import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Params, RouterModule } from '@angular/router';
import { Observable, catchError, map, of, startWith, switchMap } from 'rxjs';
import { TvReadItemDTO } from '../../api/models';
import { FaqItem, FaqSectionComponent } from '../../components/faq-section/faq-section.component';
import { PanelNavComponent, PanelNavGroup } from '../../components/panel-nav/panel-nav.component';
import { PanelShellComponent } from '../../components/panel-shell/panel-shell.component';
import { PanelTileComponent } from '../../components/panel-tile/panel-tile.component';
import { APP_PATHS } from '../../config/route-map';
import { TV_SECTION_LINKS } from '../../config/tv-section-nav';
import { ChatService } from '../../services/chat.service';
import { MetaService } from '../../services/meta.service';
import { TvDataFacade } from '../../state/tv-data.facade';
import { normalizeToCard } from '../../utils/tv-normalizers';
import { generateItemListSchema, serializeJsonLd } from '../../utils/utils';

type ContentPageType = 'series' | 'movies';
type TvView = 'hoy' | 'ahora' | 'noche' | 'manana';
type LoadState = { status: 'loading' | 'ready' | 'error'; items: TvReadItemDTO[] };

const BASE_URL = 'https://guiaprogramaciontv.com';
const timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
const VIEWS: ReadonlyArray<{ id: TvView; label: string }> = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ahora', label: 'Ahora' },
  { id: 'noche', label: 'Esta noche' },
  { id: 'manana', label: 'Mañana' },
];
const GROUPS: ReadonlyArray<{ id: '' | 'tdt'; label: string }> = [
  { id: '', label: 'Todos los canales' },
  { id: 'tdt', label: 'TDT en abierto' },
];

/**
 * "Películas en TV" and "Series en TV": only what linear TV airs (no streaming catalogue).
 * When (today, now, tonight, tomorrow) and channels (all / free-to-air) are URL params, so
 * every combination is a crawlable, indexable page.
 */
