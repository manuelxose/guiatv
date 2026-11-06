import { CommonModule } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import { Component, ElementRef, EventEmitter, HostListener, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, debounceTime, distinctUntilChanged } from 'rxjs';
import {
  AdminEditorialService,
  EditorialLedgerBulkResult,
  EditorialLedgerJob,
  EditorialLedgerPage,
  EditorialLedgerStageName,
  EditorialLedgerState,
} from '../../../../../services/admin-editorial.service';

type LedgerAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'recover' | 'archive' | 'delete';
type Pending = { action: LedgerAction; ids: string[]; title: string; needsReason: boolean };
type SortKey = 'slug' | 'state' | 'usd' | 'attempt' | 'updatedAt';

const STATE_LABELS: Record<EditorialLedgerState, string> = {
  queued: 'En cola', running: 'Ejecutando', paused: 'Pausado', cancelling: 'Cancelando',
  cancelled: 'Cancelado', completed: 'Completado', failed: 'Fallido', 'dead-letter': 'Sin reintentos', blocked: 'Bloqueado',
};
const STAGE_LABELS: Record<EditorialLedgerStageName, string> = {
  'topic-selection': 'Selección de tema', 'source-discovery': 'Descubrimiento de fuentes', 'source-retrieval': 'Lectura de fuentes',
  'evidence-validation': 'Validación de evidencias', 'research-synthesis': 'Síntesis de investigación', 'editorial-outline': 'Esquema editorial',
  'article-drafting': 'Redacción', 'seo-enrichment': 'SEO y metadatos', 'quality-evaluation': 'Evaluación de calidad',
  revision: 'Revisión', 'publication-eligibility': 'Elegibilidad de publicación', publication: 'Publicación', 'sitemap-registration': 'Sitemap',
};

/** Bulk actions are capped server-side; select-all is only offered when it is safe. */
const MAX_BULK = 50;

