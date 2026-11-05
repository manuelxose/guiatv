import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../environments/environment';

/**
 * Centro de control SEO (/admin/seo). La autorización se adjunta globalmente por el
 * interceptor; el rol de administrador se exige en el servidor. Ninguna respuesta
 * afirma que una página está indexada por haber enviado un sitemap.
 */

export type SeoIssueState = 'open' | 'applied' | 'dismissed';
export type SeoSeverity = 'high' | 'medium' | 'low';

export interface SeoUrlRow {
  url: string;
  slug: string | null;
  contentType: string;
  publishedAt: string | null;
  intendedIndexable: boolean;
  state: string;
  lastInspectedAt: string | null;
  inSitemap: boolean;
  declaredCanonical: string | null;
  googleCanonical: string | null;
  robotsDirective: string | null;
  issueCodes: string[];
  actions: string[];
  nextInspectionAt: string | null;
}

export interface SeoIssue {
  id: string;
  code: string;
  severity: SeoSeverity;
  evidence: string;
  urls: string[];
  detectedAt: string;
  proposedAction: string;
  automationEligible: boolean;
  automationKind?: string;
  state: SeoIssueState;
  appliedAt: string | null;
  dismissedAt: string | null;
  recheck: { scheduledAt: string; result: string; checkedAt: string | null } | null;
}

export interface SeoSummary {
  total: number;
  indexable: number;
  indexed: number;
  byState: Record<string, number>;
  byType: Record<string, number>;
  openIssues: number;
  bySeverity: Record<string, number>;
}

export interface SeoPage { rows: SeoUrlRow[]; total: number; page: number; pageSize: number; pages: number; }
export interface SeoAudit { issues: SeoIssue[]; urls: number; }
export interface SeoExport { rows: SeoUrlRow[]; exportedAt: string; }

interface Envelope<T> { success: boolean; data: T; meta?: Record<string, unknown>; }

@Injectable({ providedIn: 'root' })
export class AdminSeoService {
  private readonly base = `${environment.API_BASE_URL}/admin/seo`;

  constructor(private readonly http: HttpClient) {}

  indexation(query: Record<string, string | number | boolean | undefined> = {}): Observable<SeoPage> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v));
    const suffix = params.toString();
    return this.http
      .get<Envelope<SeoUrlRow[]>>(`${this.base}/indexation${suffix ? `?${suffix}` : ''}`)
      .pipe(map((r) => ({
        rows: r.data,
        total: Number(r.meta?.total ?? r.data.length),
        page: Number(r.meta?.page ?? 1),
        pageSize: Number(r.meta?.pageSize ?? r.data.length),
        pages: Number(r.meta?.pages ?? 1),
      })));
  }

  summary(): Observable<SeoSummary> {
    return this.http.get<Envelope<SeoSummary>>(`${this.base}/indexation/summary`).pipe(map((r) => r.data));
  }

  inspect(urls: string[]): Observable<{ inspected: number; errors: number; results: Array<{ url: string; state: string; error: string | null }> }> {
    return this.http.post<Envelope<{ inspected: number; errors: number; results: Array<{ url: string; state: string; error: string | null }> }>>(`${this.base}/indexation/inspect`, { urls }).pipe(map((r) => r.data));
  }

  schedule(urls: string[], at: string): Observable<{ scheduled: number }> {
    return this.http.post<Envelope<{ scheduled: number }>>(`${this.base}/indexation/schedule`, { urls, at }).pipe(map((r) => r.data));
  }

  issues(state?: SeoIssueState): Observable<SeoIssue[]> {
    const suffix = state ? `?state=${state}` : '';
    return this.http.get<Envelope<SeoIssue[]>>(`${this.base}/issues${suffix}`).pipe(map((r) => r.data));
  }

  apply(id: string, note: string): Observable<SeoIssue> {
    return this.http.post<Envelope<SeoIssue>>(`${this.base}/issues/${encodeURIComponent(id)}/apply`, { note }).pipe(map((r) => r.data));
  }

  dismiss(id: string): Observable<SeoIssue> {
    return this.http.post<Envelope<SeoIssue>>(`${this.base}/issues/${encodeURIComponent(id)}/dismiss`, {}).pipe(map((r) => r.data));
  }

  audit(): Observable<SeoAudit> {
    return this.http.post<Envelope<SeoAudit>>(`${this.base}/audit`, {}).pipe(map((r) => r.data));
  }

  exportCsv(): Observable<SeoExport> {
    return this.http.get<Envelope<SeoExport>>(`${this.base}/export`).pipe(map((r) => r.data));
  }
}
