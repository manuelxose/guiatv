import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';
import {
  AdminApiError,
  adminApiErrorMessage,
  broadcastAvailabilityLabel,
  FootballBroadcastDTO,
  FootballBroadcastsDTO,
} from '@app/features/football/admin-data/football-admin.models';

/**
 * Retransmisiones — the stored broadcast mappings list. Search and pagination
 * are server-side (q + page/limit); availability/provenance/confidence render
 * verbatim from the mapping row.
 */
@Component({
  selector: 'app-admin-football-broadcasts',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-football-broadcasts.component.html',
  styleUrls: ['./admin-football-broadcasts.component.scss'],
})
export class AdminFootballBroadcastsComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  items: FootballBroadcastDTO[] = [];
  total = 0;
  page = 1;
  limit = 25;
  q = '';
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
    this.sub = this.data.getBroadcasts({ page: this.page, limit: this.limit, q: this.q.trim() || undefined }).subscribe({
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

  availabilityLabel(value: string): string {
    return broadcastAvailabilityLabel(value);
  }

  private applyResult(result: FootballBroadcastsDTO): void {
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
      this.error = 'No se han podido cargar las retransmisiones.';
    }
  }
}
