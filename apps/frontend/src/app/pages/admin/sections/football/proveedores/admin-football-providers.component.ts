import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';
import {
  AdminApiError,
  adminApiErrorMessage,
  AvailabilityState,
  FootballProviderDetailDTO,
  FootballProviderSummaryDTO,
} from '@app/features/football/admin-data/football-admin.models';
import { AdminStatusBadgeComponent } from '@app/pages/admin/components/admin-status-badge/admin-status-badge.component';

/**
 * Proveedores y APIs — provider list plus a per-provider detail inspector.
 * Nullable measurements (`consecutiveFailures`, `quotaConsumedToday`,
 * `requestsUsed`) are rendered as "No disponible" unless their companion
 * `*State` is `observed`.
 */
@Component({
  selector: 'app-admin-football-providers',
  standalone: true,
  imports: [CommonModule, AdminStatusBadgeComponent],
  templateUrl: './admin-football-providers.component.html',
  styleUrls: ['./admin-football-providers.component.scss'],
})
export class AdminFootballProvidersComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  providers: FootballProviderSummaryDTO[] = [];
  selected: FootballProviderDetailDTO | null = null;
  loading = false;
  detailLoading = false;
  error: string | null = null;
  detailError: string | null = null;
  unauthorized = false;

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
    this.sub = this.data.getProviders().subscribe({
      next: (providers) => {
        this.providers = providers;
        this.loading = false;
        this.lastUpdatedChange.emit(new Date());
      },
      error: (err: unknown) => {
        this.loading = false;
        this.handleError(err);
      },
    });
  }

  selectProvider(provider: FootballProviderSummaryDTO): void {
    this.selected = null;
    this.detailError = null;
    this.detailLoading = true;
    this.detailSub?.unsubscribe();
    this.detailSub = this.data.getProvider(provider.provider).subscribe({
      next: (detail) => {
        this.selected = detail;
        this.detailLoading = false;
      },
      error: (err: unknown) => {
        this.detailLoading = false;
        this.detailError = err instanceof AdminApiError ? adminApiErrorMessage(err) : 'No se ha podido cargar el detalle del proveedor.';
      },
    });
  }

  closeInspector(): void {
    this.selected = null;
    this.detailSub?.unsubscribe();
  }

  healthLabel(health: FootballProviderSummaryDTO['health']): string {
    switch (health) {
      case 'ok':
        return 'Saludable';
      case 'degraded':
        return 'Degradado';
      case 'down':
        return 'Caído';
    }
  }

  healthStatus(health: FootballProviderSummaryDTO['health']): string {
    switch (health) {
      case 'ok':
        return 'healthy';
      case 'degraded':
        return 'degraded';
      case 'down':
        return 'critical';
    }
  }

  /** A nullable measurement is a real number only when its state is `observed`/`empty`. */
  numberLabel(value: number | null, state: AvailabilityState): string {
    if ((state !== 'observed' && state !== 'empty') || value == null) return 'No disponible';
    return String(value);
  }

  private handleError(err: unknown): void {
    if (err instanceof AdminApiError) {
      this.unauthorized = err.kind === 'unauthorized';
      this.error = adminApiErrorMessage(err);
    } else {
      this.error = 'No se han podido cargar los proveedores.';
    }
  }
}
