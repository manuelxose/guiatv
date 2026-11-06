import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { RouterLink } from '@angular/router';
import { COMPETITION_RIGHTS_LABEL, competitionRight } from '../data/competition-rights';
import { DataAvailability, resolveAvailability } from '../data/availability';
import { SPORTS_NOW } from '../data/football-data';
import { Match } from '../domain/models';
import { sv2Link } from '../sports-v2.paths';
import { SportsStore } from '../state/sports-store';
import { Sv2ArticleCardComponent } from '../ui/article-card';
import { Sv2IconComponent } from '../ui/icon';
import { Sv2MatchEventsTimelineComponent } from '../ui/match-events-timeline';
import { Sv2MatchLineupsComponent } from '../ui/match-lineups';
import { Sv2MatchStatisticsComponent } from '../ui/match-statistics';
import { Sv2EmptyStateComponent } from '../ui/states';
import { Sv2TabsComponent, TabItem } from '../ui/tabs';

export type MatchTab = 'resumen' | 'estadisticas' | 'alineaciones' | 'donde-verlo';
export const MATCH_TABS: readonly (TabItem & { id: MatchTab })[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'estadisticas', label: 'Estadísticas' },
  { id: 'alineaciones', label: 'Alineaciones' },
  { id: 'donde-verlo', label: 'Dónde verlo' },
];

