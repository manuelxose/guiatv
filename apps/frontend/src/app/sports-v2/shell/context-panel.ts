import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { matchClockLabel } from '../domain/match-status';
import { Match, MatchEvent } from '../domain/models';
import { SportsStore } from '../state/sports-store';
import { Sv2IconComponent } from '../ui/icon';
import { Sv2ScoreDisplayComponent } from '../ui/score-display';
import { Sv2StatusIndicatorComponent } from '../ui/status-indicator';
import { Sv2EmptyStateComponent, Sv2LoadingSkeletonComponent } from '../ui/states';
import { Sv2TeamIdentityComponent } from '../ui/team-identity';

type PanelTab = 'resumen' | 'estadisticas' | 'alineaciones' | 'donde-verlo';

const TABS: readonly { id: PanelTab; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'estadisticas', label: 'Estadísticas' },
  { id: 'alineaciones', label: 'Alineaciones' },
  { id: 'donde-verlo', label: 'Dónde verlo' },
];

const EVENT_LABEL: Record<MatchEvent['type'], string> = { goal: 'Gol', yellow: 'Tarjeta amarilla', red: 'Tarjeta roja', sub: 'Cambio' };
const EVENT_GLYPH: Record<MatchEvent['type'], string> = { goal: '⚽', yellow: '🟨', red: '🟥', sub: '⇄' };