@Component({
  selector: 'app-admin-job-ledger',
  standalone: true,
  imports: [CommonModule, FormsModule, A11yModule],
  templateUrl: './admin-job-ledger.component.html',
  styleUrl: './admin-job-ledger.component.scss',
})
export class AdminJobLedgerComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();
  readonly stateLabels = STATE_LABELS;
  readonly stageLabels = STAGE_LABELS;
  readonly states = Object.keys(STATE_LABELS) as EditorialLedgerState[];
  readonly pageSize = 25;
  readonly maxBulk = MAX_BULK;
  readonly sortableColumns: Array<{ key: SortKey; label: string }> = [
    { key: 'slug', label: 'Trabajo' },
    { key: 'state', label: 'Estado' },
    { key: 'attempt', label: 'Intento' },
    { key: 'usd', label: 'Coste' },
    { key: 'updatedAt', label: 'Actualizado' },
  ];

  page: EditorialLedgerPage = { items: [], total: 0, limit: this.pageSize, skip: 0 };
  loading = false;
  error = '';
  notice = '';
  q = '';
  state = '';
  archived: '' | '1' | '0' = '0';
  stale = false;
  selected = new Set<string>();
  busy = '';
  detail: EditorialLedgerJob | null = null;
  detailOpen = false;
  detailLoading = false;
  pending: Pending | null = null;
  pendingReason = '';
  pendingBusy = false;
  lastUpdated: Date | null = null;
  sortKey: SortKey = 'updatedAt';
  sortDir: 'asc' | 'desc' = 'desc';

  private subs = new Subscription();
  /** Element that opened the current modal layer; focus returns here when the layer closes (WCAG 2.4.3). */
  private returnFocus: HTMLElement | null = null;
  private readonly search$ = new Subject<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly service: AdminEditorialService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.subs.add(this.search$.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => this.load()));
    this.syncFromUrl();
    this.load();
    this.timer = setInterval(() => this.load(true), 15_000);
    // Deep links and back/forward: apply only a real change so a write never reloads itself.
    this.subs.add(this.route.queryParamMap.subscribe(() => {
      if (this.syncFromUrl()) this.load();
    }));
  }
  ngOnDestroy(): void {
    this.subs.unsubscribe();
    if (this.timer) clearInterval(this.timer);
    document.body.style.overflow = '';
  }

  /** WCAG 2.2: Escape closes the topmost layer without trapping focus. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.pending) this.cancelPending();
    else if (this.detailOpen) this.closeDetail();
  }

  /** The element that opened a modal layer receives focus again when that layer closes (WCAG 2.4.3). */
  private rememberFocus(): void {
    const active = document.activeElement;
    this.returnFocus = active instanceof HTMLElement ? active : null;
  }
  private restoreFocus(): void {
    const target = this.returnFocus;
    this.returnFocus = null;
    target?.focus?.();
  }

  /** Reflect the URL state/q/skip/archived/stale into the component. Returns true when something changed. */
  private syncFromUrl(): boolean {
    const params = this.route.snapshot.queryParamMap;
    const state = params.get('state') || '';
    const q = params.get('q') || '';
    const archivedRaw = params.get('archived');
    const archived: '' | '1' | '0' = archivedRaw === '1' ? '1' : archivedRaw === '' ? '' : '0';
    const stale = params.get('stale') === '1';
    const skip = Math.max(0, Number(params.get('skip')) || 0);
    const validState = state && (this.states as string[]).includes(state) ? state : '';
    const changed =
      validState !== this.state || q !== this.q || archived !== this.archived ||
      stale !== this.stale || skip !== this.page.skip;
    if (changed) {
      this.state = validState;
      this.q = q;
      this.archived = archived;
      this.stale = stale;
      this.page.skip = skip;
    }
    return changed;
  }

  /** Write the current filters and page back to the URL so a view can be linked and shared. */
  private writeUrl(): void {
    const queryParams: Record<string, string | null> = {
      state: this.state || null,
      q: this.q.trim() || null,
      archived: this.archived === '0' ? null : this.archived,
      stale: this.stale ? '1' : null,
      skip: this.page.skip > 0 ? String(this.page.skip) : null,
    };
    this.router.navigate([], { queryParams, queryParamsHandling: 'merge', replaceUrl: true }).catch(() => undefined);
  }

  load(silent = false): void {
    if (!silent) this.loading = true;
    this.error = '';
    this.subs.add(this.service.getLedger({
      states: this.state || undefined,
      q: this.q.trim() || undefined,
      archived: this.archived === '' ? undefined : this.archived === '1',
      stale: this.stale,
      limit: this.pageSize,
      skip: this.page.skip,
    }).subscribe({
      next: (page) => {
        this.page = page;
        this.loading = false;
        this.lastUpdated = new Date();
        this.lastUpdatedChange.emit(this.lastUpdated);
        if (this.detailOpen && this.detail) this.refreshDetail();
      },
      error: (e) => {
        this.loading = false;
        this.error = e?.error?.error?.message || e?.error?.message || 'No se pudo cargar el registro de trabajos';
      },
    }));
  }

  onSearch(): void { this.search$.next(this.q); this.writeUrl(); }
  applyFilters(): void { this.page.skip = 0; this.writeUrl(); this.load(); }
  clearFilters(): void { this.q = ''; this.state = ''; this.archived = '0'; this.stale = false; this.page.skip = 0; this.writeUrl(); this.load(); }

  get from(): number { return this.page.total ? this.page.skip + 1 : 0; }
  get to(): number { return Math.min(this.page.skip + this.page.items.length, this.page.total); }
  nextPage(): void { if (this.to < this.page.total) { this.page.skip += this.pageSize; this.writeUrl(); this.load(); } }
  prevPage(): void { if (this.page.skip > 0) { this.page.skip = Math.max(0, this.page.skip - this.pageSize); this.writeUrl(); this.load(); } }

  /** Client-side sort of the loaded page; a server-side sort needs a backend parameter (out of scope). */
  get sortedItems(): EditorialLedgerJob[] {
    const dir = this.sortDir === 'asc' ? 1 : -1;
    return [...this.page.items].sort((a, b) => {
      switch (this.sortKey) {
        case 'slug': return a.slug.localeCompare(b.slug) * dir;
        case 'state': return a.state.localeCompare(b.state) * dir;
        case 'usd': return (a.usage.usd - b.usage.usd) * dir;
        case 'attempt': return (a.attempt - b.attempt) * dir;
        default: return (Date.parse(a.updatedAt) - Date.parse(b.updatedAt)) * dir;
      }
    });
  }
  toggleSort(key: SortKey): void {
    if (this.sortKey === key) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.sortKey = key; this.sortDir = 'desc'; }
  }
  sortAria(key: SortKey): 'ascending' | 'descending' | 'none' {
    return this.sortKey === key ? (this.sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  }

  /** Export the loaded page as CSV. A full-history export would need a backend endpoint (out of scope). */
  exportCsv(): void {
    const header = ['jobId', 'slug', 'kind', 'state', 'currentStage', 'attempt', 'maxAttempts', 'worker', 'usd', 'modelCalls', 'inputTokens', 'outputTokens', 'createdAt', 'startedAt', 'endedAt', 'archivedAt', 'error'];
    const lines = this.sortedItems.map((job) => [
      job.jobId, job.slug, job.kind, job.state, job.currentStage ?? '', String(job.attempt), String(job.maxAttempts),
      job.worker?.id ?? '', String(job.usage.usd), String(job.usage.modelCalls), String(job.usage.inputTokens), String(job.usage.outputTokens),
      job.createdAt, job.startedAt ?? '', job.endedAt ?? '', job.archivedAt ?? '', job.error ? `${job.error.classification}: ${job.error.message}` : '',
    ]);
    const csv = [header.join(','), ...lines.map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `trabajos-editoriales-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  isSelected(jobId: string): boolean { return this.selected.has(jobId); }
  toggle(jobId: string): void {
    if (this.selected.has(jobId)) this.selected.delete(jobId);
    else this.selected.add(jobId);
  }
  get allSelected(): boolean { return this.page.items.length > 0 && this.page.items.every((job) => this.selected.has(job.jobId)); }
  toggleAll(): void {
    if (this.allSelected) this.page.items.forEach((job) => this.selected.delete(job.jobId));
    else this.page.items.forEach((job) => this.selected.add(job.jobId));
  }
  clearSelection(): void { this.selected.clear(); }

  /** Select every matching result, but only when the bulk cap makes it safe. */
  selectAllMatching(): void {
    if (this.page.total > MAX_BULK) {
      this.error = `No se pueden seleccionar más de ${MAX_BULK} trabajos a la vez (hay ${this.page.total} coincidencias). Refina los filtros para una selección segura.`;
      return;
    }
    if (!this.page.total) return;
    this.busy = 'select-all';
    this.subs.add(this.service.getLedger({
      states: this.state || undefined,
      q: this.q.trim() || undefined,
      archived: this.archived === '' ? undefined : this.archived === '1',
      stale: this.stale,
      limit: this.page.total,
      skip: 0,
    }).subscribe({
      next: (page) => {
        page.items.forEach((job) => this.selected.add(job.jobId));
        this.busy = '';
        this.notice = `${page.items.length} trabajos seleccionados (todos los que coinciden).`;
      },
      error: (e) => {
        this.busy = '';
        this.error = e?.error?.error?.message || e?.error?.message || 'No se pudieron seleccionar todos los resultados';
      },
    }));
  }

  can(action: LedgerAction, job: EditorialLedgerJob): boolean {
    const terminal = ['completed', 'failed', 'cancelled', 'dead-letter', 'blocked'].includes(job.state);
    switch (action) {
      case 'pause': return ['queued', 'running'].includes(job.state) && !job.pauseRequested;
      case 'resume': return job.state === 'paused';
      case 'cancel': return !terminal && job.state !== 'cancelling';
      case 'retry': return terminal && !job.archivedAt && job.attempt < job.maxAttempts;
      case 'recover': return ['running', 'cancelling'].includes(job.state) && !this.leaseLive(job);
      case 'archive': return terminal && !job.archivedAt;
      case 'delete': return terminal && !job.publication;
    }
  }

  ask(action: LedgerAction, job?: EditorialLedgerJob): void {
    const ids = job ? [job.jobId] : [...this.selected];
    if (!ids.length) return;
    this.rememberFocus();
    document.body.style.overflow = 'hidden';
    const label = {
      pause: 'Pausar', resume: 'Reanudar', cancel: 'Cancelar', retry: 'Reintentar', recover: 'Recuperar', archive: 'Archivar', delete: 'Borrar metadatos',
    }[action];
    this.pending = {
      action, ids, needsReason: action === 'cancel',
      title: ids.length === 1 ? `${label} «${job?.slug ?? ids[0]}»` : `${label} ${ids.length} trabajos seleccionados`,
    };
    this.pendingReason = '';
  }

  cancelPending(): void {
    if (this.pendingBusy) return;
    this.pending = null;
    this.pendingReason = '';
    if (!this.detailOpen) document.body.style.overflow = '';
    this.restoreFocus();
  }

  confirmPending(): void {
    if (!this.pending || this.pendingBusy) return;
    if (this.pending.needsReason && !this.pendingReason.trim()) return;
    this.pendingBusy = true;
    this.error = '';
    this.notice = '';
    const { action, ids } = this.pending;
    const done = (message: string) => {
      this.pendingBusy = false;
      this.pending = null;
      this.notice = message;
      // The row may have been re-rendered: the opener cannot be restored, so the announcement region takes focus.
      this.restoreFocus();
      this.load(true);
      if (this.detailOpen) this.refreshDetail();
    };
    const failedWith = (e: any) => {
      this.pendingBusy = false;
      this.error = e?.error?.error?.message || e?.error?.message || 'La acción no se pudo aplicar';
    };
    if (ids.length === 1) {
      this.subs.add(this.service.ledgerAction(ids[0], action, { reason: this.pendingReason.trim(), force: false }).subscribe({
        next: () => {
          if (action === 'delete' || action === 'archive') this.selected.clear();
          done(`Acción «${action}» aplicada.`);
        },
        error: failedWith,
      }));
      return;
    }
    this.subs.add(this.service.ledgerBulk(action, ids, this.pendingReason.trim()).subscribe({
      next: (result) => {
        this.reportBulk(result);
        if (action === 'delete' || action === 'archive') this.selected.clear();
        else this.selected = new Set(result.results.filter((row) => !row.ok).map((row) => row.jobId));
        done(this.notice);
      },
      error: failedWith,
    }));
  }

  private reportBulk(result: EditorialLedgerBulkResult): void {
    this.notice = `${result.succeeded} de ${result.succeeded + result.failed} trabajos actualizados`;
    const failed = result.results.filter((row) => !row.ok);
    if (failed.length) this.error = `${failed.length} no se pudieron actualizar: ${failed.slice(0, 3).map((row) => `${row.jobId} (${row.error})`).join('; ')}`;
  }

  runRecovery(): void {
    if (this.busy) return;
    this.busy = 'recover-stale';
    this.error = '';
    this.subs.add(this.service.recoverStaleLedger().subscribe({
      next: (result) => {
        this.busy = '';
        this.notice = result.count ? `${result.count} trabajos con lease expirado recuperados.` : 'No hay leases expirados que recuperar.';
        this.load(true);
      },
      error: (e) => { this.busy = ''; this.error = e?.error?.error?.message || e?.error?.message || 'No se pudo recuperar los leases'; },
    }));
  }

  openDetail(job: EditorialLedgerJob): void {
    this.rememberFocus();
    document.body.style.overflow = 'hidden';
    this.detail = job;
    this.detailOpen = true;
    this.refreshDetail();
  }
  closeDetail(): void {
    this.detailOpen = false;
    this.detail = null;
    if (!this.pending) document.body.style.overflow = '';
    this.restoreFocus();
  }
  private refreshDetail(): void {
    if (!this.detail) return;
    this.detailLoading = true;
    this.subs.add(this.service.getLedgerJob(this.detail.jobId).subscribe({
      next: (job) => { this.detail = job; this.detailLoading = false; },
      error: () => { this.detailLoading = false; },
    }));
  }

  leaseLive(job: EditorialLedgerJob): boolean { return Boolean(job.lease && Date.parse(job.lease.expiresAt) > Date.now()); }
  leaseText(job: EditorialLedgerJob): string {
    if (!job.lease) return '-';
    if (!this.leaseLive(job)) return 'Expirado';
    const seconds = Math.max(0, Math.round((Date.parse(job.lease.expiresAt) - Date.now()) / 1000));
    return `${seconds}s`;
  }
  duration(job: EditorialLedgerJob): string {
    const start = job.startedAt ? Date.parse(job.startedAt) : Date.parse(job.createdAt);
    const end = job.endedAt ? Date.parse(job.endedAt) : Date.now();
    const seconds = Math.max(0, Math.round((end - start) / 1000));
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }
  stageDuration(stage: { startedAt: string; endedAt: string | null }): string {
    const seconds = Math.max(0, Math.round(((stage.endedAt ? Date.parse(stage.endedAt) : Date.now()) - Date.parse(stage.startedAt)) / 1000));
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }
  badgeClass(state: string): string { return `state-${state}`; }
  stageClass(state: string): string { return `stage-${state}`; }
  shortJob(jobId: string): string { return jobId.length > 26 ? `${jobId.slice(0, 25)}…` : jobId; }
  stageLabel(name: EditorialLedgerStageName | null): string { return name ? this.stageLabels[name] : ''; }
  trackJob(_index: number, job: EditorialLedgerJob): string { return job.jobId; }
}
