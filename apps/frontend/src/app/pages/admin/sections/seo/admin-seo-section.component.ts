import { CommonModule } from '@angular/common';
import { Component, DestroyRef, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminSeoService, SeoIssue, SeoPage, SeoSummary, SeoUrlRow, SeoSeverity,
} from './admin-seo.service';

const STATE_LABELS: Record<string, string> = {
  indexed: 'Indexada', blocked: 'Bloqueada', 'fetch-error': 'Error de rastreo',
  'alternate-canonical': 'Canonical alternativo', 'crawled-not-indexed': 'Rastreada, sin indexar',
  'discovered-not-indexed': 'Descubierta, sin indexar', 'not-discovered': 'No descubierta',
  'insufficient-evidence': 'Sin evidencia', unobserved: 'Sin inspección',
};

const SEVERITY_LABELS: Record<SeoSeverity, string> = { high: 'Alta', medium: 'Media', low: 'Baja' };

@Component({
  selector: 'app-admin-seo-section',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-seo-section.component.html',
  styleUrl: './admin-seo-section.component.scss',
})
export class AdminSeoSectionComponent implements OnInit {
  @Input() activeItem = 'indexation';
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  readonly stateLabels = STATE_LABELS;
  readonly severityLabels = SEVERITY_LABELS;
  readonly stateOptions = Object.entries(STATE_LABELS).map(([value, label]) => ({ value, label }));

  tab: 'indexation' | 'issues' = 'indexation';
  summary: SeoSummary | null = null;
  page: SeoPage = { rows: [], total: 0, page: 1, pageSize: 25, pages: 1 };
  issues: SeoIssue[] = [];
  loading = false;
  error = '';
  notice = '';
  busy = '';

  q = '';
  state = '';
  indexable = '';
  hasIssues = '';
  sort: 'url' | 'publishedAt' | 'state' | 'lastInspectedAt' = 'publishedAt';
  dir: 'asc' | 'desc' = 'desc';
  selected = new Set<string>();
  applyNote: Record<string, string> = {};

  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(AdminSeoService);

  ngOnInit(): void {
    this.load();
  }

  get allSelected(): boolean {
    return this.page.rows.length > 0 && this.page.rows.every((r) => this.selected.has(r.url));
  }

  private err(e: unknown, fallback: string): string {
    const b = (e as { error?: { error?: { message?: string }; message?: string } })?.error;
    return b?.error?.message || b?.message || fallback;
  }

