import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Params, RouterModule } from '@angular/router';
import { Observable, catchError, map, of, startWith, switchMap } from 'rxjs';
import { TvReadItemDTO } from '../../api/models';
import { EditorialService } from '../../blog/services/editorial.service';
import { FaqItem, FaqSectionComponent } from '../../components/faq-section/faq-section.component';
import { PanelNavComponent, PanelNavGroup } from '../../components/panel-nav/panel-nav.component';
import { PanelShellComponent } from '../../components/panel-shell/panel-shell.component';
import { PanelTileComponent } from '../../components/panel-tile/panel-tile.component';
import { APP_PATHS } from '../../config/route-map';
import { QUE_VER_LINKS, QUE_VER_PATH } from '../../config/que-ver-nav';
import { CatalogItem } from '../../services/catalog.service';
import { ChatService } from '../../services/chat.service';
import { MetaService } from '../../services/meta.service';
import { UserService } from '../../services/user.service';
import { TvDataFacade, UnifiedDiscoveryItem, UnifiedDiscoveryResult } from '../../state/tv-data.facade';
import { UnifiedAvailability, UnifiedContentType } from '../../state/unified-guide.state';
import { isTvReadItem, normalizeToCard } from '../../utils/tv-normalizers';
import { resolvePlatformLogoUrl } from '../../utils/platform-logos';
import { generateBreadcrumbSchema, generateItemListSchema, serializeJsonLd } from '../../utils/utils';

const BASE_URL = 'https://guiaprogramaciontv.com';
const PATH = QUE_VER_PATH;
const timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
const dayFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' });
const hhmm = (iso?: string): string => (iso ? timeFmt.format(new Date(iso)) : '');
const EMPTY_RESULT: UnifiedDiscoveryResult = {
  items: [],
  meta: { total: 0, page: 1, limit: 48, hasMore: false },
  availablePlatforms: [],
  availableGenres: [],
};
const TV_PAGE = 24;
const FILM = /cine|pel[ií]cula/i;
const SERIES = /serie/i;

type Tipo = '' | 'movie' | 'series' | 'program';
type Cuando = 'hoy' | 'ahora' | 'noche' | 'manana';
type Donde = '' | 'tv' | 'abierto' | 'streaming' | 'gratis';
interface Filters {
  tipo: Tipo;
  cuando: Cuando;
  donde: Donde;
  platform: string;
  q: string;
  page: number;
}
type Load<T> = { status: 'idle' | 'loading' | 'ready' | 'error'; items: T[]; hasMore?: boolean };

/**
 * Streaming platforms with a working catalogue filter (checked against the API: each returns titles).
 * `guide` is the existing ranking article. RTVE Play, ATRESplayer, Mitele and Pluto TV return nothing yet.
 */
const PLATFORMS: ReadonlyArray<{ name: string; color: string; guide?: string }> = [
  { name: 'Netflix', color: '#e50914', guide: '/guias/mejores-series-y-peliculas-netflix-espana' },
  { name: 'Prime Video', color: '#00a8e1', guide: '/guias/mejores-series-y-peliculas-prime-video-espana' },
  { name: 'Disney+', color: '#113ccf', guide: '/guias/mejores-series-y-peliculas-disney-plus-espana' },
  { name: 'HBO Max', color: '#5b2bd9', guide: '/guias/mejores-series-y-peliculas-hbo-max-espana' },
  { name: 'Movistar+', color: '#00a9e0', guide: '/guias/mejores-series-y-peliculas-movistar-plus-espana' },
  { name: 'SkyShowtime', color: '#1d9bf0' },
  { name: 'Apple TV+', color: '#6b7280' },
  { name: 'Filmin', color: '#00a88f' },
];

