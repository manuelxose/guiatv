import { DatePipe, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, Inject, OnDestroy, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subject, combineLatest, forkJoin, map, of, startWith, switchMap, takeUntil } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { TvReadItemDTO } from '../../../api/models';
import { PanelNavComponent, PanelNavGroup } from '../../../components/panel-nav/panel-nav.component';
import { PanelShellComponent } from '../../../components/panel-shell/panel-shell.component';
import { PanelTileComponent } from '../../../components/panel-tile/panel-tile.component';
import { GUIAS_LINKS, guiasCategoryGroups } from '../../../config/guias-nav';
import { STREAMING_PLATFORMS } from '../../../config/plataformas-nav';
import { ChatService } from '../../../services/chat.service';
import { TvDataFacade } from '../../../state/tv-data.facade';
import { EditorialCategory } from '../../models/editorial.models';
import { FaqSectionComponent } from '../../../components/faq-section/faq-section.component';
import { ShareButtonsComponent } from '../../../components/share-buttons/share-buttons.component';
import { APP_PATHS } from '../../../config/route-map';
import { CatalogItem, CatalogService } from '../../../services/catalog.service';
import { MetaService } from '../../../services/meta.service';
import { generateEditorialArticleSchema, serializeJsonLd } from '../../../utils/utils';
import { EditorialPost, EditorialPostPageState, EditorialTocItem } from '../../models/editorial.models';
import { EditorialService } from '../../services/editorial.service';
import { BlogAffiliateBlockComponent } from '../../components/blog-affiliate-block/blog-affiliate-block.component';
import { UnifiedAsyncStateComponent } from '../../../components/unified-async-state/unified-async-state.component';

interface TrendingItem {
  title: string;
  path: string;
  platform?: string;
  category?: string;
}

