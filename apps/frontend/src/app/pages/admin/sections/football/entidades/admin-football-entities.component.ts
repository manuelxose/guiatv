import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';
import {
  AdminApiError,
  adminApiErrorMessage,
  FootballEntityMappingDTO,
  FootballEntityMappingsDTO,
} from '@app/features/football/admin-data/football-admin.models';
import { AdminStatusBadgeComponent } from '@app/pages/admin/components/admin-status-badge/admin-status-badge.component';

const STALE_MS = 6 * 60 * 60 * 1000;

type KindFilter = 'all' | 'competition' | 'team';

/**
 * Competiciones y entidades — entity mappings list. Search and pagination are
 * server-side (q + page/limit); the kind toggle is a client-side display
 * refinement over the combined server result.
 */
@Component({
  selector: 'app-admin-football-entities',
  standalone: true,
  imports: [CommonModule, AdminStatusBadgeComponent],
  templateUrl: './admin-football-entities.component.html',
  styleUrls: ['./admin-football-entities.component.scss'],
})
export class AdminFootballEntitiesComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  items: FootballEntityMappingDTO[] = [];
  total = 0;
  page = 1;
  limit = 25;
  q = '';
  filter: KindFilter = 'all';
  loading = false;
  error: string | null = null;
  unauthorized = false;
  loaded = false;

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
    this.sub = this.data.getEntityMappings({ page: this.page, limit: this.limit, q: this.q.trim() || undefined }).subscribe({
      next: (result) => {
        this.applyResult(result);
        this.loading = false;
        this.lastUpdatedChange.emit(new Date());
      },
      error: (err: unknown) => {
        this.loading = false;
        this.handleError(err);
      },
    });
  }

  applySearch(): void {
    this.page = 1;
    this.load();
  }

  onQ(event: Event): void {
    this.q = (event.target as HTMLInputElement).value;
  }

  setFilter(filter: KindFilter): void {
    this.filter = filter;
  }

  get visible(): FootballEntityMappingDTO[] {
    if (this.filter === 'all') return this.items;
    return this.items.filter((e) => e.kind === this.filter);
  }

  nextPage(): void {
    if (this.page * this.limit >= this.total) return;
    this.page += 1;
    this.load();
  }

  prevPage(): void {
    if (this.page <= 1) return;
    this.page -= 1;
    this.load();
  }

  mapped(entity: FootballEntityMappingDTO): boolean {
    return Object.keys(entity.providerIds ?? {}).length > 0;
  }

  stale(entity: FootballEntityMappingDTO): boolean {
    if (!entity.lastUpdatedAt) return true;
    const updated = Date.parse(entity.lastUpdatedAt);
    return !Number.isFinite(updated) || updated < Date.now() - STALE_MS;
  }

  private applyResult(result: FootballEntityMappingsDTO): void {
    this.items = result.items;
    this.total = result.total;
    this.page = result.page;
    this.limit = result.limit;
    this.loaded = true;
  }

  private handleError(err: unknown): void {
    if (err instanceof AdminApiError) {
      this.unauthorized = err.kind === 'unauthorized';
      this.error = adminApiErrorMessage(err);
    } else {
      this.error = 'No se han podido cargar las entidades.';
    }
  }
}
