import { CommonModule } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import { Component, DestroyRef, ElementRef, EventEmitter, HostListener, OnDestroy, OnInit, Output, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminEditorialService, EditorialContentType, EditorialFinding, EditorialGenerationSettings,
  EditorialGenerationTopic, EditorialLength, EditorialOverview, EditorialPolicyStatus,
  EditorialPostDetail, EditorialProviderHealth, EditorialProviderState, EditorialRole, EditorialSeverity,
} from '../../../../services/admin-editorial.service';
import { AdminConfirmDialogComponent } from '../../components/admin-confirm-dialog/admin-confirm-dialog.component';
import { AdminStatusBadgeComponent } from '../../components/admin-status-badge/admin-status-badge.component';
import { AdminJobLedgerComponent } from './job-ledger/admin-job-ledger.component';
import { DiffLine, PIPELINE_STAGES, PipelineStage, RUN_STEPS, STATE_BADGE, STATE_LABELS, diffLines, gateDetails, postStage, queueStage } from './editorial-status';
import { EditorialPostSummary, EditorialQueueActionName, EditorialQueueItem } from '../../../../services/admin-editorial.service';
import { interval } from 'rxjs';

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
  imports: [CommonModule, FormsModule, A11yModule, AdminStatusBadgeComponent, AdminConfirmDialogComponent, AdminJobLedgerComponent],
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
  readonly models: Record<string, string[]> = { anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], openai: ['gpt-6.1-terra', 'gpt-6-luna'], deepseek: ['deepseek-v4-pro', 'deepseek-flash'] };
  readonly severities: EditorialSeverity[] = ['block', 'warn', 'human'];
  readonly severityLabels: Record<EditorialSeverity, string> = { block: 'Bloqueante', warn: 'Aviso', human: 'Revisión humana' };
  readonly stateLabels = STATE_LABELS;
  readonly tabs = ['pipeline', 'topics', 'review', 'runs', 'ledger', 'generate', 'settings', 'search'] as const;
  readonly tabLabels: Record<typeof this.tabs[number], string> = { pipeline: 'Pipeline', topics: 'Temas', review: 'Revisión', runs: 'Ejecuciones', ledger: 'Trabajos', generate: 'Generar', settings: 'Configuración', search: 'Search Console' };
  readonly stages = PIPELINE_STAGES;
  activeTab: typeof this.tabs[number] = 'pipeline';
  emergencyOpen = false;
  readonly runSteps = RUN_STEPS;
  expandedJob = '';
  // Publication review (key and reviewer are typed per action and never kept).
  reviewer = '';
  reviewKey = '';
  ackCodes: string[] = [];
  reviewBusy = '';
  reviewError = '';
  reviewDetails: string[] = [];
  postRejectReason = '';
  unpublishReason = '';
  diffOpen = false;
  private diffCache: DiffLine[] | null = null;
  readonly topicFilters = [
    { id: 'all', label: 'Todos' }, { id: 'queued', label: 'En cola' }, { id: 'held', label: 'Retenidos' },
    { id: 'rejected', label: 'Rechazados' }, { id: 'manual', label: 'Manuales' },
  ] as const;
  readonly actionLabels: Record<string, string> = { approve: 'aprobar', reject: 'rechazar', prioritize: 'priorizar', edit: 'editar' };
  topicFilter: typeof this.topicFilters[number]['id'] = 'all';
  editId = '';
  editForm = { title: '', intent: '', seedUrlsText: '' };
  rejectId = '';
  rejectReason = '';
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
  editDraft: { title: string; excerpt: string; content: string; metaTitle: string; metaDescription: string } | null = null;
  editBusy = false;
  editError = '';
  postActionBusy = '';
  deleteDialogOpen = false;
  runnerBusy = '';
  runnerLogLines: string[] | null = null;
  providers: EditorialProviderHealth | null = null;
  providersLoading = false;
  providersError = '';
  gscBusy = false;
  readonly providerStateLabels: Record<EditorialProviderState, string> = {
    connected: 'Conectado', unauthorized: 'Credencial rechazada', unreachable: 'Sin conexión',
    error: 'Error del proveedor', 'not-configured': 'Sin credencial',
  };
  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(AdminEditorialService);

  ngOnInit(): void {
    this.refresh();
    this.loadProviders();
    // Live view: poll while the tab is visible; silent so the page does not flash a loading state.
    interval(15000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => { if (!document.hidden && !this.loading) this.refresh(true); });
  }

  searchConsoleLabel(reason: string): string {
    return {
      'fresh-inspected': 'Inspeccionada en las últimas 24 h',
      'fresh-indexed': 'Indexada y revisada hace menos de 7 días',
      'inspection-limit': 'Límite de inspecciones de esta ejecución',
      'no-slug': 'Sin slug público',
    }[reason] ?? reason;
  }

  runSearchConsole(): void {
    if (this.gscBusy) return;
    this.gscBusy = true;
    this.error = '';
    this.service.runSearchConsole().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.gscBusy = false;
        this.notice = result.started
          ? 'Sincronización de Search Console iniciada; los datos aparecerán al terminar.'
          : 'Ya hay una sincronización en curso.';
        setTimeout(() => { if (!document.hidden) this.refresh(true); }, 8000);
      },
      error: (e) => { this.gscBusy = false; this.error = errorMessage(e, 'No se pudo iniciar la sincronización'); },
    });
  }

  loadProviders(refresh = false): void {
    this.providersLoading = true;
    this.providersError = '';
    this.service.getProviders(refresh).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => { this.providers = data; this.providersLoading = false; },
      error: (e) => { this.providersLoading = false; this.providersError = errorMessage(e, 'No se pudo comprobar la conexión con los proveedores'); },
    });
  }
  ngOnDestroy(): void { document.body.style.overflow = ''; }

  refresh(silent = false): void {
    if (!silent) this.loading = true;
    this.error = '';
    this.service.getOverview().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.overview = data;
        if (!this.settingsDirty) this.settingsDraft = structuredClone(data.generation);
        this.loading = false;
        this.lastUpdatedChange.emit(new Date());
      },
      error: (e) => { this.loading = false; if (!silent) this.error = errorMessage(e, 'No se pudo cargar Operaciones IA'); },
    });
  }

  get policyText(): string { return this.overview ? policyStateText(this.overview.policy) : ''; }
  get runnerStatusText(): string {
    const runner = this.overview?.runner;
    if (!runner?.lastSeenAt) return 'Sin señal: el proceso externo nunca ha contactado con este servidor';
    if (runner.status === 'error') return `Error reportado: ${runner.lastError || 'sin detalle'}`;
    return runner.online ? 'Conectado' : 'Sin señal reciente';
  }
  get runnerDetailText(): string {
    const runner = this.overview?.runner;
    if (!runner?.lastSeenAt) return 'Comprueba que el runner está iniciado, actualizado y que puede autenticarse contra esta API.';
    return runner.online ? `Versión ${runner.version || 'sin informar'} · última señal ${formatDate(runner.lastSeenAt)}` : `Última señal ${formatDate(runner.lastSeenAt)}${runner.lastError ? ` · ${runner.lastError}` : ''}`;
  }
  /** Plain-language reason nothing is being produced, so the operator never has to read logs to learn it. */
  get diagnosis(): string | null {
    const ov = this.overview;
    if (!ov) return null;
    if (ov.lastCycle?.result === 'discovery-error') return `El último ciclo falló: ${ov.lastCycle.reason || 'error de descubrimiento'}. Suele ser el acceso del runner a los modelos (gateway o credenciales); no se genera nada hasta que se resuelva.`;
    if (!ov.runner.lastSeenAt) return 'El runner nunca ha contactado con el servidor.';
    if (!ov.runner.online) return `El runner no da señal desde ${formatDate(ov.runner.lastSeenAt)}; las solicitudes quedan pendientes.`;
    if (ov.runner.status === 'error') return `El runner informa de un error: ${ov.runner.lastError || 'sin detalle'}.`;
    return null;
  }
  get board(): Array<{ id: PipelineStage; label: string; hint: string; topics: EditorialQueueItem[]; posts: EditorialPostSummary[] }> {
    const ov = this.overview;
    return this.stages.map((st) => ({
      ...st,
      topics: (ov?.queue ?? []).filter((q) => queueStage(q) === st.id),
      posts: (ov?.posts ?? []).filter((p) => postStage(p) === st.id),
    }));
  }
  toggleJob(id: string): void { this.expandedJob = this.expandedJob === id ? '' : id; }
  stepCost(j: { costEntries: Array<{ role: string; model: string; inputTokens: number; outputTokens: number; usd: number }> }, role: string) {
    const rows = j.costEntries.filter((e) => e.role === role);
    return rows.length ? { models: [...new Set(rows.map((r) => r.model))].join(', '), tokens: rows.reduce((n, r) => n + r.inputTokens + r.outputTokens, 0), usd: rows.reduce((n, r) => n + r.usd, 0), calls: rows.length } : null;
  }
  get diff(): DiffLine[] {
    const d = this.detail;
    if (!d?.previous) return [];
    return this.diffCache ??= diffLines(d.previous.content, d.post.content);
  }
  get diffChanged(): number { return this.diff.filter((l) => l.kind !== 'same').length; }
  humanFindings(): EditorialFinding[] { return (this.detail?.findings ?? []).filter((f) => f.severity === 'human'); }
  toggleAck(code: string): void { this.ackCodes = this.ackCodes.includes(code) ? this.ackCodes.filter((c) => c !== code) : [...this.ackCodes, code]; }
  get canAct(): boolean { return !!this.reviewKey && !!this.reviewer.trim() && this.reviewBusy === ''; }
  private reviewAction(name: string, call: () => import('rxjs').Observable<unknown>, done: string): void {
    if (!this.detail || !this.canAct) return;
    this.reviewBusy = name;
    this.reviewError = '';
    this.reviewDetails = [];
    const id = this.detail.post.id;
    // Build the request first (it captures the key), then drop the key from memory.
    const request = call();
    this.reviewKey = '';
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.reviewBusy = ''; this.ackCodes = []; this.notice = done; this.openPost(id); this.refresh(true); },
      error: (e) => { this.reviewBusy = ''; this.reviewError = errorMessage(e, 'La acción no se pudo completar'); this.reviewDetails = gateDetails(e); },
    });
  }
  approve(): void { const id = this.detail?.post.id; if (id) this.reviewAction('approve', () => this.service.approvePost(id, this.reviewKey, this.reviewer.trim(), this.ackCodes), 'Artículo aprobado; todos los controles se han vuelto a comprobar'); }
  unpublish(): void { const id = this.detail?.post.id; if (id) this.reviewAction('unpublish', () => this.service.unpublishPost(id, this.reviewKey, this.reviewer.trim(), this.unpublishReason), 'Artículo despublicado; queda como borrador y se puede restaurar'); }
  restore(version: number): void { const id = this.detail?.post.id; if (id) this.reviewAction(`restore-${version}`, () => this.service.rollbackPost(id, version, this.reviewKey, this.reviewer.trim()), `Versión ${version} restaurada`); }
  reject(): void {
    const id = this.detail?.post.id;
    if (!id || this.reviewBusy) return;
    this.reviewBusy = 'reject';
    this.reviewError = '';
    this.service.rejectPost(id, this.postRejectReason).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.reviewBusy = ''; this.postRejectReason = ''; this.notice = 'Borrador rechazado; sigue sin publicarse'; this.openPost(id); this.refresh(true); },
      error: (e) => { this.reviewBusy = ''; this.reviewError = errorMessage(e, 'No se pudo rechazar el borrador'); },
    });
  }
  topicMatches(q: EditorialQueueItem, f: string): boolean {
    const state = q.status ?? q.state;
    return f === 'all' || (f === 'manual' ? q.source === 'manual' : f === 'held' ? state === 'held' || state === 'failed' : f === 'rejected' ? state === 'rejected' || state === 'expired' || state === 'cancelled' : state === f);
  }
  topicCount(f: string): number { return (this.overview?.queue ?? []).filter((q) => this.topicMatches(q, f)).length; }
  get topics(): EditorialQueueItem[] {
    return (this.overview?.queue ?? []).filter((q) => this.topicMatches(q, this.topicFilter)).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.score ?? 0) - (a.score ?? 0));
  }
  pendingFor(id: string) { return this.overview?.pendingActions?.find((a) => a.topicId === id); }
  startEdit(item: EditorialQueueItem): void {
    this.rejectId = '';
    this.editId = item.id;
    this.editForm = { title: item.title || '', intent: item.intent || item.topic?.intent || '', seedUrlsText: (item.sources || item.topic?.seedUrls || []).join('\n') };
  }
  saveTopicEdit(id: string): void {
    const edit = { title: this.editForm.title.trim(), intent: this.editForm.intent.trim(), seedUrls: this.editForm.seedUrlsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) };
    this.topicAction(id, 'edit', { edit });
  }
  topicAction(id: string, action: EditorialQueueActionName, extra: { reason?: string; edit?: { title?: string; intent?: string; seedUrls?: string[] } } = {}): void {
    if (this.queueBusy) return;
    this.queueBusy = id;
    this.error = '';
    this.service.queueAction(id, action, extra).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.queueBusy = ''; this.editId = ''; this.rejectId = ''; this.notice = `Decisión registrada: ${this.actionLabels[action]}. El runner la aplicará en su próximo ciclo.`; this.refresh(true); },
      error: (e) => { this.queueBusy = ''; this.error = errorMessage(e, 'No se pudo registrar la decisión'); },
    });
  }
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
      next: (data) => { this.diffCache = null; this.ackCodes = []; this.reviewError = ''; this.reviewDetails = []; this.detail = data; this.sourceIndex = new Map(data.provenance.bundle.sources.map((s) => [s.id, s])); this.editDraft = { title: data.post.title, excerpt: data.post.excerpt, content: data.post.content, metaTitle: data.post.metaTitle, metaDescription: data.post.metaDescription }; this.editError = ''; this.detailLoading = false; },
      error: (e) => { this.detailLoading = false; this.detailError = errorMessage(e, 'No se pudo cargar el artículo'); },
    });
  }

  closeDetail(): void {
    this.detailOpen = false;
    this.detail = null;
    this.detailError = '';
    this.detailLoading = false;
    this.editDraft = null;
    this.editError = '';
    document.body.style.overflow = '';
    this.returnFocus?.focus();
  }

  @HostListener('document:keydown.escape') onEscape(): void { if (this.detailOpen) this.closeDetail(); }
  source(id: string) { return this.sourceIndex.get(id); }
  bySeverity(list: EditorialFinding[], severity: EditorialSeverity): EditorialFinding[] { return list.filter((f) => f.severity === severity); }

  canManagePost(post: { status: string; pipelineState: string }): boolean { return post.status === 'draft' && ['blocked', 'verified', 'requires-update', 'rejected'].includes(post.pipelineState); }

  savePostEdit(): void {
    if (!this.detail || !this.editDraft || this.editBusy) return;
    this.editBusy = true;
    this.editError = '';
    this.service.updatePost(this.detail.post.id, this.editDraft).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.editBusy = false; this.notice = 'Artículo actualizado; vuelve a revisión sin aprobar'; this.openPost(this.detail!.post.id); this.refresh(); },
      error: (e) => { this.editBusy = false; this.editError = errorMessage(e, 'No se pudo guardar el artículo'); },
    });
  }

  requestDeletePost(): void { this.deleteDialogOpen = true; }
  confirmDeletePost(): void {
    const id = this.detail?.post.id;
    if (!id || this.postActionBusy) return;
    this.postActionBusy = id;
    this.service.deletePost(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.postActionBusy = ''; this.deleteDialogOpen = false; this.notice = 'Borrador eliminado'; this.closeDetail(); this.refresh(); },
      error: (e) => { this.postActionBusy = ''; this.deleteDialogOpen = false; this.detailError = errorMessage(e, 'No se pudo eliminar el borrador'); },
    });
  }

  requeuePost(id: string): void {
    if (this.postActionBusy) return;
    this.postActionBusy = id;
    this.service.requeuePost(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.postActionBusy = ''; this.notice = 'Artículo recuperado: nueva solicitud en cola y borrador bloqueado retirado'; if (this.detailOpen) this.closeDetail(); this.activeTab = 'topics'; this.refresh(); },
      error: (e) => { this.postActionBusy = ''; this.error = errorMessage(e, 'No se pudo recuperar el artículo'); this.detailError = this.error; },
    });
  }

  runnerProcessAction(action: 'start' | 'stop' | 'restart'): void {
    if (this.runnerBusy) return;
    this.runnerBusy = action;
    this.error = '';
    this.service.runnerProcess(action).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.runnerBusy = ''; this.notice = action === 'start' ? 'Runner iniciado' : action === 'stop' ? 'Runner detenido' : 'Runner reiniciado'; this.refresh(); },
      error: (e) => { this.runnerBusy = ''; this.error = errorMessage(e, `No se pudo ${action === 'start' ? 'iniciar' : action === 'stop' ? 'detener' : 'reiniciar'} el runner`); },
    });
  }

  toggleRunnerLogs(): void {
    if (this.runnerLogLines !== null) { this.runnerLogLines = null; return; }
    this.service.runnerLogs().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (logs) => { this.runnerLogLines = logs.lines; },
      error: (e) => { this.error = errorMessage(e, 'No se pudieron leer los registros del runner'); },
    });
  }

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
      next: () => { this.requestBusy = false; this.notice = 'Solicitud en cola; se ejecutará cuando el runner despierte'; this.request = emptyTopic(); this.seedUrlsText = ''; this.internalUrlsText = ''; this.activeTab = 'topics'; this.refresh(); },
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
