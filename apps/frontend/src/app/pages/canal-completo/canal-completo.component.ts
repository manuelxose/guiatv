import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Params, Router, RouterModule } from '@angular/router';
import { Subject, catchError, combineLatest, first, of, takeUntil } from 'rxjs';
import { ApiConfigService } from 'src/app/api/api-config.service';
import {
  ChannelMetaDTO,
  TvChannelSurfaceDTO,
  TvReadChannelSummaryDTO,
  TvReadItemDTO,
} from 'src/app/api/models';
import { TvApiService } from 'src/app/api/tv-api.service';
import { FaqItem, FaqSectionComponent } from 'src/app/components/faq-section/faq-section.component';
import { InteractionButtonsComponent } from 'src/app/components/interaction-buttons/interaction-buttons.component';
import { PanelNavComponent, PanelNavGroup } from 'src/app/components/panel-nav/panel-nav.component';
import { PanelShellComponent } from 'src/app/components/panel-shell/panel-shell.component';
import { UnifiedAsyncStateComponent } from 'src/app/components/unified-async-state/unified-async-state.component';
import { MetaService } from 'src/app/services/meta.service';
import { ChatService } from 'src/app/services/chat.service';
import { TvDataService } from 'src/app/state/tv-data.service';
import { AffiliateService } from 'src/app/services/affiliate.service';
import { AffiliateCTAComponent } from 'src/app/components/affiliate-cta/affiliate-cta.component';
import { AffiliateDisclosureComponent } from 'src/app/components/affiliate-disclosure/affiliate-disclosure.component';
import { AffiliateImpressionDirective } from 'src/app/directives/affiliate-impression.directive';
import { AffiliateContext, AffiliateResolvedOffer } from 'src/app/interfaces/affiliate.interface';
import { CatalogContentType } from 'src/app/utils/catalog';
import { dropOverlappingAirings, normalizeToCard, UnifiedCardData } from 'src/app/utils/tv-normalizers';
import { PanelTileComponent } from 'src/app/components/panel-tile/panel-tile.component';
import { normalizePublicImageUrl } from 'src/app/utils/media-url';
import { generateBreadcrumbSchema, generateItemListSchema, serializeJsonLd, slugify } from 'src/app/utils/utils';
import { APP_PATHS, channelCanonicalPath } from '../../config/route-map';
import { TV_SECTION_LINKS } from '../../config/tv-section-nav';
import { formatMadridHM } from '../../utils/madrid-time';
import { filterChannelDirectory } from '../channel-catalog/channel-catalog.component';

type DayAlias = 'today' | 'tomorrow' | 'after_tomorrow';

interface DayOption {
  label: string;
  value: DayAlias;
  /** `?dia=` value; null for today so the base URL stays clean. */
  param: string | null;
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
  raw: TvReadItemDTO;
}

const BASE_URL = 'https://guiaprogramaciontv.com';
const PRIMARY_GENRES = ['Cine', 'Series', 'Deportes'];

