import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApiResponse } from '@app/api/models';
import { environment } from '../../../../environments/environment';
import {
  AdminApiError,
  FootballAdminMatchDTO,
  FootballAdminMatchesDTO,
  FootballAuditDTO,
  FootballAuditQuery,
  FootballBroadcastsDTO,
  FootballCoverageMatrixDTO,
  FootballDashboardDTO,
  FootballEntityMappingsDTO,
  FootballIngestionStatusDTO,
  FootballMatchListQuery,
  FootballProviderDetailDTO,
  FootballProviderSummaryDTO,
  FootballQualityIssuesDTO,
  FootballSyncOperationsDTO,
  FootballSyncResultDTO,
  PagedQuery,
} from './football-admin.models';

/** Admin read API base (t7). Same-origin; the BFF routes it to the internal admin controller. */
const ADMIN_API_BASE = '/v2/sports/football/admin';

/** Query accepted by the entity-mappings and broadcasts list endpoints (page/limit + free-text q). */
type SearchListQuery = PagedQuery & { q?: string };

/**
 * Single strongly typed client over the t7 football admin API
 * (`/v2/sports/football/admin/*`). Every method returns a typed DTO; every
 * failure is normalized into an {@link AdminApiError} so the eight sections
 * can render honest unauthorized/validation/unavailable states instead of
 * a generic error or a fabricated empty array.
 *
 * Authentication reuses the real admin session the way AdminOperationsService
 * does (the `gtv_id_token` from localStorage) — the shared `ANALYTICS_ADMIN_KEY`
 * is a server secret and is NEVER embedded in the browser bundle.
 */
@Injectable({ providedIn: 'root' })
export class FootballAdminDataService {
  private readonly baseUrl = `${environment.API_BASE_URL}${ADMIN_API_BASE}`;
  private readonly isBrowser = typeof window !== 'undefined';

  constructor(private readonly http: HttpClient) {}

  // ── Read endpoints ──────────────────────────────────────────────────────

  getDashboard(): Observable<FootballDashboardDTO> {
    return this.get<FootballDashboardDTO>('/dashboard');
  }

  getProviders(): Observable<FootballProviderSummaryDTO[]> {
    return this.get<{ providers: FootballProviderSummaryDTO[] }>('/providers').pipe(map((r) => r.providers));
  }

  getProvider(provider: string): Observable<FootballProviderDetailDTO> {
    return this.get<FootballProviderDetailDTO>(`/providers/${encodeURIComponent(provider)}`);
  }

  getCoverage(): Observable<FootballCoverageMatrixDTO> {
    return this.get<FootballCoverageMatrixDTO>('/coverage');
  }

  getMatches(query: FootballMatchListQuery = {}): Observable<FootballAdminMatchesDTO> {
    return this.get<FootballAdminMatchesDTO>('/matches', query);
  }

  getMatch(idOrSlug: string): Observable<FootballAdminMatchDTO> {
    return this.get<FootballAdminMatchDTO>(`/matches/${encodeURIComponent(idOrSlug)}`);
  }

  getEntityMappings(query: SearchListQuery = {}): Observable<FootballEntityMappingsDTO> {
    return this.get<FootballEntityMappingsDTO>('/entity-mappings', query);
  }

  getBroadcasts(query: SearchListQuery = {}): Observable<FootballBroadcastsDTO> {
    return this.get<FootballBroadcastsDTO>('/broadcasts', query);
  }

  getIngestionStatus(): Observable<FootballIngestionStatusDTO> {
    return this.get<FootballIngestionStatusDTO>('/ingestion/status');
  }

  getQualityIssues(query: PagedQuery = {}): Observable<FootballQualityIssuesDTO> {
    return this.get<FootballQualityIssuesDTO>('/quality-issues', query);
  }

  getAudit(query: FootballAuditQuery = {}): Observable<FootballAuditDTO> {
    return this.get<FootballAuditDTO>('/audit', query);
  }

  // ── Mutating endpoint ───────────────────────────────────────────────────

  /** Queues a manual sync. Idempotency-keyed: re-POSTing the same key returns the current job state. */
  sync(idempotencyKey: string): Observable<FootballSyncResultDTO> {
    return this.post<FootballSyncResultDTO>('/ingestion/sync', { idempotencyKey });
  }

  /**
   * R1-5: the truthful operation history (F06). The backend exposes it and nothing
   * consumed it, so the real outcome of every run was invisible in the UI.
   */
  getSyncOperations(params: { page?: number; limit?: number } = {}): Observable<FootballSyncOperationsDTO> {
    return this.get<FootballSyncOperationsDTO>('/ingestion/sync', params);
  }

  // ── HTTP plumbing ───────────────────────────────────────────────────────

  private get<T>(path: string, params?: object): Observable<T> {
    return this.http
      .get<ApiResponse<T>>(`${this.baseUrl}${path}`, { headers: this.buildHeaders(), params: this.cleanParams(params) })
      .pipe(map((res) => res.data as T), catchError((err: unknown) => throwError(() => this.toApiError(err))));
  }

  private post<T>(path: string, body: unknown): Observable<T> {
    return this.http
      .post<ApiResponse<T>>(`${this.baseUrl}${path}`, body, { headers: this.buildHeaders() })
      .pipe(map((res) => res.data as T), catchError((err: unknown) => throwError(() => this.toApiError(err))));
  }

  private cleanParams(params?: object): HttpParams | undefined {
    if (!params) return undefined;
    let result = new HttpParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      result = result.set(key, String(value));
    }
    return result;
  }

  private toApiError(err: unknown): AdminApiError {
    const status = err instanceof HttpErrorResponse ? err.status : 0;
    const body = err instanceof HttpErrorResponse ? (err.error as { error?: { code?: string; message?: string } } | null) : null;
    const message = body?.error?.message ?? 'La operación no se pudo completar.';
    const code = body?.error?.code;
    if (status === 0) return new AdminApiError('network', status, message, code);
    if (status === 401 || status === 403) return new AdminApiError('unauthorized', status, message, code);
    if (status === 400) return new AdminApiError('validation', status, message, code);
    if (status === 404) return new AdminApiError('not_found', status, message, code);
    return new AdminApiError('unavailable', status, message, code);
  }

  private buildHeaders(): HttpHeaders {
    const headers: Record<string, string> = {};
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return new HttpHeaders(headers);
  }

  private getToken(): string | null {
    if (!this.isBrowser) return null;
    try {
      return localStorage.getItem('gtv_id_token');
    } catch {
      return null;
    }
  }
}
