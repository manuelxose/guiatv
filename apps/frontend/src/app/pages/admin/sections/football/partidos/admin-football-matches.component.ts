import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { combineLatest, Subscription } from 'rxjs';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';
import {
  broadcastAvailabilityLabel,
  FootballAdminOverview,
  isProviderApproved,
} from '@app/features/football/admin-data/football-admin.models';
import { FootballMatchDTO } from '@app/features/football/football.models';
import { formatMatchStatusLabel } from '@app/features/football/football-status.util';
import { AdminStatusBadgeComponent } from '@app/pages/admin/components/admin-status-badge/admin-status-badge.component';

@Component({
  selector: 'app-admin-football-matches',
  standalone: true,
  imports: [CommonModule, AdminStatusBadgeComponent],
  templateUrl: './admin-football-matches.component.html',
  styleUrls: ['./admin-football-matches.component.scss'],
})
export class AdminFootballMatchesComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  overview: FootballAdminOverview | null = null;
  matches: FootballMatchDTO[] = [];
  selected: FootballMatchDTO | null = null;
  loading = false;
  error: string | null = null;

  private sub?: Subscription;

  constructor(private readonly data: FootballAdminDataService) {}

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.sub?.unsubscribe();
    this.sub = combineLatest([this.data.getOverview(), this.data.getMatches()]).subscribe({
      next: ([overview, matches]) => {
        this.overview = overview;
        this.matches = matches;
        if (this.selected) {
          this.selected = matches.find((match) => match.id === this.selected?.id) ?? null;
        }
        this.loading = false;
        this.lastUpdatedChange.emit(new Date());
      },
      error: () => {
        this.error = 'No se han podido cargar los partidos';
        this.loading = false;
      },
    });
  }

  get providerApproved(): boolean {
    return isProviderApproved(this.overview?.provider);
  }

  selectMatch(match: FootballMatchDTO): void {
    this.selected = match;
  }

  closeInspector(): void {
    this.selected = null;
  }

  statusLabel(match: FootballMatchDTO): string {
    return formatMatchStatusLabel(match, 'short');
  }

  availabilityLabel(value: string): string {
    return broadcastAvailabilityLabel(value as Parameters<typeof broadcastAvailabilityLabel>[0]);
  }

  /** Broadcasts ordered by confidence so the strongest source reads first. */
  orderedBroadcasts(match: FootballMatchDTO) {
    const rank = { high: 0, medium: 1, low: 2 } as const;
    return [...(match.broadcasts ?? [])].sort(
      (a, b) => (rank[a.confidence] ?? 3) - (rank[b.confidence] ?? 3)
    );
  }
}