@Component({
  selector: 'app-post-detail',
  standalone: true,
  imports: [DatePipe, RouterModule, PanelShellComponent, PanelNavComponent, PanelTileComponent, ShareButtonsComponent, BlogAffiliateBlockComponent, FaqSectionComponent, UnifiedAsyncStateComponent],
  templateUrl: './post-detail.component.html',
  styleUrls: ['../../../pages/que-ver/que-ver.component.scss', '../blog-home/blog-home.component.scss', './post-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PostDetailComponent implements OnInit, OnDestroy {
  public readonly appPaths = APP_PATHS;
  public readonly isBrowser: boolean;
  public loading = true;
  public error: string | null = null;
  public notFound = false;
  public state: EditorialPostPageState | null = null;
  public currentUrl = '';
  public safeLdHtml: SafeHtml | null = null;
  public platformRailItems: CatalogItem[] = [];
  public exploreRailItems: CatalogItem[] = [];
  public guideRailItems: TvReadItemDTO[] = [];
  public readonly sideLinks = GUIAS_LINKS;
  public sideGroups: PanelNavGroup[] = [];
  public contextOpen = false;
  private readonly chat = inject(ChatService);
  private readonly facade = inject(TvDataFacade);
  public trendingItems: TrendingItem[] = [];
  /** Article body with an id on every H2/H3, and the table of contents built from them. */
  public bodyHtml = '';
  public toc: EditorialTocItem[] = [];
  /** How far the reader has scrolled through the page (0-100), for the progress bar. */
  public readonly progress = signal(0);
  /** "Sigue leyendo": the related guides, or the latest ones when a guide has none (the page never ends bare). */
  public morePosts: EditorialPost[] = [];
  private readonly host = inject(ElementRef<HTMLElement>);
  /** Scroll events do not bubble, but a capture listener on the document sees the shell's <main> scrolling. */
  private readonly onScroll = (event: Event) => {
    const el = event.target as HTMLElement | null;
    if (el?.id !== 'panel-main') return;
    const max = el.scrollHeight - el.clientHeight;
    const next = max > 0 ? Math.min(100, Math.round((el.scrollTop / max) * 100)) : 0;
    // A signal: the listener runs outside a change-detection turn, and markForCheck alone did not repaint.
    this.progress.set(next);
  };

  private readonly destroy$ = new Subject<void>();
  private readonly retryTrigger$ = new Subject<void>();

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly editorialService: EditorialService,
    private readonly metaService: MetaService,
    private readonly sanitizer: DomSanitizer,
    private readonly catalogService: CatalogService,
    private readonly changeDetector: ChangeDetectorRef,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    if (this.isBrowser) document.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
  }

  ngOnInit(): void {
    this.editorialService
      .getCategories()
      .pipe(catchError(() => of([] as EditorialCategory[])), takeUntil(this.destroy$))
      .subscribe((categories) => {
        this.sideGroups = guiasCategoryGroups(categories);
        this.changeDetector.markForCheck();
      });
    combineLatest([
      this.route.paramMap,
      this.retryTrigger$.pipe(startWith(undefined)),
    ])
      .pipe(
        map(([params]) => params.get('slug') || ''),
        switchMap((slug) => {
          this.loading = true;
          this.error = null;
          this.notFound = false;
          this.state = null;
          this.changeDetector.markForCheck();
          return this.editorialService.getPostPageState(slug).pipe(
            map((state) => ({ state, failed: false })),
            catchError(() => of({ state: null, failed: true }))
          );
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: ({ state, failed }) => {
          if (failed) {
            this.error = 'No se ha podido cargar este artículo. Comprueba tu conexión e inténtalo de nuevo.';
            this.metaService.markUnavailable('Artículo no disponible | Guía TV');
            this.loading = false;
            this.changeDetector.markForCheck();
            return;
          }
          if (!state) {
            // Unknown slug: a real 404, not a redirect to the hub (which search engines read as a soft 404).
            this.notFound = true;
            this.loading = false;
            this.metaService.setMetaTags({
              title: 'Artículo no encontrado | Guía TV',
              description: 'La página que buscas no existe o ha cambiado de dirección.',
              canonicalUrl: null,
              robots: 'noindex, nofollow',
              httpStatus: 404,
            });
            this.changeDetector.markForCheck();
            return;
          }

          this.state = state;
          this.loading = false;
          this.error = null;
          const body = withHeadingIds(state.post.contentHtml || '');
          this.bodyHtml = body.html;
          this.toc = state.post.tocItems.length ? state.post.tocItems : body.toc;
          this.currentUrl = this.isBrowser
            ? window.location.href
            : `https://guiaprogramaciontv.com${state.post.canonicalPath}`;

          this.metaService.setMetaTags({
            title: state.post.metaTitle || `${state.post.title} | Guía TV`,
            description:
              state.post.metaDescription || state.post.excerptText || 'Artículo editorial de Guía TV.',
            canonicalUrl: state.post.canonicalPath,
            image: state.post.coverImage,
            type: 'article',
            publishedTime: state.post.publishedAt,
            modifiedTime: state.post.modifiedAt,
            section: state.post.primaryCategory?.name || state.post.contentType,
          });

          this.buildStructuredData(state);
          this.loadLinkedModules(state.post);
          this.changeDetector.markForCheck();

          if (this.isBrowser) {
            // Angular's sanitizer strips `id` from injected HTML: give the headings their anchors once rendered.
            this.applyHeadingIds();
            this.progress.set(0);
          }
        },
      });
  }

  ngOnDestroy(): void {
    if (this.isBrowser) document.removeEventListener('scroll', this.onScroll, true);
    this.destroy$.next();
    this.destroy$.complete();
  }

  public retry(): void {
    this.retryTrigger$.next();
  }

  /**
   * Sets the contents-list ids on the rendered H2/H3 (same order and filter as withHeadingIds), then honours a
   * #fragment. Retries briefly: the body renders after the state arrives (and hydration may swap the DOM).
   */
  private applyHeadingIds(tries = 0): void {
    const root: HTMLElement = this.host.nativeElement;
    const headings = Array.from(root.querySelectorAll<HTMLElement>('.post-content h2, .post-content h3')).filter((h) => h.textContent?.trim());
    if (!headings.length || !root.isConnected) {
      if (this.toc.length && tries < 25) setTimeout(() => this.applyHeadingIds(tries + 1), 120);
      return;
    }
    headings.forEach((h, i) => {
      if (!h.id && this.toc[i]) h.id = this.toc[i].id;
    });
    const fragment = window.location.hash.slice(1);
    if (fragment) document.getElementById(decodeURIComponent(fragment))?.scrollIntoView({ block: 'start' });
  }

  /** Author initials for the byline avatar ("Redacción IA de Guía TV" → "RG"). */
  public get authorInitials(): string {
    const name = this.state?.post.author?.name || 'Guía TV';
    const words = name.split(/\s+/).filter((w) => /^[A-ZÁÉÍÓÚÑ]/.test(w));
    return ((words[0]?.[0] || 'G') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
  }

  public openAssistant(): void {
    this.chat.requestToggleAssistant();
  }

  /** Streaming services the article talks about, linked to their catalogue page. */
  public get relatedPlatforms(): Array<{ name: string; color: string }> {
    return (this.state?.post.relatedPlatformKeys || [])
      .map((key) => STREAMING_PLATFORMS.find((p) => p.key === key))
      .filter((p): p is (typeof STREAMING_PLATFORMS)[number] => Boolean(p))
      .map((p) => ({ name: p.name, color: p.color }));
  }

  public hasRouteRelation(key: string): boolean {
    return this.state?.post.relatedRouteKeys.includes(key as any) ?? false;
  }

  public get breadcrumbItems(): Array<{ name: string; url: string }> {
    return [
      { name: 'Inicio', url: APP_PATHS.home },
      { name: 'Guías', url: APP_PATHS.blog },
      ...(this.state?.post.primaryCategory
        ? [{ name: this.state.post.primaryCategory.name, url: this.state.post.primaryCategory.canonicalPath }]
        : []),
      ...(this.state ? [{ name: this.state.post.title, url: this.state.post.canonicalPath }] : []),
    ];
  }

  public get showUpdatedDate(): boolean {
    const published = new Date(this.state?.post.publishedAt || 0).getTime();
    const modified = new Date(this.state?.post.modifiedAt || 0).getTime();
    return Number.isFinite(published) && Number.isFinite(modified) && modified - published >= 86_400_000;
  }

  private loadLinkedModules(post: EditorialPostPageState['post']): void {
    this.platformRailItems = [];
    this.exploreRailItems = [];
    this.guideRailItems = [];
    this.trendingItems = [];
    this.morePosts = this.state?.relatedPosts ?? [];
    if (!this.morePosts.length) {
      this.editorialService
        .getPosts()
        .pipe(catchError(() => of([] as EditorialPost[])), takeUntil(this.destroy$))
        .subscribe((posts) => {
          this.morePosts = posts.filter((p) => p.slug !== post.slug).slice(0, 4);
          this.changeDetector.markForCheck();
        });
    }

    const platformItems$ =
      post.relatedRouteKeys.includes('platforms') && post.relatedPlatformKeys.length
        ? this.catalogService
            .queryState({
              types: ['movie', 'series'],
              platforms: post.relatedPlatformKeys,
              availability: ['streaming'],
              sort: 'popular',
              limit: 8,
            })
            .pipe(
              map((result) => result.data?.items || []),
              catchError(() => of([]))
            )
        : of([] as CatalogItem[]);

    const exploreItems$ = post.relatedRouteKeys.includes('explore')
      ? this.catalogService
          .queryState({
            types: ['movie', 'series'],
            sort: 'popular',
            limit: 8,
            ...(post.relatedPlatformKeys.length
              ? { platforms: post.relatedPlatformKeys.slice(0, 2) }
              : {}),
          })
          .pipe(
            map((result) => result.data?.items || []),
            catchError(() => of([]))
          )
      : of([] as CatalogItem[]);

    // Tonight on free TV (the old "live, by airtime" query surfaced minor channels mid-morning), one per broadcast.
    const guideItems$ = post.relatedRouteKeys.includes('guide')
      ? this.facade.getTonightPrograms({ group: 'tdt', limit: 48 }).pipe(
          map((items) => {
            const seen = new Set<string>();
            return items.filter((i) => {
              const key = `${i.program.title.trim().toLowerCase()}|${i.airing.start}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            }).slice(0, 8);
          }),
          catchError(() => of([] as TvReadItemDTO[]))
        )
      : of([] as TvReadItemDTO[]);

    const trendingItems$ = post.relatedRouteKeys.includes('stats')
      ? this.catalogService
          .queryState({
            types: ['movie', 'series'],
            sort: 'popular',
            limit: 4,
          })
          .pipe(
            map((result) =>
              (result.data?.items || []).map((item) => ({
                title: item.title,
                path: item.detailPath || APP_PATHS.explore,
                platform: item.primaryPlatforms?.[0] || item.channel?.name,
                category: item.genres?.[0],
              }))
            ),
            catchError(() => of([] as TrendingItem[]))
          )
      : of([] as TrendingItem[]);

    forkJoin({
      platformRailItems: platformItems$,
      exploreRailItems: exploreItems$,
      guideRailItems: guideItems$,
      trendingItems: trendingItems$,
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe((modules) => {
        this.platformRailItems = modules.platformRailItems;
        this.exploreRailItems = modules.exploreRailItems;
        this.guideRailItems = modules.guideRailItems;
        this.trendingItems = modules.trendingItems.slice(0, 4);
        this.changeDetector.markForCheck();
      });
  }

  private buildStructuredData(state: EditorialPostPageState): void {
    const baseUrl = 'https://guiaprogramaciontv.com';
    const schemas = [
      generateEditorialArticleSchema(
        {
          title: state.post.title,
          excerptText: state.post.excerptText,
          coverImage: state.post.coverImage,
          publishedAt: state.post.publishedAt,
          modifiedAt: state.post.modifiedAt,
          canonicalPath: state.post.canonicalPath,
          contentType: state.post.contentType,
          targetQuery: state.post.targetQuery,
          author: state.post.author,
        },
        baseUrl
      ),
    ];
    this.safeLdHtml = this.sanitizer.bypassSecurityTrustHtml(
      schemas
        .map((schema) => `<script type="application/ld+json">${serializeJsonLd(schema)}</script>`)
        .join('')
    );
  }
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&#039;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };

/**
 * Gives every H2/H3 of the article an id (kept when it already has one) and returns the contents list
 * built from them: the posts arrive without one, and the index is what makes a long guide skimmable.
 */
export function withHeadingIds(html: string): { html: string; toc: EditorialTocItem[] } {
  const toc: EditorialTocItem[] = [];
  const used = new Set<string>();
  const out = html.replace(/<h([23])([^>]*)>([\s\S]*?)<\/h\1>/gi, (match, level: string, attrs: string, inner: string) => {
    const label = inner.replace(/<[^>]+>/g, '').replace(/&[#a-z0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e).replace(/\s+/g, ' ').trim();
    if (!label) return match;
    const existing = /\sid=["']([^"']+)["']/i.exec(attrs)?.[1];
    let id = existing || label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'seccion';
    if (!existing) {
      const base = id;
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    }
    used.add(id);
    toc.push({ id, label, level: Number(level) as 2 | 3 });
    return existing ? match : `<h${level}${attrs} id="${id}">${inner}</h${level}>`;
  });
  return { html: out, toc };
}
