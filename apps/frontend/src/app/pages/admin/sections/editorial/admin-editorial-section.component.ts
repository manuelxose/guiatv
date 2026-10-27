import { CommonModule } from '@angular/common';
import { Component, DestroyRef, EventEmitter, OnInit, Output, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminEditorialService,
  EditorialFinding,
  EditorialOverview,
  EditorialPolicyStatus,
  EditorialPostDetail,
  EditorialRole,
  EditorialSeverity,
} from '../../../../services/admin-editorial.service';
import { AdminConfirmDialogComponent } from '../../components/admin-confirm-dialog/admin-confirm-dialog.component';
import { AdminStatusBadgeComponent } from '../../components/admin-status-badge/admin-status-badge.component';

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

/** Plain-Spanish summary of whether automatic publication can happen right now. */
export function policyStateText(policy: EditorialPolicyStatus): string {
  if (policy.paused) {
    const who = policy.pausedBy || 'desconocido';
    const when = policy.pausedAt ? ` el ${formatDate(policy.pausedAt)}` : '';
    const why = policy.pausedReason ? `: ${policy.pausedReason}` : '';
    const env = policy.envEnabled ? '' : ' (además desactivada por variable de entorno)';
    return `Publicación automática: pausada por ${who}${when}${why}${env}`;
  }
  if (!policy.envEnabled) return 'Publicación automática: desactivada (variable de entorno)';
  return policy.active ? 'Publicación automática: activa' : 'Publicación automática: inactiva';
}

/** Maps pipeline/critic states onto the shared admin badge vocabulary. */
const STATE_BADGE: Record<string, string> = {
  published: 'healthy',
  'approved-by-policy': 'active',
  pass: 'healthy',
  verified: 'current',
  'requires-update': 'warning',
  revise: 'warning',
  blocked: 'failed',
  block: 'failed',
};

function errorMessage(e: any, fallback: string): string {
  const body = e?.error;
  if (typeof body?.message === 'string') return body.message;
  if (typeof body?.error === 'string') return body.error;
  if (typeof body?.error?.message === 'string') return body.error.message;
  return fallback;
}

@Component({
  selector: 'app-admin-editorial-section',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminStatusBadgeComponent, AdminConfirmDialogComponent],
  templateUrl: './admin-editorial-section.component.html',
})
export class AdminEditorialSectionComponent implements OnInit {
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  readonly roles: EditorialRole[] = ['research', 'evidence', 'editorial', 'seo', 'critic'];
  readonly severities: EditorialSeverity[] = ['block', 'warn', 'human'];
  readonly severityLabels: Record<EditorialSeverity, string> = {
    block: 'Bloqueante',
    warn: 'Aviso',
    human: 'Revisión humana',
  };

  overview: EditorialOverview | null = null;
  loading = false;
  error = '';

  detail: EditorialPostDetail | null = null;
  detailLoading = false;
  detailError = '';
  private sourceIndex = new Map<string, EditorialPostDetail['provenance']['bundle']['sources'][number]>();

  pauseReason = '';
  pauseDialogOpen = false;
  pauseBusy = false;
  pauseError = '';

  resumeKey = '';
  resumeReviewer = '';
  resumeBusy = false;
  resumeError = '';

  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(AdminEditorialService);

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading = true;
    this.error = '';
    this.service
      .getOverview()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.overview = data;
          this.loading = false;
          this.lastUpdatedChange.emit(new Date());
        },
        error: (e) => {
          this.loading = false;
          this.error = errorMessage(e, 'No se pudo cargar la supervisión editorial');
        },
      });
  }

  get policyText(): string {
    return this.overview ? policyStateText(this.overview.policy) : '';
  }

  badgeStatus(state: string | null | undefined): string {
    return STATE_BADGE[state || ''] || 'queued';
  }

  routeFallbacks(role: EditorialRole): string {
    const fallbacks = (this.overview?.routes[role] || []).slice(1);
    return fallbacks.map((r) => `${r.provider}/${r.model} (${r.effort})`).join(' → ') || '—';
  }

  openPost(id: string): void {
    this.detail = null;
    this.detailError = '';
    this.detailLoading = true;
    this.service
      .getPost(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.detail = data;
          this.sourceIndex = new Map(data.provenance.bundle.sources.map((s) => [s.id, s]));
          this.detailLoading = false;
        },
        error: (e) => {
          this.detailLoading = false;
          this.detailError = errorMessage(e, 'No se pudo cargar el artículo');
        },
      });
  }

  closeDetail(): void {
    this.detail = null;
    this.detailError = '';
    this.detailLoading = false;
  }

  source(id: string) {
    return this.sourceIndex.get(id);
  }

  bySeverity(list: EditorialFinding[], severity: EditorialSeverity): EditorialFinding[] {
    return list.filter((f) => f.severity === severity);
  }

  requestPause(): void {
    if (!this.pauseReason.trim()) return;
    this.pauseError = '';
    this.pauseDialogOpen = true;
  }

  confirmPause(): void {
    const reason = this.pauseReason.trim();
    if (!reason || !this.overview) return;
    this.pauseBusy = true;
    this.service
      .pause(reason)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (policy) => {
          if (this.overview) this.overview = { ...this.overview, policy };
          this.pauseBusy = false;
          this.pauseDialogOpen = false;
          this.pauseReason = '';
        },
        error: (e) => {
          this.pauseBusy = false;
          this.pauseDialogOpen = false;
          this.pauseError = errorMessage(e, 'No se pudo pausar la publicación automática');
        },
      });
  }

  resume(): void {
    const key = this.resumeKey;
    const reviewer = this.resumeReviewer.trim();
    if (!key || !reviewer) return;
    this.resumeBusy = true;
    this.resumeError = '';
    // The key is never stored: cleared from the form whatever the outcome.
    this.resumeKey = '';
    this.service
      .resume(key, reviewer)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (policy) => {
          if (this.overview) this.overview = { ...this.overview, policy };
          this.resumeBusy = false;
          this.resumeReviewer = '';
        },
        error: (e) => {
          this.resumeBusy = false;
          this.resumeError = errorMessage(e, 'No se pudo reanudar la publicación automática');
        },
      });
  }
}
