import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';
import {
  COVERAGE_LABELS,
  CompetitionCoverageState,
  FootballCoverageReport,
  FootballDataAspect,
  FOOTBALL_DATA_ASPECT_LABELS,
  isProviderApproved,
} from '@app/features/football/admin-data/football-admin.models';
import { AdminStatusBadgeComponent } from '@app/pages/admin/components/admin-status-badge/admin-status-badge.component';

@Component({
  selector: 'app-admin-football-coverage',
  standalone: true,
  imports: [CommonModule, AdminStatusBadgeComponent],
  templateUrl: './admin-football-coverage.component.html',
  styleUrls: ['./admin-football-coverage.component.scss'],
})
export class AdminFootballCoverageComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  report: FootballCoverageReport | null = null;
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
    this.sub = this.data.getCoverage().subscribe({
      next: (report) => {
        this.report = report;
        this.loading = false;
        this.lastUpdatedChange.emit(new Date());
      },
      error: () => {
        this.error = 'No se han podido cargar la cobertura';
        this.loading = false;
      },
    });
  }

  get providerApproved(): boolean {
    return isProviderApproved(this.report?.provider);
  }

  stateLabel(state: CompetitionCoverageState): string {
    return COVERAGE_LABELS[state];
  }

  aspectLabel(aspect: FootballDataAspect): string {
    return FOOTBALL_DATA_ASPECT_LABELS[aspect];
  }

  /** Maps a coverage state to the admin badge vocabulary (never color-only). */
  coverageStatus(state: CompetitionCoverageState): string {
    switch (state) {
      case 'available':
        return 'configured';
      case 'partial':
        return 'degraded';
      case 'missing':
        return 'missing';
      case 'not-supported':
        return 'info';
      case 'not-covered':
        return 'unconfigured';
      case 'stale':
        return 'stale';
      case 'temporarily-unavailable':
        return 'degraded';
      case 'legally-blocked':
        return 'critical';
      case 'not-yet-measured':
        return 'unknown';
      default:
        return 'unknown';
    }
  }
}