@Component({
  selector: 'app-content-page',
  standalone: true,
  imports: [DecimalPipe, RouterModule, PanelShellComponent, PanelNavComponent, PanelTileComponent, FaqSectionComponent],
  templateUrl: './content-page.component.html',
  styleUrls: ['./content-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContentPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly facade = inject(TvDataFacade);
  private readonly meta = inject(MetaService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly chat = inject(ChatService);

  readonly appPaths = APP_PATHS;
  readonly sideLinks = TV_SECTION_LINKS;
  readonly views = VIEWS;
  readonly groups = GROUPS;
  readonly contextOpen = signal(false);

  readonly type = toSignal(
    this.route.data.pipe(map((d) => (d['type'] === 'series' ? 'series' : 'movies') as ContentPageType)),
    { initialValue: (this.route.snapshot.data['type'] === 'series' ? 'series' : 'movies') as ContentPageType }
  );
  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  readonly view = computed<TvView>(() => {
    const v = this.params().get('vista') as TvView;
    return VIEWS.some((x) => x.id === v) ? v : 'hoy';
  });
  readonly group = computed<'' | 'tdt'>(() => (this.params().get('grupo') === 'tdt' ? 'tdt' : ''));
  readonly category = computed(() => (this.type() === 'series' ? 'Series' : 'Cine'));
  readonly path = computed(() => (this.type() === 'series' ? APP_PATHS.series : APP_PATHS.movies));
  readonly noun = computed(() => (this.type() === 'series' ? 'series' : 'películas'));
  readonly Noun = computed(() => (this.type() === 'series' ? 'Series' : 'Películas'));

  private readonly refresh = signal(0);
  private readonly request = computed(() => ({ view: this.view(), group: this.group(), category: this.category(), refresh: this.refresh() }));
  private readonly state = toSignal(
    toObservable(this.request).pipe(
      switchMap((req) =>
        this.load(req.view, req.category, req.group).pipe(
          map((items): LoadState => ({ status: 'ready', items })),
          catchError(() => of<LoadState>({ status: 'error', items: [] })),
          startWith<LoadState>({ status: 'loading', items: [] })
        )
      )
    ),
    { initialValue: { status: 'loading', items: [] } as LoadState }
  );
  /** Right panel: what of this type is on air right now. */
  readonly live = toSignal(
    toObservable(computed(() => ({ category: this.category(), group: this.group() }))).pipe(
      switchMap((r) => this.facade.getLivePrograms({ category: r.category, group: r.group || undefined, limit: 24 }).pipe(catchError(() => of([]))))
    ),
    { initialValue: [] as TvReadItemDTO[] }
  );

  readonly status = computed(() => this.state().status);
  /**
   * One card per airing, by start time; "today" hides what has already finished.
   * The same broadcast often arrives through several feeds (sub-channels, aliases), so
   * the key is the title and start time, not the channel; the first feed seen wins.
   */
  readonly items = computed(() => {
    const seen = new Set<string>();
    const now = Date.now();
    return this.state()
      .items.filter((item) => {
        const key = `${item.program.title.trim().toLowerCase()}|${item.airing.start}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return this.view() !== 'hoy' || new Date(item.airing.end).getTime() > now;
      })
      .sort((a, b) => a.airing.start.localeCompare(b.airing.start));
  });
  /** Cards rendered (the rest behind "Ver más", so the page stays light). */
  readonly shown = signal(48);
  readonly visibleItems = computed(() => this.items().slice(0, this.shown()));
  readonly liveCards = computed(() => {
    const seen = new Set<string>();
    return this.live()
      .filter((item) => {
        const key = item.program.title.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 12)
      .map((item) => normalizeToCard(item));
  });

  readonly h1 = computed(() => {
    const n = this.Noun();
    const when = { hoy: 'hoy en TV', ahora: 'en la tele ahora', noche: 'de esta noche en TV', manana: 'mañana en TV' }[this.view()];
    return `${n} ${when}${this.group() === 'tdt' ? ' en abierto' : ''}`;
  });
  readonly intro = computed(() =>
    this.type() === 'series'
      ? 'Las series que emiten hoy los canales de televisión, con su hora y canal. Toca una para ver su ficha y los próximos episodios.'
      : 'Las películas que emiten hoy los canales de televisión, con su hora y canal. Toca una para ver su ficha y dónde verla.'
  );
  readonly crumb = computed(() => `${this.Noun()} en TV`);

  readonly sideGroups = computed<PanelNavGroup[]>(() => [
    { title: 'Cuándo', links: VIEWS.map((v) => ({ label: v.label, path: this.path(), queryParams: this.linkFor({ vista: v.id }), active: this.view() === v.id })) },
    { title: 'Canales', links: GROUPS.map((g) => ({ label: g.label, path: this.path(), queryParams: this.linkFor({ grupo: g.id }), active: this.group() === g.id })) },
  ]);
  readonly assistantAsks = computed(() =>
    this.type() === 'series'
      ? ['¿Qué serie veo esta noche?', 'Series de estreno en la tele', '¿Cuándo echan el próximo episodio?']
      : ['¿Qué película veo esta noche?', 'Una comedia en la tele hoy', 'Películas de acción en abierto']
  );

  readonly faq = computed<FaqItem[]>(() => {
    const n = this.noun();
    const top = this.items().slice(0, 3).map((i) => `«${i.program.title}» (${i.channel.name}, ${this.hhmm(i.airing.start)})`);
    return [
      {
        question: `¿Qué ${n} echan hoy en la tele?`,
        answer: top.length
          ? `Próximamente: ${top.join(', ')}. En esta página tienes todas, con su hora y canal.`
          : `En esta página tienes las ${n} que emiten hoy los canales de televisión, con su hora y canal.`,
      },
      {
        question: `¿Dónde ver ${n} gratis en la tele?`,
        answer: `Los canales de TDT en abierto emiten ${n} a diario sin coste. Usa el filtro «TDT en abierto» para ver solo esas.`,
      },
      {
        question: `¿Qué ${n} ponen esta noche?`,
        answer: `En «Esta noche» tienes las ${n} del prime time de todos los canales, ordenadas por hora.`,
      },
      {
        question: `¿Cómo saber qué ${n} echan mañana?`,
        answer: `Cambia a «Mañana» para ver la programación de ${n} del día siguiente en todos los canales.`,
      },
    ];
  });

  readonly structuredData = computed<SafeHtml | null>(() => {
    const cards = this.items().slice(0, 10).map((item) => normalizeToCard(item));
    if (!cards.length) return null;
    return this.sanitizer.bypassSecurityTrustHtml(
      `<script type="application/ld+json">${serializeJsonLd(generateItemListSchema(cards, this.h1(), BASE_URL))}</script>`
    );
  });

  constructor() {
    // A new filter starts again from the first page of cards.
    effect(() => {
      this.request();
      this.shown.set(48);
    });
    effect(() => {
      const query = new URLSearchParams();
      if (this.view() !== 'hoy') query.set('vista', this.view());
      if (this.group()) query.set('grupo', this.group());
      const qs = query.toString();
      this.meta.setMetaTags({
        title: `${this.h1()}: horarios y canales | Guía TV`,
        description: `${this.h1()}: todas las ${this.noun()} que emiten los canales de televisión, con su hora y canal, para no perderte ninguna.`,
        // Each when/channels combination is a page of its own (8 at most).
        canonicalUrl: `${this.path()}${qs ? `?${qs}` : ''}`,
      });
    });
  }

  /** Link to one filter option, keeping the other one; defaults are dropped so URLs stay clean. */
  linkFor(change: { vista?: TvView; grupo?: string }): Params {
    const vista = change.vista ?? this.view();
    const grupo = change.grupo ?? this.group();
    return { vista: vista === 'hoy' ? null : vista, grupo: grupo || null };
  }

  hhmm(iso?: string): string {
    return iso ? timeFmt.format(new Date(iso)) : '';
  }

  openAssistant(): void {
    this.chat.requestToggleAssistant();
  }

  retry(): void {
    this.refresh.update((v) => v + 1);
  }

  private load(view: TvView, category: string, group: string): Observable<TvReadItemDTO[]> {
    const filters = { category, group: group || undefined };
    if (view === 'ahora') return this.facade.getLivePrograms({ ...filters, limit: 48 });
    if (view === 'noche') return this.facade.getTonightPrograms({ ...filters, limit: 96 });
    return this.facade.getAllPrograms({ ...filters, date: view === 'manana' ? 'tomorrow' : 'today', limit: 240 });
  }
}