/** URL-safe genre key for `?genero=` (accents dropped: "Música" → "musica"). */
export function genreSlug(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Component({
  selector: 'app-canal-completo',
  standalone: true,
  templateUrl: './canal-completo.component.html',
  styleUrls: ['./canal-completo.component.scss'],
  imports: [
    RouterModule,
    PanelShellComponent,
    PanelNavComponent,
    PanelTileComponent,
    FaqSectionComponent,
    InteractionButtonsComponent,
    UnifiedAsyncStateComponent,
    AffiliateCTAComponent,
    AffiliateDisclosureComponent,
    AffiliateImpressionDirective,
  ],
})
export class CanalCompletoComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tvDataService = inject(TvDataService);
  private readonly tvApi = inject(TvApiService);
  private readonly metaService = inject(MetaService);
  private readonly apiConfig = inject(ApiConfigService);
  private readonly affiliateService = inject(AffiliateService);
  private readonly chat = inject(ChatService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroy$ = new Subject<void>();

  readonly appPaths = APP_PATHS;
  readonly sideLinks = TV_SECTION_LINKS;
  readonly days: DayOption[] = [
    { label: 'Hoy', value: 'today', param: null },
    { label: 'Mañana', value: 'tomorrow', param: 'manana' },
    { label: 'Pasado mañana', value: 'after_tomorrow', param: 'pasado' },
  ];
  readonly assistantAsks = ['¿Qué echa este canal esta noche?', '¿Dónde lo veo online?', 'Avísame de lo próximo'];

  public query = '';
  public canal = '';
  public logo = '';
  public channel: ChannelMetaDTO | null = null;
  /** M10-C: set on a second-feed alias page; canonical, breadcrumb and the SSR 301 point to this channel. */
  public canonicalChannel: TvChannelSurfaceDTO['canonicalChannel'] | null = null;
  public channelDescription: string | null = null;
  public isLoading = true;
  public error: string | null = null;
  public channelNotFound = false;
  public activeDayAlias: DayAlias = 'today';
  /** `?genero=` slug, or 'all'. */
  public selectedGenre = 'all';
  public contextOpen = false;

  public programs: ChannelProgram[] = [];
  public currentProgram: ChannelProgram | null = null;
  public nextPrograms: ChannelProgram[] = [];
  public tonightPrograms: ChannelProgram[] = [];
  public relatedChannels: TvReadChannelSummaryDTO[] = [];
  public otherChannels: Array<{ name: string; path: string }> = [];
  /** Related channels with what they air now, drawn as cards (the rest stay as chips). */
  public otherChannelCards: Array<{ name: string; path: string; icon: string; now: UnifiedCardData | null; next: UnifiedCardData | null }> = [];
  public genres: Array<{ slug: string; label: string }> = [];
  public faq: FaqItem[] = [];
  public structuredData: SafeHtml | null = null;
  public sideGroups: PanelNavGroup[] = [];
  private directory: TvReadChannelSummaryDTO[] = [];

  /** Verified provider offer(s) for this channel — empty when no merchant alias matches, which is the common case and renders nothing. */
  public channelAffiliateOffers: AffiliateResolvedOffer[] = [];
  public showChannelSponsoredDisclosure = false;

  get dayLabel(): string {
    return this.days.find((d) => d.value === this.activeDayAlias)!.label;
  }

  /** "hoy", "mañana", "pasado mañana" for titles and copy. */
  get dayText(): string {
    return this.dayLabel.toLowerCase();
  }

  get channelPath(): string {
    return channelCanonicalPath(this.canonicalChannel || this.channel, this.query);
  }

  get filteredSchedule(): ChannelProgram[] {
    return this.byGenre(this.programs);
  }

  get filteredTonightPrograms(): ChannelProgram[] {
    return this.byGenre(this.tonightPrograms);
  }

  /** "Ahora y a continuación" tiles: today, unfiltered only. */
  get nowAndNext(): ChannelProgram[] {
    if (this.activeDayAlias !== 'today' || this.selectedGenre !== 'all') return [];
    return [...(this.currentProgram ? [this.currentProgram] : []), ...this.nextPrograms].slice(0, 4);
  }

  /** Films and series of the day still to air (or airing). */
  get filmsAndSeries(): ChannelProgram[] {
    return this.programs
      .filter((p) => (p.contentType === 'movie' || p.contentType === 'series') && !this.isPastProgram(p))
      .slice(0, 8);
  }

  /** Genre → number of programmes, for the "Sobre el canal" copy. */
  get genreSummary(): string {
    const counts = new Map<string, number>();
    this.programs.forEach((p) => p.normalizedCategory !== 'Otros' && counts.set(p.normalizedCategory, (counts.get(p.normalizedCategory) || 0) + 1));
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([label, n]) => `${n} de ${label.toLowerCase()}`)
      .join(', ');
  }

  public get contentFacetLabels(): string[] {
    const labels: Record<string, string> = {
      general: 'Generalista', movies: 'Cine', series: 'Series', documentary: 'Documentales', kids: 'Infantil',
      news: 'Noticias', sports: 'Deportes', music: 'Música', lifestyle: 'Estilo de vida',
    };
    return (this.channel?.contentFacets || []).filter((f) => f !== 'unknown').map((f) => labels[f] || f);
  }

  /** `/canales?grupo=` of this channel, when the guide has that group. */
  get groupLink(): { label: string; group: string } | null {
    const g = this.channel?.group;
    const labels: Record<string, string> = { tdt: 'canales de TDT', autonomico: 'canales autonómicos', cable: 'canales de cable', movistar: 'canales de Movistar+', deporte: 'canales de deportes', online: 'canales online' };
    return g && labels[g] ? { label: labels[g], group: g } : null;
  }

  ngOnInit(): void {
    this.tvApi
      .getTvReadChannels('today')
      .pipe(first(), catchError(() => of(null)), takeUntil(this.destroy$))
      .subscribe((response) => {
        this.directory = filterChannelDirectory(response?.data?.channels || [], '', 'all');
        this.buildChannelLinks();
      });

    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([params, queryParams]) => {
        const id = String(params.get('id') || '').trim();
        const day = this.days.find((d) => d.param === queryParams.get('dia'))?.value || 'today';
        this.selectedGenre = queryParams.get('genero') || 'all';
        // A genre link only filters what is loaded; a new channel or day reloads.
        if (id === this.query && day === this.activeDayAlias && (this.channel || this.isLoading)) return;
        this.query = id;
        this.activeDayAlias = day;
        this.canal = this.formatChannelName(id);
        this.setupMetaTags();
        this.loadProgramData();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Query params for a day/genre link: keeps the other one and drops defaults. */
  paramsFor(change: { dia?: string | null; genero?: string }): Params {
    const dia = change.dia !== undefined ? change.dia : this.days.find((d) => d.value === this.activeDayAlias)!.param;
    const genero = change.genero ?? this.selectedGenre;
    return { dia: dia || null, genero: genero === 'all' ? null : genero };
  }

  public formatTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : formatMadridHM(date);
  }

  public formatTimeRange(program: ChannelProgram): string {
    return `${this.formatTime(program.start)}–${this.formatTime(program.end)}`;
  }

  public onChannelLogoError(): void {
    this.logo = '';
  }

  public retry(): void {
    this.loadProgramData();
  }

  public openAssistant(): void {
    this.chat.requestToggleAssistant();
  }

  public isPastProgram(program: ChannelProgram): boolean {
    return new Date(program.end).getTime() <= Date.now();
  }

  public progressPercentage(program: ChannelProgram): number {
    if (!program.liveNow) return 0;
    const start = new Date(program.start).getTime();
    const end = new Date(program.end).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return Math.max(0, Math.min(100, Math.round(((Date.now() - start) / (end - start)) * 100)));
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

  public get providerLabels(): string[] {
    return Array.from(new Set([
      ...(this.channel?.providers || []),
      ...(this.channel?.operator && this.channel.operator !== 'unknown' ? [this.channel.operator] : []),
    ])).filter(Boolean);
  }

  /** "Dónde verlo": only facts the channel registry confirms, never guessed dials. */
  public get whereToWatch(): Array<[string, string]> {
    const c = this.channel;
    if (!c) return [];
    const rows: Array<[string, string]> = [];
    if (c.distribution === 'terrestrial') rows.push(['TDT', c.access === 'free' ? 'En abierto, gratis' : 'Sí']);
    if (c.capabilities?.streaming === true) rows.push(['Online', 'En directo en su web o app']);
    if (c.capabilities?.catchup === true) rows.push(['A la carta', 'Programas ya emitidos']);
    if (this.providerLabels.length) rows.push(['Operadores', this.providerLabels.join(', ')]);
    const resolution = c.quality?.resolution;
    if (resolution && resolution !== 'unknown') rows.push(['Calidad', resolution.toUpperCase()]);
    return rows;
  }

  private byGenre(programs: ChannelProgram[]): ChannelProgram[] {
    return this.selectedGenre === 'all'
      ? programs
      : programs.filter((p) => genreSlug(p.normalizedCategory) === this.selectedGenre);
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
    this.canal = String(surface.channel.name || this.canal || '').trim() || this.canal;
    this.channelDescription = surface.channel?.description || null;
    this.logo =
      this.resolveImageUrl(surface.channel.icon) ||
      this.buildLocalChannelIcon(surface.channel.id || surface.channel.normalizedName || this.query);

    const normalizedPrograms = dropOverlappingAirings(surface.scheduleItems || [])
      .map((program: TvReadItemDTO) => this.normalizeProgram(program))
      .filter(Boolean) as ChannelProgram[];
    normalizedPrograms.sort((left, right) => Date.parse(left.start) - Date.parse(right.start));

    this.programs = normalizedPrograms;
    const apiCurrent = this.normalizeProgram(surface.current);
    this.currentProgram =
      (apiCurrent?.liveNow ? apiCurrent : null) || normalizedPrograms.find((program) => program.liveNow) || null;
    // The API's `surface.next` is a single item; the schedule carries more, so both feed the list (deduplicated).
    const apiNext = this.normalizeProgram(surface.next);
    const nextById = new Map<string, ChannelProgram>();
    [...(apiNext ? [apiNext] : []), ...this.buildNextPrograms(normalizedPrograms)].forEach((p) => nextById.set(p.id, p));
    this.nextPrograms = this.buildNextPrograms(Array.from(nextById.values()));
    this.tonightPrograms = dropOverlappingAirings(surface.tonightItems || [])
      .map((program) => this.normalizeProgram(program))
      .filter((program): program is ChannelProgram => Boolean(program))
      .sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
    this.relatedChannels = (surface.relatedChannels || []).slice(0, 10);

    const seen = new Set<string>();
    this.genres = [...PRIMARY_GENRES, ...normalizedPrograms.map((p) => p.normalizedCategory).sort((a, b) => a.localeCompare(b, 'es'))]
      .filter((label) => label !== 'Otros' && normalizedPrograms.some((p) => p.normalizedCategory === label))
      .filter((label) => !seen.has(label) && !!seen.add(label))
      .map((label) => ({ slug: genreSlug(label), label }));

    this.setupMetaTags();
    this.buildSeo();
    this.buildChannelLinks();
    this.resolveChannelAffiliateOffers();
    this.isLoading = false;
  }

  /** FAQ and JSON-LD, built once per load (not getters: a new SafeHtml every check would re-render the script). */
  private buildSeo(): void {
    if (!this.channel) return;
    const name = this.canal;
    const now = this.currentProgram;
    const upNext = this.nextPrograms[0];
    const night = this.tonightPrograms.slice(0, 4);
    const items: FaqItem[] = [];
    if (this.activeDayAlias === 'today') {
      items.push({
        question: `¿Qué echan ahora en ${name}?`,
        answer: now
          ? `Ahora ${name} emite «${now.title}» (${this.formatTimeRange(now)}).${upNext ? ` Después, a las ${this.formatTime(upNext.start)}, «${upNext.title}».` : ''}`
          : `Ahora mismo no hay ninguna emisión confirmada en ${name}. Más abajo tienes la programación completa de hoy.`,
      });
    }
    if (night.length) {
      items.push({
        question: `¿Qué ponen ${this.activeDayAlias === 'today' ? 'esta noche' : `${this.dayText} por la noche`} en ${name}?`,
        answer: night.map((p) => `«${p.title}» a las ${this.formatTime(p.start)}`).join(', ') + '.',
      });
    }
    const films = this.programs.filter((p) => p.contentType === 'movie').slice(0, 4);
    if (films.length) {
      items.push({
        question: `¿Qué películas echan ${this.dayText} en ${name}?`,
        answer: `${name} emite ${this.dayText}: ${films.map((p) => `«${p.title}» a las ${this.formatTime(p.start)}`).join(', ')}.`,
      });
    }
    if (this.programs.length) {
      const first = this.programs[0];
      const last = this.programs[this.programs.length - 1];
      items.push({
        question: `¿Cuál es la programación de ${name} ${this.dayText}?`,
        answer: `${name} tiene ${this.programs.length} emisiones confirmadas ${this.dayText}, desde «${first.title}» a las ${this.formatTime(first.start)} hasta «${last.title}» a las ${this.formatTime(last.start)}.${this.genreSummary ? ` Por géneros: ${this.genreSummary}.` : ''}`,
      });
    }
    if (this.activeDayAlias === 'today') {
      items.push({
        question: `¿Qué echan mañana en ${name}?`,
        answer: `Pulsa «Mañana» en esta página para ver la programación de ${name} de mañana, hora a hora y con enlace a cada programa.`,
      });
    }
    const where = this.whereToWatch.filter(([k]) => k === 'TDT' || k === 'Online' || k === 'A la carta');
    items.push({
      question: `¿Dónde ver ${name} online?`,
      answer: where.length
        ? `${name}: ${where.map(([k, v]) => `${k}, ${v.toLowerCase()}`).join('; ')}.`
        : `No tenemos confirmado si ${name} se puede ver online. Su programación completa está en esta página.`,
    });
    this.faq = items;

    const schemas: object[] = [
      generateBreadcrumbSchema(
        [
          { name: 'Inicio', url: '/' },
          { name: 'Canales', url: APP_PATHS.channels },
          { name, url: this.channelPath },
        ],
        BASE_URL
      ),
      {
        '@context': 'https://schema.org',
        '@type': 'TelevisionChannel',
        name,
        url: `${BASE_URL}${this.channelPath}`,
        ...(this.logo.startsWith('http') ? { logo: this.logo } : {}),
      },
    ];
    if (this.programs.length) {
      schemas.push(generateItemListSchema(this.programs, `Programación de ${name} ${this.dayText}`, BASE_URL));
    }
    this.structuredData = this.sanitizer.bypassSecurityTrustHtml(
      schemas.map((s) => `<script type="application/ld+json">${serializeJsonLd(s)}</script>`).join('')
    );
  }

  /** Left menu groups and "Otros canales": links to other channel pages from today's directory. */
  private buildChannelLinks(): void {
    const toLink = (entry: TvReadChannelSummaryDTO) => ({
      label: entry.channel.name,
      path: channelCanonicalPath(entry.channel, entry.channel.id),
      logoUrl: this.resolveImageUrl(entry.channel.icon),
    });
    const groups: Array<[string, (e: TvReadChannelSummaryDTO) => boolean, string]> = [
      ['TDT', (e) => e.channel.group === 'tdt', 'tdt'],
      ['Autonómicos', (e) => e.channel.group === 'autonomico', 'autonomico'],
      ['Pago', (e) => e.channel.access === 'pay', 'movistar'],
    ];
    this.sideGroups = groups
      .map(([title, match]) => ({ title, links: this.directory.filter(match).slice(0, 12).map(toLink) }))
      .filter((g) => g.links.length);

    const own = this.channelPath;
    const sameGroup = this.directory.filter((e) => this.channel?.group && e.channel.group === this.channel.group);
    const unique = new Map<string, { name: string; path: string }>();
    [...this.relatedChannels, ...sameGroup].forEach((e) => {
      const link = toLink(e);
      if (link.path !== own) unique.set(link.path, { name: link.label, path: link.path });
    });
    const cards = this.relatedChannels
      .filter((e) => toLink(e).path !== own)
      .slice(0, 8)
      .map((e) => ({
        name: e.channel.name,
        path: toLink(e).path,
        icon: this.resolveImageUrl(e.channel.icon) || '',
        now: e.current ? normalizeToCard(e.current) : null,
        next: e.next ? normalizeToCard(e.next) : null,
      }));
    this.otherChannelCards = cards;
    const carded = new Set(cards.map((c) => c.path));
    this.otherChannels = Array.from(unique.values()).filter((c) => !carded.has(c.path)).slice(0, 16);
  }

  /**
   * One batched resolve for the whole channel, using the channel's own canonical provider labels (never the channel
   * name alone) as the affiliate provider hints. Renders nothing when none is a commercial merchant.
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

    const normalizedCategory = this.normalizeCategory(program?.program?.editorialCategory || program?.program?.genre);
    const contentType: CatalogContentType =
      normalizedCategory === 'Cine' ? 'movie' : normalizedCategory === 'Series' ? 'series' : 'program';
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

  private setupMetaTags(): void {
    const channelName = this.canal || this.formatChannelName(this.query);
    const day = this.dayText;
    this.metaService.setMetaTags({
      title: `Programación de ${channelName} ${day}: ${this.activeDayAlias === 'today' ? 'qué echan ahora y esta noche' : 'horarios y parrilla'} | Guía TV`,
      description:
        this.channelDescription ||
        `Programación de ${channelName} ${day}: qué echan ahora, qué viene después y la parrilla completa con horarios y enlace a cada programa.`,
      // One URL per channel: not the request path (la_1 vs la-1, dmax vs discovery, ?dia=…), the one in the sitemap.
      canonicalUrl: this.channelPath,
      ogTitle: `${channelName} en directo y programación ${day}`,
      ogDescription:
        this.channelDescription ||
        `Parrilla completa de ${channelName} con horarios, programas destacados y acceso directo a cada contenido.`,
      ogType: 'website',
      ogImage: `${BASE_URL}${this.buildLocalChannelIcon(this.query || channelName)}`,
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
      .replace(/[̀-ͯ]/g, '')
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
}
