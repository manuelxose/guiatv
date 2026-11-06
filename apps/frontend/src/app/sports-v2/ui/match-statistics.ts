import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DataAvailability } from '../data/availability';
import { Match, MatchStat } from '../domain/models';
import { Sv2MatchDataStatusComponent } from './match-data-status';
import { Sv2EmptyStateComponent } from './states';

/** Team statistics. Only rows the provider supplied are shown; an absent value is "n/d", never 0. */
@Component({
  selector: 'app-sv2-match-statistics',
  standalone: true,
  imports: [Sv2EmptyStateComponent, Sv2MatchDataStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (stats().length) {
      <div class="stats">
        @for (s of stats(); track $index) {
          <div class="stat">
            <div class="srow">
              <b [class.na]="s.home === null" [attr.aria-label]="s.home === null ? 'No disponible' : null">{{ homeValue(s) }}</b>
              <span>{{ s.label }}</span>
              <b [class.na]="s.away === null" [attr.aria-label]="s.away === null ? 'No disponible' : null">{{ awayValue(s) }}</b>
            </div>
            @if (share(s.home, s.away); as sh) {
              <div class="bar" aria-hidden="true"><i [style.flex-grow]="sh.home"></i><i class="b" [style.flex-grow]="sh.away"></i></div>
            }
          </div>
        }
      </div>
      @if (availability() === 'stale') {
        <app-sv2-match-data-status [availability]="availability()" noun="estadísticas" />
      }
    } @else if (pending()) {
      <app-sv2-empty-state [title]="emptyTitle()" [hint]="emptyHint()" />
    } @else {
      <app-sv2-match-data-status [availability]="availability()" noun="estadísticas" />
    }
  `,
  styles: `
    :host { display: grid; gap: 12px; min-width: 0; }
    .stats { display: grid; gap: 18px; }
    .srow { display: grid; grid-template-columns: 56px 1fr 56px; text-align: center; font-size: var(--sv2-fs-xs); color: var(--sv2-text-muted); }
    .srow b { color: var(--sv2-text); font-size: var(--sv2-fs-sm); font-variant-numeric: tabular-nums; }
    .srow b:first-child { text-align: left; } .srow b:last-child { text-align: right; }
    .srow b.na { color: var(--sv2-text-faint); }
    .bar { display: flex; gap: 3px; height: 6px; margin-top: 6px; }
    .bar i { flex-basis: 0; border-radius: 3px; background: var(--sv2-scheduled); }
    .bar i.b { background: var(--sv2-live); }
  `,
})
export class Sv2MatchStatisticsComponent {
  readonly match = input.required<Match>();
  readonly availability = input.required<DataAvailability>();

  protected readonly stats = computed(() => this.match().stats ?? []);
  protected readonly pending = computed(() => this.match().status === 'scheduled' || this.match().status === 'postponed');
  protected readonly emptyTitle = computed(() => (this.match().status === 'scheduled' ? 'Estadísticas aún no disponibles' : 'Estadísticas no disponibles'));
  protected readonly emptyHint = computed(() => (this.match().status === 'scheduled' ? 'Se publican cuando empieza el partido.' : 'No hay estadísticas para este partido.'));

  protected homeValue(s: MatchStat): string {
    return s.home === null ? 'n/d' : `${s.home}${s.unit ?? ''}`;
  }
  protected awayValue(s: MatchStat): string {
    return s.away === null ? 'n/d' : `${s.away}${s.unit ?? ''}`;
  }
  protected share(home: number | undefined, away: number | undefined): { home: number; away: number } | null {
    if (home == null || away == null) return null;
    const total = home + away;
    if (total <= 0) return { home: 0.5, away: 0.5 };
    return { home: Math.max(home / total, 0.01), away: Math.max(away / total, 0.01) };
  }
}

