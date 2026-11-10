import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Params, RouterLink } from '@angular/router';
import { catchError, map, Observable, of, startWith, switchMap } from 'rxjs';
import { TvReadItemDTO } from '../../api/models';
import { EpgGridComponent } from '../../components/epg-grid/epg-grid.component';
import { PanelNavComponent, PanelNavGroup, PanelNavLink } from '../../components/panel-nav/panel-nav.component';
import { PanelShellComponent } from '../../components/panel-shell/panel-shell.component';
import { PanelTileComponent } from '../../components/panel-tile/panel-tile.component';
import { UnifiedAsyncStateComponent } from '../../components/unified-async-state/unified-async-state.component';
import { UnifiedSkeletonBlockComponent } from '../../components/unified-skeleton-block/unified-skeleton-block.component';
import { PORTAL_ICON_PATHS } from '../../config/portal-navigation.config';
import { TV_SECTION_LINKS } from '../../config/tv-section-nav';
import { APP_PATHS } from '../../config/route-map';
import { ChatService } from '../../services/chat.service';
import { MetaService } from '../../services/meta.service';
import { TvDataFacade } from '../../state/tv-data.facade';
import { UnifiedLiveFlag } from '../../state/unified-guide.state';
import { madridMinutesSinceMidnight } from '../../utils/madrid-time';
import { dropOverlappingAirings, normalizeToCard } from '../../utils/tv-normalizers';
import { generateItemListSchema, serializeJsonLd } from '../../utils/utils';

const BASE_URL = 'https://guiaprogramaciontv.com';
const MADRID = 'Europe/Madrid';
const DAY_MS = 86_400_000;
const timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: MADRID });
const dayFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: MADRID });
const weekdayFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: MADRID });
const hhmm = (iso?: string): string => (iso ? timeFmt.format(new Date(iso)) : '');
const isoDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: MADRID });
const isLive = (item: TvReadItemDTO, now: number) => Date.parse(item.airing.start) <= now && now < Date.parse(item.airing.end);
/** From 21:00 on that calendar day in Madrid (a broadcast day also holds the previous night, which is not "tonight"). */
const isPrimeTime = (item: TvReadItemDTO, day: string) => {
  const start = new Date(item.airing.start);
  return isoDayFmt.format(start) === day && madridMinutesSinceMidnight(start) >= 21 * 60;
};

export type TvGuideView = 'now' | 'next' | 'night';
export type TvGuideFormat = 'grid' | 'cards';
type Option = { id: string; label: string };

