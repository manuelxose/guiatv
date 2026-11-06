import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';
import { FootballAdminOverview } from '@app/features/football/admin-data/football-admin.models';
import { AdminStatusBadgeComponent } from '@app/pages/admin/components/admin-status-badge/admin-status-badge.component';

@Component({
  selector: 'app-admin-football-control-center',
  standalone: true,
  imports: [CommonModule, AdminStatusBadgeComponent],
  templateUrl: './admin-football-control-center.component.html',
  styleUrls: ['./admin-football-control-center.component.scss'],
})
export class AdminFootballControlCenterComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  overview: FootballAdminOverview | null = null;
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
    this.sub = this.data.getOverview().subscribe({
      next: (overview) => {
        this.overview = overview;
        this.loading = false;
        this.lastUpdatedChange.emit(new Date());
      },
      error: () => {
        this.error = 'No se han podido cargar los datos del fútbol';
        this.loading = false;
      },
    });
  }

  get providerStateLabel(): string {
    switch (this.overview?.provider.state) {
      case 'healthy':
        return 'Saludable';
      case 'degraded':
        return 'Degradado';
      default:
        return 'Sin configurar';
    }
  }

  get staleTotal(): number {
    if (!this.overview) return 0;
    return this.overview.staleCompetitions + this.overview.staleTeams;
  }

  get unmappedTotal(): number {
    if (!this.overview) return 0;
    return this.overview.unmappedCompetitions + this.overview.unmappedTeams;
  }
}
