import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';
import { FootballAdminQualityReport } from '@app/features/football/admin-data/football-admin.models';

@Component({
  selector: 'app-admin-football-quality',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-football-quality.component.html',
  styleUrls: ['./admin-football-quality.component.scss'],
})
export class AdminFootballQualityComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  report: FootballAdminQualityReport | null = null;
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
    this.sub = this.data.getQuality().subscribe({
      next: (report) => {
        this.report = report;
        this.loading = false;
        this.lastUpdatedChange.emit(new Date());
      },
      error: () => {
        this.error = 'No se han podido cargar la calidad de los datos';
        this.loading = false;
      },
    });
  }

  get staleTotal(): number {
    if (!this.report) return 0;
    return this.report.overview.staleCompetitions + this.report.overview.staleTeams;
  }

  get unmappedTotal(): number {
    if (!this.report) return 0;
    return this.report.overview.unmappedCompetitions + this.report.overview.unmappedTeams;
  }

  get hasIssues(): boolean {
    if (!this.report) return false;
    return (
      this.staleTotal + this.unmappedTotal + this.report.overview.fixturesMissingBroadcast > 0
    );
  }
}
