import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subject, combineLatest, map, of, startWith, switchMap, takeUntil } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { APP_PATHS } from '../../../config/route-map';
import { FaqItem, FaqSectionComponent } from '../../../components/faq-section/faq-section.component';
import { PanelNavComponent, PanelNavGroup } from '../../../components/panel-nav/panel-nav.component';
import { PanelShellComponent } from '../../../components/panel-shell/panel-shell.component';
import { PanelTileComponent } from '../../../components/panel-tile/panel-tile.component';
import { GUIAS_LINKS, GUIAS_PLATFORM_CATEGORIES, GUIAS_SECTIONS, guiasCategoryGroups, guiasSectionName } from '../../../config/guias-nav';
import { CatalogItem } from '../../../services/catalog.service';
import { ChatService } from '../../../services/chat.service';
import { TvDataFacade } from '../../../state/tv-data.facade';
import { EditorialCategory } from '../../models/editorial.models';
import { MetaService } from '../../../services/meta.service';
import { EditorialCategoryPageState } from '../../models/editorial.models';
import { EditorialPost } from '../../models/editorial.models';
import { EditorialService } from '../../services/editorial.service';
import { generateCollectionPageSchema, generateItemListSchema, serializeJsonLd } from '../../../utils/utils';
import { UnifiedAsyncStateComponent } from '../../../components/unified-async-state/unified-async-state.component';

