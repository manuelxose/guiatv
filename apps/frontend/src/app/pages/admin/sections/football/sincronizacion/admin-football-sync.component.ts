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
  INGESTION_OUTCOME_LABELS,
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
      },
      error: (err: unknown) => {
        this.loading = false;
        this.handleError(err);
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
        if (result.status === 'completed') {
          this.syncing = false;
          this.syncMessage = `Sincronización completada (operación ${result.id}).`;
          this.load();
        } else if (result.status === 'failed') {
          this.syncing = false;
          this.syncError = `La sincronización falló (operación ${result.id}).`;
          this.load();
        } else if (attempt < MAX_SYNC_POLLS) {
          this.syncSub = timer(2500).subscribe(() => this.pollSync(idempotencyKey, attempt + 1));
        } else {
          this.syncing = false;
          this.syncMessage = `Operación ${result.id} sigue ${SYNC_STATUS_LABELS[result.status].toLowerCase()}. Revisa el estado más adelante.`;
        }
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