// Same query params as the previous guide, so every existing link (?liveView=night…) keeps working.
// No liveView/format = grid, now. Default group TDT: a day of all 423 channels is ~25 MB of server HTML ("Todos" stays a filter).
const DEFAULTS: Params = { liveView: 'now', format: 'grid', date: 'today', category: 'all', group: 'tdt', region: 'all', channelType: 'all', country: 'es' };
// Phase 1: only countries with real, schedule-complete channels in the already-configured EPG feeds (verified by
// hand against the feeds themselves — most country mentions in them are placenames inside programme synopses,
// not actual channels: Reino Unido has 30 real Sky/TNT/Premier Sports channels, Portugal 22, Alemania 25, all with
// full schedules). España stays the default so nothing about today's site changes. No France: searched the same
// feeds by hand (id/display-name prefix, parenthetical, any mention) and found no actual French channel.
const COUNTRIES: Option[] = [
  { id: 'es', label: 'España' },
  { id: 'gb', label: 'Reino Unido' },
  { id: 'pt', label: 'Portugal' },
  { id: 'de', label: 'Alemania' },
];
const VIEWS: Option[] = [
  { id: 'now', label: 'Ahora' },
  { id: 'next', label: 'A continuación' },
  { id: 'night', label: 'Esta noche' },
];
// Separate from the time tabs above: each one reads as a full grid (Parrilla) or as cards (Tarjetas) — a
// display preference, not a time slot, so it gets its own selector instead of living inside VIEWS.
const FORMATS: Option[] = [
  { id: 'grid', label: 'Parrilla' },
  { id: 'cards', label: 'Tarjetas' },
];
const DATE_IDS = ['today', 'tomorrow', 'after_tomorrow'];
const CATEGORIES: Option[] = [
  { id: 'all', label: 'Todo' },
  { id: 'Cine', label: 'Cine' },
  { id: 'Series', label: 'Series' },
  { id: 'Deportes', label: 'Deportes' },
  { id: 'Entretenimiento', label: 'Entretenimiento' },
  { id: 'Noticias', label: 'Noticias' },
  { id: 'Infantil', label: 'Infantil' },
];
const GROUPS: Option[] = [
  { id: 'all', label: 'Todos' },
  { id: 'tdt', label: 'TDT' },
  { id: 'autonomico', label: 'Autonómicos' },
  { id: 'cable', label: 'Cable' },
  { id: 'movistar', label: 'Movistar+' },
  { id: 'online', label: 'Online' },
  { id: 'deporte', label: 'Deportes' },
];
// Only autonomico channels carry a region; under "Todos" it still narrows the mix down to that region's channels.
// Any other group (tdt, cable…) has none, so a region picked earlier must not stay applied there.
const REGION_GROUPS = new Set(['all', 'autonomico']);
const FLAGS: Array<{ id: UnifiedLiveFlag; label: string }> = [
  { id: 'live', label: 'Directo' },
  { id: 'catchup', label: 'A la carta' },
  { id: 'streaming', label: 'Streaming' },
];
/** Generic wording for every Phase 1 country beyond España (same shape, just the country name changes). */
function genericIntro(country: string): Record<TvGuideView, string> {
  return {
    now: `Lo que emiten ahora mismo los canales de ${country} disponibles en esta guía, con lo que le queda a cada programa.`,
    next: `Lo siguiente en cada canal de ${country}, para saber qué viene después.`,
    night: `El prime time de los canales de ${country}, con su hora y su canal.`,
  };
}
/** The "now" view read as a grid for another day: the full day's schedule, not scrolled to any particular time. */
function fullDayIntro(country: string): string {
  return country === 'es'
    ? 'Parrilla completa de los canales de TDT, autonómicos y de pago. Toca un programa para ver el detalle o abre su ficha.'
    : `Parrilla de los canales de ${country} disponibles en esta guía. Toca un programa para ver el detalle.`;
}

const INTRO: Record<string, Record<TvGuideView, string>> = {
  es: {
    now: 'Lo que emiten ahora mismo La 1, Antena 3, Telecinco, laSexta y el resto de canales, con lo que le queda a cada programa.',
    next: 'Lo siguiente en cada canal, para saber qué viene después sin cambiar de canal.',
    night: 'El prime time de los canales de TV: películas, series, fútbol y programas de la noche, con su hora y su canal.',
  },
  gb: genericIntro('Reino Unido'),
  pt: genericIntro('Portugal'),
  de: genericIntro('Alemania'),
};

interface LoadResult {
  status: 'loading' | 'ready' | 'error';
  items: TvReadItemDTO[];
}

export interface TvGuideChip {
  id: string;
  label: string;
  on: boolean;
  params: Params;
}

/**
 * TV section (programacion-tv/en-directo), grid first, in the three-panel layout of docs/design/unified-shell.html:
 * TV menu and channel facets on the left, view/day/category + the grid or cards in the centre, the selected
 * programme on the right.
 *
 * Two independent axes, both in the URL: the view (now/next/night — which slice of the day) and the format
 * (grid/cards — how it's read), e.g. "A continuación" in cards is simply {liveView:'next', format:'cards'}.
 * Neither one changes the data loaded: only the day, the channel group, the country and a search do, so
 * switching view or format costs no request. Category, channel type, region and availability are applied to
 * the loaded day. The URL is the only filter state, and every filter is a crawlable link.
 */
