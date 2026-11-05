import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface AdminAnalyticsOverview {
  activeNow: number;
  totalSessions: number;
  uniqueVisitors: number;
  totalPageViews: number;
  avgSessionDurationSec: number;
  topPages: Array<{ path: string; count: number; label?: string }>;
  topReferrers: Array<{ referrer: string; count: number }>;
  sessionsByDay: Array<{ date: string; count: number }>;
  geography?: Array<{ country: string; region: string; count: number }>;
  geographyConfigured: boolean;
  geographyDetailConfigured?: boolean;
  aggregateLimitations?: boolean;
  geographyCollectionEnabled?: boolean;
  geographyDetail?: Array<{ country?: string; region?: string; regionName?: string; city?: string; count: number }>;
  geographyStatus?: Array<{ status: string; count: number }>;
  store?: 'mongo' | 'valkey';
  geoipEnabled?: boolean;
}

export interface AdminAnalyticsLiveSession {
  sessionId: string;
  anonId: string;
  startedAt: string;
  lastSeenAt: string;
  lastPath?: string;
  lastPathLabel?: string;
  initialPathLabel?: string;
  geo?: { status?: string; source?: string; regionName?: string; accuracyRadiusKm?: number; asn?: number; asOrg?: string; db?: string };
  durationSec?: number;
  referrer?: string;
  userAgent?: string;
  ip?: string;
  country?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  language?: string;
  timezone?: string;
  screen?: Record<string, any>;
  viewport?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface AdminAnalyticsEvent {
  eventId: string;
  type: string;
  name?: string;
  path?: string;
  pathLabel?: string;
  title?: string;
  occurredAt: string;
  sessionId: string;
  anonId: string;
}

export interface AdminAnalyticsLiveSnapshot {
  activeCount: number;
  sessions: AdminAnalyticsLiveSession[];
  idleTimeoutSec?: number;
}

export interface AdminAnalyticsJourney {
  steps: string[];
  labels?: string[];
  count: number;
}

export interface AdminAnalyticsJourneys {
  days: number;
  sessionsAnalyzed: number;
  journeys: AdminAnalyticsJourney[];
}

export interface AdminRealtimePages {
  from: string;
  to: string;
  activeUsers: number;
  pageViews: number;
  minutes: Array<{ from: string; users: number }>;
  pages: Array<{ path: string; users: number; views: number; label?: string }>;
  partial?: boolean;
  coverageStartedAt?: string;
}

export interface AdminAnalyticsDiagnostics {
  store: 'mongo' | 'valkey';
  flags: { ingestEnabled: boolean; killed: boolean; ga4Enabled: boolean; geoipEnabled: boolean; legacyEndpoints: string };
  ingest: {
    queue: { depth: number; depthEvents: number; accepted: number; acceptedEvents: number; rejectedFull: number; processed: number; processedEvents: number; failedAttempts: number; droppedAfterRetries: number; droppedEventsAfterRetries: number; storageUnavailableWaits: number; maxLagMs: number; lastLagMs: number; lastError?: string; lastErrorAt?: string };
    rejectedEvents: number;
    invalidBatches: number;
    droppedWhileDisabled: number;
    storageAvailable: boolean | null;
    geoip: { enabled: boolean; city: { loaded: boolean; version: string | null; source?: string | null; error: string | null }; asn: { loaded: boolean; version: string | null; source?: string | null; error: string | null }; lookups: number; located: number };
  } | null;
  generatedAt: string;
}

export interface AdminGa4Breakdown {
  dimension: 'userAgeBracket' | 'userGender' | 'brandingInterest' | string;
  rows: Array<{ value: string; activeUsers: number }>;
  totalUsers: number;
  thresholded: boolean;
}

export type AdminGa4Demographics =
  | { available: true; propertyId: string; days: number; generatedAt: string; cached: boolean; breakdowns: AdminGa4Breakdown[] }
  | { available: false; reason: string; message: string };

export interface AdminAnalyticsExclusion {
  /** Covers Cloudflare edge addresses (saved before the visitor address was read behind Cloudflare): not a visitor. */
  cloudflare?: boolean;
  id?: string;
  value: string;
  label?: string;
  createdAt?: string;
  createdBy?: string;
  source: 'manual' | 'env' | 'server' | 'loopback';
}

export interface AdminAnalyticsExclusions {
  entries: AdminAnalyticsExclusion[];
  you: { ip: string | null; excludedBy: AdminAnalyticsExclusion[] };
}

export type AnalyticsErrorKind = 'network' | 'unauthorized' | 'forbidden' | 'not_deployed' | 'storage_unavailable' | 'unsupported_store' | 'rate_limited' | 'server' | 'unknown';

/**
 * Turns an HTTP failure into a distinguishable, human-readable state: expired session (401), missing role (403),
 * backend without this report (404), storage down (503 storage_unavailable), report not supported by the active
 * store, rate limit, other server errors (with status) and network failures. "No data" is never an error: it is a
 * successful, empty response and is rendered as an empty state.
 */
export function describeAnalyticsError(error: unknown): { kind: AnalyticsErrorKind; message: string; status: number } {
  const err = error as { status?: number; error?: { code?: string; message?: string } } | null;
  const status = typeof err?.status === 'number' ? err.status : 0;
  const code = err?.error?.code;
  const serverMessage = typeof err?.error?.message === 'string' ? err.error.message : undefined;
  if (status === 0) return { kind: 'network', status, message: 'Sin conexión con el servidor de Analytics. Comprueba la red o el estado del backend.' };
  if (status === 401) return { kind: 'unauthorized', status, message: 'Tu sesión ha caducado. Vuelve a iniciar sesión con una cuenta de administración.' };
  if (status === 403) return { kind: 'forbidden', status, message: 'Tu cuenta no tiene permisos de administración para ver Analytics.' };
  if (status === 404) return { kind: 'not_deployed', status, message: 'El backend conectado no dispone de este informe. Actualiza o reinicia el backend con la versión actual.' };
  if (status === 429) return { kind: 'rate_limited', status, message: 'Demasiadas peticiones. Espera unos segundos y vuelve a intentarlo.' };
  if ((status === 501 || status === 503) && code === 'unsupported_store') return { kind: 'unsupported_store', status, message: serverMessage || 'Este informe no está disponible con el almacenamiento activo.' };
  if (status === 503) return { kind: 'storage_unavailable', status, message: serverMessage || 'El almacenamiento de Analytics no está disponible en este momento.' };
  if (status >= 500) return { kind: 'server', status, message: `Error del servidor (${status}) al cargar Analytics.` };
  return { kind: 'unknown', status, message: serverMessage || `No se ha podido cargar el informe (${status}).` };
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class AdminAnalyticsService {
  private readonly baseUrl = environment.API_BASE_URL;
  private readonly isBrowser = typeof window !== 'undefined';

  constructor(private http: HttpClient) {}

  getRealtimePages(): Observable<AdminRealtimePages> {
    return this.http.get<ApiResponse<{ report: AdminRealtimePages }>>(`${this.baseUrl}/analytics/realtime-pages`, { headers: this.buildHeaders() })
      .pipe(map((response) => response.data.report));
  }

  getOverview(hours = 24, endedHoursAgo = 0): Observable<AdminAnalyticsOverview> {
    const to = new Date(Date.now() - endedHoursAgo * 60 * 60 * 1000);
    const from = new Date(Date.now() - hours * 60 * 60 * 1000);
    const url = `${this.baseUrl}/analytics/overview?from=${from.toISOString()}&to=${to.toISOString()}`;
    return this.http
      .get<ApiResponse<{ overview: AdminAnalyticsOverview }>>(url, {
        headers: this.buildHeaders(),
      })
      .pipe(map((resp) => resp.data.overview));
  }

  getLive(
    windowSec = 90,
    limit = 50
  ): Observable<AdminAnalyticsLiveSnapshot> {
    const url = `${this.baseUrl}/analytics/live?windowSec=${windowSec}&limit=${limit}`;
    return this.http
      .get<ApiResponse<AdminAnalyticsLiveSnapshot>>(url, {
        headers: this.buildHeaders(),
      })
      .pipe(
        map((resp) => ({
          activeCount: resp.data.activeCount || 0,
          sessions: resp.data.sessions || [],
          idleTimeoutSec: resp.data.idleTimeoutSec,
        }))
      );
  }

  getRecentEvents(
    limit = 50,
    type?: string,
    sessionId?: string,
    hours?: number
  ): Observable<AdminAnalyticsEvent[]> {
    const typeParam = type ? `&type=${encodeURIComponent(type)}` : '';
    const sessionParam = sessionId
      ? `&sessionId=${encodeURIComponent(sessionId)}`
      : '';
    const fromParam = hours ? `&from=${encodeURIComponent(new Date(Date.now() - hours * 3600000).toISOString())}` : '';
    const url = `${this.baseUrl}/analytics/events?limit=${limit}${typeParam}${sessionParam}${fromParam}`;
    return this.http
      .get<ApiResponse<{ events: AdminAnalyticsEvent[] }>>(url, {
        headers: this.buildHeaders(),
      })
      .pipe(map((resp) => resp.data.events || []));
  }

  getJourneys(days = 7): Observable<AdminAnalyticsJourneys> {
    const url = `${this.baseUrl}/analytics/journeys?days=${days}`;
    return this.http
      .get<ApiResponse<AdminAnalyticsJourneys>>(url, {
        headers: this.buildHeaders(),
      })
      .pipe(map((resp) => resp.data || { days, sessionsAnalyzed: 0, journeys: [] }));
  }

  getDiagnostics(): Observable<AdminAnalyticsDiagnostics> {
    return this.http
      .get<ApiResponse<AdminAnalyticsDiagnostics>>(`${this.baseUrl}/analytics/diagnostics`, { headers: this.buildHeaders() })
      .pipe(map((resp) => resp.data));
  }

  getGa4Demographics(days = 28): Observable<AdminGa4Demographics> {
    return this.http
      .get<ApiResponse<{ ga4: AdminGa4Demographics }>>(`${this.baseUrl}/analytics/ga4/demographics?days=${days}`, { headers: this.buildHeaders() })
      .pipe(map((resp) => resp.data.ga4));
  }

  getExclusions(): Observable<AdminAnalyticsExclusions> {
    return this.http.get<ApiResponse<AdminAnalyticsExclusions>>(`${this.baseUrl}/analytics/exclusions`, { headers: this.buildHeaders() }).pipe(map((resp) => resp.data));
  }

  addExclusion(body: { value?: string; label?: string; mine?: boolean }): Observable<AdminAnalyticsExclusion> {
    return this.http.post<ApiResponse<{ entry: AdminAnalyticsExclusion }>>(`${this.baseUrl}/analytics/exclusions`, body, { headers: this.buildHeaders() }).pipe(map((resp) => resp.data.entry));
  }

  removeExclusion(id: string): Observable<boolean> {
    return this.http.delete<ApiResponse<{ removed: boolean }>>(`${this.baseUrl}/analytics/exclusions/${encodeURIComponent(id)}`, { headers: this.buildHeaders() }).pipe(map(() => true));
  }

  private buildHeaders(): HttpHeaders {
    const headers: Record<string, string> = {};
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
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
