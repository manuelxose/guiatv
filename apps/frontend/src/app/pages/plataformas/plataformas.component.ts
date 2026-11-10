import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Params, RouterModule } from '@angular/router';
import { catchError, combineLatest, map, of, startWith, switchMap } from 'rxjs';
import { FaqItem, FaqSectionComponent } from '../../components/faq-section/faq-section.component';
import { PanelNavComponent, PanelNavGroup } from '../../components/panel-nav/panel-nav.component';
import { PanelShellComponent } from '../../components/panel-shell/panel-shell.component';
import { PanelTileComponent } from '../../components/panel-tile/panel-tile.component';
import { PLATAFORMAS_LINKS, STREAMING_PLATFORMS, StreamingPlatform } from '../../config/plataformas-nav';
import { APP_PATHS } from '../../config/route-map';
import { outboundRel } from '../../services/affiliate.service';
import { CatalogItem } from '../../services/catalog.service';
import { ChatService } from '../../services/chat.service';
import { MetaService } from '../../services/meta.service';
import { MonetizationOffer, MonetizationService } from '../../services/monetization.service';
import { TvDataFacade } from '../../state/tv-data.facade';
import { UnifiedAvailability, UnifiedContentType } from '../../state/unified-guide.state';
import { normalizeToCard } from '../../utils/tv-normalizers';
import { resolvePlatformLogoUrl } from '../../utils/platform-logos';
import { generateBreadcrumbSchema, generateItemListSchema, serializeJsonLd } from '../../utils/utils';

const BASE_URL = 'https://guiaprogramaciontv.com';
const PATH = APP_PATHS.platforms;
const HOME_RAILS = ['netflix', 'prime-video', 'disney-plus', 'max'];

type Tipo = '' | 'movie' | 'series';
type Orden = 'popular' | 'recent';
interface Filters {
  platform: StreamingPlatform | null;
  tipo: Tipo;
  orden: Orden;
  gratis: boolean;
  page: number;
}
type Load = { status: 'idle' | 'loading' | 'ready' | 'error'; items: CatalogItem[]; hasMore: boolean };

/** One platform as the page shows it: registry data plus its cheapest plan and the other plans. */
export interface PlatformView extends StreamingPlatform {
  from: string;
  offers: MonetizationOffer[];
  main: MonetizationOffer | null;
}

const TIPOS: ReadonlyArray<{ id: Tipo; label: string; noun: string }> = [
  { id: '', label: 'Todo', noun: 'Películas y series' },
  { id: 'movie', label: 'Películas', noun: 'Películas' },
  { id: 'series', label: 'Series', noun: 'Series' },
];

/**
 * /plataformas: the streaming services available in Spain, with price, specs and catalogue.
 * Filters are links with the same query params as before (?platform=, ?type=, ?availability=free,
 * ?sort=recent, ?page=). "Novedades" only with a platform (without one the API returns unreleased
 * titles) and "Gratis" only without one (with one it would list titles free somewhere else).
 */
