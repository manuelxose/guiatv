import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, OnDestroy, OnInit, Output } from '@angular/core';
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

@Component({
  selector: 'app-admin-job-ledger',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-job-ledger.component.html',
  styleUrl: './admin-job-ledger.component.scss',
})
export class AdminJobLedgerComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();
  readonly stateLabels = STATE_LABELS;
  readonly stageLabels = STAGE_LABELS;
  readonly states = Object.keys(STATE_LABELS) as EditorialLedgerState[];
  readonly pageSize = 25;

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

  private subs = new Subscription();
  private readonly search$ = new Subject<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly service: AdminEditorialService) {}

  ngOnInit(): void {
    this.subs.add(this.search$.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => this.load()));
    this.load();
    this.timer = setInterval(() => this.load(true), 15_000);
  }
  ngOnDestroy(): void {
    this.subs.unsubscribe();
    if (this.timer) clearInterval(this.timer);
  }

  /** WCAG 2.2: Escape closes the topmost layer without trapping focus. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.pending) this.cancelPending();
    else if (this.detailOpen) this.closeDetail();
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

  onSearch(): void { this.search$.next(this.q); }
  applyFilters(): void { this.page.skip = 0; this.load(); }
  clearFilters(): void { this.q = ''; this.state = ''; this.archived = '0'; this.stale = false; this.page.skip = 0; this.load(); }

  get from(): number { return this.page.total ? this.page.skip + 1 : 0; }
  get to(): number { return Math.min(this.page.skip + this.page.items.length, this.page.total); }
  nextPage(): void { if (this.to < this.page.total) { this.page.skip += this.pageSize; this.load(); } }
  prevPage(): void { if (this.page.skip > 0) { this.page.skip = Math.max(0, this.page.skip - this.pageSize); this.load(); } }

  isSelected(jobId: string): boolean { return this.selected.has(jobId); }
  toggle(jobId: string): void { this.selected.has(jobId) ? this.selected.delete(jobId) : this.selected.add(jobId); }
  get allSelected(): boolean { return this.page.items.length > 0 && this.page.items.every((job) => this.selected.has(job.jobId)); }
  toggleAll(): void {
    if (this.allSelected) this.page.items.forEach((job) => this.selected.delete(job.jobId));
    else this.page.items.forEach((job) => this.selected.add(job.jobId));
  }
  clearSelection(): void { this.selected.clear(); }

  can(action: LedgerAction, job: EditorialLedgerJob): boolean {
    const terminal = ['completed', 'failed', 'cancelled', 'dead-letter', 'blocked'].includes(job.state);
    switch (action) {
      case 'pause': return ['queued', 'running'].includes(job.state) && !job.pauseRequested;
      case 'resume': return job.state === 'paused';
      case 'cancel': return !terminal && job.state !== 'cancelling';
      case 'retry': return terminal && !job.archivedAt && job.attempt < job.maxAttempts;
      case 'recover': return ['running', 'cancelling'].includes(job.state) && !this.leaseLive(job);
      case 'archive': return terminal && !job.archivedAt;
      case 'delete': return terminal && Boolean(job.archivedAt);
    }
  }

  ask(action: LedgerAction, job?: EditorialLedgerJob): void {
    const ids = job ? [job.jobId] : [...this.selected];
    if (!ids.length) return;
    const label = {
      pause: 'Pausar', resume: 'Reanudar', cancel: 'Cancelar', retry: 'Reintentar', recover: 'Recuperar', archive: 'Archivar', delete: 'Borrar metadatos',
    }[action];
    this.pending = {
      action, ids, needsReason: action === 'cancel',
      title: ids.length === 1 ? `${label} «${job?.slug ?? ids[0]}»` : `${label} ${ids.length} trabajos seleccionados`,
    };
    this.pendingReason = '';
  }

  cancelPending(): void { if (!this.pendingBusy) { this.pending = null; this.pendingReason = ''; } }

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
    this.detail = job;
    this.detailOpen = true;
    this.refreshDetail();
  }
  closeDetail(): void { this.detailOpen = false; this.detail = null; }
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
