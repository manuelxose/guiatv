import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface AIAnalyticsOverview {
  totalConversations: number;
  totalMessages: number;
  activeUsersToday: number;
  activeUsersWeek: number;
  avgMessagesPerConversation: number;
  topGenres: { genre: string; count: number }[];
  topPlatforms: { platform: string; count: number }[];
  subscriptionBreakdown: { free: number; premium: number };
  feedbackSummary: { positive: number; negative: number };
}

export interface AIAnalyticsTimeSeries {
  date: string;
  conversations: number;
  messages: number;
}
export interface AIFailureDiagnostic { requestId: string; outcome: 'partial' | 'fallback' | 'failed'; grounding: string[]; failureReason?: string; latencyMs: number; createdAt: string; }

export interface AIConversationListItem {
  conversationId: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  sessionTitle?: string;
  messageCount: number;
  feedbackPositive: number;
  feedbackNegative: number;
  pinned: boolean;
  archived: boolean;
  lastUsedAt?: string;
}

export interface AIConversationListResult {
  items: AIConversationListItem[];
  pagination: { total: number; page: number; limit: number; pages: number };
}

export interface AIConversationDetail extends AIConversationListItem {
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    createdAt?: string;
    feedback?: 'positive' | 'negative';
  }>;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
}

@Injectable({ providedIn: 'root' })
export class AdminAIAnalyticsService {
  private readonly baseUrl = environment.API_BASE_URL;

  constructor(private readonly http: HttpClient) {}

  getOverview(): Observable<AIAnalyticsOverview | null> {
    return this.http
      .get<ApiResponse<AIAnalyticsOverview>>(
        `${this.baseUrl}/admin/ai-analytics/overview`,
        { headers: this.headers() }
      )
      .pipe(
        map((r) => r?.data || null),
        catchError(() => of(null))
      );
  }

  getTimeSeries(days = 30): Observable<AIAnalyticsTimeSeries[]> {
    return this.http
      .get<ApiResponse<AIAnalyticsTimeSeries[]>>(
        `${this.baseUrl}/admin/ai-analytics/timeseries`,
        { headers: this.headers(), params: { days: String(days) } }
      )
      .pipe(
        map((r) => r?.data || []),
        catchError(() => of([]))
      );
  }

  getFailures(limit = 50): Observable<AIFailureDiagnostic[]> {
    return this.http.get<ApiResponse<AIFailureDiagnostic[]>>(`${this.baseUrl}/admin/ai-analytics/failures`, { headers: this.headers(), params: { limit: String(limit) } }).pipe(map((r) => r?.data || []), catchError(() => of([])));
  }

  getConversations(page = 1, limit = 20, search = ''): Observable<AIConversationListResult | null> {
    const params: Record<string, string> = { page: String(page), limit: String(limit) };
    if (search.trim()) params['search'] = search.trim();
    return this.http
      .get<ApiResponse<AIConversationListResult>>(`${this.baseUrl}/admin/ai-analytics/conversations`, { headers: this.headers(), params })
      .pipe(
        map((r) => r?.data || null)
      );
  }

  getConversation(conversationId: string): Observable<AIConversationDetail | null> {
    return this.http
      .get<ApiResponse<AIConversationDetail>>(`${this.baseUrl}/admin/ai-analytics/conversations/${encodeURIComponent(conversationId)}`, { headers: this.headers() })
      .pipe(
        map((r) => r?.data || null)
      );
  }

  private headers(): HttpHeaders {
    const token =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem('gtv_id_token')
        : null;
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }
}
