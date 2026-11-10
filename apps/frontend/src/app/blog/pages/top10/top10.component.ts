import { DatePipe } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subject, catchError, map, of, takeUntil } from 'rxjs';
import { FaqItem, FaqSectionComponent } from '../../../components/faq-section/faq-section.component';
import { PanelNavComponent, PanelNavGroup } from '../../../components/panel-nav/panel-nav.component';
import { PanelShellComponent } from '../../../components/panel-shell/panel-shell.component';
import { PanelTileComponent } from '../../../components/panel-tile/panel-tile.component';
import { UnifiedAsyncStateComponent } from '../../../components/unified-async-state/unified-async-state.component';
import { GUIAS_LINKS, GUIAS_PLATFORM_CATEGORIES, guiasCategoryGroups } from '../../../config/guias-nav';
import { APP_PATHS } from '../../../config/route-map';
import { CatalogItem } from '../../../services/catalog.service';
import { ChatService } from '../../../services/chat.service';
import { MetaService } from '../../../services/meta.service';
import { TvDataFacade } from '../../../state/tv-data.facade';
import { generateCollectionPageSchema, generateItemListSchema, serializeJsonLd } from '../../../utils/utils';
import { EditorialCategory, EditorialPost } from '../../models/editorial.models';
import { EditorialService } from '../../services/editorial.service';

const BASE_URL = 'https://guiaprogramaciontv.com';

/**
 * /guias/rankings: every ranking, filtered by platform with a link (?categoria=netflix), plus the
 * platform's most watched titles when one is chosen. Indexable only when there are rankings.
 */
@Component({
  selector: 'app-top10',
  standalone: true,
  imports: [DatePipe, RouterModule, PanelShellComponent, PanelNavComponent, PanelTileComponent, FaqSectionComponent, UnifiedAsyncStateComponent],
  templateUrl: './top10.component.html',
  styleUrls: ['../../../pages/que-ver/que-ver.component.scss', '../blog-home/blog-home.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Top10Component implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly chat = inject(ChatService);
  private readonly facade = inject(TvDataFacade);

  public readonly appPaths = APP_PATHS;
  public readonly sideLinks = GUIAS_LINKS;
  public sideGroups: PanelNavGroup[] = [];
  public contextOpen = false;

  public loading = true;
  public error: string | null = null;
  public featured: EditorialPost | null = null;
  public posts: EditorialPost[] = [];
  /** Categories of the rankings (the platforms), for the filter. */
  public categories: EditorialCategory[] = [];
  public selectedCategory = 'all';
  public platformItems: CatalogItem[] = [];
  public faq: FaqItem[] = [];
  public safeLdHtml: SafeHtml | null = null;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly editorialService: EditorialService,
    private readonly metaService: MetaService,
    private readonly sanitizer: DomSanitizer,
    private readonly changeDetector: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.editorialService
      .getCategories()
      .pipe(catchError(() => of([] as EditorialCategory[])), takeUntil(this.destroy$))
      .subscribe((categories) => {
        this.sideGroups = guiasCategoryGroups(categories);
        this.changeDetector.markForCheck();
      });
    this.loadRankings();
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.selectedCategory = params.get('categoria') || 'all';
      this.applySelection();
    });
  }

  private loadRankings(): void {
    this.loading = true;
    this.error = null;
    this.changeDetector.markForCheck();

    this.editorialService
      .getRankingsPageState()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (state) => {
          this.featured = state.featured;
          this.posts = state.posts;
          this.categories = state.categories.filter((c) => c.slug !== 'rankings');
          this.loading = false;
          this.applySelection();
        },
        error: () => {
          this.error = 'No se han podido cargar los rankings. Comprueba tu conexión e inténtalo de nuevo.';
          this.loading = false;
          this.changeDetector.markForCheck();
        },
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  public retry(): void {
    this.loadRankings();
  }

  public openAssistant(): void {
    this.chat.requestToggleAssistant();
  }

  public trackPost(_index: number, post: EditorialPost): string {
    return post.slug;
  }

  public get platformName(): string {
    return GUIAS_PLATFORM_CATEGORIES[this.selectedCategory] || '';
  }

  public get filteredPosts(): EditorialPost[] {
    if (this.selectedCategory === 'all') return this.posts;
    return this.posts.filter((post) => post.categories.some((category) => category.slug === this.selectedCategory));
  }

  public get selectedCategoryName(): string {
    const category = this.categories.find((item) => item.slug === this.selectedCategory);
    return category ? category.name : '';
  }

  /** Meta, structured data, FAQ and the platform rail for the current filter. */
  private applySelection(): void {
    const name = this.selectedCategoryName;
    const empty = !this.loading && !this.featured && !this.posts.length;
    this.metaService.setMetaTags({
      title: name ? `Rankings de ${name}: las mejores series y películas | Guía TV` : 'Rankings: lo mejor de cada plataforma de streaming | Guía TV',
      description: name
        ? `Las mejores series y películas de ${name} en España, elegidas con criterio editorial y conectadas con su catálogo real.`
        : 'Las mejores series y películas de Netflix, Prime Video, Disney+, HBO Max y Movistar Plus+, con criterio editorial y sin ordenar por comisión.',
      // MetaService drops the query: each platform filter consolidates on the rankings hub.
      canonicalUrl: '/guias/rankings',
      image: '/assets/images/blog-og-image.webp',
      type: 'website',
      // An empty hub is not worth indexing; it returns to the index once a ranking is published.
      robots: empty ? 'noindex, follow' : undefined,
    });
    this.buildStructuredData();
    this.faq = [
      { question: '¿Cómo elegimos los rankings?', answer: 'Por criterio editorial: valoración, popularidad en España y disponibilidad real en cada plataforma. Nunca ordenamos por comisión comercial.' },
      { question: '¿Cada cuánto se actualizan?', answer: 'Revisamos cada ranking cuando cambia el catálogo de la plataforma; cada uno indica su fecha de actualización.' },
      ...this.filteredPosts.slice(0, 3).map((p) => ({ question: `¿Qué incluye «${p.title}»?`, answer: p.excerptText || 'Una selección editorial de los mejores títulos de la plataforma.' })),
    ];
    this.platformItems = [];
    const platform = this.platformName;
    if (platform) {
      this.facade
        .discoverContent({ types: ['movie', 'series'], platforms: [platform], sort: 'popular', limit: 24 })
        .pipe(map((r) => r.items.slice(0, 12) as CatalogItem[]), catchError(() => of([] as CatalogItem[])), takeUntil(this.destroy$))
        .subscribe((items) => {
          this.platformItems = items;
          this.changeDetector.markForCheck();
        });
    }
    this.changeDetector.markForCheck();
  }

  private buildStructuredData(): void {
    const schemas = [
      generateCollectionPageSchema(
        { name: 'Rankings de Guía TV', description: 'Las mejores series y películas de cada plataforma de streaming en España.', path: '/guias/rankings' },
        BASE_URL
      ),
      generateItemListSchema(
        this.filteredPosts.map((post) => ({ title: post.title, detailPath: post.canonicalPath, image: post.coverImage })),
        'Rankings de Guía TV',
        BASE_URL
      ),
    ];
    this.safeLdHtml = this.sanitizer.bypassSecurityTrustHtml(
      schemas.map((schema) => `<script type="application/ld+json">${serializeJsonLd(schema)}</script>`).join('')
    );
  }
}
