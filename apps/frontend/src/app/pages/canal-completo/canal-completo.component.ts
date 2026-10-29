import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subject, first, takeUntil } from 'rxjs';
import { ApiConfigService } from 'src/app/api/api-config.service';
import {
  ChannelMetaDTO,
  TvChannelSurfaceDTO,
  TvReadChannelSummaryDTO,
  TvReadItemDTO,
} from 'src/app/api/models';
import { ChannelCardComponent } from 'src/app/components/channel-card/channel-card.component';
import { BreadcrumbComponent, BreadcrumbItem } from 'src/app/components/breadcrumb/breadcrumb.component';
import { InteractionButtonsComponent } from 'src/app/components/interaction-buttons/interaction-buttons.component';
import { UnifiedAsyncStateComponent } from 'src/app/components/unified-async-state/unified-async-state.component';
import { UnifiedSkeletonBlockComponent } from 'src/app/components/unified-skeleton-block/unified-skeleton-block.component';
import { UnifiedProgramCardComponent } from 'src/app/components/unified-program-card/unified-program-card.component';
import { MetaService } from 'src/app/services/meta.service';
import { TvDataService } from 'src/app/state/tv-data.service';
import { AffiliateService } from 'src/app/services/affiliate.service';
import { AffiliateCTAComponent } from 'src/app/components/affiliate-cta/affiliate-cta.component';
import { AffiliateDisclosureComponent } from 'src/app/components/affiliate-disclosure/affiliate-disclosure.component';
import { AffiliateImpressionDirective } from 'src/app/directives/affiliate-impression.directive';
import { AffiliateContext, AffiliateResolvedOffer } from 'src/app/interfaces/affiliate.interface';
import {
  CatalogContentType,
} from 'src/app/utils/catalog';
import { normalizeToCard } from 'src/app/utils/tv-normalizers';
import { normalizePublicImageUrl } from 'src/app/utils/media-url';
import { slugify } from 'src/app/utils/utils';
import { channelCanonicalPath } from '../../config/route-map';
import { formatMadridHM } from '../../utils/madrid-time';

type GuideQuickCategory = 'all' | 'Cine' | 'Series' | 'Deportes';
type DayAlias = 'today' | 'tomorrow' | 'after_tomorrow';

interface DayOption {
  label: string;
  value: DayAlias;
}

interface ChannelProgram {
  id: string;
  title: string;
  description?: string;
  category?: string;
  normalizedCategory: string;
  contentType: CatalogContentType;
  image?: string;
  start: string;
  end: string;
  liveNow: boolean;
  detailPath: string;
  durationMinutes?: number;
  /** Original DTO, kept so shared card components (UnifiedProgramCard) can be fed directly. */
  raw: TvReadItemDTO;
}

const PRIMARY_GUIDE_CATEGORIES: Array<{ key: GuideQuickCategory; label: string }> = [
  { key: 'all', label: 'Todos' },
  { key: 'Cine', label: 'Cine' },
  { key: 'Series', label: 'Series' },
  { key: 'Deportes', label: 'Deportes' },
];

