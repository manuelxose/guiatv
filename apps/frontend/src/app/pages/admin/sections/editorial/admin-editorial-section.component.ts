import { CommonModule } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import { Component, DestroyRef, ElementRef, EventEmitter, HostListener, OnDestroy, OnInit, Output, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminEditorialService, EditorialContentType, EditorialFinding, EditorialGenerationSettings,
  EditorialGenerationTopic, EditorialLength, EditorialOverview, EditorialPolicyStatus,
  EditorialPostDetail, EditorialRole, EditorialSeverity,
} from '../../../../services/admin-editorial.service';
import { AdminConfirmDialogComponent } from '../../components/admin-confirm-dialog/admin-confirm-dialog.component';
import { AdminStatusBadgeComponent } from '../../components/admin-status-badge/admin-status-badge.component';

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

export function policyStateText(policy: EditorialPolicyStatus): string {
  if (policy.paused) return `Publicación pausada por ${policy.pausedBy || 'un administrador'}${policy.pausedReason ? `: ${policy.pausedReason}` : ''}`;
  if (!policy.envEnabled) return 'Publicación desactivada por la configuración del servidor';
  if (!policy.activated) return 'Publicación disponible, pendiente de activación humana';
  return policy.active ? 'Publicación automática activa; solo publica artículos que superan todos los controles' : 'Publicación automática inactiva';
}

export function topReasons(reasons: Record<string, number>, n = 5): Array<[string, number]> {
  return Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, n);
}

const STATE_BADGE: Record<string, string> = {
  published: 'healthy', completed: 'healthy', 'approved-by-policy': 'active', pass: 'healthy', queued: 'queued',
  verified: 'current', running: 'current', 'requires-update': 'warning', revise: 'warning', failed: 'failed',
  blocked: 'failed', block: 'failed', held: 'warning', rejected: 'failed', cancelled: 'unconfigured', ok: 'healthy',
  partial: 'warning', 'quota-exceeded': 'warning', 'missing-credentials': 'unconfigured', forbidden: 'failed', error: 'failed',
};

function errorMessage(e: any, fallback: string): string {
  const body = e?.error;
  return body?.error?.message || body?.message || (typeof body?.error === 'string' ? body.error : fallback);
}

const emptyTopic = (): EditorialGenerationTopic => ({
  title: '', slug: '', topic: '', intent: '', category: 'Streaming', volatility: 'stable',
  contentType: 'guide', length: 'medium', seedUrls: [], internalSources: [],
});

