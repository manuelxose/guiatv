import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';
import {
  AdminApiError,
  adminApiErrorMessage,
  FootballDashboardDTO,
  INGESTION_OUTCOME_LABELS,
} from '@app/features/football/admin-data/football-admin.models';
import { AdminStatusBadgeComponent } from '@app/pages/admin/components/admin-status-badge/admin-status-badge.component';

/**
 * Centro de control — the dashboard counters and last-sync freshness.
 * Counters are only rendered when `countsState === 'observed'`; the last sync
 * freshness honours `lastSyncState` (`not_measured` / `observed` / `stale`).
 */
@Component({
  selector: 'app-admin-football-control-center',
  standalone: true,
  imports: [CommonModule, AdminStatusBadgeComponent],
  templateUrl: './admin-football-control-center.component.html',
  styleUrls: ['./admin-football-control-center.component.scss'],
})
export class AdminFootballControlCenterComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  dashboard: FootballDashboardDTO | null = null;
  loading = false;
  error: string | null = null;
  unauthorized = false;

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
    this.unauthorized = false;
    this.sub?.unsubscribe();
    this.sub = this.data.getDashboard().subscribe({
      next: (dashboard) => {
        this.dashboard = dashboard;
        this.loading = false;
        this.lastUpdatedChange.emit(new Date());
      },
      error: (err: unknown) => {
        this.loading = false;
        this.handleError(err);
      },
    });
  }

  get countersAvailable(): boolean {
    return this.dashboard?.countsState === 'observed' || this.dashboard?.countsState === 'empty';
  }

  get lastSyncLabel(): string {
    switch (this.dashboard?.lastSyncState) {
      case 'not_measured':
        return 'Aún no medido';
      case 'stale':
        return 'Desactualizada';
      default:
        return 'Al día';
    }
  }

  outcomeLabel(outcome: FootballDashboardDTO['lastSyncOutcome']): string {
    return outcome ? INGESTION_OUTCOME_LABELS[outcome] : '—';
  }

  private handleError(err: unknown): void {
    if (err instanceof AdminApiError) {
      this.unauthorized = err.kind === 'unauthorized';
      this.error = adminApiErrorMessage(err);
    } else {
      this.error = 'No se han podido cargar los datos del fútbol.';
    }
  }
}
