import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';
import {
  AdminApiError,
  adminApiErrorMessage,
  COVERAGE_STATE_LABELS,
  coverageStateBadgeStatus,
  FootballCoverageMatrixDTO,
  FootballCoverageRowDTO,
  FootballCoverageState,
} from '@app/features/football/admin-data/football-admin.models';
import { AdminStatusBadgeComponent } from '@app/pages/admin/components/admin-status-badge/admin-status-badge.component';

/**
 * Cobertura de datos — the server-computed per-competition coverage matrix.
 * The four-value `coverageState` and the companion `snapshotCountState` come
 * from the backend; nothing here derives availability client-side.
 */
@Component({
  selector: 'app-admin-football-coverage',
  standalone: true,
  imports: [CommonModule, AdminStatusBadgeComponent],
  templateUrl: './admin-football-coverage.component.html',
  styleUrls: ['./admin-football-coverage.component.scss'],
})
export class AdminFootballCoverageComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  report: FootballCoverageMatrixDTO | null = null;
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
    this.sub = this.data.getCoverage().subscribe({
      next: (report) => {
        this.report = report;
        this.loading = false;
        this.lastUpdatedChange.emit(new Date());
      },
      error: (err: unknown) => {
        this.loading = false;
        this.handleError(err);
      },
    });
  }

  stateLabel(state: FootballCoverageState): string {
    return COVERAGE_STATE_LABELS[state];
  }

  stateStatus(state: FootballCoverageState): string {
    return coverageStateBadgeStatus(state);
  }

  /** Snapshots are a real count only when the backend says `observed`/`empty` — never a fabricated zero. */
  snapshotLabel(row: FootballCoverageRowDTO): string {
    switch (row.snapshotCountState) {
      case 'observed':
        return String(row.snapshotCount ?? 0);
      case 'empty':
        return 'Sin partidos';
      case 'not_covered':
        return 'Sin cobertura';
      case 'unavailable':
        return 'No disponible';
      default:
        return 'No disponible';
    }
  }

  private handleError(err: unknown): void {
    if (err instanceof AdminApiError) {
      this.unauthorized = err.kind === 'unauthorized';
      this.error = adminApiErrorMessage(err);
    } else {
      this.error = 'No se ha podido cargar la cobertura.';
    }
  }
}