@Component({
  selector: 'app-admin-editorial-section',
  standalone: true,
  imports: [CommonModule, FormsModule, A11yModule, AdminStatusBadgeComponent, AdminConfirmDialogComponent],
  templateUrl: './admin-editorial-section.component.html',
  styleUrl: './admin-editorial-section.component.scss',
})
export class AdminEditorialSectionComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();
  @ViewChild('detailDrawer') detailDrawer?: ElementRef<HTMLElement>;
  readonly roles: EditorialRole[] = ['research', 'evidence', 'editorial', 'seo', 'critic'];
  readonly roleLabels: Record<EditorialRole, string> = { research: 'Investigación', evidence: 'Evidencias', editorial: 'Redacción', seo: 'SEO', critic: 'Crítico' };
  readonly categories = ['Televisión', 'Cine', 'Series', 'Streaming', 'Fútbol', 'Deportes', 'Tecnología'];
  readonly contentTypes: Array<{ id: EditorialContentType; label: string }> = [{ id: 'guide', label: 'Guía' }, { id: 'ranking', label: 'Ranking' }, { id: 'analysis', label: 'Análisis' }];
  readonly lengths: Array<{ id: EditorialLength; label: string }> = [{ id: 'short', label: 'Corta · 600–900' }, { id: 'medium', label: 'Media · 900–1400' }, { id: 'long', label: 'Larga · 1400–2000' }];
  readonly models: Record<string, string[]> = { anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], openai: ['gpt-6.1-terra', 'gpt-6-luna'] };
  readonly severities: EditorialSeverity[] = ['block', 'warn', 'human'];
  readonly severityLabels: Record<EditorialSeverity, string> = { block: 'Bloqueante', warn: 'Aviso', human: 'Revisión humana' };
  readonly stateLabels: Record<string, string> = { queued: 'En cola', running: 'En ejecución', completed: 'Completada', failed: 'Fallida', cancelled: 'Cancelada', published: 'Publicado', held: 'Retenido', rejected: 'Rechazado', 'approved-by-policy': 'Aprobado por política', verified: 'Revisión humana', blocked: 'Bloqueado' };
  readonly tabs = ['activity', 'queue', 'generate', 'settings'] as const;
  activeTab: typeof this.tabs[number] = 'activity';
  overview: EditorialOverview | null = null;
  loading = false;
  error = '';
  notice = '';
  settingsDraft: EditorialGenerationSettings | null = null;
  settingsDirty = false;
  settingsBusy = false;
  request = emptyTopic();
  seedUrlsText = '';
  internalUrlsText = '';
  requestBusy = false;
  queueBusy = '';
  detail: EditorialPostDetail | null = null;
  detailOpen = false;
  detailLoading = false;
  detailError = '';
  private sourceIndex = new Map<string, EditorialPostDetail['provenance']['bundle']['sources'][number]>();
  private returnFocus: HTMLElement | null = null;
  pauseReason = '';
  pauseDialogOpen = false;
  pauseBusy = false;
  pauseError = '';
  resumeKey = '';
  resumeReviewer = '';
  resumeBusy = false;
  resumeError = '';
  limitValue: number | null = null;
  limitKey = '';
  limitReviewer = '';
  limitBusy = false;
  limitError = '';
  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(AdminEditorialService);

  ngOnInit(): void { this.refresh(); }
  ngOnDestroy(): void { document.body.style.overflow = ''; }

  refresh(): void {
    this.loading = true;
    this.error = '';
    this.service.getOverview().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.overview = data;
        if (!this.settingsDirty) this.settingsDraft = structuredClone(data.generation);
        this.loading = false;
        this.lastUpdatedChange.emit(new Date());
      },
      error: (e) => { this.loading = false; this.error = errorMessage(e, 'No se pudo cargar Operaciones IA'); },
    });
  }

  get policyText(): string { return this.overview ? policyStateText(this.overview.policy) : ''; }
  readonly topReasons = topReasons;
  badgeStatus(state: string | null | undefined): string { return STATE_BADGE[state || ''] || 'queued'; }
  stateLabel(state: string | null | undefined): string { return this.stateLabels[state || ''] || state || 'Sin estado'; }
  routeFallbacks(role: EditorialRole): string { return (this.overview?.generation.routes[role] || []).slice(1).map((r) => `${r.provider}/${r.model} (${r.effort})`).join(' → ') || '—'; }
  trackId(_: number, item: { id: string }): string { return item.id; }
  trackJob(_: number, item: { jobId: string }): string { return item.jobId; }
  trackRole(_: number, item: string): string { return item; }

  selectTab(tab: typeof this.tabs[number]): void { this.activeTab = tab; }
  tabKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = this.tabs.indexOf(this.activeTab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? this.tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + this.tabs.length) % this.tabs.length;
    this.activeTab = this.tabs[next];
    document.getElementById(`editorial-tab-${this.activeTab}`)?.focus();
  }

  openPost(id: string): void {
    this.returnFocus = document.activeElement as HTMLElement;
    this.detail = null;
    this.detailError = '';
    this.detailLoading = true;
    this.detailOpen = true;
    document.body.style.overflow = 'hidden';
    this.service.getPost(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => { this.detail = data; this.sourceIndex = new Map(data.provenance.bundle.sources.map((s) => [s.id, s])); this.detailLoading = false; },
      error: (e) => { this.detailLoading = false; this.detailError = errorMessage(e, 'No se pudo cargar el artículo'); },
    });
  }

  closeDetail(): void {
    this.detailOpen = false;
    this.detail = null;
    this.detailError = '';
    this.detailLoading = false;
    document.body.style.overflow = '';
    this.returnFocus?.focus();
  }

  @HostListener('document:keydown.escape') onEscape(): void { if (this.detailOpen) this.closeDetail(); }
  source(id: string) { return this.sourceIndex.get(id); }
  bySeverity(list: EditorialFinding[], severity: EditorialSeverity): EditorialFinding[] { return list.filter((f) => f.severity === severity); }

  requestPause(): void { if (this.pauseReason.trim()) { this.pauseError = ''; this.pauseDialogOpen = true; } }
  confirmPause(): void {
    const reason = this.pauseReason.trim();
    if (!reason || !this.overview) return;
    this.pauseBusy = true;
    this.service.pause(reason).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (policy) => { this.overview = { ...this.overview!, policy }; this.pauseBusy = false; this.pauseDialogOpen = false; this.pauseReason = ''; this.notice = 'Generación y publicación detenidas'; },
      error: (e) => { this.pauseBusy = false; this.pauseDialogOpen = false; this.pauseError = errorMessage(e, 'No se pudo detener la automatización'); },
    });
  }

  resume(): void {
    const key = this.resumeKey;
    const reviewer = this.resumeReviewer.trim();
    if (!key || !reviewer) return;
    this.resumeBusy = true;
    this.resumeError = '';
    this.resumeKey = '';
    this.service.resume(key, reviewer).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (policy) => { this.overview = { ...this.overview!, policy }; this.resumeBusy = false; this.resumeReviewer = ''; this.notice = 'Publicación automática reanudada'; },
      error: (e) => { this.resumeBusy = false; this.resumeError = errorMessage(e, 'No se pudo reanudar la publicación'); },
    });
  }

  saveDailyLimit(): void {
    const value = this.limitValue;
    const key = this.limitKey;
    const reviewer = this.limitReviewer.trim();
    if (value === null || !key || !reviewer) return;
    this.limitBusy = true;
    this.limitError = '';
    this.limitKey = '';
    this.service.setDailyLimit(value, key, reviewer).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (policy) => { this.overview = { ...this.overview!, policy, limits: { ...this.overview!.limits, maxDailyArticles: policy.dailyLimit } }; this.limitBusy = false; this.limitValue = null; this.notice = 'Límite diario actualizado'; },
      error: (e) => { this.limitBusy = false; this.limitError = errorMessage(e, 'No se pudo cambiar el límite diario'); },
    });
  }

  toggleGeneration(): void {
    if (!this.settingsDraft) return;
    this.settingsDraft.enabled = !this.settingsDraft.enabled;
    this.saveSettings();
  }

  saveSettings(): void {
    if (!this.settingsDraft || this.settingsBusy) return;
    this.settingsBusy = true;
    this.error = '';
    this.service.saveGenerationSettings(this.settingsDraft).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (generation) => { this.overview = { ...this.overview!, generation }; this.settingsDraft = structuredClone(generation); this.settingsDirty = false; this.settingsBusy = false; this.notice = generation.enabled ? 'Configuración guardada; generación programada activa' : 'Generación programada en pausa'; },
      error: (e) => { this.settingsBusy = false; this.error = errorMessage(e, 'No se pudo guardar la configuración'); },
    });
  }

  toggleList(list: string[], value: string): void {
    const index = list.indexOf(value);
    if (index >= 0) { if (list.length > 1) list.splice(index, 1); } else list.push(value);
    this.settingsDirty = true;
  }

  submitGeneration(): void {
    if (this.requestBusy) return;
    this.request.seedUrls = this.seedUrlsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    this.request.internalSources = this.internalUrlsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean).map((url, i) => ({ id: `internal-${i + 1}`, url }));
    this.requestBusy = true;
    this.error = '';
    this.service.generate(this.request).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.requestBusy = false; this.notice = 'Solicitud en cola; se ejecutará cuando el runner despierte'; this.request = emptyTopic(); this.seedUrlsText = ''; this.internalUrlsText = ''; this.activeTab = 'queue'; this.refresh(); },
      error: (e) => { this.requestBusy = false; this.error = errorMessage(e, 'No se pudo crear la solicitud'); },
    });
  }

  discover(): void {
    if (this.requestBusy) return;
    this.requestBusy = true;
    this.service.discover().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.requestBusy = false; this.notice = 'Descubrimiento en cola para la próxima activación del runner'; this.refresh(); },
      error: (e) => { this.requestBusy = false; this.error = errorMessage(e, 'No se pudo solicitar el descubrimiento'); },
    });
  }

  queueAction(id: string, action: 'cancel' | 'retry'): void {
    this.queueBusy = id;
    const call = action === 'cancel' ? this.service.cancelRequest(id) : this.service.retryRequest(id);
    call.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.queueBusy = ''; this.notice = action === 'cancel' ? 'Solicitud cancelada' : 'Solicitud devuelta a la cola'; this.refresh(); },
      error: (e) => { this.queueBusy = ''; this.error = errorMessage(e, 'No se pudo actualizar la solicitud'); },
    });
  }
}
