import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DataAvailability } from '../data/availability';
import { Match, MatchEvent, MatchEventType } from '../domain/models';
import { SportsStore } from '../state/sports-store';
import { Sv2MatchDataStatusComponent } from './match-data-status';
import { Sv2EmptyStateComponent } from './states';

const EVENT_LABEL: Record<MatchEventType, string> = {
  goal: 'Gol',
  own_goal: 'Gol en propia puerta',
  penalty: 'Penalti',
  penalty_missed: 'Penalti fallado',
  goal_disallowed: 'Gol anulado',
  var: 'Revisión del VAR',
  yellow: 'Tarjeta amarilla',
  second_yellow: 'Segunda tarjeta amarilla',
  red: 'Tarjeta roja',
  substitution: 'Cambio',
  sub: 'Cambio',
  assist: 'Asistencia',
};
const EVENT_GLYPH: Record<MatchEventType, string> = {
  goal: '⚽',
  own_goal: '🥅',
  penalty: '🎯',
  penalty_missed: '❌',
  goal_disallowed: '⊘',
  var: '📺',
  yellow: '🟨',
  second_yellow: '🟧',
  red: '🟥',
  substitution: '⇄',
  sub: '⇄',
  assist: '🅰',
};

/** Chronological match timeline: goals, cards, substitutions, VAR. Own goals, penalties and disallowed goals stay distinct. */
@Component({
  selector: 'app-sv2-match-events-timeline',
  standalone: true,
  imports: [Sv2EmptyStateComponent, Sv2MatchDataStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-label="Cronología">
      @if (events().length) {
        <ol class="timeline">
          @for (e of events(); track $index) {
            <li [class.away]="isAway(e)">
              <span class="min">{{ e.minute }}'@if (e.addedMinute) { +{{ e.addedMinute }} }</span>
              <span class="glyph" aria-hidden="true">{{ glyph(e) }}</span>
              <span class="who">
                <span class="sr">{{ label(e) }}: </span>
                @if (name(e)) { <span>{{ name(e) }}</span> }
                @if (teamShort(e); as t) { <small> · {{ t }}</small> }
                @if (e.detail) { <small> · {{ e.detail }}</small> }
              </span>
            </li>
          }
        </ol>
        @if (availability() === 'stale') {
          <app-sv2-match-data-status [availability]="availability()" noun="eventos" />
        }
      } @else if (pending()) {
        <app-sv2-empty-state [title]="emptyTitle()" [hint]="emptyHint()" />
      } @else {
        <app-sv2-match-data-status [availability]="availability()" noun="eventos" />
      }
    </section>
  `,
  styles: `
    :host { display: grid; gap: 12px; min-width: 0; }
    .timeline { list-style: none; margin: 0; padding: 0; }
    .timeline li { display: grid; grid-template-columns: 44px 28px 1fr; align-items: center; min-height: 44px; font-size: var(--sv2-fs-sm); border-bottom: 1px solid var(--sv2-border); }
    .timeline li.away .who { color: var(--sv2-text-muted); }
    .who small { color: var(--sv2-text-faint); }
    .min { font-weight: 700; font-variant-numeric: tabular-nums; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  `,
})
export class Sv2MatchEventsTimelineComponent {
  protected readonly store = inject(SportsStore);
  readonly match = input.required<Match>();
  readonly availability = input.required<DataAvailability>();

  protected readonly events = computed(() => this.match().events ?? []);
  protected readonly pending = computed(() => this.match().status === 'scheduled' || this.match().status === 'postponed');
  protected readonly emptyTitle = computed(() => (this.match().status === 'scheduled' ? 'El partido aún no ha empezado' : 'Partido aplazado'));
  protected readonly emptyHint = computed(() =>
    this.match().status === 'scheduled' ? 'Los goles, tarjetas y cambios aparecerán aquí durante el partido.' : 'No hay goles ni tarjetas disponibles para este partido.',
  );

  protected glyph(e: MatchEvent): string {
    return EVENT_GLYPH[e.type];
  }
  protected label(e: MatchEvent): string {
    return EVENT_LABEL[e.type];
  }
  protected name(e: MatchEvent): string {
    return e.playerName ?? e.player ?? '';
  }
  protected isAway(e: MatchEvent): boolean {
    return e.side === 'away' || (e.side == null && e.teamSlug === this.match().awaySlug);
  }
  protected teamShort(e: MatchEvent): string | undefined {
    const slug = e.side === 'home' ? this.match().homeSlug : e.side === 'away' ? this.match().awaySlug : e.teamSlug;
    return slug ? this.store.team(slug)?.shortName : undefined;
  }
}
