import { CommonModule } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import { Component, DestroyRef, ElementRef, EventEmitter, HostListener, OnDestroy, OnInit, Output, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Observable, catchError, concatMap, from, interval, map, of, throwError } from 'rxjs';
import {
  AdminEditorialService,
  EditorialOverview,
  EditorialPostDetail,
  EditorialPostSummary,
} from '../../../../../services/admin-editorial.service';
import { AdminConfirmDialogComponent } from '../../../components/admin-confirm-dialog/admin-confirm-dialog.component';
import { AdminStatusBadgeComponent } from '../../../components/admin-status-badge/admin-status-badge.component';

interface BulkResult { id: string; ok: boolean; error: string }

function errorMessage(e: any, fallback: string): string {
  const body = e?.error;
  return body?.error?.message || body?.message || (typeof body?.error === 'string' ? body.error : fallback);
}

/** The pipeline states the backend actually allows `POST /posts/:id/requeue` for (cf. EditorialOpsController.requeuePost). */
const RETRYABLE_STATES = ['blocked', 'requires-update', 'verified'];

@Component({
  selector: 'app-admin-rejected-inbox',
  standalone: true,
  imports: [CommonModule, FormsModule, A11yModule, AdminStatusBadgeComponent, AdminConfirmDialogComponent],
  templateUrl: './admin-rejected-inbox.component.html',
  styleUrl: './admin-rejected-inbox.component.scss',
})
export class AdminRejectedInboxComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();
  @ViewChild('drawer') private readonly drawer?: ElementRef<HTMLElement>;

  overview: EditorialOverview | null = null;
  loading = false;
  error = '';
  notice = '';
  selected = new Set<string>();
  busy = '';
  detail: EditorialPostDetail | null = null;
  detailOpen = false;
  detailLoading = false;
  detailError = '';
  editOpen = false;
  editBusy = false;
  editError = '';
  editNotice = '';
  editDraft: { title: string; excerpt: string; content: string; metaTitle: string; metaDescription: string } | null = null;
  deleteTarget: { id: string; title: string; version: number | null } | null = null;
  deleteBusy = false;
  bulkBusy: '' | 'requeue' | 'delete' = '';
  bulkResults: BulkResult[] = [];

  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(AdminEditorialService);

  ngOnInit(): void {
    this.load();
    interval(15000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => { if (!document.hidden && !this.loading) this.load(true); });
  }
  ngOnDestroy(): void { document.body.style.overflow = ''; }

  load(silent = false): void {
    if (!silent) this.loading = true;
    this.error = '';
    this.service.getOverview().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        let changed = false;
        for (const id of this.selected) {
          const previous = this.overview?.posts.find((post) => post.id === id);
          const current = data.posts.find((post) => post.id === id);
          if (!previous || !current || previous.version !== current.version || previous.status !== current.status) {
            this.selected.delete(id);
            changed = true;
          }
        }
        if (changed) this.notice = 'Se ha retirado la selección de artículos que cambiaron. Revísalos antes de continuar.';
        this.overview = data;
        this.loading = false;
        this.lastUpdatedChange.emit(new Date());
      },
      error: (e) => { this.loading = false; if (!silent) this.error = errorMessage(e, 'No se pudo cargar la bandeja de rechazados'); },
    });
  }

  isRejected(post: EditorialPostSummary): boolean {
    return post.reviewState === 'rejected' || ['blocked', 'requires-update', 'rejected'].includes(post.pipelineState);
  }
  canRetry(post: { status: string; pipelineState: string }): boolean {
    return post.status === 'draft' && RETRYABLE_STATES.includes(post.pipelineState);
  }
  /** The detail drawer keeps the ledger state in `provenance`, not in the post summary. */
  canRetryDetail(d: EditorialPostDetail): boolean {
    return this.canRetry({ status: d.post.status, pipelineState: d.provenance.state });
  }
  eligibilityTextDetail(d: EditorialPostDetail): string {
    return this.eligibilityText({ status: d.post.status, pipelineState: d.provenance.state });
  }
  get rejectedPosts(): EditorialPostSummary[] {
    return (this.overview?.posts ?? []).filter((post) => this.isRejected(post)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  /** Templates cannot hold arrow functions or assignments, so the bulk counter lives here. */
  get bulkOkCount(): number { return this.bulkResults.filter((r) => r.ok).length; }
  /** Plain-language reason a rejected draft can or cannot be re-run. */
  eligibilityText(post: { status: string; pipelineState: string }): string {
    if (post.status !== 'draft') return 'No es borrador; no se puede reintentar';
    if (RETRYABLE_STATES.includes(post.pipelineState)) return 'Elegible para reintento seguro';
    return `Estado «${post.pipelineState}» no reintentable`;
  }
  stateLabel(state: string | null | undefined): string {
    const labels: Record<string, string> = { blocked: 'Bloqueado', 'requires-update': 'Requiere actualización', verified: 'Revisión humana', rejected: 'Rechazado', draft: 'Borrador', publish: 'Publicado' };
    return labels[state || ''] || state || '—';
  }

  isSelected(id: string): boolean { return this.selected.has(id); }
  toggle(id: string): void { if (this.selected.has(id)) this.selected.delete(id); else this.selected.add(id); }
  get allSelected(): boolean { return this.rejectedPosts.length > 0 && this.rejectedPosts.every((p) => this.selected.has(p.id)); }
  toggleAll(): void {
    if (this.allSelected) this.rejectedPosts.forEach((p) => this.selected.delete(p.id));
    else this.rejectedPosts.forEach((p) => this.selected.add(p.id));
  }
  clearSelection(): void { this.selected.clear(); }

  openPost(id: string): void {
    this.detail = null;
    this.detailOpen = true;
    this.detailLoading = true;
    this.detailError = '';
    this.editOpen = false;
    document.body.style.overflow = 'hidden';
    this.service.getPost(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.detail = data;
        this.editDraft = { title: data.post.title, excerpt: data.post.excerpt, content: data.post.content, metaTitle: data.post.metaTitle, metaDescription: data.post.metaDescription };
        this.detailLoading = false;
        setTimeout(() => this.drawer?.nativeElement.querySelector('button')?.focus(), 0);
      },
      error: (e) => { this.detailLoading = false; this.detailError = errorMessage(e, 'No se pudo cargar el artículo'); },
    });
  }
  closeDetail(): void {
    this.detailOpen = false;
    this.detail = null;
    this.editOpen = false;
    this.editDraft = null;
    this.editNotice = '';
    this.detailError = '';
    document.body.style.overflow = '';
  }
  @HostListener('document:keydown.escape') onEscape(): void { if (this.detailOpen && !this.deleteTarget) this.closeDetail(); }

  startEdit(): void { this.editOpen = true; this.editError = ''; }
  cancelEdit(): void { if (this.editDraft && this.detail) this.editDraft.content = this.detail.post.content; this.editOpen = false; this.editError = ''; }
  saveEdit(): void {
    if (!this.detail || !this.editDraft || this.editBusy) return;
    this.editBusy = true;
    this.editError = '';
    this.editNotice = '';
    const id = this.detail.post.id;
    this.service.updatePost(id, { ...this.editDraft, expectedVersion: this.detail.version, expectedStatus: this.detail.post.status }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.editBusy = false;
        this.editOpen = false;
        this.notice = 'Borrador reescrito; vuelve a revisión sin aprobar';
        this.editNotice = 'Cambios guardados. El borrador sigue pendiente de revisión.';
        if (this.detailOpen && this.detail?.post.id === id) this.openPost(id);
        this.load(true);
      },
      error: (e) => { this.editBusy = false; this.editError = errorMessage(e, 'No se pudo guardar la reescritura'); },
    });
  }

  /** Reinvestigar + reintento seguro: re-encola el tema para una nueva ejecución completa con todos los controles. */
  requeue(id: string): void {
    if (this.busy) return;
    this.busy = id;
    this.error = '';
    this.service.requeuePost(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.busy = ''; this.selected.delete(id); this.notice = 'Artículo recuperado: nueva solicitud en cola y borrador bloqueado retirado'; this.closeDetail(); this.load(true); },
      error: (e) => { this.busy = ''; this.error = errorMessage(e, 'No se pudo recuperar el artículo'); },
    });
  }

  /** The confirmation only needs identity, so it accepts both the ledger summary and the drawer's post shape. */
  requestDelete(post: { id: string; title: string }): void {
    const summary = this.overview?.posts.find((p) => p.id === post.id);
    const version = this.detail?.post.id === post.id ? this.detail.version : summary?.version;
    if (version === undefined) { this.error = 'Vuelve a cargar el artículo antes de eliminarlo'; return; }
    this.deleteTarget = { ...post, version };
  }
  confirmDelete(): void {
    const id = this.deleteTarget?.id;
    if (!id || this.deleteBusy) return;
    this.deleteBusy = true;
    this.service.deletePost(id, this.deleteTarget!.version, 'draft').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.deleteBusy = false; this.deleteTarget = null; this.selected.delete(id); this.notice = 'Borrador eliminado'; this.closeDetail(); this.load(true); },
      error: (e) => { this.deleteBusy = false; this.deleteTarget = null; this.error = errorMessage(e, 'No se pudo eliminar el borrador'); if (this.detailOpen) this.detailError = this.error; },
    });
  }

  /** Bulk actions call the real single-item endpoints sequentially (no invented bulk endpoint). */
  bulkRequeue(): void {
    this.runBulk('requeue', [...this.selected], (id) => this.service.requeuePost(id), 'recuperados');
  }
  bulkDelete(): void {
    const posts = new Map((this.overview?.posts ?? []).map((post) => [post.id, post]));
    this.runBulk('delete', [...this.selected], (id) => {
      const post = posts.get(id);
      return post ? this.service.deletePost(id, post.version, 'draft') : throwError(() => new Error('Artículo no disponible; vuelve a cargar la lista'));
    }, 'eliminados');
  }
  private runBulk(kind: 'requeue' | 'delete', ids: string[], call: (id: string) => Observable<unknown>, verb: string): void {
    if (!ids.length || this.bulkBusy) return;
    this.bulkBusy = kind;
    this.bulkResults = [];
    this.error = '';
    from(ids).pipe(
      concatMap((id) => call(id).pipe(
        map(() => ({ id, ok: true, error: '' })),
        catchError((e) => of({ id, ok: false, error: errorMessage(e, 'Falló') })),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (result) => { this.bulkResults.push(result); },
      complete: () => {
        const ok = this.bulkResults.filter((r) => r.ok).length;
        this.bulkBusy = '';
        this.selected.clear();
        this.notice = `${ok} de ${this.bulkResults.length} ${verb}`;
        const failed = this.bulkResults.filter((r) => !r.ok);
        if (failed.length) this.error = `${failed.length} fallaron: ${failed.slice(0, 3).map((r) => `${r.id} (${r.error})`).join('; ')}`;
        this.load(true);
      },
    });
  }

  trackPost(_index: number, post: EditorialPostSummary): string { return post.id; }
}