const TIPOS: ReadonlyArray<{ id: Tipo; label: string }> = [
  { id: '', label: 'Todo' },
  { id: 'movie', label: 'Películas' },
  { id: 'series', label: 'Series' },
  { id: 'program', label: 'Programas de TV' },
];
const CUANDOS: ReadonlyArray<{ id: Cuando; label: string; phrase: string }> = [
  { id: 'hoy', label: 'Hoy', phrase: 'hoy' },
  { id: 'ahora', label: 'Ahora', phrase: 'ahora' },
  { id: 'noche', label: 'Esta noche', phrase: 'esta noche' },
  { id: 'manana', label: 'Mañana', phrase: 'mañana' },
];
const DONDES: ReadonlyArray<{ id: Donde; label: string; phrase: string }> = [
  { id: '', label: 'TV y streaming', phrase: '' },
  { id: 'tv', label: 'Toda la TV', phrase: 'en TV' },
  { id: 'abierto', label: 'TV en abierto', phrase: 'en TV en abierto' },
  { id: 'streaming', label: 'Streaming', phrase: 'en streaming' },
  { id: 'gratis', label: 'Gratis', phrase: 'gratis' },
];

const csv = (value: string | null): string[] => (value || '').split(',').map((v) => v.trim()).filter(Boolean);

/**
 * "Qué ver hoy": TV and streaming on one page, filtered by type, when, where and platform.
 * Every filter is a link that stays on this page. Links never build a combination that cannot have
 * results (a platform drops "tonight", "free-to-air TV" drops the platform…). Old links still work:
 * ?types=movie,series, ?availability=free|live|streaming and ?platforms=Netflix are read as before.
 */
