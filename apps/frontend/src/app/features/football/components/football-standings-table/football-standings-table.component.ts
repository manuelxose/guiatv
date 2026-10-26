import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { RouterModule } from '@angular/router';
import { FootballStandingRowDTO } from '@app/features/football/football.models';

/**
 * Compact standings table: position, team, played, goal difference, points.
 * W/D/L and a full form strip are intentionally out of this compact view —
 * see the competition-page rebuild for the full table (deferred).
 *
 * Reused (not duplicated) for match-centre standings context: pass
 * `highlightTeamIds` to mark the two playing teams, and `windowSize` to show
 * only the rows around them (spec §29) instead of the whole table.
 */
@Component({
  selector: 'app-football-standings-table',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="standings" role="table" aria-label="Clasificación">
      <div class="standings__head" role="row">
        <span class="standings__pos" role="columnheader">#</span>
        <span class="standings__team" role="columnheader">Equipo</span>
        <span class="standings__cell" role="columnheader" aria-label="Partidos jugados">PJ</span>
        <span class="standings__cell" role="columnheader" aria-label="Diferencia de goles">DG</span>
        <span class="standings__cell standings__pts" role="columnheader" aria-label="Puntos">Pts</span>
      </div>
      <div
        *ngFor="let row of visibleRows; trackBy: trackByPosition"
        class="standings__row"
        [class.standings__row--highlight]="isHighlighted(row)"
        role="row"
      >
        <span class="standings__pos" role="cell">{{ row.position }}</span>
        <span class="standings__team" role="cell">
          <a class="standings__name" [routerLink]="['/deportes/futbol/equipos', row.team.slug]">{{ row.team.shortName || row.team.name }}</a>
          <span *ngIf="row.form" class="standings__form">{{ row.form }}</span>
        </span>
        <span class="standings__cell" role="cell">{{ row.played }}</span>
        <span class="standings__cell" role="cell">{{ signed(row.goalDifference) }}</span>
        <span class="standings__cell standings__pts" role="cell">{{ row.points }}</span>
      </div>
      <div *ngIf="!standings.length" class="standings__empty">
        Clasificación no disponible para esta competición.
      </div>
    </div>
  `,
  styles: `
    .standings {
      border: 1px solid var(--portal-border);
      border-radius: var(--radius-lg);
      overflow: hidden;
      background: var(--portal-card);
    }
    .standings__head, .standings__row {
      display: grid;
      grid-template-columns: 2rem minmax(0, 1fr) 2.25rem 2.25rem 2.5rem;
      align-items: center;
      gap: 0.25rem;
      padding: 0.5rem 0.75rem;
    }
    .standings__head {
      font-size: 0.6875rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--portal-text-muted);
      border-bottom: 1px solid var(--portal-border);
    }
    .standings__row {
      font-size: 0.875rem;
      color: var(--portal-text);
      border-bottom: 1px solid var(--portal-divider);
    }
    .standings__row:last-child { border-bottom: none; }
    .standings__row--highlight { background: var(--status-warning-soft); font-weight: 750; }
    .standings__pos {
      font-weight: 750;
      color: var(--portal-text-muted);
      text-align: center;
    }
    .standings__row--highlight .standings__pos { color: var(--portal-text); }
    .standings__team {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .standings__name {
      display: block;
      padding: 0.65rem 0;
      min-height: 44px;
      max-width: 100%;
      font-weight: 650;
      color: inherit;
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .standings__name:hover, .standings__name:focus-visible { color: var(--portal-text); text-decoration: underline; }
    .standings__name:focus-visible { outline: 2px solid var(--accent-sports); outline-offset: 2px; }
    .standings__form {
      font-size: 0.6875rem;
      letter-spacing: 0.08em;
      color: var(--portal-text-muted);
    }
    .standings__cell, .standings__pos { text-align: center; font-variant-numeric: tabular-nums; }
    .standings__pts { font-weight: 850; color: var(--portal-text); }
    .standings__empty { padding: 1.25rem; text-align: center; color: var(--portal-text-muted); font-size: 0.875rem; }
  `,
})
export class FootballStandingsTableComponent {
  @Input() standings: FootballStandingRowDTO[] = [];
  /** Team ids to visually mark (e.g. the two teams in a match). */
  @Input() highlightTeamIds: string[] = [];
  /** When set alongside `highlightTeamIds`, shows only rows within this many
   *  positions of each highlighted team instead of the full table. */
  @Input() windowSize?: number;

  get visibleRows(): FootballStandingRowDTO[] {
    if (!this.windowSize || !this.highlightTeamIds.length || !this.standings.length) {
      return this.standings;
    }
    const highlightedIndexes = this.standings
      .map((row, index) => (this.highlightTeamIds.includes(row.team.id) ? index : -1))
      .filter((index) => index >= 0);
    if (!highlightedIndexes.length) return this.standings;

    const keep = new Set<number>();
    for (const index of highlightedIndexes) {
      for (let i = Math.max(0, index - this.windowSize); i <= Math.min(this.standings.length - 1, index + this.windowSize); i++) {
        keep.add(i);
      }
    }
    return this.standings.filter((_, index) => keep.has(index));
  }

  isHighlighted(row: FootballStandingRowDTO): boolean {
    return this.highlightTeamIds.includes(row.team.id);
  }

  signed(value: number): string {
    return value > 0 ? `+${value}` : String(value);
  }

  trackByPosition(_index: number, row: FootballStandingRowDTO): number {
    return row.position;
  }
}
