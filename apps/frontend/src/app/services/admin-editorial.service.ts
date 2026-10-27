import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

/**
 * Read-only supervision of the AI editorial pipeline (`/admin/editorial/*`)
 * plus the emergency pause/resume of automatic publication. Authorization is
 * attached globally by authRefreshInterceptor; admin role is enforced server-side.
 */

export type EditorialRole = 'research' | 'evidence' | 'editorial' | 'seo' | 'critic';
export type EditorialSeverity = 'block' | 'warn' | 'human';

export interface EditorialPolicyStatus {
  envEnabled: boolean;
  paused: boolean;
  active: boolean;
  pausedAt: string | null;
  pausedBy: string | null;
  pausedReason: string | null;
  dailyLimit: number;
  dailyLimitBy: string | null;
  dailyLimitRange: { recommended: number; min: number; max: number };
  approvalsLast24h: number;
  signingKeyConfigured: boolean;
  liveProviders: string[];
}

export interface EditorialCostEntry {
  role: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  searches: number;
  usd: number;
}

export interface EditorialJobSummary {
  jobId: string;
  slug: string;
  state: 'draft' | 'researched' | 'verified' | 'approved-by-policy' | 'published' | 'requires-update' | 'blocked';
  reason: string | null;
  startedAt: string;
  backend: string | null;
  costUsd: number;
  costEntries: EditorialCostEntry[];
  blockingCodes: string[];
  imageFailure: string | null;
}

export interface EditorialPostSummary {
  id: string;
  slug: string;
  title: string;
  status: 'draft' | 'publish';
  reviewState: 'unreviewed' | 'in-review' | 'approved' | 'rejected';
  reviewedBy: string | null;
  updatedAt: string;
  pipelineState: string;
  backend: string | null;
  signed: boolean;
  costUsd: number;
  claims: { supported: number; conflicting: number; unverified: number };
  sources: number;
  criticVerdict: 'pass' | 'revise' | 'block' | null;
  coverUrl: string | null;
  nextReviewAt: string | null;
}

export interface EditorialOverview {
  policy: EditorialPolicyStatus;
  limits: { maxArticleUsd: number; maxDailyUsd: number; maxDailyArticles: number };
  routes: Record<EditorialRole, Array<{ provider: string; model: string; effort: 'low' | 'medium' | 'high' }>>;
  imageRoutes: Array<{ provider: string; model: string }>;
  spend: { todayUsd: number; last30dUsd: number };
  jobs: EditorialJobSummary[];
  posts: EditorialPostSummary[];
}

export interface EditorialFinding {
  severity: EditorialSeverity;
  code: string;
  message: string;
}

export interface EditorialPostDetail {
  post: {
    id: string; slug: string; title: string; status: string; reviewState: string;
    reviewedBy: string | null; reviewNotes: string | null;
    excerpt: string; content: string; metaTitle: string; metaDescription: string;
    coverUrl: string | null; coverAlt: string | null; author: { name?: string; id?: string } | null;
    /** Data URL: an unpublished cover is not served anonymously. */
    coverPreview?: string | null;
  };
  provenance: {
    pipelineVersion: string; state: string; backend: string | null; signed: boolean;
    bundle: {
      topic: string; intent: string;
      sources: Array<{ id: string; url: string; publisher: string; kind: 'official' | 'dataset' | 'internal' | 'press'; retrievedAt?: string; httpStatus?: number }>;
      claims: Array<{
        id: string; text: string; volatility: string;
        status?: 'supported' | 'conflicting' | 'unverified'; note?: string;
        quotes: Array<{ sourceId: string; quote: string; verified?: boolean }>;
      }>;
      conflicts: Array<{ claimIds: string[]; note: string }>;
    };
    critic: {
      model: string; verdict: 'pass' | 'revise' | 'block';
      issues: Array<{ claimId?: string; severity: 'high' | 'medium' | 'low'; message: string }>;
      reviewedAt: string;
    } | null;
    cost: {
      entries: EditorialCostEntry[]; usd: number; inputTokens: number; outputTokens: number;
      sourceFetches: number; draftAttempts: number; reviewFailures: number;
    } | null;
    images: Array<{
      assetId: string; purpose: 'cover'; url: string; width: number; height: number; contentType: string;
      sha256: string; provider: string; model: string; prompt: string; altText: string; rights: string;
      costUsd: number; createdAt: string;
    }>;
    lastVerifiedAt: string | null;
    nextReviewAt: string | null;
  };
  findings: EditorialFinding[];
  policyBlockers: EditorialFinding[];
  revisions: Array<{ version: number; savedAt: string; reason: string; status: string }>;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class AdminEditorialService {
  private readonly baseUrl = `${environment.API_BASE_URL}/admin/editorial`;

  constructor(private readonly http: HttpClient) {}

  getOverview(): Observable<EditorialOverview> {
    return this.http
      .get<ApiResponse<EditorialOverview>>(`${this.baseUrl}/overview`)
      .pipe(map((resp) => resp.data));
  }

  getPost(id: string): Observable<EditorialPostDetail> {
    return this.http
      .get<ApiResponse<EditorialPostDetail>>(`${this.baseUrl}/posts/${encodeURIComponent(id)}`)
      .pipe(map((resp) => resp.data));
  }

  pause(reason: string): Observable<EditorialPolicyStatus> {
    return this.http
      .post<ApiResponse<{ policy: EditorialPolicyStatus }>>(`${this.baseUrl}/policy/pause`, { reason })
      .pipe(map((resp) => resp.data.policy));
  }

  /** The review key is passed straight through as a header and never stored. */
  resume(reviewKey: string, reviewer: string): Observable<EditorialPolicyStatus> {
    const headers = new HttpHeaders({ 'x-editorial-review-key': reviewKey, 'x-editorial-reviewer': reviewer });
    return this.http
      .post<ApiResponse<{ policy: EditorialPolicyStatus }>>(`${this.baseUrl}/policy/resume`, {}, { headers })
      .pipe(map((resp) => resp.data.policy));
  }

  /** Articles per day (runs and policy publications); needs the review key, like resume. */
  setDailyLimit(dailyLimit: number, reviewKey: string, reviewer: string): Observable<EditorialPolicyStatus> {
    const headers = new HttpHeaders({ 'x-editorial-review-key': reviewKey, 'x-editorial-reviewer': reviewer });
    return this.http
      .post<ApiResponse<{ policy: EditorialPolicyStatus }>>(`${this.baseUrl}/policy/daily-limit`, { dailyLimit }, { headers })
      .pipe(map((resp) => resp.data.policy));
  }
}
