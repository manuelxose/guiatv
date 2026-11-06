import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';
import { FootballAdminSyncState } from '@app/features/football/admin-data/football-admin.models';
import { AdminStatusBadgeComponent } from '@app/pages/admin/components/admin-status-badge/admin-status-badge.component';

@Component({
  selector: 'app-admin-football-sync',
  standalone: true,
  imports: [CommonModule, AdminStatusBadgeComponent],
  templateUrl: './admin-football-sync.component.html',
  styleUrls: ['./admin-football-sync.component.scss'],
})
export class AdminFootballSyncComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  state: FootballAdminSyncState | null = null;
  loading = false;
  refreshing = false;
  error: string | null = null;
  actionMessage: string | null = null;

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
    this.sub = this.data.getSyncState().subscribe({
      next: (state) => {
        this.state = state;
        this.loading = false;
        this.lastUpdatedChange.emit(new Date());
      },
      error: () => {
        this.error = 'No se han podido cargar la sincronización';
        this.loading = false;
      },
    });
  }

  refresh(): void {
    if (this.refreshing) return;
    this.refreshing = true;
    this.actionMessage = null;
    this.data.refreshFootball().subscribe({
      next: () => {
        this.refreshing = false;
        this.actionMessage = 'Sincronización de fútbol encolada';
        this.load();
      },
      error: () => {
        this.refreshing = false;
        this.actionMessage = 'No se ha podido encolar la sincronización';
      },
    });
  }
}
