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
  topPages: Array<{ path: string; count: number }>;
  topReferrers: Array<{ referrer: string; count: number }>;
  sessionsByDay: Array<{ date: string; count: number }>;
  geography?: Array<{ country: string; region: string; count: number }>;
  geographyConfigured: boolean;
  geographyDetailConfigured?: boolean;
  aggregateLimitations?: boolean;
  geographyCollectionEnabled?: boolean;
}

export interface AdminAnalyticsLiveSession {
  sessionId: string;
  anonId: string;
  startedAt: string;
  lastSeenAt: string;
  lastPath?: string;
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
  pages: Array<{ path: string; users: number; views: number }>;
  partial?: boolean;
  coverageStartedAt?: string;
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

  getOverview(hours = 24): Observable<AdminAnalyticsOverview> {
    const to = new Date();
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
