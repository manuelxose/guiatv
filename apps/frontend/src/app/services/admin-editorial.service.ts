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
  /** M11-E2: one-time administrative activation (human key); the env switch alone publishes nothing. */
  activated: boolean;
  activatedAt: string | null;
  activatedBy: string | null;
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
  /** M11-E2 (absent on older reports). */
  revisions?: number;
  revisionLog?: string[];
  budget?: 'capped' | 'unlimited';
  publicUrl?: string | null;
}

/** M14-B durable execution record: one row per claimed job, with stage timeline and lease. */
export type EditorialLedgerState = 'queued' | 'running' | 'paused' | 'cancelling' | 'cancelled' | 'completed' | 'failed' | 'dead-letter' | 'blocked';
export type EditorialLedgerStageName = 'topic-selection' | 'source-discovery' | 'source-retrieval' | 'evidence-validation' | 'research-synthesis' | 'editorial-outline' | 'article-drafting' | 'seo-enrichment' | 'quality-evaluation' | 'revision' | 'publication-eligibility' | 'publication' | 'sitemap-registration';
export interface EditorialLedgerStage {
  key: string;
  name: EditorialLedgerStageName;
  attempt: number;
  state: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';
  startedAt: string;
  endedAt: string | null;
  deadlineAt: string;
  error: { classification: string; message: string } | null;
  detail: string | null;
}
export interface EditorialLedgerJob {
  jobId: string;
  slug: string;
  kind: 'article' | 'discovery' | 'maintenance' | 'enrichment';
  state: EditorialLedgerState;
  currentStage: EditorialLedgerStageName | null;
  attempt: number;
  maxAttempts: number;
  worker: { id: string; host: string | null; pid: number | null } | null;
  lease: { token: string; generation: number; acquiredAt: string; expiresAt: string; heartbeatAt: string } | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  articleDeadlineAt: string | null;
  lastProgressAt: string;
  progress: string | null;
  cancelRequested: boolean;
  pauseRequested: boolean;
  archivedAt: string | null;
  error: { classification: string; message: string } | null;
  usage: { modelCalls: number; inputTokens: number; outputTokens: number; usd: number };
  stages: EditorialLedgerStage[];
  checkpoints: Array<{ at: string; stage: EditorialLedgerStageName | null; ref: string; hash: string | null }>;
  publication: { key: string; state: 'publishing' | 'published' | 'rejected'; url: string | null; at: string } | null;
  revision: number;
  deadlines: { stageMs: number; articleMs: number };
}
export interface EditorialLedgerPage { items: EditorialLedgerJob[]; total: number; limit: number; skip: number }
export interface EditorialLedgerBulkResult {
  action: string;
  succeeded: number;
  failed: number;
  results: Array<{ jobId: string; ok: boolean; state?: string; error?: string }>;
}

/** M11-E2: today's attempts and their outcome; attempts and publications are counted separately. */export interface EditorialToday {
  generated: number;
  published: number;
  ready: number;
  held: number;
  rejected: number;
  revisions: number;
  models: Record<string, { calls: number; inputTokens: number; outputTokens: number; usd: number }>;
  reasons: Record<string, number>;
}

