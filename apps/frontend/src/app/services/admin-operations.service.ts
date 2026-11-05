import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { HealthResponse } from './admin-schedules.service';

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class AdminOperationsService {
  private readonly baseUrl = environment.API_BASE_URL;
  private readonly isBrowser = typeof window !== 'undefined';

  constructor(private http: HttpClient) {}

  invalidateCache(namespace: 'epg' | 'football' | 'catalog' | 'schedules'): Observable<any> {
    return this.http.post(
      `${this.baseUrl}/admin/cache/invalidate`, { namespace },
      { headers: this.buildHeaders() }
    );
  }

  getFootballOverview(): Observable<any> { return this.get('/admin/football/overview'); }
  getFootballCompetitions(params: Record<string, string | number> = {}): Observable<any> { return this.get('/admin/football/competitions', params); }
  getFootballTeams(params: Record<string, string | number> = {}): Observable<any> { return this.get('/admin/football/teams', params); }
  getFootballFixtures(params: Record<string, string | number> = {}): Observable<any> { return this.get('/admin/football/fixtures', params); }
  getJobs(params: Record<string, string | number> = {}): Observable<any> { return this.get('/admin/jobs', params); }
  getScheduledJobs(): Observable<any> { return this.get('/admin/jobs/scheduled'); }
  runScheduledJob(name: string): Observable<any> { return this.http.post(`${this.baseUrl}/admin/jobs/scheduled/${encodeURIComponent(name)}/run`, {}, { headers: this.buildHeaders() }); }
  getEvents(params: Record<string, string | number> = {}): Observable<any> { return this.get('/admin/events', params); }
  getAlerts(): Observable<any> { return this.get('/admin/alerts'); }
  refreshFootball(): Observable<any> { return this.http.post(`${this.baseUrl}/admin/football/refresh`, {}, { headers: this.buildHeaders() }); }
  getCacheDiagnostics(): Observable<any> { return this.get('/admin/cache/diagnostics'); }

  private get(path: string, params: Record<string, string | number> = {}): Observable<any> {
    return this.http.get<ApiResponse<any>>(`${this.baseUrl}${path}`, { headers: this.buildHeaders(), params: params as any }).pipe(map((response) => response.data));
  }

  getHealth(): Observable<HealthResponse> {
    return this.http
      .get<ApiResponse<HealthResponse>>(`${this.baseUrl}/admin/health`, {
        headers: this.buildHeaders(),
      })
      .pipe(map((resp) => resp.data));
  }

  private buildHeaders(): HttpHeaders {
    const headers: Record<string, string> = {};
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return new HttpHeaders(headers);
  }

  private getToken(): string | null {
    if (!this.isBrowser) return null;
    try { return localStorage.getItem('gtv_id_token'); } catch { return null; }
  }
}