@Component({
  selector: 'app-category',
  standalone: true,
  imports: [DatePipe, RouterModule, PanelShellComponent, PanelNavComponent, PanelTileComponent, FaqSectionComponent, UnifiedAsyncStateComponent],
  templateUrl: './category.component.html',
  styleUrls: ['../../../pages/que-ver/que-ver.component.scss', '../blog-home/blog-home.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoryComponent implements OnInit, OnDestroy {
  public readonly appPaths = APP_PATHS;
  public loading = true;
  public error: string | null = null;
  public notFound = false;
  public state: EditorialCategoryPageState | null = null;
  public safeLdHtml: SafeHtml | null = null;
  public readonly sideLinks = GUIAS_LINKS;
  public readonly sectionName = guiasSectionName;
  public sideGroups: PanelNavGroup[] = [];
  public categories: EditorialCategory[] = [];
  public contextOpen = false;
  /** For a platform category ("Netflix"): its streaming name and its most watched titles. */
  public platform = '';
  public platformItems: CatalogItem[] = [];
  public faq: FaqItem[] = [];
  /** The section is in the menu but has no guides yet. */
  public upcoming = false;
  /** Latest guides, shown in sections with few or no guides of their own. */
  public latest: EditorialPost[] = [];
  private readonly chat = inject(ChatService);
  private readonly facade = inject(TvDataFacade);

  private readonly destroy$ = new Subject<void>();
  private readonly retryTrigger$ = new Subject<void>();

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly editorialService: EditorialService,
    private readonly metaService: MetaService,
    private readonly sanitizer: DomSanitizer,
    private readonly changeDetector: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
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
          return this.editorialService.getCategoryPageState(slug).pipe(
            map((state) => ({ state, failed: false, slug })),
            catchError(() => of({ state: null, failed: true, slug }))
          );
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: ({ state, failed, slug }) => {
          this.upcoming = false;
          if (failed) {
            this.error = 'No se ha podido cargar esta categoría. Comprueba tu conexión e inténtalo de nuevo.';
            this.metaService.markUnavailable('Categoría no disponible | Guía TV');
            this.loading = false;
            this.changeDetector.markForCheck();
            return;
          }
          if (!state && GUIAS_SECTIONS[slug]) {
            // A menu section with no guides yet: a real page (200, noindex) with related content, not a 404.
            state = this.upcomingState(slug);
            this.upcoming = true;
          }
          if (!state) {
            // Unknown slug: a real 404, not a redirect to the hub (which search engines read as a soft 404).
            this.notFound = true;
            this.loading = false;
            this.metaService.setMetaTags({
              title: 'Categoría no encontrada | Guía TV',
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
          this.enrich(state);
          this.metaService.setMetaTags({
            title: `Guías de ${state.category.name} | Guía TV`,
            description:
              state.category.description ||
              `Artículos y rankings editoriales relacionados con ${state.category.name}.`,
            canonicalUrl: state.category.canonicalPath,
            image:
              state.featuredPost?.coverImage || '/assets/images/blog-og-image.webp',
            type: 'website',
            robots: !this.upcoming && [state.featuredPost, ...state.posts, ...state.relatedRankings].filter(Boolean).length >= 3
              ? 'index, follow'
              : 'noindex, follow',
          });
          this.buildStructuredData(state);
          this.changeDetector.markForCheck();
        },
      });
  }

  /** Category page state for a menu section with no guides yet. */
  private upcomingState(slug: string): EditorialCategoryPageState {
    const section = GUIAS_SECTIONS[slug];
    return {
      category: { id: 0, name: section.name, slug, description: section.description, count: 0, canonicalPath: `${APP_PATHS.blog}/categoria/${slug}`, isRankingCategory: false },
      featuredPost: null,
      posts: [],
      relatedRankings: [],
      siblingCategories: [],
    };
  }

  public openAssistant(): void {
    this.chat.requestToggleAssistant();
  }

  /** Menu with the current category marked, the platform catalogue for platform categories, and the FAQ. */
  private enrich(state: EditorialCategoryPageState): void {
    const slug = state.category.slug;
    // The menu's name and copy for the section ("TV y legislación" for the API's "Televisión").
    const section = GUIAS_SECTIONS[slug];
    if (section) {
      state.category = { ...state.category, name: section.name, description: state.category.description || section.description };
    }
    this.latest = [];
    if (!state.featuredPost && state.posts.length < 3) {
      this.editorialService
        .getPosts()
        .pipe(catchError(() => of([] as EditorialPost[])), takeUntil(this.destroy$))
        .subscribe((posts) => {
          const own = new Set([state.featuredPost?.slug, ...state.posts.map((p) => p.slug)]);
          this.latest = posts.filter((p) => !own.has(p.slug)).slice(0, 6);
          this.changeDetector.markForCheck();
        });
    }
    this.editorialService
      .getCategories()
      .pipe(catchError(() => of([] as EditorialCategory[])), takeUntil(this.destroy$))
      .subscribe((categories) => {
        this.categories = categories.filter((c) => c.count > 0);
        this.sideGroups = guiasCategoryGroups(this.categories);
        this.changeDetector.markForCheck();
      });
    this.platform = GUIAS_PLATFORM_CATEGORIES[slug] || '';
    this.platformItems = [];
    if (this.platform) {
      this.facade
        .discoverContent({ types: ['movie', 'series'], platforms: [this.platform], sort: 'popular', limit: 24 })
        .pipe(map((r) => r.items.slice(0, 12) as CatalogItem[]), catchError(() => of([] as CatalogItem[])), takeUntil(this.destroy$))
        .subscribe((items) => {
          this.platformItems = items;
          this.changeDetector.markForCheck();
        });
    }
    const posts = [state.featuredPost, ...state.posts].filter((p): p is EditorialPost => Boolean(p));
    const name = state.category.name;
    this.faq = [
      { question: `¿Qué guías hay sobre ${name}?`, answer: posts.length ? `${posts.slice(0, 3).map((p) => `«${p.title}»`).join(', ')}${posts.length > 3 ? ' y más' : ''}.` : `Estamos preparando guías sobre ${name}.` },
      ...(this.platform
        ? [
            { question: `¿Qué ver en ${this.platform}?`, answer: `En esta página tienes lo más visto ahora en ${this.platform}; en Plataformas, su catálogo completo, sus novedades y su precio.` },
            { question: `¿Cuánto cuesta ${this.platform}?`, answer: `Tienes todos sus planes y precios en Plataformas y en el comparador de plataformas de streaming.` },
          ]
        : []),
      ...posts.flatMap((p) => p.faqItems || []).slice(0, 3),
    ];
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  public retry(): void {
    this.retryTrigger$.next();
  }

  public trackPost(_index: number, post: EditorialPost): string {
    return post.slug;
  }

  public get breadcrumbItems(): Array<{ name: string; url: string }> {
    return [
      { name: 'Inicio', url: APP_PATHS.home },
      { name: 'Guías', url: APP_PATHS.blog },
      ...(this.state ? [{ name: this.state.category.name, url: this.state.category.canonicalPath }] : []),
    ];
  }

  private buildStructuredData(state: EditorialCategoryPageState): void {
    const baseUrl = 'https://guiaprogramaciontv.com';
    const schemas = [
      generateCollectionPageSchema(
        {
          name: `${state.category.name}: guías`,
          description:
            state.category.description ||
            `Coleccion editorial de ${state.category.name} en Guia TV.`,
          path: state.category.canonicalPath,
        },
        baseUrl
      ),
      generateItemListSchema(
        [state.featuredPost, ...state.posts]
          .filter((post): post is NonNullable<typeof post> => Boolean(post))
          .map((post) => ({
            title: post.title,
            detailPath: post.canonicalPath,
            image: post.coverImage,
          })),
        `${state.category.name}: guías`,
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
