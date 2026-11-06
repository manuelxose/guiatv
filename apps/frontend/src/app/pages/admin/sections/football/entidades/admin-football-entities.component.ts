import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';
import { FootballAdminEntity, FootballAdminEntityKind } from '@app/features/football/admin-data/football-admin.models';
import { AdminStatusBadgeComponent } from '@app/pages/admin/components/admin-status-badge/admin-status-badge.component';

type EntityFilter = 'all' | FootballAdminEntityKind;

@Component({
  selector: 'app-admin-football-entities',
  standalone: true,
  imports: [CommonModule, AdminStatusBadgeComponent],
  templateUrl: './admin-football-entities.component.html',
  styleUrls: ['./admin-football-entities.component.scss'],
})
export class AdminFootballEntitiesComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  entities: FootballAdminEntity[] = [];
  filtered: FootballAdminEntity[] = [];
  filter: EntityFilter = 'all';
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
    this.sub = this.data.getEntities().subscribe({
      next: (entities) => {
        this.entities = entities;
        this.applyFilter();
        this.loading = false;
        this.lastUpdatedChange.emit(new Date());
      },
      error: () => {
        this.error = 'No se han podido cargar las entidades';
        this.loading = false;
      },
    });
  }

  setFilter(filter: EntityFilter): void {
    this.filter = filter;
    this.applyFilter();
  }

  private applyFilter(): void {
    this.filtered =
      this.filter === 'all' ? this.entities : this.entities.filter((entity) => entity.kind === this.filter);
  }
}