  load(silent = false): void {
    if (!silent) this.loading = true;
    this.error = '';
    this.service.summary().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (s) => { this.summary = s; this.lastUpdatedChange.emit(new Date()); },
      error: (e) => { if (!silent) this.error = this.err(e, 'No se pudo cargar el resumen SEO'); },
    });
    this.loadIndexation(silent);
    this.loadIssues(silent);
  }

  loadIndexation(silent = false): void {
    this.service.indexation({
      q: this.q, state: this.state, indexable: this.indexable, hasIssues: this.hasIssues,
      sort: this.sort, dir: this.dir, page: this.page.page, pageSize: this.page.pageSize,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (p) => { this.page = p; if (!silent) this.loading = false; this.selected.clear(); },
      error: (e) => { if (!silent) { this.loading = false; this.error = this.err(e, 'No se pudo cargar la cuadrícula'); } },
    });
  }

  loadIssues(silent = false): void {
    this.service.issues().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (list) => { this.issues = list; },
      error: () => { if (!silent) this.error = 'No se pudieron cargar las incidencias'; },
    });
  }

  applyFilters(): void { this.page.page = 1; this.loadIndexation(); }
  resetFilters(): void { this.q = ''; this.state = ''; this.indexable = ''; this.hasIssues = ''; this.applyFilters(); }

  sortBy(field: 'url' | 'publishedAt' | 'state' | 'lastInspectedAt'): void {
    if (this.sort === field) this.dir = this.dir === 'asc' ? 'desc' : 'asc';
    else { this.sort = field; this.dir = 'desc'; }
    this.loadIndexation();
  }

  setPage(p: number): void {
    if (p < 1 || p > this.page.pages) return;
    this.page.page = p;
    this.loadIndexation();
  }

  toggleSelect(url: string): void {
    this.selected.has(url) ? this.selected.delete(url) : this.selected.add(url);
  }
  toggleSelectAll(): void {
    if (this.allSelected) this.page.rows.forEach((r) => this.selected.delete(r.url));
    else this.page.rows.forEach((r) => this.selected.add(r.url));
  }

  inspectSelected(): void {
    if (!this.selected.size || this.busy) return;
    this.busy = 'inspect';
    this.service.inspect([...this.selected]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (r) => {
        this.busy = '';
        this.notice = `Inspección finalizada: ${r.inspected} inspeccionadas, ${r.errors} con error. Los datos provienen de Google, no de un sitemap.`;
        this.load(true);
      },
      error: (e) => { this.busy = ''; this.error = this.err(e, 'No se pudo inspeccionar'); },
    });
  }

  scheduleSelected(): void {
    if (!this.selected.size || this.busy) return;
    this.busy = 'schedule';
    const at = new Date(Date.now() + 24 * 3600e3).toISOString();
    this.service.schedule([...this.selected], at).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (r) => { this.busy = ''; this.notice = `${r.scheduled} URL(s) programadas para reinspección.`; this.load(true); },
      error: (e) => { this.busy = ''; this.error = this.err(e, 'No se pudo programar'); },
    });
  }

  runAudit(): void {
    if (this.busy) return;
    this.busy = 'audit';
    this.service.audit().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (r) => { this.busy = ''; this.notice = `Auditoría técnica finalizada: ${r.urls} URL(s), ${r.issues.length} incidencia(s).`; this.load(true); },
      error: (e) => { this.busy = ''; this.error = this.err(e, 'No se pudo ejecutar la auditoría'); },
    });
  }

  exportCsv(): void {
    this.service.exportCsv().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (r) => {
        const head = ['url', 'slug', 'contentType', 'publishedAt', 'state', 'inSitemap', 'declaredCanonical', 'googleCanonical', 'robotsDirective', 'issueCodes'];
        const rows = r.rows.map((x) => [x.url, x.slug ?? '', x.contentType, x.publishedAt ?? '', x.state, String(x.inSitemap), x.declaredCanonical ?? '', x.googleCanonical ?? '', x.robotsDirective ?? '', x.issueCodes.join(';')]);
        const csv = [head, ...rows].map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `seo-indexation-${r.exportedAt.slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
        this.notice = 'Exportación CSV generada.';
      },
      error: (e) => { this.error = this.err(e, 'No se pudo exportar'); },
    });
  }

  applyIssue(id: string): void {
    if (this.busy) return;
    this.busy = id;
    this.service.apply(id, this.applyNote[id] ?? '').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (issue) => { this.busy = ''; this.notice = issue.automationEligible ? 'Corrección segura aplicada; reinspección programada.' : 'Incidencia marcada como aplicada; reinspección programada.'; this.load(true); },
      error: (e) => { this.busy = ''; this.error = this.err(e, 'No se pudo aplicar la corrección'); },
    });
  }

  dismissIssue(id: string): void {
    if (this.busy) return;
    this.busy = id;
    this.service.dismiss(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.busy = ''; this.notice = 'Incidencia descartada.'; this.load(true); },
      error: (e) => { this.busy = ''; this.error = this.err(e, 'No se pudo descartar la incidencia'); },
    });
  }

  stateClass(state: string): string {
    return state === 'indexed' ? 'ok' : state === 'blocked' || state === 'fetch-error' ? 'bad' : 'warn';
  }

  trackUrl(_: number, row: SeoUrlRow): string { return row.url; }
  trackIssue(_: number, issue: SeoIssue): string { return issue.id; }
}
