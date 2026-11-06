import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';
import { FootballAdminProvider } from '@app/features/football/admin-data/football-admin.models';
import { AdminStatusBadgeComponent } from '@app/pages/admin/components/admin-status-badge/admin-status-badge.component';

@Component({
  selector: 'app-admin-football-providers',
  standalone: true,
  imports: [CommonModule, AdminStatusBadgeComponent],
  templateUrl: './admin-football-providers.component.html',
  styleUrls: ['./admin-football-providers.component.scss'],
})
export class AdminFootballProvidersComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  provider: FootballAdminProvider | null = null;
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
        this.provider = overview.provider;
        this.loading = false;
        this.lastUpdatedChange.emit(new Date());
      },
      error: () => {
        this.error = 'No se han podido cargar los proveedores';
        this.loading = false;
      },
    });
  }

  get providerStateLabel(): string {
    switch (this.provider?.state) {
      case 'healthy':
        return 'Saludable';
      case 'degraded':
        return 'Degradado';
      default:
        return 'Sin configurar';
    }
  }
}