export interface EditorialPostSummary {
  id: string;
  version: number | null;
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

/** Google observations plus separately recorded manual request annotations. */
export interface EditorialSearchConsole {
  enabled: boolean;
  windowDays: number;
  lastRun: {
    status: string; message: string | null; startedAt: string; finishedAt?: string; inspected: number; skipped: number;
    pageRows?: number; queryRows?: number;
    skipReasons?: Array<{ url: string; reason: 'fresh-inspected' | 'fresh-indexed' | 'inspection-limit' | 'no-slug' }>;
    diagnostics?: {
      property: { date: number; page: number; query: number; available: boolean; errors: string[] };
      guides: { pageRows: number; queryRows: number; state: 'ok' | 'zero-for-guides' | 'unavailable' };
    };
  } | null;
  baseline: { days: number; complete: boolean };
  guides: Array<{
    slug: string;
    title: string;
    url: string;
    indexingRequestRecordedAt: string | null;
    inspection: {
      inspectedAt: string | null; verdict: string | null; coverageState: string | null; indexed: boolean;
      lastCrawlTime: string | null; googleCanonical: string | null; canonicalMatch: boolean | null; error: string | null;
    } | null;
    /** null when Google returned no rows for the page (never zero-filled). */
    performance: {
      clicks: number; impressions: number; ctr: number | null; position: number | null;
      days: number; baselineComplete: boolean; preliminary: boolean;
    } | null;
  }>;
}

export type EditorialContentType = 'guide' | 'ranking' | 'analysis';
export type EditorialLength = 'short' | 'medium' | 'long';
export interface EditorialModelRoute { provider: 'anthropic' | 'openai' | 'deepseek'; model: string; effort: 'low' | 'medium' | 'high' }
export interface EditorialGenerationSettings {
  enabled: boolean;
  scheduleHours: 3 | 6 | 12 | 24;
  topicsPerCycle: number;
  categories: string[];
  contentTypes: EditorialContentType[];
  defaultLength: EditorialLength;
  sourceDomains: string[];
  routes: Record<EditorialRole, EditorialModelRoute[]>;
  updatedAt?: string;
  updatedBy?: string;
}
export interface EditorialGenerationTopic {
  title: string; slug: string; topic: string; intent: string; category: string;
  volatility: 'stable' | 'pricing' | 'availability' | 'sports-rights' | 'catalog-ranking';
  contentType: EditorialContentType; length: EditorialLength; seedUrls: string[];
  internalSources: Array<{ id: string; url: string }>;
}
export interface EditorialQueueItem {
  id: string; title?: string; category?: string; kind?: 'generate' | 'discover';
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; state?: string;
  topic?: EditorialGenerationTopic; reason?: string | null; createdAt?: string; updatedAt?: string;
  createdBy?: string; source: 'manual' | 'discovered'; score?: number; attempts?: number; sources?: string[];
  pinned?: boolean; intent?: string; explanation?: string[];
}
export type EditorialQueueActionName = 'approve' | 'reject' | 'prioritize' | 'edit';
export interface EditorialPendingAction { id: string; action: EditorialQueueActionName; topicId: string; reason?: string }
export interface EditorialRunnerProcess {
  configured: boolean;
  managed: boolean;
  running: boolean;
  pid: number | null;
  command: string | null;
  cwd: string | null;
  envKeys: string[];
  logPath: string | null;
}

/** M14-R: a start/restart result carries `started`/`mode`; `started=false` means the start was refused. `stop` omits them. */
export interface EditorialRunnerActionResult extends EditorialRunnerProcess {
  started?: boolean;
  mode?: 'automatic' | 'manual';
  reason?: string | null;
  enabled?: boolean;
}

export interface EditorialOperations {
  generation: EditorialGenerationSettings;
  runner: { online: boolean; lastSeenAt: string | null; version: string | null; status?: 'never-connected' | 'offline' | 'ready' | 'error' | string; lastError?: string | null; capabilities: { providers: string[]; webSearch: boolean }; process?: EditorialRunnerProcess };
  lastCycle: { at: string; result: string; reason: string; queued: number; generated: number } | null;
  /** M15: the OS scheduler's ticks; `nextRunAt` is only set while it ticks and generation is enabled. */
  scheduler?: { active: boolean; lastTickAt: string | null; lastAutomaticStartAt: string | null; tickMinutes: number };
  nextRunAt: string | null;
  queue: EditorialQueueItem[];
  /** Human decisions on queued topics that the runner has not applied yet. */
  pendingActions?: EditorialPendingAction[];
  queueSummary: { manualPending: number; discovered: number; running: number };
}

export type EditorialProviderState = 'connected' | 'unauthorized' | 'unreachable' | 'error' | 'not-configured';
export interface EditorialProviderStatus {
  id: 'deepseek' | 'anthropic' | 'openai';
  label: string;
  configured: boolean;
  credentialEnv: string;
  baseUrlHost: string | null;
  state: EditorialProviderState;
  models: string[];
  latencyMs: number | null;
  checkedAt: string;
  error: string | null;
}
export interface EditorialProviderHealth { checkedAt: string; providers: EditorialProviderStatus[] }

export interface EditorialOverview extends EditorialOperations {
  policy: EditorialPolicyStatus;
  /** USD caps are null when the runner reported EDITORIAL_BUDGET=unlimited. */
  limits: { budget: 'capped' | 'unlimited'; maxArticleUsd: number | null; maxDailyUsd: number | null; maxDailyArticles: number };
  today: EditorialToday;
  routes: Record<EditorialRole, Array<{ provider: string; model: string; effort: 'low' | 'medium' | 'high' }>>;
  imageRoutes: Array<{ provider: string; model: string }>;
  spend: { todayUsd: number; last30dUsd: number };
  jobs: EditorialJobSummary[];
  posts: EditorialPostSummary[];
  searchConsole: EditorialSearchConsole;
}

export interface EditorialFinding {
  severity: EditorialSeverity;
  code: string;
  message: string;
}

export interface EditorialPostDetail {
  version: number | null;
  pendingEdit: { title: string; excerpt: string; content: string; metaTitle: string; metaDescription: string; savedAt: string } | null;
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
  /** The latest stored version, for a diff against what is shown now. */
  previous: { version: number; savedAt: string; reason: string; title: string; content: string } | null;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class AdminEditorialService {
  private readonly baseUrl = `${environment.API_BASE_URL}/admin/editorial`;
  private readonly blogUrl = `${environment.API_BASE_URL}/blog`;

  constructor(private readonly http: HttpClient) {}

  getOverview(): Observable<EditorialOverview> {
    return this.http
      .get<ApiResponse<EditorialOverview>>(`${this.baseUrl}/overview`)
      .pipe(map((resp) => resp.data));
  }

  getProviders(refresh = false): Observable<EditorialProviderHealth> {
    return this.http
      .get<ApiResponse<EditorialProviderHealth>>(`${this.baseUrl}/providers${refresh ? '?refresh=1' : ''}`)
      .pipe(map((resp) => resp.data));
  }

  /** Read-only Search Console synchronization; returns 202 while a run is already in progress. */
  runSearchConsole(): Observable<{ running: boolean; started: boolean }> {
    return this.http
      .post<ApiResponse<{ running: boolean; started: boolean }>>(`${this.baseUrl}/search-console/run`, {})
      .pipe(map((resp) => resp.data));
  }

  recordIndexingRequest(slug: string): Observable<{ recordedAt: string }> {
    return this.http.post<ApiResponse<{ recordedAt: string }>>(`${this.baseUrl}/search-console/indexing-request`, { slug })
      .pipe(map((resp) => resp.data));
  }

  submitGuideSitemap(slug: string): Observable<{ submittedAt: string }> {
    return this.http.post<ApiResponse<{ submittedAt: string }>>(`${this.baseUrl}/search-console/submit-guide-sitemap`, { slug })
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

  saveGenerationSettings(settings: EditorialGenerationSettings): Observable<EditorialGenerationSettings> {
    return this.http.put<ApiResponse<EditorialGenerationSettings>>(`${this.baseUrl}/generation/settings`, settings).pipe(map((resp) => resp.data));
  }

  generate(topic: EditorialGenerationTopic): Observable<EditorialQueueItem> {
    return this.http.post<ApiResponse<EditorialQueueItem>>(`${this.baseUrl}/generation/requests`, topic).pipe(map((resp) => resp.data));
  }

  discover(): Observable<EditorialQueueItem> {
    return this.http.post<ApiResponse<EditorialQueueItem>>(`${this.baseUrl}/generation/discovery`, {}).pipe(map((resp) => resp.data));
  }

  cancelRequest(id: string): Observable<EditorialQueueItem> {
    return this.http.post<ApiResponse<EditorialQueueItem>>(`${this.baseUrl}/generation/requests/${encodeURIComponent(id)}/cancel`, {}).pipe(map((resp) => resp.data));
  }

  retryRequest(id: string): Observable<EditorialQueueItem> {
    return this.http.post<ApiResponse<EditorialQueueItem>>(`${this.baseUrl}/generation/requests/${encodeURIComponent(id)}/retry`, {}).pipe(map((resp) => resp.data));
  }

  updatePost(id: string, changes: { title?: string; excerpt?: string; content?: string; metaTitle?: string; metaDescription?: string; expectedVersion: number | null; expectedStatus: string }): Observable<{ updated: boolean; id: string }> {
    return this.http.patch<ApiResponse<{ updated: boolean; id: string }>>(`${this.baseUrl}/posts/${encodeURIComponent(id)}`, changes).pipe(map((resp) => resp.data));
  }

  deletePost(id: string, expectedVersion: number | null, expectedStatus: string): Observable<{ deleted: boolean; id: string }> {
    return this.http.delete<ApiResponse<{ deleted: boolean; id: string }>>(`${this.baseUrl}/posts/${encodeURIComponent(id)}`, { body: { expectedVersion, expectedStatus } }).pipe(map((resp) => resp.data));
  }

  requeuePost(id: string): Observable<EditorialQueueItem> {
    return this.http.post<ApiResponse<EditorialQueueItem>>(`${this.baseUrl}/posts/${encodeURIComponent(id)}/requeue`, {}).pipe(map((resp) => resp.data));
  }

  /** Human decision on a queued topic; the runner applies it at its next cycle. */
  queueAction(topicId: string, action: EditorialQueueActionName, extra: { reason?: string; edit?: { title?: string; intent?: string; seedUrls?: string[] } } = {}): Observable<EditorialQueueItem> {
    return this.http.post<ApiResponse<EditorialQueueItem>>(`${this.baseUrl}/generation/queue-actions`, { topicId, action, ...extra }).pipe(map((resp) => resp.data));
  }

  /** Publication state changes use the existing review-key endpoints: every gate is re-run server-side and the key is never stored. */
  private reviewHeaders(reviewKey: string, reviewer: string): HttpHeaders {
    return new HttpHeaders({ 'x-editorial-review-key': reviewKey, 'x-editorial-reviewer': reviewer });
  }

  approvePost(id: string, reviewKey: string, reviewer: string, acknowledge: string[]): Observable<unknown> {
    return this.http.post(`${this.blogUrl}/${encodeURIComponent(id)}/approve`, { acknowledge }, { headers: this.reviewHeaders(reviewKey, reviewer) });
  }

  unpublishPost(id: string, reviewKey: string, reviewer: string, reason: string): Observable<unknown> {
    return this.http.post(`${this.blogUrl}/${encodeURIComponent(id)}/unpublish`, { reason }, { headers: this.reviewHeaders(reviewKey, reviewer) });
  }

  rollbackPost(id: string, version: number, reviewKey: string, reviewer: string): Observable<unknown> {
    return this.http.post(`${this.blogUrl}/${encodeURIComponent(id)}/rollback`, { version }, { headers: this.reviewHeaders(reviewKey, reviewer) });
  }

  rejectPost(id: string, reason: string): Observable<{ rejected: boolean; id: string }> {
    return this.http.post<ApiResponse<{ rejected: boolean; id: string }>>(`${this.baseUrl}/posts/${encodeURIComponent(id)}/reject`, { reason }).pipe(map((resp) => resp.data));
  }

  /** M14-B: durable job ledger. Filters are server-side; pagination never loads the whole history. */
  getLedger(query: { states?: string; q?: string; archived?: boolean; stale?: boolean; limit?: number; skip?: number } = {}): Observable<EditorialLedgerPage> {
    const params = new URLSearchParams();
    if (query.states) params.set('states', query.states);
    if (query.q) params.set('q', query.q);
    if (query.archived !== undefined) params.set('archived', query.archived ? '1' : '0');
    if (query.stale) params.set('stale', '1');
    if (query.limit) params.set('limit', String(query.limit));
    if (query.skip) params.set('skip', String(query.skip));
    const suffix = params.toString();
    return this.http.get<ApiResponse<EditorialLedgerPage>>(`${this.baseUrl}/ledger${suffix ? `?${suffix}` : ''}`).pipe(map((resp) => resp.data));
  }

  getLedgerJob(jobId: string): Observable<EditorialLedgerJob> {
    return this.http.get<ApiResponse<EditorialLedgerJob>>(`${this.baseUrl}/ledger/${encodeURIComponent(jobId)}`).pipe(map((resp) => resp.data));
  }

  ledgerAction(jobId: string, action: 'pause' | 'resume' | 'cancel' | 'retry' | 'recover' | 'archive' | 'delete', body: { reason?: string; force?: boolean } = {}): Observable<EditorialLedgerJob | { deleted: true; jobId: string }> {
    return this.http.post<ApiResponse<EditorialLedgerJob | { deleted: true; jobId: string }>>(
      `${this.baseUrl}/ledger/${encodeURIComponent(jobId)}/${action}`, body,
    ).pipe(map((resp) => resp.data));
  }

  ledgerBulk(action: 'pause' | 'resume' | 'cancel' | 'retry' | 'recover' | 'archive' | 'delete', jobIds: string[], reason = ''): Observable<EditorialLedgerBulkResult> {
    return this.http.post<ApiResponse<EditorialLedgerBulkResult>>(`${this.baseUrl}/ledger/bulk`, { action, jobIds, reason }).pipe(map((resp) => resp.data));
  }

  /** Reconcile every expired worker lease in one read-only-safe sweep. */
  recoverStaleLedger(): Observable<{ recovered: Array<{ jobId: string; state: string }>; count: number }> {
    return this.http.post<ApiResponse<{ recovered: Array<{ jobId: string; state: string }>; count: number }>>(`${this.baseUrl}/ledger/recover-stale`, {}).pipe(map((resp) => resp.data));
  }

  runnerProcess(action: 'start' | 'stop' | 'restart'): Observable<EditorialRunnerActionResult> {
    // A human pressing the button starts manually; the runner may refuse only an automatic start.
    const body = action === 'stop' ? {} : { mode: 'manual' as const };
    return this.http.post<ApiResponse<EditorialRunnerActionResult>>(`${this.baseUrl}/generation/runner/process/${action}`, body).pipe(map((resp) => resp.data));
  }

  runnerLogs(lines = 120): Observable<{ configured: boolean; path: string | null; lines: string[] }> {
    return this.http.get<ApiResponse<{ configured: boolean; path: string | null; lines: string[] }>>(`${this.baseUrl}/generation/runner/logs?lines=${lines}`).pipe(map((resp) => resp.data));
  }
}