@Component({
  selector: 'app-tv-guide',
  standalone: true,
  imports: [
    RouterLink,
    PanelShellComponent,
    PanelNavComponent,
    PanelTileComponent,
    EpgGridComponent,
    UnifiedSkeletonBlockComponent,
    UnifiedAsyncStateComponent,
  ],
  templateUrl: './tv-guide.component.html',
  styleUrl: './tv-guide.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TvGuideComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly facade = inject(TvDataFacade);
  private readonly meta = inject(MetaService);
  private readonly chat = inject(ChatService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly appPaths = APP_PATHS;
  readonly hhmm = hhmm;

  // ── Filters, read from the URL ──
  private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private readonly raw = computed<Params>(() => {
    const q = this.query();
    return Object.fromEntries(q.keys.map((key) => [key, q.get(key)]));
  });
  private param(key: string): string {
    return this.query().get(key) || DEFAULTS[key] || '';
  }
  readonly view = computed<TvGuideView>(() => {
    const value = this.param('liveView');
    return VIEWS.some((v) => v.id === value) ? (value as TvGuideView) : 'now';
  });
  readonly format = computed<TvGuideFormat>(() => (this.param('format') === 'cards' ? 'cards' : 'grid'));
  /** Another day only makes sense for tonight, and for "now" read as a grid (a future day has no "now" to
   * scroll to, so it just shows that whole day — what a separate "Parrilla" view used to mean). */
  readonly date = computed(() => {
    const value = this.param('date');
    return (this.view() === 'night' || this.view() === 'now') && DATE_IDS.includes(value) ? value : 'today';
  });
  readonly category = computed(() => this.param('category'));
  readonly country = computed(() => (COUNTRIES.some((c) => c.id === this.param('country')) ? this.param('country') : 'es'));
  // Grupo/Región/Tipo de canal are Spain's own distribution taxonomy (TDT, autonómico, comunidades…) — they don't
  // apply to another country's channels, so switching country away from España ignores (and later clears) them.
  readonly group = computed(() => (this.country() === 'es' ? this.param('group') : 'all'));
  // Ignores a leftover ?region= from a bookmark or an earlier group too, not just chip clicks (see groupParams).
  readonly region = computed(() => (this.country() === 'es' && REGION_GROUPS.has(this.group()) ? this.param('region') : 'all'));
  readonly channelType = computed(() => (this.country() === 'es' ? this.param('channelType') : 'all'));
  readonly flags = computed(() =>
    this.param('flags').split(',').filter((f): f is UnifiedLiveFlag => FLAGS.some((o) => o.id === f))
  );
  readonly search = computed(() => this.param('q').trim());

  // ── Data: one request per (day, group, search) ──
  private readonly retryNonce = signal(0);
  private readonly requestKey = computed(() =>
    JSON.stringify([this.date(), this.group(), this.country(), this.search(), this.search() ? this.category() : '', this.retryNonce()])
  );
  private readonly result = toSignal(
    toObservable(this.requestKey).pipe(
      switchMap(() =>
        this.load().pipe(
          map((items): LoadResult => ({ status: 'ready', items })),
          catchError(() => of<LoadResult>({ status: 'error', items: [] })),
          startWith<LoadResult>({ status: 'loading', items: [] })
        )
      )
    ),
    { initialValue: { status: 'loading', items: [] } as LoadResult }
  );
  readonly status = computed(() => this.result().status);
  // A channel airs one programme at a time; the feeds send the same channel minutes apart, so drop the overlaps
  // here once and every view (grid, cards, tonight, the SEO list) sees the same single timeline.
  readonly items = computed(() =>
    dropOverlappingAirings(
      this.facade.applyLiveFilters(this.result().items, {
        region: this.region(),
        channelType: this.channelType(),
        flags: this.flags(),
      })
    )
  );
  // What's airing right now (regardless of the active view/format) — the right panel's and the SEO list's
  // default is "what's on now", and it's also what the cards format shows for the "now" view (below).
  readonly liveNowItems = computed(() => this.items().filter((i) => isLive(i, Date.now())));
  /** Cards format, per view: live now, the very next programme per channel, or tonight's lineup. Category
   * filters out here (the grid only dims, to keep its shape) — same normalized label the grid dims by. */
  readonly cardItems = computed(() => {
    const cat = this.category();
    const matches = (i: TvReadItemDTO) => cat === 'all' || normalizeToCard(i).category === cat;
    if (this.view() === 'night') {
      const day = this.isoDay();
      return this.items().filter((i) => isPrimeTime(i, day) && matches(i));
    }
    if (this.view() === 'next') {
      const now = Date.now();
      const perChannel = new Map<string, TvReadItemDTO>();
      for (const i of this.items()) {
        if (Date.parse(i.airing.start) <= now) continue;
        const current = perChannel.get(i.channel.id);
        if (!current || i.airing.start < current.airing.start) perChannel.set(i.channel.id, i);
      }
      return [...perChannel.values()].filter(matches);
    }
    return this.liveNowItems().filter(matches);
  });
  readonly channels = computed(() => {
    const seen = new Map<string, { name: string; path: string }>();
    for (const item of this.items()) {
      if (!seen.has(item.channel.id)) seen.set(item.channel.id, { name: item.channel.name, path: normalizeToCard(item).channelPath });
    }
    return [...seen.values()].filter((c) => c.path);
  });

  // ── Labels ──
  private readonly dayOffset = computed(() => DATE_IDS.indexOf(this.date()));
  private readonly isoDay = computed(() => isoDayFmt.format(new Date(Date.now() + this.dayOffset() * DAY_MS)));
  readonly dayLabel = computed(() => dayFmt.format(new Date(Date.now() + this.dayOffset() * DAY_MS)));
  readonly h1 = computed(() => {
    const day = ['hoy', 'mañana', 'el ' + weekdayFmt.format(new Date(Date.now() + 2 * DAY_MS))][this.dayOffset()];
    const base = {
      // "now" for another day has no "now" to speak of — it's that whole day's schedule (what "Parrilla" used to be).
      now: this.dayOffset() ? `Programación TV ${day}` : 'Qué echan ahora en la tele',
      next: 'Qué echan a continuación en la tele',
      night: this.dayOffset() ? `Qué ponen ${day} por la noche en la tele` : 'Qué ponen esta noche en la tele',
    }[this.view()];
    const category = CATEGORIES.find((c) => c.id === this.category() && c.id !== 'all');
    const country = COUNTRIES.find((c) => c.id === this.country() && c.id !== 'es');
    const suffix = [category?.label, country?.label].filter(Boolean).join(' · ');
    return this.search() ? `Programas con «${this.search()}» en la tele` : base + (suffix ? ` · ${suffix}` : '');
  });
  readonly intro = computed(() =>
    this.view() === 'now' && this.dayOffset()
      ? fullDayIntro(this.country() === 'es' ? 'es' : this.countryLabel())
      : (INTRO[this.country()] || INTRO['es'])[this.view()]
  );
  readonly countryLabel = computed(() => COUNTRIES.find((c) => c.id === this.country())?.label || '');
  readonly crumb = computed(() => VIEWS.find((v) => v.id === this.view())!.label);

  // ── Links: each filter is an <a> that changes one query param; a default value leaves the URL ──
  link(patch: Params): Params {
    const next: Params = { ...this.raw(), ...patch };
    for (const key of Object.keys(next)) if (next[key] === '' || next[key] === DEFAULTS[key]) next[key] = null;
    return next;
  }
  private chips(key: string, options: Option[], current: string): TvGuideChip[] {
    return options.map((o) => ({ ...o, on: o.id === current, params: this.link({ [key]: o.id }) }));
  }
  /** Switching to a group without regions drops a region picked under another group, instead of leaving it stuck. */
  private groupParams(id: string): Params {
    const patch: Params = { group: id };
    if (!REGION_GROUPS.has(id)) patch['region'] = null;
    return this.link(patch);
  }
  /** Switching country drops every Spain-only facet (group/region/channelType) — none of them applies elsewhere. */
  private countryParams(id: string): Params {
    return this.link({ country: id, group: null, region: null, channelType: null });
  }

  readonly filters = computed(() => {
    const loaded = this.result().items;
    const distinct = (pick: (i: TvReadItemDTO) => string): Option[] => [
      { id: 'all', label: 'Todos' },
      ...[...new Set(loaded.map(pick).filter((v) => v && v !== 'unknown'))].sort((a, b) => a.localeCompare(b, 'es')).map((v) => ({ id: v, label: v })),
    ];
    const regions = distinct((i) => String(i.channel.region || i.channel.country || '').trim());
    const types = distinct((i) => String(i.channel.type || '').trim());
    return {
      views: VIEWS.map((v) => ({
        ...v,
        on: v.id === this.view(),
        params: this.link({ liveView: v.id, date: v.id === 'night' || v.id === 'now' ? this.date() : null }),
      })),
      formats: this.chips('format', FORMATS, this.format()),
      dates: DATE_IDS.map((id, i) => ({
        id,
        label: ['Hoy', 'Mañana', weekdayFmt.format(new Date(Date.now() + 2 * DAY_MS))][i],
        on: id === this.date(),
        params: this.link({ date: id }),
      })),
      categories: this.chips('category', CATEGORIES, this.category()),
      countries: COUNTRIES.map((o) => ({ ...o, on: o.id === this.country(), params: this.countryParams(o.id) })),
      // Spain's own distribution taxonomy: meaningless (and hidden) for any other country.
      groups: this.country() === 'es' ? GROUPS.map((o) => ({ ...o, on: o.id === this.group(), params: this.groupParams(o.id) })) : [],
      // Built from the data before the local filters, so picking one keeps the others visible.
      regions: this.country() === 'es' && regions.length > 2 ? this.chips('region', regions, this.region()) : [],
      types: this.country() === 'es' && types.length > 2 ? this.chips('channelType', types, this.channelType()) : [],
      flags: FLAGS.map((f) => {
        const on = this.flags().includes(f.id);
        const next = on ? this.flags().filter((x) => x !== f.id) : [...this.flags(), f.id];
        return { ...f, on, params: this.link({ flags: next.join(',') }) };
      }),
    };
  });

  /** Applied filters as removable chips (the view and the day are not filters). */
  readonly active = computed(() => {
    const out: Array<{ label: string; params: Params }> = [];
    const add = (key: string, options: Option[], value: string) => {
      if (value !== DEFAULTS[key]) out.push({ label: options.find((o) => o.id === value)?.label || value, params: this.link({ [key]: null }) });
    };
    add('category', CATEGORIES, this.category());
    // Forced to 'all' for any other country (see group/region/channelType above) — not a real, removable choice there.
    if (this.country() === 'es') {
      add('group', GROUPS, this.group());
      add('region', [], this.region());
      add('channelType', [], this.channelType());
    }
    for (const f of this.flags()) {
      out.push({ label: FLAGS.find((o) => o.id === f)!.label, params: this.link({ flags: this.flags().filter((x) => x !== f).join(',') }) });
    }
    if (this.search()) out.push({ label: `«${this.search()}»`, params: this.link({ q: null }) });
    return out;
  });
  readonly moreCount = computed(() =>
    this.country() === 'es'
      ? Number(this.group() !== DEFAULTS['group']) + Number(this.region() !== 'all') + Number(this.channelType() !== 'all') + this.flags().length
      : this.flags().length
  );
  // Country is not cleared here: it is the section you are in (like the view), not a filter on top of it.
  readonly clearParams = computed(() => this.link({ category: null, group: null, region: null, channelType: null, flags: null, q: null }));

  // ── Left panel: the TV section menu (grid first, then channels, series, films) and the channel facets ──
  readonly sideLinks = TV_SECTION_LINKS;
  readonly sideGroups = computed<PanelNavGroup[]>(() => {
    const f = this.filters();
    const facet = (title: string, chips: TvGuideChip[]): PanelNavGroup => ({
      title,
      links: chips.map((c) => ({ label: c.label, path: APP_PATHS.guide, queryParams: c.params, active: c.on })),
    });
    return [
      facet('País', f.countries),
      ...(f.groups.length ? [facet('Grupo de canal', f.groups)] : []),
      ...(f.regions.length ? [facet('Región', f.regions)] : []),
      ...(f.types.length ? [facet('Tipo de canal', f.types)] : []),
      facet('Disponibilidad', f.flags),
    ];
  });

  // ── Right panel: the selected programme (by default the one the view is about) ──
  readonly contextOpen = signal(false);
  readonly selectedId = signal<string | null>(null);
  readonly selected = computed(() => {
    const items = this.items();
    const now = Date.now();
    const day = this.isoDay();
    const onAirNow = this.date() === 'today' && this.view() !== 'night';
    return (
      items.find((i) => i.id === this.selectedId()) ||
      (onAirNow ? items.find((i) => isLive(i, now)) : undefined) ||
      items.find((i) => isPrimeTime(i, day)) ||
      items[0] ||
      null
    );
  });
  readonly selectedCard = computed(() => {
    const item = this.selected();
    if (!item) return null;
    const now = Date.now();
    const live = isLive(item, now);
    const where = [
      item.availability.live || live ? `En directo en ${item.channel.name}` : '',
      item.availability.catchup ? 'A la carta, después de la emisión' : '',
      item.availability.streaming ? 'En streaming en la app del canal' : '',
    ].filter(Boolean);
    return { item, card: normalizeToCard(item), live, left: live ? Math.ceil((Date.parse(item.airing.end) - now) / 60_000) : 0, where };
  });
  readonly upNext = computed(() => {
    const item = this.selected();
    if (!item) return [];
    return this.items()
      .filter((i) => i.channel.id === item.channel.id && i.airing.start > item.airing.start)
      .sort((a, b) => a.airing.start.localeCompare(b.airing.start))
      .slice(0, 3)
      .map((i) => normalizeToCard(i));
  });
  readonly assistantAsks = ['¿Qué hay de cine esta noche?', '¿Dónde veo el fútbol hoy?', 'Algo para ver ahora'];

  select(item: TvReadItemDTO): void {
    this.selectedId.set(item.id);
    this.contextOpen.set(true);
  }

  retry(): void {
    this.retryNonce.update((n) => n + 1);
  }

  openAssistant(): void {
    this.chat.requestOpenChat('portal-assistant');
  }

  // ── SEO ──
  readonly structuredData = computed<SafeHtml>(() => {
    // The list the page is about: what is on now (or tonight), not the first programmes of the day.
    const day = this.isoDay();
    const pick = this.view() === 'night' || this.date() !== 'today' ? this.items().filter((i) => isPrimeTime(i, day)) : this.liveNowItems();
    const cards = pick.slice(0, 20).map((i) => normalizeToCard(i));
    return this.sanitizer.bypassSecurityTrustHtml(
      cards.length ? `<script type="application/ld+json">${serializeJsonLd(generateItemListSchema(cards, this.h1(), BASE_URL))}</script>` : ''
    );
  });

  constructor() {
    effect(() => {
      // Narrowed lists (channel group, region, type, availability, search) are not pages of their own.
      // A non-default country is real, distinct content (different channels) — but MetaService's canonical
      // always strips query params, so it would collapse to this same España URL; noindex until that content
      // gets its own path is the honest choice, not a silent duplicate-canonical.
      const narrowed = this.moreCount() > 0 || !!this.search() || this.country() !== 'es';
      this.meta.setMetaTags({
        title: `${this.h1()} | Guía TV`,
        description: `${this.h1()}: ${this.intro()}`,
        canonicalUrl: APP_PATHS.guide,
        type: 'website',
        robots: narrowed ? 'noindex, follow' : undefined,
      });
    });
  }

  private load(): Observable<TvReadItemDTO[]> {
    const filters = { date: this.date(), group: this.group(), country: this.country() };
    return this.search()
      ? this.facade.searchTvPrograms({ ...filters, category: this.category(), q: this.search(), limit: 48 })
      : this.facade.getDaySchedule(filters);
  }
}
