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

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class AdminAnalyticsService {
  private readonly baseUrl = environment.API_BASE_URL;
  private readonly isBrowser = typeof window !== 'undefined';

  constructor(private http: HttpClient) {}

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
        }))
      );
  }

  getRecentEvents(
    limit = 50,
    type?: string,
    sessionId?: string
  ): Observable<AdminAnalyticsEvent[]> {
    const typeParam = type ? `&type=${encodeURIComponent(type)}` : '';
    const sessionParam = sessionId
      ? `&sessionId=${encodeURIComponent(sessionId)}`
      : '';
    const url = `${this.baseUrl}/analytics/events?limit=${limit}${typeParam}${sessionParam}`;
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