@Component({
  selector: 'app-plataformas',
  standalone: true,
  imports: [RouterModule, PanelShellComponent, PanelNavComponent, PanelTileComponent, FaqSectionComponent],
  templateUrl: './plataformas.component.html',
  styleUrls: ['../que-ver/que-ver.component.scss', './plataformas.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlataformasComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly facade = inject(TvDataFacade);
  private readonly monetization = inject(MonetizationService);
  private readonly meta = inject(MetaService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly chat = inject(ChatService);

  readonly appPaths = APP_PATHS;
  readonly path = PATH;
  readonly sideLinks = PLATAFORMAS_LINKS;
  readonly contextOpen = signal(false);

  // ── Filters from the URL ──
  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  readonly filters = computed<Filters>(() => {
    const p = this.params();
    const raw = (p.get('platform') || '').trim().toLowerCase();
    const platform = STREAMING_PLATFORMS.find((x) => x.name.toLowerCase() === raw || x.key === raw || (raw === 'max' && x.key === 'max')) || null;
    const type = p.get('type');
    return {
      platform,
      tipo: (type === 'movie' || type === 'series' ? type : '') as Tipo,
      orden: platform && p.get('sort') === 'recent' ? 'recent' : 'popular',
      gratis: !platform && (p.get('availability') || '').split(',').includes('free'),
      page: Math.max(1, Number(p.get('page')) || 1),
    };
  });
  readonly isHome = computed(() => {
    const f = this.filters();
    return !f.platform && !f.tipo && !f.gratis && f.page === 1;
  });

  // ── Prices and specs (live offers API, the comparator's source) ──
  private readonly offers = toSignal(
    this.monetization.getOffers().pipe(map((r) => r.items), catchError(() => of([] as MonetizationOffer[]))),
    { initialValue: [] as MonetizationOffer[] }
  );
  readonly platforms = computed<PlatformView[]>(() =>
    STREAMING_PLATFORMS.map((p) => {
      const offers = this.offers()
        .filter((o) => o.provider.id === p.key)
        .sort((a, b) => (a.pricing.monthlyAmount ?? Infinity) - (b.pricing.monthlyAmount ?? Infinity));
      const main = offers[0] || null;
      return { ...p, offers, main, from: main ? (main.pricing.monthlyAmount != null ? `Desde ${main.pricing.monthlyLabel}` : main.pricing.monthlyLabel) : '' };
    })
  );
  readonly current = computed(() => {
    const f = this.filters();
    return f.platform ? this.platforms().find((p) => p.key === f.platform!.key) || null : null;
  });
  readonly alternatives = computed(() => {
    const cur = this.current();
    return cur ? this.platforms().filter((p) => p.key !== cur.key).slice(0, 4) : [];
  });

  /** Provider ids whose brand mark failed to load: the card falls back to the coloured initial. */
  private readonly failedLogos = new Set<string>();

  platformLogo(platform: StreamingPlatform): string {
    if (this.failedLogos.has(platform.key)) return '';
    return resolvePlatformLogoUrl(platform.name);
  }

  onLogoError(platform: StreamingPlatform): void {
    this.failedLogos.add(platform.key);
  }

  // ── Filtered catalogue: one API page per URL ──
  private readonly results = toSignal(
    toObservable(this.filters).pipe(
      switchMap((f) =>
        this.isHome()
          ? of<Load>({ status: 'idle', items: [], hasMore: false })
          : this.facade
              .discoverContent({
                types: f.tipo ? [f.tipo as UnifiedContentType] : ['movie', 'series'],
                platforms: f.platform ? [f.platform.name] : [],
                availability: f.gratis ? (['free'] as UnifiedAvailability[]) : [],
                sort: f.orden,
                page: f.page,
                // The API answers limit=48 with 8 items; 24 returns the full page (~20 per type).
                limit: 24,
              })
              .pipe(
                map((r): Load => ({ status: 'ready', items: r.items as CatalogItem[], hasMore: r.meta.hasMore })),
                catchError(() => of<Load>({ status: 'error', items: [], hasMore: false })),
                startWith<Load>({ status: 'loading', items: [], hasMore: false })
              )
      )
    ),
    { initialValue: { status: 'loading', items: [], hasMore: false } as Load }
  );
  readonly status = computed(() => this.results().status);
  readonly items = computed(() => this.results().items);
  readonly hasMore = computed(() => this.results().hasMore);

  // ── Home rails: the four biggest services and free titles ──
  readonly rails = toSignal(
    combineLatest(
      HOME_RAILS.map((key) => {
        const platform = STREAMING_PLATFORMS.find((p) => p.key === key)!;
        return this.facade
          .discoverContent({ types: ['movie', 'series'], platforms: [platform.name], sort: 'popular', limit: 24 })
          .pipe(
            map((r) => ({ platform, items: interleave(r.items as CatalogItem[]).slice(0, 8) })),
            catchError(() => of({ platform, items: [] as CatalogItem[] }))
          );
      })
    ).pipe(map((rails) => rails.filter((r) => r.items.length))),
    { initialValue: [] as Array<{ platform: StreamingPlatform; items: CatalogItem[] }> }
  );
  readonly freeItems = toSignal(
    this.facade
      .discoverContent({ types: ['movie', 'series'], availability: ['free'], sort: 'popular', limit: 24 })
      .pipe(map((r) => interleave(r.items as CatalogItem[]).slice(0, 8)), catchError(() => of([] as CatalogItem[]))),
    { initialValue: [] as CatalogItem[] }
  );

  // ── Filter links ──
  /** Query params for a change; "Novedades" needs a platform, "Gratis" needs none. */
  link(change: Partial<{ platform: StreamingPlatform | null; tipo: Tipo; orden: Orden; gratis: boolean; page: number }>): Params {
    const f = { ...this.filters(), page: 1, ...change };
    if (change.platform) f.gratis = false;
    if (change.gratis) f.platform = null;
    if (!f.platform) f.orden = 'popular';
    return {
      platform: f.platform?.name || null,
      type: f.tipo || null,
      sort: f.orden === 'recent' ? 'recent' : null,
      availability: f.gratis ? 'free' : null,
      page: f.page > 1 ? f.page : null,
    };
  }

  readonly facets = computed(() => {
    const f = this.filters();
    return {
      platforms: [
        { label: 'Todas', params: this.link({ platform: null }), on: !f.platform },
        ...STREAMING_PLATFORMS.map((p) => ({ label: p.name, params: this.link({ platform: p }), on: f.platform?.key === p.key })),
      ],
      tipos: TIPOS.map((t) => ({ label: t.label, params: this.link({ tipo: t.id }), on: f.tipo === t.id })),
      ordenes: f.platform
        ? [
            { label: 'Lo más visto', params: this.link({ orden: 'popular' }), on: f.orden === 'popular' },
            { label: 'Novedades', params: this.link({ orden: 'recent' }), on: f.orden === 'recent' },
          ]
        : [],
      accesos: f.platform
        ? []
        : [
            { label: 'Todo', params: this.link({ gratis: false }), on: !f.gratis },
            { label: 'Gratis', params: this.link({ gratis: true }), on: f.gratis },
          ],
    };
  });
  readonly activeFilters = computed(() => {
    const f = this.filters();
    const out: Array<{ label: string; params: Params }> = [];
    if (f.platform) out.push({ label: f.platform.name, params: this.link({ platform: null }) });
    if (f.tipo) out.push({ label: TIPOS.find((t) => t.id === f.tipo)!.label, params: this.link({ tipo: '' }) });
    if (f.orden === 'recent') out.push({ label: 'Novedades', params: this.link({ orden: 'popular' }) });
    if (f.gratis) out.push({ label: 'Gratis', params: this.link({ gratis: false }) });
    return out;
  });
  readonly sideGroups = computed<PanelNavGroup[]>(() => {
    const x = this.facets();
    const toLinks = (list: Array<{ label: string; params: Params; on: boolean }>) => list.map((o) => ({ label: o.label, path: PATH, queryParams: o.params, active: o.on }));
    const groups: PanelNavGroup[] = [
      { title: 'Plataforma', links: toLinks(x.platforms) },
      { title: 'Tipo', links: toLinks(x.tipos) },
    ];
    if (x.ordenes.length) groups.push({ title: 'Orden', links: toLinks(x.ordenes) });
    if (x.accesos.length) groups.push({ title: 'Acceso', links: toLinks(x.accesos) });
    return groups;
  });

  // ── Copy ──
  readonly h1 = computed(() => {
    const f = this.filters();
    const noun = TIPOS.find((t) => t.id === f.tipo)!.noun;
    if (f.platform) {
      if (f.orden === 'recent') return `Novedades de ${f.platform.name}: ${noun.toLowerCase()} recién llegadas`;
      return f.tipo ? `${noun} de ${f.platform.name}: lo más visto en España` : `${f.platform.name}: qué ver, catálogo y precio en España`;
    }
    if (f.gratis) return `${noun} gratis en streaming`;
    if (f.tipo) return `${noun} más vistas en las plataformas de streaming`;
    return 'Plataformas de streaming en España: precios, catálogo y qué ver';
  });
  readonly intro = computed(() => {
    const cur = this.current();
    if (cur) {
      return `${cur.main?.highlight || `El catálogo de ${cur.name} en España.`} Abajo tienes ${this.filters().orden === 'recent' ? 'lo último que ha llegado' : 'lo más visto ahora'}, con la ficha de cada título.`;
    }
    if (this.filters().gratis) return 'Películas y series que puedes ver sin pagar suscripción en alguna plataforma de streaming en España.';
    return 'Netflix, Prime Video, Disney+, HBO Max, Movistar Plus+, SkyShowtime, Apple TV+ y Filmin: qué cuesta cada una, qué tiene y lo más visto en cada catálogo.';
  });
  readonly resultsHeading = computed(() => {
    const f = this.filters();
    const noun = TIPOS.find((t) => t.id === f.tipo)!.noun;
    if (f.platform) return `${f.orden === 'recent' ? 'Novedades' : 'Lo más visto'}: ${noun.toLowerCase()} en ${f.platform.name}`;
    return f.gratis ? `${noun} gratis` : `${noun} más vistas`;
  });
  readonly assistantAsks = computed(() => {
    const cur = this.current();
    return cur
      ? [`¿Qué veo en ${cur.name}?`, `¿Merece la pena ${cur.name}?`, `Alternativas más baratas a ${cur.name}`]
      : ['¿Qué plataforma me conviene?', '¿Netflix o HBO Max?', '¿Cuál tiene más cine?'];
  });

  readonly faq = computed<FaqItem[]>(() => {
    const cur = this.current();
    const cheapest = this.platforms()
      .filter((p) => p.main?.pricing.monthlyAmount)
      .sort((a, b) => a.main!.pricing.monthlyAmount! - b.main!.pricing.monthlyAmount!)
      .slice(0, 3)
      .map((p) => `${p.name} (${p.main!.pricing.monthlyLabel})`);
    if (cur) {
      const m = cur.main;
      const titles = this.items().slice(0, 3).map((i) => `«${i.title}»`);
      return [
        { question: `¿Cuánto cuesta ${cur.name} en España?`, answer: m ? `El plan más barato es «${m.plan.name}» por ${m.pricing.monthlyLabel}${cur.offers.length > 1 ? `; hay ${cur.offers.length} planes en total` : ''}. Los precios pueden cambiar: revisa las condiciones de ${cur.name}.` : `Consulta el precio en la web de ${cur.name}.` },
        { question: `¿${cur.name} tiene prueba gratis?`, answer: m?.trialDays ? `Sí, ${m.trialDays} días.` : `Ahora mismo ${cur.name} no ofrece prueba gratuita en España.` },
        { question: `¿Qué ver en ${cur.name}?`, answer: titles.length ? `Lo más visto ahora: ${titles.join(', ')}. En esta página tienes el resto, y con «Novedades» lo último que ha llegado.` : `En esta página tienes lo más visto en ${cur.name} y sus novedades.` },
        { question: `¿En cuántas pantallas a la vez se puede ver ${cur.name}?`, answer: m ? `${m.features.simultaneousStreams} en el plan «${m.plan.name}», con calidad de hasta ${m.features.maxResolution}.` : `Depende del plan contratado.` },
        { question: `¿Qué alternativas hay a ${cur.name}?`, answer: `${this.alternatives().map((a) => `${a.name}${a.from ? ` (${a.from.toLowerCase()})` : ''}`).join(', ')}. Compáralas en el comparador de plataformas.` },
      ];
    }
    return [
      { question: '¿Cuál es la plataforma de streaming más barata?', answer: cheapest.length ? `Entre las de pago: ${cheapest.join(', ')}. RTVE Play y Pluto TV son gratis.` : 'RTVE Play y Pluto TV son gratis; entre las de pago, revisa el comparador.' },
      { question: '¿Qué plataforma tiene más películas y series?', answer: 'Netflix y Prime Video tienen los catálogos más amplios en España; Filmin destaca en cine de autor y Disney+ en franquicias y familia.' },
      { question: '¿Dónde ver películas y series gratis?', answer: 'En RTVE Play, Pluto TV y en los canales de la TDT. El filtro «Gratis» muestra títulos que puedes ver sin suscripción.' },
      { question: '¿Cómo elijo plataforma?', answer: 'Mira qué tiene cada una en su catálogo, compara precio, pantallas y calidad en el comparador, o pregunta al asistente según lo que te gusta ver.' },
      { question: '¿Los precios están actualizados?', answer: 'Revisamos los precios en las webs oficiales de cada servicio en España; promociones y paquetes con operadoras pueden cambiar el importe final.' },
    ];
  });

  readonly structuredData = computed<SafeHtml>(() => {
    const crumbs = [
      { name: 'Inicio', url: '/' },
      { name: 'Plataformas', url: PATH },
    ];
    const schemas: object[] = [generateBreadcrumbSchema(crumbs, BASE_URL)];
    const list = this.isHome() ? this.rails().flatMap((r) => r.items.slice(0, 3)) : this.items();
    if (list.length) schemas.push(generateItemListSchema(list.map((i) => normalizeToCard(i)), this.h1(), BASE_URL));
    return this.sanitizer.bypassSecurityTrustHtml(schemas.map((s) => `<script type="application/ld+json">${serializeJsonLd(s)}</script>`).join(''));
  });

  constructor() {
    effect(() => {
      const home = this.isHome();
      const empty = !home && this.status() === 'ready' && !this.items().length;
      this.meta.setMetaTags({
        title: home ? 'Plataformas de streaming en España: precios y catálogo | Guía TV' : `${this.h1()} | Guía TV`,
        description: home
          ? 'Compara Netflix, Prime Video, Disney+, HBO Max, Movistar Plus+, SkyShowtime, Apple TV+ y Filmin: precio, pantallas, calidad y lo más visto en cada catálogo.'
          : `${this.h1()}. ${this.intro()}`.slice(0, 300),
        // MetaService drops query params: every filter consolidates on /plataformas.
        canonicalUrl: PATH,
        type: 'website',
        robots: empty ? 'noindex, follow' : undefined,
      });
    });
  }

  outboundUrl(offer: MonetizationOffer): string {
    return this.monetization.buildOutboundUrl(offer.outbound.path, 'provider-summary');
  }

  outboundRel(offer: MonetizationOffer): string {
    return outboundRel(offer.outbound.path, offer.outbound.isSponsored);
  }

  yesNo(value: boolean | null): string {
    return value === null ? 'Según plan' : value ? 'Sí' : 'No';
  }

  openAssistant(): void {
    this.chat.requestToggleAssistant();
  }
}

/** Movies and series arrive as two blocks; alternate them so a rail shows both. */
function interleave(items: CatalogItem[]): CatalogItem[] {
  const movies = items.filter((i) => i.contentType === 'movie');
  const series = items.filter((i) => i.contentType !== 'movie');
  const out: CatalogItem[] = [];
  for (let i = 0; i < Math.max(movies.length, series.length); i++) {
    if (movies[i]) out.push(movies[i]);
    if (series[i]) out.push(series[i]);
  }
  return out;
}
