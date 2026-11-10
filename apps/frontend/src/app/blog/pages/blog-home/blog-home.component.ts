import { DatePipe } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Subject, combineLatest, forkJoin, map, of, takeUntil } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { TvReadItemDTO } from '../../../api/models';
import { FaqItem, FaqSectionComponent } from '../../../components/faq-section/faq-section.component';
import { PanelNavComponent, PanelNavGroup } from '../../../components/panel-nav/panel-nav.component';
import { PanelShellComponent } from '../../../components/panel-shell/panel-shell.component';
import { PanelTileComponent } from '../../../components/panel-tile/panel-tile.component';
import { UnifiedAsyncStateComponent } from '../../../components/unified-async-state/unified-async-state.component';
import { GUIAS_LINKS, guiasCategoryGroups, guiasSectionName } from '../../../config/guias-nav';
import { STREAMING_PLATFORMS } from '../../../config/plataformas-nav';
import { APP_PATHS } from '../../../config/route-map';
import { CatalogItem, CatalogService } from '../../../services/catalog.service';
import { ChatService } from '../../../services/chat.service';
import { MetaService } from '../../../services/meta.service';
import { TvDataFacade } from '../../../state/tv-data.facade';
import { generateCollectionPageSchema, generateItemListSchema, serializeJsonLd } from '../../../utils/utils';
import { EditorialCategory, EditorialCategorySection, EditorialPost } from '../../models/editorial.models';
import { EditorialService } from '../../services/editorial.service';

const BASE_URL = 'https://guiaprogramaciontv.com';

/**
 * /guias: the editorial hub inside the shared shell. Lead story, latest guides, one block per
 * category, rankings, and "qué ver hoy" with real catalogue and tonight's free TV. Categories in the
 * left panel come from the API, so every link has posts behind it.
 */