/** Tabbed match detail: timeline + context, statistics, lineups, where to watch. */
@Component({
  selector: 'app-sv2-match-details',
  standalone: true,
  imports: [
    RouterLink,
    Sv2TabsComponent,
    Sv2EmptyStateComponent,
    Sv2ArticleCardComponent,
    Sv2IconComponent,
    Sv2MatchEventsTimelineComponent,
    Sv2MatchStatisticsComponent,
    Sv2MatchLineupsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-sv2-tabs [tabs]="tabs" [selected]="tab()" label="Detalle del partido" [prefix]="prefix()" [fill]="true" (tabSelect)="tab.set($any($event))" />

    <div [id]="prefix() + '-panel'" role="tabpanel" tabindex="0" [attr.aria-labelledby]="prefix() + '-tab-' + tab()">
      @switch (tab()) {
        @case ('resumen') {
          <app-sv2-match-events-timeline [match]="match()" [availability]="eventsAvailability()" />

          <section aria-labelledby="ctx-h">
            <h3 id="ctx-h">Contexto de la competición</h3>
            <dl class="ctx">
              <div><dt>Competición</dt><dd><a [routerLink]="compLink()">{{ store.competition(match().competitionSlug)?.name }}</a></dd></div>
              @if (match().round) { <div><dt>Fase</dt><dd>{{ match().round }}</dd></div> }
              @for (p of positions(); track p.slug) {
                <div><dt>{{ p.name }}</dt><dd>{{ p.position }}.º · {{ p.points }} pts</dd></div>
              }
            </dl>
            @if (hasTable()) { <a class="more" [routerLink]="tableLink()">Ver clasificación</a> }
          </section>

          @if (related().length) {
            <section aria-labelledby="rel-h">
              <h3 id="rel-h">Contenido relacionado</h3>
              <div class="rel">
                @for (n of related(); track n.slug) { <app-sv2-article-card [item]="n" variant="row" /> }
              </div>
            </section>
          }
        }
        @case ('estadisticas') {
          <app-sv2-match-statistics [match]="match()" [availability]="statsAvailability()" />
        }
        @case ('alineaciones') {
          <app-sv2-match-lineups [match]="match()" [availability]="lineupsAvailability()" />
        }
        @case ('donde-verlo') {
          @if (match().broadcasts.length) {
            <ul class="bcast">
              @for (b of match().broadcasts; track b.channel) {
                <li>
                  <app-sv2-icon name="tv" />
                  @if (b.channelPath) { <a [href]="b.channelPath">{{ b.channel }}</a> } @else { <span>{{ b.channel }}</span> }
                  <em>{{ b.kind === 'tv' ? 'TV' : 'Streaming' }} · {{ b.evidence === 'override' ? 'confirmado por la redacción' : b.probable ? 'probable, según la programación' : 'según la programación' }}</em>
                </li>
              }
            </ul>
            <p class="note">
              {{ store.isDemo ? 'Canales ficticios de demostración: no corresponden a ninguna emisión real.' : 'Fuente: guía de programación de Guía TV; la hora de inicio es la del proveedor del partido. Las emisiones pueden cambiar: confirma el canal con tu operador antes del inicio.' }}
            </p>
          } @else if (right(); as r) {
            <div class="right">
              <app-sv2-icon name="tv" />
              <div>
                <strong>{{ r.operator }}</strong> <em>España · {{ r.season }}</em>
                <p>{{ rightsLabel }}</p>
                <a [href]="r.source" target="_blank" rel="noopener noreferrer">Fuente: UEFA</a>
              </div>
            </div>
          } @else {
            <app-sv2-empty-state title="Emisión no confirmada" hint="Todavía no tenemos un canal o plataforma verificados para este partido. No mostramos canales por suposición." />
          }
          <p class="note">Para ver el partido usa siempre el servicio autorizado que tengas contratado. Guía TV solo enlaza a sus propias fichas de canal y nunca enlaza ni incrusta emisiones no autorizadas.</p>
        }
      }
    </div>
  `,
  styles: `
    :host { display: grid; gap: 16px; min-width: 0; }
    [role='tabpanel'] { display: grid; gap: 20px; min-width: 0; outline: none; }
    [role='tabpanel']:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 4px; border-radius: var(--sv2-r-sm); }
    h3 { margin: 0 0 8px; font-size: var(--sv2-fs-sm); font-weight: 700; color: var(--sv2-text-muted); }
    .ctx { display: grid; gap: 1px; margin: 0; border-radius: var(--sv2-r-sm); overflow: hidden; background: var(--sv2-border); }
    .ctx div { display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; background: var(--sv2-surface-2); font-size: var(--sv2-fs-sm); }
    .ctx dt { color: var(--sv2-text-muted); } .ctx dd { margin: 0; font-weight: 600; text-align: right; } .ctx dd a { display: inline-flex; align-items: center; min-block-size: 24px; }
    .ctx a, .more { color: var(--sv2-text); }
    .more { display: inline-flex; align-items: center; min-block-size: 24px; margin-top: 10px; font-size: var(--sv2-fs-sm); font-weight: 600; }
    .rel { display: grid; gap: 12px; }
    .bcast { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .bcast li { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 0 12px; border-radius: var(--sv2-r-sm); background: var(--sv2-surface-2); font-size: var(--sv2-fs-sm); font-weight: 600; }
    .bcast a { color: inherit; }
    .bcast em { margin-left: auto; font-style: normal; font-size: var(--sv2-fs-xs); color: var(--sv2-text-muted); }
    .right { display: flex; gap: 12px; align-items: flex-start; padding: 12px; border: 1px dashed var(--sv2-border-strong); border-radius: var(--sv2-r-md); }
    .right p { margin: 4px 0; font-size: var(--sv2-fs-sm); color: var(--sv2-text-muted); }
    .right a { font-size: var(--sv2-fs-xs); color: var(--sv2-text-muted); }
    .note { margin: 0; font-size: var(--sv2-fs-xs); color: var(--sv2-text-faint); }
    a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
  `,
})
export class Sv2MatchDetailsComponent {
  protected readonly store = inject(SportsStore);
  private readonly now = inject(SPORTS_NOW);
  protected readonly tabs = MATCH_TABS;
  readonly match = input.required<Match>();
  protected readonly rightsLabel = COMPETITION_RIGHTS_LABEL;
  protected readonly right = computed(() => competitionRight(this.match().competitionSlug));
  /** DOM id prefix; the sidebar and the page use different ones so ids never collide. */
  readonly prefix = input('sv2m');
  readonly tab = model<MatchTab>('resumen');
  readonly relatedLimit = input(3);

  protected readonly eventsAvailability = computed<DataAvailability>(() => this.availabilityOf(this.match().events?.length));
  protected readonly statsAvailability = computed<DataAvailability>(() => this.availabilityOf(this.match().stats?.length));
  protected readonly lineupsAvailability = computed<DataAvailability>(() => this.availabilityOf(this.match().lineups?.home != null || this.match().lineups?.away != null ? 1 : 0));

  protected readonly compLink = computed(() => sv2Link('competiciones', this.match().competitionSlug));
  protected readonly tableLink = computed(() => sv2Link('clasificaciones', this.match().competitionSlug));
  protected readonly hasTable = computed(() => !!this.store.standingsOf(this.match().competitionSlug));
  protected readonly positions = computed(() => {
    const table = this.store.standingsOf(this.match().competitionSlug);
    if (!table) return [];
    return [this.match().homeSlug, this.match().awaySlug].flatMap((slug) => {
      const i = table.rows.findIndex((r) => r.teamSlug === slug);
      return i < 0 ? [] : [{ slug, name: this.store.team(slug)?.name ?? slug, position: i + 1, points: table.rows[i].points }];
    });
  });
  protected readonly related = computed(() => {
    const m = this.match();
    const own = this.store.newsFor({ match: m.slug });
    const rest = [...this.store.newsFor({ team: m.homeSlug }), ...this.store.newsFor({ team: m.awaySlug }), ...this.store.newsFor({ competition: m.competitionSlug })];
    return [...new Map([...own, ...rest].map((n) => [n.slug, n])).values()].slice(0, this.relatedLimit());
  });

  /** Exactly one availability state per field, via the shared pure state machine. */
  private availabilityOf(hasData: number | undefined): DataAvailability {
    return resolveAvailability({
      loading: this.store.loadState() === 'loading',
      hasApprovedProvider: true, // demo and live adapters are both approved; per-competition coverage is not yet exposed by the store
      fetchFailed: this.store.loadState() === 'error',
      hasData: (hasData ?? 0) > 0,
      updatedAt: this.store.isDemo ? this.now().getTime() : this.store.lastUpdated(),
      now: this.now().getTime(),
    });
  }
}
