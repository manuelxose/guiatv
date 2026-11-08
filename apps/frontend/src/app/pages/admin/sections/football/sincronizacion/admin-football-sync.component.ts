import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription, timer } from 'rxjs';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';
import {
  AdminApiError,
  adminApiErrorMessage,
  AvailabilityState,
  FootballIngestionStatusDTO,
  FootballSyncResultDTO,
  FootballSyncStatus,
  INGESTION_OUTCOME_LABELS,
  isSyncTerminal,
  SYNC_STATUS_LABELS,
} from '@app/features/football/admin-data/football-admin.models';
import { AdminStatusBadgeComponent } from '@app/pages/admin/components/admin-status-badge/admin-status-badge.component';

/** Max poll attempts for the manual sync terminal outcome (2.5s apart → ~20s). */
const MAX_SYNC_POLLS = 8;

/**
 * Sincronización — ingestion status plus the single real control. The sync
 * button POSTs to `/ingestion/sync` with an idempotency key, shows the queued
 * operation id, and polls (re-POSTing the same key) until the operation reaches
 * a terminal `completed`/`failed` state. A queued operation is NEVER rendered
 * as success.
 */
@Component({
  selector: 'app-admin-football-sync',
  standalone: true,
  imports: [CommonModule, AdminStatusBadgeComponent],
  templateUrl: './admin-football-sync.component.html',
  styleUrls: ['./admin-football-sync.component.scss'],
})
export class AdminFootballSyncComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  status: FootballIngestionStatusDTO | null = null;
  loading = false;
  error: string | null = null;
  unauthorized = false;

  syncing = false;
  syncResult: FootballSyncResultDTO | null = null;
  history: FootballSyncResultDTO[] = [];
  historyError: string | null = null;
  private historySub?: Subscription;
  syncMessage: string | null = null;
  syncError: string | null = null;

  private sub?: Subscription;
  private syncSub?: Subscription;

  constructor(private readonly data: FootballAdminDataService) {}

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.syncSub?.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.unauthorized = false;
    this.sub?.unsubscribe();
    this.sub = this.data.getIngestionStatus().subscribe({
      next: (status) => {
        this.status = status;
        this.loading = false;
        this.lastUpdatedChange.emit(new Date());
        this.loadHistory();
      },
      error: (err: unknown) => {
        this.loading = false;
        this.handleError(err);
      },
    });
  }

  /**
   * R1-5: the truthful operation history. A failure here must NOT blank the whole
   * section (the status above already loaded); it is reported in its own message.
   */
  private loadHistory(): void {
    this.historySub?.unsubscribe();
    this.historySub = this.data.getSyncOperations({ limit: 10 }).subscribe({
      next: (ops) => {
        this.history = ops.items ?? [];
        this.historyError = null;
      },
      error: (err: unknown) => {
        this.history = [];
        this.historyError = err instanceof AdminApiError
          ? adminApiErrorMessage(err)
          : 'No se ha podido cargar el historial de sincronizaciones.';
      },
    });
  }

  syncNow(): void {
    if (this.syncing) return;
    this.syncing = true;
    this.syncResult = null;
    this.syncMessage = null;
    this.syncError = null;
    // Stable idempotency key: re-POSTing it reads the same operation instead of re-queueing.
    const idempotencyKey = `manual.${Date.now()}`;
    this.pollSync(idempotencyKey, 0);
  }

  outcomeLabel(outcome: string): string {
    return INGESTION_OUTCOME_LABELS[outcome as keyof typeof INGESTION_OUTCOME_LABELS] ?? outcome;
  }

  /** R1: template-safe label lookup (the constant is not a template member). */
  statusLabel(status: FootballSyncStatus): string {
    return SYNC_STATUS_LABELS[status];
  }

  /** R1: the DTO carries a plain string; coerce to the availability union. */
  asAvailabilityState(value: string | undefined): AvailabilityState {
    return (value ?? 'not_measured') as AvailabilityState;
  }

  syncStatusLabel(): string {
    return this.syncResult ? SYNC_STATUS_LABELS[this.syncResult.status] : '';
  }

  healthLabel(health: string): string {
    switch (health) {
      case 'ok':
        return 'Saludable';
      case 'degraded':
        return 'Degradado';
      case 'down':
        return 'Caído';
      // R1-7: never render an unmeasured health as if it were a measurement.
      case 'unknown':
        return 'Sin medir';
      default:
        return health;
    }
  }

  healthStatus(health: string): string {
    switch (health) {
      case 'ok':
        return 'healthy';
      case 'degraded':
        return 'degraded';
      case 'down':
        return 'critical';
      default:
        return 'unknown';
    }
  }

  numberLabel(value: number | null, state: AvailabilityState): string {
    if ((state !== 'observed' && state !== 'empty') || value == null) return 'No disponible';
    return String(value);
  }

  private pollSync(idempotencyKey: string, attempt: number): void {
    this.syncSub?.unsubscribe();
    this.syncSub = this.data.sync(idempotencyKey).subscribe({
      next: (result) => {
        this.syncResult = result;
        // R1-1: treat EVERY terminal backend state as terminal. The old code only
        // knew 'completed'/'failed', so a real 'succeeded' was polled until it
        // timed out and was then rendered as "sigue undefined".
        if (!isSyncTerminal(result.status)) {
          if (attempt < MAX_SYNC_POLLS) {
            this.syncSub = timer(2500).subscribe(() => this.pollSync(idempotencyKey, attempt + 1));
          } else {
            this.syncing = false;
            this.syncMessage = `La operación ${result.id} sigue en curso. Vuelve a consultar el historial más adelante.`;
          }
          return;
        }
        this.syncing = false;
        const label = SYNC_STATUS_LABELS[result.status];
        switch (result.status) {
          case 'succeeded':
            this.syncMessage = `Sincronización completada (operación ${result.id}).`;
            break;
          case 'empty':
            this.syncMessage = `La sincronización no devolvió partidos nuevos (operación ${result.id}).`;
            break;
          case 'skipped':
            this.syncError = `La sincronización se omitió${result.skipReason ? `: ${result.skipReason}` : ''} (operación ${result.id}).`;
            break;
          case 'throttled':
            this.syncError = `La sincronización se limitó por cuota (operación ${result.id}).`;
            break;
          case 'failed':
          default:
            this.syncError = `La sincronización falló (operación ${result.id}): ${label.toLowerCase()}.`;
            break;
        }
        this.load();
      },
      error: (err: unknown) => {
        this.syncing = false;
        this.syncError = err instanceof AdminApiError ? adminApiErrorMessage(err) : 'No se ha podido encolar la sincronización.';
      },
    });
  }

  private handleError(err: unknown): void {
    if (err instanceof AdminApiError) {
      this.unauthorized = err.kind === 'unauthorized';
      this.error = adminApiErrorMessage(err);
    } else {
      this.error = 'No se ha podido cargar la sincronización.';
    }
  }
}