@Component({
  selector: 'app-que-ver',
  standalone: true,
  imports: [RouterModule, PanelShellComponent, PanelNavComponent, PanelTileComponent, FaqSectionComponent],
  templateUrl: './que-ver.component.html',
  styleUrls: ['./que-ver.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueVerComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly facade = inject(TvDataFacade);
  private readonly meta = inject(MetaService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly chat = inject(ChatService);
  private readonly editorial = inject(EditorialService);
  private readonly user = inject(UserService);

  readonly appPaths = APP_PATHS;
  readonly path = PATH;
  readonly sideLinks = QUE_VER_LINKS;
  readonly platforms = PLATFORMS;
  readonly contextOpen = signal(false);
  readonly hhmm = hhmm;
  readonly today = dayFmt.format(new Date());

  // ── Filters from the URL ──
  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  readonly filters = computed<Filters>(() => {
    const p = this.params();
    const types = csv(p.get('types')).filter((t) => t === 'movie' || t === 'series' || t === 'program');
    const availability = csv(p.get('availability'));
    const rawPlatform = csv(p.get('platforms'))[0] || '';
    const platform = PLATFORMS.find((x) => x.name.toLowerCase() === rawPlatform.toLowerCase() || (rawPlatform.toLowerCase() === 'max' && x.name === 'HBO Max'))?.name || '';
    const cuando = (CUANDOS.find((c) => c.id === p.get('cuando'))?.id || (availability.includes('live') ? 'ahora' : 'hoy')) as Cuando;
    let donde = (DONDES.find((d) => d.id && d.id === p.get('donde'))?.id ||
      (availability.includes('free') ? 'gratis' : availability.some((a) => a === 'streaming' || a === 'flatrate') ? 'streaming' : '')) as Donde;
    if (platform) donde = 'streaming';
    return {
      tipo: (types.length === 1 ? types[0] : '') as Tipo,
      cuando,
      donde,
      platform,
      q: (p.get('q') || '').trim(),
      page: Math.max(1, Number(p.get('page')) || 1),
    };
  });
  readonly isHome = computed(() => {
    const f = this.filters();
    return !f.tipo && f.cuando === 'hoy' && !f.donde && !f.q && f.page === 1;
  });
  /** Which sources the current filters ask for. */
  readonly showTv = computed(() => {
    const f = this.filters();
    return !this.isHome() && f.donde !== 'streaming';
  });
  readonly showStreaming = computed(() => {
    const f = this.filters();
    return !this.isHome() && f.tipo !== 'program' && f.cuando === 'hoy' && f.donde !== 'tv' && f.donde !== 'abierto';
  });

  // ── Filtered view: TV ──
  private readonly tvRequest = computed(() => (this.showTv() ? { ...this.filters(), page: 1 } : null));
  private readonly tvState = toSignal(
    toObservable(this.tvRequest).pipe(
      switchMap((f) =>
        !f
          ? of<Load<TvReadItemDTO>>({ status: 'idle', items: [] })
          : this.loadTv(f).pipe(
              map((items): Load<TvReadItemDTO> => ({ status: 'ready', items })),
              catchError(() => of<Load<TvReadItemDTO>>({ status: 'error', items: [] })),
              startWith<Load<TvReadItemDTO>>({ status: 'loading', items: [] })
            )
      )
    ),
    { initialValue: { status: 'loading', items: [] } as Load<TvReadItemDTO> }
  );
  readonly tvStatus = computed(() => this.tvState().status);
  readonly tvItems = computed(() => this.tvState().items);
  readonly tvShown = signal(TV_PAGE);
  readonly tvVisible = computed(() => this.tvItems().slice(0, this.tvShown()));

  // ── Filtered view: streaming (one API page per URL) ──
  private readonly streamRequest = computed(() => (this.showStreaming() ? this.filters() : null));
  private readonly streamState = toSignal(
    toObservable(this.streamRequest).pipe(
      switchMap((f) =>
        !f
          ? of<Load<UnifiedDiscoveryItem>>({ status: 'idle', items: [] })
          : this.facade
              .discoverContent({
                types: f.tipo ? [f.tipo as UnifiedContentType] : ['movie', 'series'],
                availability: f.donde === 'gratis' ? (['free'] as UnifiedAvailability[]) : [],
                platforms: f.platform ? [f.platform] : [],
                q: f.q,
                sort: 'popular',
                page: f.page,
                // The API answers limit=48 with 8 items; 24 returns the full page (~20 per type).
                limit: 24,
              })
              .pipe(
                map((r): Load<UnifiedDiscoveryItem> => ({ status: 'ready', items: r.items, hasMore: r.meta.hasMore })),
                catchError(() => of<Load<UnifiedDiscoveryItem>>({ status: 'error', items: [] })),
                startWith<Load<UnifiedDiscoveryItem>>({ status: 'loading', items: [] })
              )
      )
    ),
    { initialValue: { status: 'loading', items: [] } as Load<UnifiedDiscoveryItem> }
  );
  readonly streamStatus = computed(() => this.streamState().status);
  readonly streamItems = computed(() => this.streamState().items);
  readonly streamHasMore = computed(() => Boolean(this.streamState().hasMore));
  readonly resultsReady = computed(() => this.tvStatus() !== 'loading' && this.streamStatus() !== 'loading');
  readonly resultCount = computed(() => this.tvItems().length + this.streamItems().length);

  // ── Home sections ──
  // Free-to-air only: the home page promises "gratis" for tonight's TV.
  private readonly tonight = toSignal(this.facade.getTonightPrograms({ group: 'tdt', limit: 96 }).pipe(catchError(() => of([]))), {
    initialValue: [] as TvReadItemDTO[],
  });
  private readonly live = toSignal(this.facade.getLivePrograms({ group: 'tdt', limit: 48 }).pipe(catchError(() => of([]))), {
    initialValue: [] as TvReadItemDTO[],
  });
  private readonly movies = toSignal(this.catalogue({ types: ['movie'], limit: 12 }), { initialValue: EMPTY_RESULT });
  private readonly series = toSignal(this.catalogue({ types: ['series'], limit: 12 }), { initialValue: EMPTY_RESULT });
  private readonly free = toSignal(this.catalogue({ types: ['movie', 'series'], availability: ['free'], limit: 8 }), {
    initialValue: EMPTY_RESULT,
  });
  readonly forYou = toSignal(
    this.user.isAuthenticated$.pipe(switchMap((authed) => (authed ? this.facade.getForYou(8).pipe(catchError(() => of([]))) : of([])))),
    { initialValue: [] as CatalogItem[] }
  );
  readonly guides = toSignal(this.editorial.getHubState().pipe(map((s) => s.guidePosts.slice(0, 3)), catchError(() => of([]))), {
    initialValue: [],
  });
  readonly rankings = toSignal(this.editorial.getRankingsPageState().pipe(map((s) => s.posts.slice(0, 4)), catchError(() => of([]))), {
    initialValue: [],
  });

  /** Tonight on free TV, one card per broadcast (feeds repeat), films and series first. */
  readonly tonightItems = computed(() => {
    const rank = (i: TvReadItemDTO) => (FILM.test(normalizeToCard(i).category) ? 0 : SERIES.test(normalizeToCard(i).category) ? 1 : 2);
    return dedupe(this.tonight()).sort((a, b) => rank(a) - rank(b) || a.airing.start.localeCompare(b.airing.start));
  });
  readonly tonightFilms = computed(() => this.tonightItems().filter((i) => FILM.test(normalizeToCard(i).category)).slice(0, 8));
  readonly tonightMix = computed(() => {
    const films = new Set(this.tonightFilms());
    return this.tonightItems().filter((i) => !films.has(i)).slice(0, 8);
  });
  readonly liveItems = computed(() => dedupe(this.live()).slice(0, 8));
  readonly movieItems = computed(() => this.movies().items.slice(0, 8));
  readonly seriesItems = computed(() => this.series().items.slice(0, 8));
  readonly freeItems = computed(() => this.free().items.slice(0, 8));
  readonly tonightList = computed(() => this.tonightItems().slice(0, 6).map((i) => normalizeToCard(i)));

  /** Right panel: the first result of the current filter, else tonight's first free film, else the top streaming film. */
  readonly pick = computed(() => {
    const item: UnifiedDiscoveryItem | undefined = this.isHome()
      ? this.tonightFilms()[0] || this.movieItems()[0]
      : this.tvItems()[0] || this.streamItems()[0] || this.tonightFilms()[0];
    if (!item) return null;
    const card = normalizeToCard(item);
    const catalog = isTvReadItem(item) ? null : item;
    const where: Array<[string, string]> = catalog
      ? (catalog.whereToWatch?.flatrate || []).slice(0, 4).map((w) => [w.name, 'Incluida en la suscripción'] as [string, string])
      : [[card.channelName, `${card.liveNow ? 'Ahora' : hhmm(card.startTime)}`]];
    return {
      card,
      image: catalog?.backdrop || card.image,
      meta: catalog
        ? [catalog.releaseYear, catalog.rating ? `★ ${catalog.rating.toFixed(1).replace('.', ',')}` : ''].filter(Boolean).join(' · ')
        : `${card.channelName} · ${hhmm(card.startTime)}–${hhmm(card.endTime)}`,
      description: catalog?.synopsis || card.description,
      where,
    };
  });

  // ── Filter links ──
  /** Query params for a change, dropping defaults and whatever the change makes meaningless. */
  link(change: Partial<Filters>): Params {
    const f = { ...this.filters(), page: 1, ...change };
    if (change.platform) {
      f.donde = 'streaming';
      f.cuando = 'hoy';
      if (f.tipo === 'program') f.tipo = '';
    }
    if (change.cuando && change.cuando !== 'hoy') {
      f.platform = '';
      if (f.donde === 'streaming') f.donde = '';
    }
    if (change.donde !== undefined && change.donde !== 'streaming') f.platform = '';
    if (change.donde === 'streaming') f.cuando = 'hoy';
    if (change.tipo === 'program') {
      f.platform = '';
      if (f.donde === 'streaming') f.donde = '';
    }
    return {
      types: f.tipo || null,
      cuando: f.cuando === 'hoy' ? null : f.cuando,
      donde: f.donde && !(f.donde === 'streaming' && f.platform) ? f.donde : null,
      platforms: f.platform || null,
      q: f.q || null,
      page: f.page > 1 ? f.page : null,
    };
  }

  readonly facets = computed(() => {
    const f = this.filters();
    return {
      tipos: TIPOS.map((o) => ({ label: o.label, params: this.link({ tipo: o.id }), on: f.tipo === o.id })),
      cuandos: CUANDOS.map((o) => ({ label: o.label, params: this.link({ cuando: o.id }), on: f.cuando === o.id })),
      dondes: DONDES.map((o) => ({ label: o.label, params: this.link({ donde: o.id, platform: '' }), on: f.donde === o.id && !f.platform })),
      platforms: PLATFORMS.map((p) => ({ label: p.name, params: this.link({ platform: f.platform === p.name ? '' : p.name, donde: f.platform === p.name ? '' : 'streaming' }), on: f.platform === p.name })),
    };
  });
  /** Active filters, each with a link that removes only it. */
  readonly activeFilters = computed(() => {
    const f = this.filters();
    const out: Array<{ label: string; params: Params }> = [];
    if (f.tipo) out.push({ label: TIPOS.find((t) => t.id === f.tipo)!.label, params: this.link({ tipo: '' }) });
    if (f.cuando !== 'hoy') out.push({ label: CUANDOS.find((c) => c.id === f.cuando)!.label, params: this.link({ cuando: 'hoy' }) });
    if (f.platform) out.push({ label: f.platform, params: this.link({ platform: '', donde: '' }) });
    else if (f.donde) out.push({ label: DONDES.find((d) => d.id === f.donde)!.label, params: this.link({ donde: '' }) });
    if (f.q) out.push({ label: `«${f.q}»`, params: this.link({ q: '' }) });
    return out;
  });
  readonly sideGroups = computed<PanelNavGroup[]>(() => {
    const x = this.facets();
    const toLinks = (list: Array<{ label: string; params: Params; on: boolean }>) => list.map((o) => ({ label: o.label, path: PATH, queryParams: o.params, active: o.on }));
    return [
      { title: 'Tipo', links: toLinks(x.tipos) },
      { title: 'Cuándo', links: toLinks(x.cuandos) },
      { title: 'Dónde', links: toLinks(x.dondes) },
      { title: 'Plataforma', links: toLinks(x.platforms) },
    ];
  });

  // ── Copy ──
  readonly h1 = computed(() => {
    const f = this.filters();
    if (this.isHome()) return 'Qué ver hoy: películas, series y programas de TV';
    if (f.q) return `Qué ver: resultados para «${f.q}»`;
    const when = CUANDOS.find((c) => c.id === f.cuando)!.phrase;
    const where = f.platform
      ? `en ${f.platform}`
      : DONDES.find((d) => d.id === f.donde)!.phrase || (f.tipo === 'program' ? '' : f.cuando !== 'hoy' ? 'en TV' : 'en TV y streaming');
    const subject = { '': 'Qué ver', movie: 'Películas para ver', series: 'Series para ver', program: 'Programas de TV para ver' }[f.tipo];
    return `${subject} ${when} ${where}`.replace(/\s+/g, ' ').trim();
  });
  readonly intro = computed(() => {
    const f = this.filters();
    if (this.isHome()) {
      return `Recomendaciones para hoy, ${this.today}: lo mejor de la TV en abierto esta noche y lo más visto en Netflix, Prime Video, Disney+, HBO Max y Movistar Plus+, con dónde verlo.`;
    }
    const parts: string[] = [];
    if (this.showTv()) parts.push(`lo que emiten ${f.donde === 'abierto' || f.donde === 'gratis' ? 'los canales en abierto' : 'los canales de televisión'} ${CUANDOS.find((c) => c.id === f.cuando)!.phrase}, con hora y canal`);
    if (this.showStreaming()) parts.push(f.platform ? `lo más visto en ${f.platform}` : f.donde === 'gratis' ? 'títulos gratis en plataformas de streaming' : 'lo más visto en las plataformas de streaming');
    return `${parts.join(', y ')}. Combina los filtros para afinar y toca un título para ver su ficha y dónde verlo.`.replace(/^./, (c) => c.toUpperCase());
  });
  readonly tvHeading = computed(() => {
    const f = this.filters();
    const subject = { '': 'En TV', movie: 'Películas en TV', series: 'Series en TV', program: 'Programas de TV' }[f.tipo];
    return `${subject} ${CUANDOS.find((c) => c.id === f.cuando)!.phrase}${f.donde === 'abierto' || f.donde === 'gratis' ? ' en abierto' : ''}`;
  });
  readonly streamHeading = computed(() => {
    const f = this.filters();
    const subject = { '': 'Películas y series', movie: 'Películas', series: 'Series', program: '' }[f.tipo];
    return f.platform ? `${subject} en ${f.platform}` : f.donde === 'gratis' ? `${subject} gratis en streaming` : `${subject} en streaming`;
  });
  readonly assistantAsks = ['Una película para esta noche', 'Algo gratis en la tele hoy', 'Una serie corta para el fin de semana', 'Thriller de menos de 2 horas'];

  readonly faq = computed<FaqItem[]>(() => {
    const films = this.tonightFilms().slice(0, 3).map((i) => `«${i.program.title}» (${i.channel.name}, ${hhmm(i.airing.start)})`);
    const live = this.liveItems().slice(0, 3).map((i) => `«${i.program.title}» en ${i.channel.name}`);
    const series = this.seriesItems().slice(0, 3).map((i) => {
      const c = normalizeToCard(i);
      return c.platforms[0] ? `«${c.title}» (${c.platforms[0]})` : `«${c.title}»`;
    });
    const movie = this.movieItems()[0] ? normalizeToCard(this.movieItems()[0]) : null;
    return [
      {
        question: '¿Qué película ver hoy en la tele gratis?',
        answer: films.length
          ? `Esta noche en abierto: ${films.join(', ')}. Con los filtros «Películas», «Esta noche» y «TV en abierto» tienes todas, con su hora y canal.`
          : 'Con los filtros «Películas», «Esta noche» y «TV en abierto» tienes todas las películas de la noche, con su hora y canal.',
      },
      {
        question: '¿Qué echan ahora en la televisión?',
        answer: live.length
          ? `Ahora mismo: ${live.join(', ')}. El filtro «Ahora» muestra todo lo que está en emisión.`
          : 'El filtro «Ahora» muestra lo que emiten en este momento todos los canales.',
      },
      {
        question: '¿Qué series ver hoy en streaming?',
        answer: series.length
          ? `Las más vistas esta semana: ${series.join(', ')}. Elige tu plataforma para ver solo las de tu servicio.`
          : 'Elige tu plataforma para ver las series más vistas en Netflix, Prime Video, Disney+, HBO Max o Movistar Plus+.',
      },
      {
        question: '¿Cuál es la película más vista en streaming esta semana?',
        answer: movie
          ? `«${movie.title}»${movie.platforms[0] ? `, en ${movie.platforms[0]}` : ''}. En su ficha tienes la sinopsis, el reparto y dónde verla.`
          : 'Con los filtros «Películas» y «Streaming» tienes las más vistas en las plataformas en España esta semana.',
      },
      {
        question: '¿Dónde ver películas y series gratis?',
        answer: 'En los canales de la TDT en abierto (La 1, Antena 3, Telecinco, laSexta…) y en plataformas gratuitas. El filtro «Gratis» junta las dos cosas.',
      },
      {
        question: '¿Qué ponen mañana en la tele?',
        answer: 'Con el filtro «Mañana» tienes la programación del día siguiente de todos los canales, y puedes quedarte solo con las películas o las series.',
      },
      {
        question: '¿Cómo elijo qué ver?',
        answer: 'Combina tipo (película, serie o programa), cuándo (ahora, esta noche, hoy o mañana), dónde (TV, TV en abierto, streaming o gratis) y plataforma, o pregunta al asistente.',
      },
    ];
  });

  readonly structuredData = computed<SafeHtml>(() => {
    const list = this.isHome()
      ? [...this.tonightFilms(), ...this.movieItems()].map((i) => normalizeToCard(i))
      : [...this.tvItems(), ...this.streamItems()].map((i) => normalizeToCard(i));
    const schemas: object[] = [
      generateBreadcrumbSchema(
        [
          { name: 'Inicio', url: '/' },
          { name: 'Qué ver hoy', url: PATH },
        ],
        BASE_URL
      ),
    ];
    if (list.length) schemas.push(generateItemListSchema(list, this.h1(), BASE_URL));
    return this.sanitizer.bypassSecurityTrustHtml(schemas.map((s) => `<script type="application/ld+json">${serializeJsonLd(s)}</script>`).join(''));
  });

  constructor() {
    // A new filter starts again from the first cards.
    effect(() => {
      this.tvRequest();
      this.tvShown.set(TV_PAGE);
    });
    effect(() => {
      const home = this.isHome();
      const empty = !home && this.resultsReady() && !this.resultCount();
      this.meta.setMetaTags({
        title: home ? 'Qué ver hoy en TV y streaming: películas, series y programas | Guía TV' : `${this.h1()} | Guía TV`,
        description: home
          ? `Qué ver hoy, ${this.today}: las mejores películas y series de esta noche en la TV en abierto y lo más visto en Netflix, Prime Video, Disney+ y HBO Max, con dónde verlo.`
          : `${this.h1()}. ${this.intro()}`.slice(0, 300),
        // MetaService drops query params: every filter consolidates on the base page.
        canonicalUrl: PATH,
        type: 'website',
        // Searches and empty combinations are thin: followed, not indexed.
        robots: this.filters().q || empty ? 'noindex, follow' : undefined,
      });
    });
  }

  tileVariant(item: UnifiedDiscoveryItem): 'tv' | 'poster' {
    return isTvReadItem(item) ? 'tv' : 'poster';
  }

  trackItem(item: UnifiedDiscoveryItem): string {
    const c = normalizeToCard(item);
    return `${c.detailPath}|${c.startTime || ''}|${c.channelName || ''}`;
  }

  openAssistant(): void {
    this.chat.requestToggleAssistant();
  }

  /** Self-hosted brand mark of a streaming platform; empty when the name matches none. */
  private readonly failedLogos = new Set<string>();

  platformLogo(name: string): string {
    if (this.failedLogos.has(name)) return '';
    return resolvePlatformLogoUrl(name);
  }

  onLogoError(name: string): void {
    this.failedLogos.add(name);
  }

  /** TV airings for the filter: when → view/date, where → channel group, type → category. */
  private loadTv(f: Filters): Observable<TvReadItemDTO[]> {
    const options = {
      group: f.donde === 'abierto' || f.donde === 'gratis' ? 'tdt' : undefined,
      category: f.tipo === 'movie' ? 'Cine' : f.tipo === 'series' ? 'Series' : undefined,
      q: f.q || undefined,
    };
    const request =
      f.cuando === 'ahora'
        ? this.facade.getLivePrograms({ ...options, limit: 96 })
        : f.cuando === 'noche'
          ? this.facade.getTonightPrograms({ ...options, limit: 96 })
          : this.facade.getAllPrograms({ ...options, date: f.cuando === 'manana' ? 'tomorrow' : 'today', limit: 240 });
    return request.pipe(
      map((items) =>
        dedupe(items, f.cuando !== 'manana')
          // "Programas" is what is neither a film nor a series.
          .filter((i) => f.tipo !== 'program' || !(FILM.test(normalizeToCard(i).category) || SERIES.test(normalizeToCard(i).category)))
          .sort((a, b) => a.airing.start.localeCompare(b.airing.start))
      )
    );
  }

  private catalogue(filters: { types: UnifiedContentType[]; availability?: UnifiedAvailability[]; limit: number }) {
    return this.facade.discoverContent({ ...filters, sort: 'popular', page: 1 }).pipe(catchError(() => of(EMPTY_RESULT)));
  }
}

/** The provider repeats a broadcast across feeds: keep one per title and start time (and drop what has ended). */
function dedupe(items: TvReadItemDTO[], dropEnded = true): TvReadItemDTO[] {
  const seen = new Set<string>();
  const now = Date.now();
  return items.filter((item) => {
    const key = `${item.program.title.trim().toLowerCase()}|${item.airing.start}`;
    if (seen.has(key) || (dropEnded && new Date(item.airing.end).getTime() <= now)) return false;
    seen.add(key);
    return true;
  });
}
