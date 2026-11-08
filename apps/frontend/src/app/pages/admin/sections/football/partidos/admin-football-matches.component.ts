import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';
import {
  AdminApiError,
  adminApiErrorMessage,
  AvailabilityState,
  FootballAdminMatchDTO,
  FootballAdminMatchesDTO,
  FootballAdminMatchStatus,
} from '@app/features/football/admin-data/football-admin.models';
import { AdminStatusBadgeComponent } from '@app/pages/admin/components/admin-status-badge/admin-status-badge.component';

const STATUS_OPTIONS: Array<{ value: FootballAdminMatchStatus | ''; label: string }> = [
  { value: '', label: 'Todos los estados' },
  { value: 'scheduled', label: 'Programado' },
  { value: 'live', label: 'En directo' },
  { value: 'halftime', label: 'Descanso' },
  { value: 'finished', label: 'Finalizado' },
  { value: 'postponed', label: 'Aplazado' },
  { value: 'suspended', label: 'Suspendido' },
  { value: 'cancelled', label: 'Cancelado' },
];

const STATUS_LABELS: Record<FootballAdminMatchStatus, string> = {
  scheduled: 'Programado',
  live: 'En directo',
  halftime: 'Descanso',
  finished: 'Finalizado',
  postponed: 'Aplazado',
  suspended: 'Suspendido',
  cancelled: 'Cancelado',
};

/**
 * Partidos — server-side filtered and paginated match list plus a match detail
 * inspector (by `idOrSlug`). Filters and pagination go to the backend; a 400
 * validation message is surfaced verbatim, never swallowed.
 */
@Component({
  selector: 'app-admin-football-matches',
  standalone: true,
  imports: [CommonModule, AdminStatusBadgeComponent],
  templateUrl: './admin-football-matches.component.html',
  styleUrls: ['./admin-football-matches.component.scss'],
})
export class AdminFootballMatchesComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  readonly statusOptions = STATUS_OPTIONS;

  items: FootballAdminMatchDTO[] = [];
  selected: FootballAdminMatchDTO | null = null;
  total = 0;
  page = 1;
  limit = 25;
  q = '';
  status: FootballAdminMatchStatus | '' = '';
  loading = false;
  detailLoading = false;
  error: string | null = null;
  detailError: string | null = null;
  unauthorized = false;
  /** True once a list request has answered successfully (so empty is an honest empty, not "still loading"). */
  loaded = false;

  private sub?: Subscription;
  private detailSub?: Subscription;

  constructor(private readonly data: FootballAdminDataService) {}

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.detailSub?.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.unauthorized = false;
    this.sub?.unsubscribe();
    this.sub = this.data
      .getMatches({
        page: this.page,
        limit: this.limit,
        status: this.status || undefined,
        q: this.q.trim() || undefined,
      })
      .subscribe({
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

  applyFilters(): void {
    this.page = 1;
    this.load();
  }

  onQ(event: Event): void {
    this.q = (event.target as HTMLInputElement).value;
  }

  onStatus(event: Event): void {
    this.status = (event.target as HTMLSelectElement).value as FootballAdminMatchStatus | '';
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

  selectMatch(match: FootballAdminMatchDTO): void {
    this.selected = null;
    this.detailError = null;
    this.detailLoading = true;
    this.detailSub?.unsubscribe();
    this.detailSub = this.data.getMatch(match.matchId).subscribe({
      next: (detail) => {
        this.selected = detail;
        this.detailLoading = false;
      },
      error: (err: unknown) => {
        this.detailLoading = false;
        this.detailError = err instanceof AdminApiError ? adminApiErrorMessage(err) : 'No se ha podido cargar el detalle del partido.';
      },
    });
  }

  closeInspector(): void {
    this.selected = null;
    this.detailSub?.unsubscribe();
  }

  statusLabel(match: FootballAdminMatchDTO): string {
    if (match.statusState !== 'observed' || !match.status) return 'No disponible';
    return STATUS_LABELS[match.status] ?? match.status;
  }

  statusBadge(match: FootballAdminMatchDTO): string {
    if (match.statusState !== 'observed' || !match.status) return 'unknown';
    switch (match.status) {
      case 'live':
      case 'halftime':
        return 'active';
      case 'finished':
        return 'completed';
      case 'postponed':
      case 'suspended':
      case 'cancelled':
        return 'warning';
      default:
        return 'info';
    }
  }

  /** Optional string fields render "No disponible" unless their companion state is `observed`. */
  fieldLabel(value: string | undefined, state: AvailabilityState): string {
    if (state !== 'observed' || value == null || value === '') return 'No disponible';
    return value;
  }

  kickoffLabel(match: FootballAdminMatchDTO): string {
    if (match.kickoffState !== 'observed' || !match.kickoffAt) return 'No disponible';
    const d = new Date(match.kickoffAt);
    if (Number.isNaN(d.getTime())) return 'No disponible';
    return d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  }

  scoreLabel(match: FootballAdminMatchDTO): string {
    if (match.scoreState !== 'observed' || !match.score) return 'Sin marcador';
    return `${match.score.home ?? '—'} : ${match.score.away ?? '—'}`;
  }

  private applyResult(result: FootballAdminMatchesDTO): void {
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
      this.error = 'No se han podido cargar los partidos.';
    }
  }
}