/** Match Center: context-sensitive details for the selected fixture. */
@Component({
  selector: 'app-sv2-context-panel',
  standalone: true,
  imports: [Sv2IconComponent, Sv2ScoreDisplayComponent, Sv2StatusIndicatorComponent, Sv2TeamIdentityComponent, Sv2EmptyStateComponent, Sv2LoadingSkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <h2 id="sv2-ctx-title">Match Center</h2>
      <button type="button" class="close" (click)="store.contextOpen.set(false)" aria-label="Cerrar Match Center"><app-sv2-icon name="close" /></button>
    </header>

    @if (store.loadState() === 'loading' || store.loadState() === 'idle') {
      <app-sv2-loading-skeleton [count]="3" />
    } @else if (match(); as m) {
      <section class="hero" aria-label="Partido seleccionado">
        <p class="comp">{{ store.competition(m.competitionSlug)?.name }}</p>
        <div class="teams">
          @if (store.team(m.homeSlug); as h) { <app-sv2-team-identity [team]="h" layout="stack" /> }
          <div class="mid">
            <app-sv2-score-display [home]="m.homeScore" [away]="m.awayScore" [status]="m.status" />
            <app-sv2-status-indicator [status]="m.status" />
            <span class="clock">{{ clock(m) }}</span>
          </div>
          @if (store.team(m.awaySlug); as a) { <app-sv2-team-identity [team]="a" layout="stack" /> }
        </div>
        <button type="button" class="track" [class.on]="store.isTracked(m.slug)" [attr.aria-pressed]="store.isTracked(m.slug)" (click)="store.toggleTracked(m.slug)">
          <app-sv2-icon name="track" />{{ store.isTracked(m.slug) ? 'Siguiendo en directo' : 'Seguir en directo' }}
        </button>
      </section>

      <div class="tabs" role="tablist" aria-label="Detalle del partido">
        @for (t of tabs; track t.id) {
          <button type="button" role="tab" [id]="'sv2-tab-' + t.id" [attr.aria-selected]="tab() === t.id" [attr.aria-controls]="'sv2-tabpanel'" [attr.tabindex]="tab() === t.id ? 0 : -1" (click)="tab.set(t.id)" (keydown.arrowright)="moveTab($event, 1)" (keydown.arrowleft)="moveTab($event, -1)">{{ t.label }}</button>
        }
      </div>

      <div id="sv2-tabpanel" role="tabpanel" [attr.aria-labelledby]="'sv2-tab-' + tab()">
        @switch (tab()) {
          @case ('resumen') {
            @if (m.events.length) {
              <ol class="timeline">
                @for (e of m.events; track $index) {
                  <li [class.away]="e.side === 'away'">
                    <span class="min">{{ e.minute }}'</span>
                    <span class="glyph" aria-hidden="true">{{ glyph(e) }}</span>
                    <span><span class="sr">{{ evLabel(e) }}: </span>{{ e.player }}</span>
                  </li>
                }
              </ol>
            } @else {
              <app-sv2-empty-state title="Aún no hay eventos" hint="Los goles y tarjetas aparecerán aquí durante el partido." />
            }
          }
          @case ('estadisticas') {
            @if (m.stats.length) {
              <div class="stats">
                @for (s of m.stats; track s.label) {
                  <div class="stat">
                    <div class="row"><b>{{ s.home }}{{ s.unit }}</b><span>{{ s.label }}</span><b>{{ s.away }}{{ s.unit }}</b></div>
                    <div class="bar" aria-hidden="true"><i [style.flex-grow]="s.home || 0.01"></i><i class="b" [style.flex-grow]="s.away || 0.01"></i></div>
                  </div>
                }
              </div>
            } @else {
              <app-sv2-empty-state title="Estadísticas no disponibles" hint="Se publican cuando empieza el partido." />
            }
          }
          @case ('alineaciones') {
            @if (m.lineups; as l) {
              <div class="lineups">
                <div><h3>{{ l.home.formation }}</h3><ol>@for (p of l.home.players; track p) { <li>{{ p }}</li> }</ol></div>
                <div><h3>{{ l.away.formation }}</h3><ol>@for (p of l.away.players; track p) { <li>{{ p }}</li> }</ol></div>
              </div>
            } @else {
              <app-sv2-empty-state title="Alineaciones pendientes" hint="Suelen confirmarse una hora antes del inicio." />
            }
          }
          @case ('donde-verlo') {
            @if (m.broadcasts.length) {
              <ul class="bcast">
                @for (b of m.broadcasts; track b.channel) {
                  <li><app-sv2-icon name="tv" /><span>{{ b.channel }}</span><em>{{ b.kind === 'tv' ? 'TV' : 'Streaming' }}</em></li>
                }
              </ul>
            } @else {
              <app-sv2-empty-state title="Sin emisión confirmada" hint="Aún no hay canal ni plataforma anunciados." />
            }
          }
        }
      </div>
    } @else {
      <app-sv2-empty-state title="Selecciona un partido" hint="Elige un encuentro para ver su cronología, estadísticas y dónde verlo." />
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; height: 100%; overflow-y: auto; padding: 16px; }
    .head { display: flex; align-items: center; justify-content: space-between; }
    h2 { margin: 0; font-size: var(--sv2-fs-md); font-weight: 700; }
    .close { display: inline-grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 50%; background: var(--sv2-surface-2); color: var(--sv2-text); cursor: pointer; }
    .close:focus-visible, .track:focus-visible, .tabs button:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    @media (min-width: 1200px) { .close { display: none; } }
    .hero { display: grid; gap: 12px; padding: 16px; border-radius: var(--sv2-r-md); background: var(--sv2-surface-2); border: 1px solid var(--sv2-border); --sv2-badge: 44px; --sv2-score-size: var(--sv2-fs-score); }
    .comp { margin: 0; text-align: center; font-size: var(--sv2-fs-xs); color: var(--sv2-text-muted); }
    .teams { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
    .mid { display: grid; justify-items: center; gap: 6px; }
    .clock { font-size: var(--sv2-fs-xs); font-weight: 600; color: var(--sv2-text-muted); font-variant-numeric: tabular-nums; }
    .track { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; border: 1px solid var(--sv2-border-strong); border-radius: 999px; background: transparent; color: var(--sv2-text); font: inherit; font-size: var(--sv2-fs-sm); font-weight: 600; cursor: pointer; }
    .track.on { background: var(--sv2-accent); border-color: var(--sv2-accent); color: var(--sv2-accent-ink); }
    .tabs { display: grid; grid-template-columns: repeat(2, 1fr); gap: 2px; padding: 4px; border-radius: var(--sv2-r-lg); background: var(--sv2-surface-2); }
    .tabs button { min-height: 36px; padding: 0 8px; border: 0; border-radius: 999px; background: transparent; color: var(--sv2-text-muted); font: inherit; font-size: var(--sv2-fs-xs); font-weight: 600; cursor: pointer; white-space: nowrap; }
    .tabs button[aria-selected='true'] { background: var(--sv2-text); color: var(--sv2-bg); }
    .timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    .timeline li { display: grid; grid-template-columns: 40px 24px 1fr; align-items: center; min-height: 40px; font-size: var(--sv2-fs-sm); border-bottom: 1px solid var(--sv2-border); }
    .timeline li.away { color: var(--sv2-text-muted); }
    .min { font-weight: 700; font-variant-numeric: tabular-nums; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    .stats { display: grid; gap: 16px; }
    .row { display: grid; grid-template-columns: 56px 1fr 56px; text-align: center; font-size: var(--sv2-fs-xs); color: var(--sv2-text-muted); }
    .row b { color: var(--sv2-text); font-variant-numeric: tabular-nums; } .row b:first-child { text-align: left; } .row b:last-child { text-align: right; }
    .bar { display: flex; gap: 3px; height: 6px; margin-top: 6px; } .bar i { flex-basis: 0; border-radius: 3px; background: var(--sv2-scheduled); } .bar i.b { background: var(--sv2-live); }
    .lineups { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; font-size: var(--sv2-fs-sm); }
    .lineups h3 { margin: 0 0 8px; font-size: var(--sv2-fs-xs); color: var(--sv2-text-muted); } .lineups ol { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
    .bcast { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .bcast li { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 0 12px; border-radius: var(--sv2-r-sm); background: var(--sv2-surface-2); font-size: var(--sv2-fs-sm); font-weight: 600; }
    .bcast em { margin-left: auto; font-style: normal; font-size: var(--sv2-fs-xs); color: var(--sv2-text-muted); }
  `,
})
export class Sv2ContextPanelComponent {
  protected readonly store = inject(SportsStore);
  protected readonly tabs = TABS;
  protected readonly tab = signal<PanelTab>('resumen');
  protected readonly match = computed<Match | null>(() => this.store.selectedMatch());

  protected clock(m: Match): string {
    return matchClockLabel(m.status, m.minute, m.kickoff);
  }
  protected glyph(e: MatchEvent): string {
    return EVENT_GLYPH[e.type];
  }
  protected evLabel(e: MatchEvent): string {
    return EVENT_LABEL[e.type];
  }
  protected moveTab(ev: Event, delta: number): void {
    ev.preventDefault();
    const i = TABS.findIndex((t) => t.id === this.tab());
    const next = TABS[(i + delta + TABS.length) % TABS.length];
    this.tab.set(next.id);
    const list = (ev.currentTarget as HTMLElement).parentElement;
    queueMicrotask(() => list?.querySelector<HTMLElement>(`#sv2-tab-${next.id}`)?.focus());
  }
}
