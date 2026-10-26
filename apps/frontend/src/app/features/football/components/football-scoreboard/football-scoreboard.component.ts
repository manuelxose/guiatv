import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { FootballMatchDTO } from '@app/features/football/football.models';
import { FootballTeamBadgeComponent } from '@app/features/football/components/football-team-badge/football-team-badge.component';
import {
  formatMatchAccessibleLabel,
  formatMatchStatusLabel,
  hasFinalScore,
  isLiveStatus,
} from '@app/features/football/football-status.util';

/**
 * Match centre header: competition, round, teams, score/status, kickoff.
 * Semantically grouped so a screen reader reads a coherent sentence.
 */
@Component({
  selector: 'app-football-scoreboard',
  standalone: true,
  imports: [CommonModule, FootballTeamBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="scoreboard" [attr.aria-label]="accessibleLabel">
      <header class="scoreboard__head">
        <span class="scoreboard__competition">
          <img *ngIf="match.competition.logo" [src]="match.competition.logo" [alt]="''" width="24" height="24" loading="lazy" decoding="async" />
          {{ match.competition.name }}
        </span>
        <span *ngIf="match.round" class="scoreboard__round">{{ match.round }}</span>
      </header>

      <div class="scoreboard__grid">
        <div class="scoreboard__team">
          <app-football-team-badge [team]="match.homeTeam" layout="vertical"></app-football-team-badge>
        </div>

        <div class="scoreboard__center">
          <ng-container *ngIf="hasScore; else kickoff">
            <div class="scoreboard__score">
              <span>{{ match.score.home }}</span>
              <span class="scoreboard__sep">-</span>
              <span>{{ match.score.away }}</span>
            </div>
          </ng-container>
          <ng-template #kickoff>
            <div class="scoreboard__kickoff">
              <span class="scoreboard__time">{{ kickoffTime }}</span>
              <span class="scoreboard__date">{{ kickoffDate }}</span>
            </div>
          </ng-template>

          <div class="scoreboard__status" [class.scoreboard__status--live]="isLive">
            <span *ngIf="isLive" class="scoreboard__dot"></span>
            {{ statusLabel }}
          </div>
        </div>

        <div class="scoreboard__team scoreboard__team--away">
          <app-football-team-badge [team]="match.awayTeam" layout="vertical"></app-football-team-badge>
        </div>
      </div>
    </section>
  `,
  styles: `
    .scoreboard {
      border: 1px solid var(--portal-border);
      border-radius: var(--radius-xl);
      background: var(--portal-card);
      padding: 1.25rem 1rem;
    }
    .scoreboard__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .scoreboard__competition {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-weight: 750;
      color: var(--portal-text);
      font-size: 0.875rem;
    }
    .scoreboard__competition img { width: 1.25rem; height: 1.25rem; object-fit: contain; }
    .scoreboard__round {
      font-size: 0.75rem;
      color: var(--portal-text-muted);
    }

    .scoreboard__grid {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 0.75rem;
    }
    .scoreboard__team { min-width: 0; }
    .scoreboard__team--away { text-align: right; }

    .scoreboard__center { text-align: center; }
    .scoreboard__score {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      font-size: 2.75rem;
      font-weight: 900;
      font-variant-numeric: tabular-nums;
      color: var(--portal-text);
    }
    .scoreboard__sep { color: var(--portal-text-muted); }
    .scoreboard__kickoff { display: flex; flex-direction: column; gap: 0.125rem; }
    .scoreboard__time { font-size: 1.75rem; font-weight: 850; font-variant-numeric: tabular-nums; }
    .scoreboard__date { font-size: 0.75rem; color: var(--portal-text-muted); }

    .scoreboard__status {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      margin-top: 0.5rem;
      font-size: 0.8125rem;
      font-weight: 700;
      color: var(--portal-text-muted);
    }
    .scoreboard__status--live { color: var(--status-live); }
    .scoreboard__dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: var(--radius-pill);
      background: var(--status-live);
      animation: football-pulse 1.4s ease-in-out infinite;
    }
    @media (max-width: 640px) {
      .scoreboard__grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1fr); }
      .scoreboard__center { min-width: 0; overflow-wrap: anywhere; }
      .scoreboard__score { gap: .25rem; font-size: var(--text-xl); }
    }
    @media (prefers-reduced-motion: reduce) {
      .scoreboard__dot { animation: none; }
    }
    @keyframes football-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }
  `,
})
export class FootballScoreboardComponent {
  @Input({ required: true }) match!: FootballMatchDTO;

  get isLive(): boolean {
    return isLiveStatus(this.match.status);
  }

  get hasScore(): boolean {
    return hasFinalScore(this.match.score);
  }

  get statusLabel(): string {
    return formatMatchStatusLabel(this.match, 'long');
  }

  get kickoffTime(): string {
    return this.format(this.match.kickoffAt, { hour: '2-digit', minute: '2-digit' });
  }

  get kickoffDate(): string {
    return this.format(this.match.kickoffAt, { weekday: 'long', day: 'numeric', month: 'long' });
  }

  get accessibleLabel(): string {
    return formatMatchAccessibleLabel(this.match);
  }

  private format(iso: string, options: Intl.DateTimeFormatOptions): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('es-ES', { ...options, timeZone: 'Europe/Madrid' }).format(date);
  }
}