@Component({
  selector: 'app-blog-home',
  standalone: true,
  imports: [DatePipe, RouterModule, PanelShellComponent, PanelNavComponent, PanelTileComponent, FaqSectionComponent, UnifiedAsyncStateComponent],
  templateUrl: './blog-home.component.html',
  styleUrls: ['../../../pages/que-ver/que-ver.component.scss', './blog-home.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlogHomeComponent implements OnInit, OnDestroy {
  private readonly chat = inject(ChatService);
  private readonly facade = inject(TvDataFacade);

  public readonly appPaths = APP_PATHS;
  public readonly sideLinks = GUIAS_LINKS;
  public readonly sectionName = guiasSectionName;
  public sideGroups: PanelNavGroup[] = [];
  public categories: EditorialCategory[] = [];
  public contextOpen = false;
  public readonly assistantAsks = ['¿Dónde veo LaLiga?', '¿Qué plataforma me conviene?', '¿Es legal grabar la tele?'];

  public loading = true;
  public error: string | null = null;
  public hero: EditorialPost | null = null;
  public latestPosts: EditorialPost[] = [];
  public latestStories: EditorialPost[] = [];
  /** Every published guide, newest first: the "Todas las guías" list. */
  public allPosts: EditorialPost[] = [];
  public trendPosts: EditorialPost[] = [];
  public rankingPosts: EditorialPost[] = [];
  public sections: EditorialCategorySection[] = [];
  public faq: FaqItem[] = [];
  public safeLdHtml: SafeHtml | null = null;

  // "Qué ver hoy": real catalogue and TV, so the hub links the guides with what can be watched now.
  public moviesToday: CatalogItem[] = [];
  public seriesToday: CatalogItem[] = [];
  public tvTonight: TvReadItemDTO[] = [];

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly editorialService: EditorialService,
    private readonly catalogService: CatalogService,
    private readonly metaService: MetaService,
    private readonly sanitizer: DomSanitizer,
    private readonly changeDetector: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.metaService.setMetaTags({
      title: 'Guías de streaming, fútbol y TV en España | Guía TV',
      description:
        'Dónde ver LaLiga y la Champions, precios de Netflix, HBO Max, Disney+ y Prime Video, y los mejores títulos de cada plataforma, con fuentes oficiales.',
      canonicalUrl: '/guias',
      image: '/assets/images/blog-og-image.webp',
      type: 'website',
    });
    this.loadHub();
    this.loadWatchToday();
  }

  public retry(): void {
    this.loadHub();
  }

  public trackPost(index: number, post: EditorialPost): string {
    return post.id || `${post.slug}-${index}`;
  }

  /** Streaming services a guide talks about, as links to their catalogue page. */
  public platformsFor(post: EditorialPost | null): Array<{ name: string; color: string }> {
    return (post?.relatedPlatformKeys || [])
      .map((key) => STREAMING_PLATFORMS.find((p) => p.key === key))
      .filter((p): p is (typeof STREAMING_PLATFORMS)[number] => Boolean(p))
      .map((p) => ({ name: p.name, color: p.color }));
  }

  public openAssistant(): void {
    this.chat.requestToggleAssistant();
  }

  private loadHub(): void {
    this.loading = true;
    this.error = null;
    combineLatest([
      this.editorialService.getHubState(),
      this.editorialService.getEditorialSections(),
      this.editorialService.getPosts(),
      this.editorialService.getCategories(),
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ([hub, sections, posts, categories]) => {
          this.hero = hub.hero;
          this.allPosts = posts;
          this.latestPosts = hub.latestPosts;
          this.categories = categories.filter((c) => c.count > 0);
          this.sideGroups = guiasCategoryGroups(this.categories);

          const featuredSlugs = new Set([hub.hero?.slug, ...hub.latestPosts.map((post) => post.slug)].filter(Boolean) as string[]);
          this.latestStories = posts.filter((post) => !featuredSlugs.has(post.slug)).slice(0, 6);

          // Lower sections only add stories not shown above: with a small archive they repeated the same cards.
          const shown = new Set([...featuredSlugs, ...this.latestStories.map((post) => post.slug)]);
          const unseen = (list: EditorialPost[]) => list.filter((post) => !shown.has(post.slug));
          const section = (value: EditorialCategorySection | null) => {
            const remaining = value ? unseen(value.posts) : [];
            return value && remaining.length ? { ...value, posts: remaining } : null;
          };
          this.trendPosts = unseen(hub.trendPosts);
          this.rankingPosts = hub.rankingPosts;
          this.sections = [sections.streaming, sections.cine, sections.series, ...sections.collections]
            .map(section)
            .filter((value): value is EditorialCategorySection => Boolean(value));
          this.faq = this.buildFaq(posts);
          this.buildStructuredData(posts);

          this.loading = false;
          this.changeDetector.markForCheck();
        },
        error: () => {
          this.error = 'No se han podido cargar las publicaciones. Comprueba tu conexión e inténtalo de nuevo.';
          this.metaService.markUnavailable('Guías no disponibles | Guía TV');
          this.loading = false;
          this.changeDetector.markForCheck();
        },
      });
  }

  private loadWatchToday(): void {
    const popular = (type: 'movie' | 'series') =>
      this.catalogService.queryState({ types: [type], sort: 'popular', limit: 10 }).pipe(
        map((result) => (result.data?.items || []).slice(0, 8)),
        catchError(() => of([] as CatalogItem[]))
      );
    // Tonight on free TV, one card per broadcast (the provider repeats feeds).
    const tonight$ = this.facade.getTonightPrograms({ group: 'tdt', limit: 48 }).pipe(
      map((items) => {
        const seen = new Set<string>();
        return items
          .filter((i) => {
            const key = `${i.program.title.trim().toLowerCase()}|${i.airing.start}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 8);
      }),
      catchError(() => of([] as TvReadItemDTO[]))
    );

    forkJoin({ movies: popular('movie'), series: popular('series'), tonight: tonight$ })
      .pipe(takeUntil(this.destroy$))
      .subscribe((data) => {
        this.moviesToday = data.movies;
        this.seriesToday = data.series;
        this.tvTonight = data.tonight;
        this.changeDetector.markForCheck();
      });
  }

  private buildFaq(posts: EditorialPost[]): FaqItem[] {
    const find = (re: RegExp) => posts.find((p) => re.test(p.slug));
    const laliga = find(/laliga/);
    const prices = find(/precios-plataformas/);
    const legal = find(/grabar-tele|copia-privada/);
    return [
      { question: '¿Qué tipo de guías publica Guía TV?', answer: `Guías prácticas sobre streaming, fútbol y televisión en España: dónde ver cada competición, precios y planes de las plataformas, rankings de lo mejor de cada servicio y normativa de TV. Ahora mismo hay ${posts.length} guías publicadas.` },
      { question: '¿Dónde ver LaLiga esta temporada?', answer: laliga ? `Lo explicamos en «${laliga.title}», con los canales y plataformas que emiten cada jornada.` : 'En la sección de fútbol tienes cada partido con el canal que lo emite.' },
      { question: '¿Cuánto cuestan las plataformas de streaming?', answer: prices ? `Tienes todos los precios en «${prices.title}» y la comparativa al día en el comparador de plataformas.` : 'Consulta el comparador de plataformas para ver precio, pantallas y calidad de cada servicio.' },
      { question: '¿Es legal grabar la televisión?', answer: legal ? `Sí, con matices: lo contamos en «${legal.title}».` : 'La copia privada permite grabar para uso personal; lo explicamos en las guías de televisión.' },
      { question: '¿Cada cuánto se actualizan las guías?', answer: 'Revisamos precios, derechos de emisión y rankings cuando cambian, y cada guía indica su fecha de actualización.' },
    ];
  }

  private buildStructuredData(posts: EditorialPost[]): void {
    const collection = generateCollectionPageSchema(
      {
        name: 'Guías de streaming, fútbol y TV',
        description: 'Dónde ver cada competición, precios de las plataformas de streaming en España y rankings por servicio, con fuentes oficiales.',
        path: '/guias',
      },
      BASE_URL
    );
    const list = generateItemListSchema(
      posts.slice(0, 10).map((p) => ({ title: p.title, detailPath: p.canonicalPath, image: p.coverImage })),
      'Guías de Guía TV',
      BASE_URL
    );
    this.safeLdHtml = this.sanitizer.bypassSecurityTrustHtml(
      [collection, list].map((s) => `<script type="application/ld+json">${serializeJsonLd(s)}</script>`).join('')
    );
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