@Component({
  selector: 'app-canal-completo',
  standalone: true,
  templateUrl: './canal-completo.component.html',
  styleUrls: ['./canal-completo.component.scss'],
  imports: [
    CommonModule,
    RouterModule,
    ChannelCardComponent,
    BreadcrumbComponent,
    InteractionButtonsComponent,
    UnifiedAsyncStateComponent,
    UnifiedSkeletonBlockComponent,
    UnifiedProgramCardComponent,
    AffiliateCTAComponent,
    AffiliateDisclosureComponent,
    AffiliateImpressionDirective,
  ],
})
export class CanalCompletoComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tvDataService = inject(TvDataService);
  private readonly metaService = inject(MetaService);
  private readonly apiConfig = inject(ApiConfigService);
  private readonly affiliateService = inject(AffiliateService);
  private readonly destroy$ = new Subject<void>();

  public readonly days: DayOption[] = [
    { label: 'Hoy', value: 'today' },
    { label: 'Mañana', value: 'tomorrow' },
    { label: 'Pasado', value: 'after_tomorrow' },
  ];
  public readonly quickCategoryTabs = PRIMARY_GUIDE_CATEGORIES;

  public query = '';
  public canal = '';

  get breadcrumbItems(): BreadcrumbItem[] {
    return [
      { name: 'Inicio', url: '/' },
      { name: 'Canales', url: '/canales' },
      { name: this.canal, url: channelCanonicalPath(this.canonicalChannel || this.channel, this.query) },
    ];
  }
  public logo = '';
  public channel: ChannelMetaDTO | null = null;
  /** M10-C: set on a second-feed alias page; canonical, breadcrumb and the SSR 301 point to this channel. */
  public canonicalChannel: TvChannelSurfaceDTO['canonicalChannel'] | null = null;
  public channelDescription: string | null = null;
  public isLoading = true;
  public error: string | null = null;
  public channelNotFound = false;
  public diaSeleccionado = 'Hoy';
  public activeDayAlias: DayAlias = 'today';
  public selectedCategory: string = 'all';
  public isMoreCategoriesOpen = false;
  public readonly posterFallback = '/assets/images/default-movie-poster.svg';

  public programs: ChannelProgram[] = [];
  public currentProgram: ChannelProgram | null = null;
  public nextPrograms: ChannelProgram[] = [];
  public tonightPrograms: ChannelProgram[] = [];
  public relatedChannels: TvReadChannelSummaryDTO[] = [];

  /** Verified provider offer(s) for this channel — empty when no merchant alias matches, which is the common case and renders nothing. */
  public channelAffiliateOffers: AffiliateResolvedOffer[] = [];
  public showChannelSponsoredDisclosure = false;

  ngOnInit(): void {
    this.route.paramMap
      .pipe(takeUntil(this.destroy$))
      .subscribe((params) => {
        this.query = String(params.get('id') || '').trim();
        this.canal = this.formatChannelName(this.query);
        this.setupMetaTags();
        this.loadProgramData();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  public async cambiarDia(value: string): Promise<void> {
    const nextDay = (this.days.find((day) => day.value === value)?.value || 'today') as DayAlias;
    this.activeDayAlias = nextDay;
    this.diaSeleccionado =
      this.days.find((day) => day.value === nextDay)?.label || 'Hoy';
    this.setupMetaTags();
    this.loadProgramData();
  }

  public selectCategory(category: string): void {
    this.selectedCategory = category;
    this.isMoreCategoriesOpen = false;
  }

  public toggleMoreCategories(): void {
    this.isMoreCategoriesOpen = !this.isMoreCategoriesOpen;
  }

  public formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return formatMadridHM(date);
  }

  public formatTimeRange(program: ChannelProgram): string {
    return `${this.formatTime(program.start)} - ${this.formatTime(program.end)}`;
  }

  public trackProgram(index: number, program: ChannelProgram): string {
    return program.id || `${program.title}-${index}`;
  }

  public trackChannel(index: number, entry: TvReadChannelSummaryDTO): string {
    return entry.channel.id || `${entry.channel.name}-${index}`;
  }

  public onPosterError(event: Event): void {
    const img = event.target as HTMLImageElement | null;
    if (img) {
      img.src = this.posterFallback;
    }
  }

  public onChannelLogoError(event: Event): void {
    const img = event.target as HTMLImageElement | null;
    if (img) {
      img.hidden = true;
    }
    this.logo = '';
  }

  public retry(): void {
    this.loadProgramData();
  }

  public accessLabel(): string {
    if (this.channel?.access === 'free') return 'En abierto';
    if (this.channel?.access === 'pay') return 'De pago';
    return 'Acceso sin confirmar';
  }

  public distributionLabel(): string {
    const labels: Record<string, string> = {
      terrestrial: 'TDT',
      cable: 'Cable',
      operator: 'Operador',
      ott: 'Online',
    };
    return labels[this.channel?.distribution || ''] || 'Distribución sin confirmar';
  }

  public resolutionLabel(): string | null {
    const resolution = this.channel?.quality?.resolution;
    return resolution && resolution !== 'unknown' ? resolution.toUpperCase() : null;
  }

  public get providerLabels(): string[] {
    return Array.from(new Set([
      ...(this.channel?.providers || []),
      ...(this.channel?.operator && this.channel.operator !== 'unknown'
        ? [this.channel.operator]
        : []),
    ])).filter(Boolean);
  }

  public get contentFacetLabels(): string[] {
    const labels: Record<string, string> = {
      general: 'Generalista',
      movies: 'Cine',
      series: 'Series',
      documentary: 'Documentales',
      kids: 'Infantil',
      news: 'Noticias',
      sports: 'Deportes',
      music: 'Música',
      lifestyle: 'Estilo de vida',
    };
    return (this.channel?.contentFacets || [])
      .filter((facet) => facet !== 'unknown')
      .map((facet) => labels[facet] || facet);
  }

  public progressPercentage(program: ChannelProgram): number {
    if (!program.liveNow) return 0;
    const start = new Date(program.start).getTime();
    const end = new Date(program.end).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return Math.max(0, Math.min(100, Math.round(((Date.now() - start) / (end - start)) * 100)));
  }

  public get extraCategories(): string[] {
    const primary = new Set<string>(PRIMARY_GUIDE_CATEGORIES.map((category) => category.key));
    const categories = new Set<string>();
    this.programs.forEach((program) => {
      if (program.normalizedCategory !== 'Otros' && !primary.has(program.normalizedCategory)) {
        categories.add(program.normalizedCategory);
      }
    });
    return Array.from(categories).sort((left, right) => left.localeCompare(right, 'es'));
  }

  public get filteredSchedule(): ChannelProgram[] {
    if (this.selectedCategory === 'all') {
      return this.programs;
    }

    return this.programs.filter(
      (program) => program.normalizedCategory === this.selectedCategory
    );
  }

  public get filteredCurrentProgram(): ChannelProgram | null {
    if (!this.currentProgram) {
      return null;
    }

    return this.selectedCategory === 'all' ||
      this.currentProgram.normalizedCategory === this.selectedCategory
      ? this.currentProgram
      : null;
  }

  public get filteredNextPrograms(): ChannelProgram[] {
    return this.filterPrograms(this.nextPrograms).slice(0, 8);
  }

  public get filteredTonightPrograms(): ChannelProgram[] {
    return this.filterPrograms(this.tonightPrograms);
  }

  public isPastProgram(program: ChannelProgram): boolean {
    return new Date(program.end).getTime() <= Date.now();
  }

  /** Ambient backdrop for the hero — the current programme's artwork when available, otherwise none (falls back to the CSS gradient). */
  public get heroBackdrop(): string | undefined {
    return this.filteredCurrentProgram?.image;
  }

  private loadProgramData(): void {
    this.isLoading = true;
    this.error = null;
    this.channelNotFound = false;

    this.tvDataService
      .loadChannelSurface(this.normalizeChannelToken(this.query || this.canal), this.activeDayAlias)
      .pipe(first(), takeUntil(this.destroy$))
      .subscribe({
        next: (data) => this.managePrograms(data),
        error: () => {
          this.error =
            'No se pudo cargar la programación del canal ahora mismo. Inténtalo de nuevo en unos minutos.';
          this.metaService.markUnavailable('Canal no disponible | Guía TV');
          this.isLoading = false;
        },
      });
  }

  private managePrograms(surface: TvChannelSurfaceDTO): void {
    if (!surface.channel) {
      this.channelNotFound = true;
      this.error = 'No hemos encontrado este canal en la guía actual.';
      this.metaService.setMetaTags({
        title: 'Canal no disponible - Guía TV',
        description: 'No hemos encontrado este canal en la guía actual.',
        canonicalUrl: null,
        robots: 'noindex, follow',
        httpStatus: 404,
      });
      this.isLoading = false;
      return;
    }

    this.channel = surface.channel;
    this.canonicalChannel = surface.canonicalChannel || null;
    const channelName = String(surface.channel.name || this.canal || '').trim();
    this.canal = channelName || this.canal;
    this.channelDescription = surface.channel?.description || null;
    this.logo =
      this.resolveImageUrl(surface.channel.icon) ||
      this.buildLocalChannelIcon(
        surface.channel.id || surface.channel.normalizedName || this.query
      );

    const normalizedPrograms = (surface.scheduleItems || [])
      .map((program: TvReadItemDTO) => this.normalizeProgram(program))
      .filter(Boolean) as ChannelProgram[];

    normalizedPrograms.sort(
      (left, right) =>
        new Date(left.start).getTime() - new Date(right.start).getTime()
    );

    this.programs = normalizedPrograms;
    const apiCurrent = this.normalizeProgram(surface.current);
    this.currentProgram =
      (apiCurrent?.liveNow ? apiCurrent : null) ||
      normalizedPrograms.find((program) => program.liveNow) ||
      null;
    // The API's own `surface.next` is a single item; the full schedule usually
    // carries several more upcoming items for the same day, so the rail is
    // built from both (deduplicated) rather than truncating to one card.
    const apiNext = this.normalizeProgram(surface.next);
    const scheduleNext = this.buildNextPrograms(normalizedPrograms);
    const nextById = new Map<string, ChannelProgram>();
    [...(apiNext ? [apiNext] : []), ...scheduleNext].forEach((program) => {
      nextById.set(program.id, program);
    });
    this.nextPrograms = this.buildNextPrograms(Array.from(nextById.values()));
    this.tonightPrograms = (surface.tonightItems || [])
      .map((program) => this.normalizeProgram(program))
      .filter((program): program is ChannelProgram => Boolean(program))
      .sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
    this.relatedChannels = this.buildRelatedChannels(surface);
    this.setupMetaTags();
    this.resolveChannelAffiliateOffers();
    this.isLoading = false;
  }

  /**
   * One batched resolve for the whole channel, using the channel's own
   * canonical provider labels (never the channel name alone) as the
   * affiliate provider hints — the resolver's alias mapping decides whether
   * any of them is actually a commercial merchant. Renders nothing when it
   * isn't: a channel with no affiliate relationship stays silent rather than
   * showing a dead or misleading CTA.
   */
  private resolveChannelAffiliateOffers(): void {
    this.channelAffiliateOffers = [];
    this.showChannelSponsoredDisclosure = false;

    const providerKeys = Array.from(new Set(this.providerLabels)).filter(Boolean);
    if (!providerKeys.length || !this.channel) {
      return;
    }

    const context: AffiliateContext = {
      market: 'ES',
      placement: 'channel-page',
      channelId: this.channel.id,
      providerKey: providerKeys[0],
    };

    this.affiliateService
      .resolveMany(context, { providerKeys, maxResults: 2 })
      .pipe(takeUntil(this.destroy$))
      .subscribe((offers) => {
        this.channelAffiliateOffers = offers;
        this.showChannelSponsoredDisclosure = offers.some((offer) => offer.cta.sponsored);
      });
  }

  channelAffiliateImpressionContext(): Pick<AffiliateContext, 'market' | 'placement' | 'contentType' | 'contentId'> {
    return { market: 'ES', placement: 'channel-page', contentId: this.channel?.id };
  }

  get channelPagePath(): string {
    return this.router.url;
  }

  private normalizeProgram(program: TvReadItemDTO | undefined): ChannelProgram | null {
    const title = String(program?.program?.title || '').trim();
    const start = String(program?.airing?.start || '').trim();
    const end = String(program?.airing?.end || '').trim();

    if (!title || !start || !end) {
      return null;
    }

    const normalizedCategory = this.normalizeCategory(
      program?.program?.editorialCategory || program?.program?.genre
    );
    const contentType: CatalogContentType =
      normalizedCategory === 'Cine' ? 'movie' :
      normalizedCategory === 'Series' ? 'series' :
      'program';
    const imageUrl = this.resolveImageUrl(
      program?.assets?.poster?.url ||
      ((program?.assets?.primary?.kind === 'poster' || program?.assets?.primary?.kind === 'backdrop')
        ? program?.assets?.primary?.url
        : undefined)
    );
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || endDate <= startDate) {
      return null;
    }
    const durationMinutes = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
    const now = Date.now();
    const liveNow = startDate.getTime() <= now && now < endDate.getTime();
    const itemId = String(program?.id || `${slugify(title)}-${start}`);

    return {
      raw: {
        ...program as TvReadItemDTO,
        airing: { ...program!.airing, liveNow },
        timingContext: { ...program!.timingContext, liveNow },
      },
      id: itemId,
      title,
      description: String(program?.program?.description || '').trim() || undefined,
      category: String(program?.program?.editorialCategory || '').trim() || undefined,
      normalizedCategory,
      contentType,
      image: imageUrl,
      start,
      end,
      liveNow,
      detailPath: normalizeToCard(program as TvReadItemDTO).detailPath,
      durationMinutes: program?.airing?.durationMinutes || durationMinutes,
    };
  }

  private buildNextPrograms(programs: ChannelProgram[]): ChannelProgram[] {
    const now = Date.now();
    return programs
      .filter((program) => new Date(program.start).getTime() > now)
      .sort((left, right) => Date.parse(left.start) - Date.parse(right.start))
      .slice(0, 6);
  }

  private buildRelatedChannels(surface: TvChannelSurfaceDTO): TvReadChannelSummaryDTO[] {
    return (surface.relatedChannels || []).slice(0, 4);
  }

  private setupMetaTags(): void {
    const channelName = this.canal || this.formatChannelName(this.query);
    const currentText = this.diaSeleccionado.toLowerCase();
    this.metaService.setMetaTags({
      title: `Programación de ${channelName} ${currentText} — Guía TV`,
      description:
        this.channelDescription ||
        `Consulta qué están emitiendo ahora, qué viene después y la parrilla completa de ${channelName} ${currentText}.`,
      // One URL per channel: not the request path (la_1 vs la-1, dmax vs discovery, ?dia=…), the one in the sitemap.
      canonicalUrl: channelCanonicalPath(this.canonicalChannel || this.channel, this.query),
      ogTitle: `${channelName} en directo y programación ${currentText}`,
      ogDescription:
        this.channelDescription ||
        `Parrilla completa de ${channelName} con horarios, programas destacados y acceso directo a cada contenido.`,
      ogType: 'website',
      ogImage: `https://guiaprogramaciontv.com${this.buildLocalChannelIcon(this.query || channelName)}`,
    });
  }

  private formatChannelName(value: string): string {
    return String(value || '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private normalizeChannelToken(value: string): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private buildLocalChannelIcon(channelRef?: string): string {
    const token = this.normalizeChannelToken(channelRef || this.query || this.canal);
    return `/storage/channel_icons/${encodeURIComponent(token)}.webp`;
  }

  private resolveImageUrl(url?: string | null): string | undefined {
    if (!url) return undefined;
    return normalizePublicImageUrl(url, this.apiConfig.getAssetBaseUrl());
  }

  private normalizeCategory(input: unknown): string {
    return String((input as any)?.value || input || '').trim() || 'Otros';
  }

  private filterPrograms(programs: ChannelProgram[]): ChannelProgram[] {
    if (this.selectedCategory === 'all') {
      return programs;
    }

    return programs.filter(
      (program) => program.normalizedCategory === this.selectedCategory
    );
  }
}
