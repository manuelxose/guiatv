import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

/**
 * M14-R7 — Observatorio del flujo editorial (`/v2/admin/editorial/flow/*`).
 *
 * Solo transporte y tipado: no rellena huecos, no deriva métricas y no traduce
 * estados. La guía de estados llega del contrato compartido del backend
 * (`FLOW_STATE_GUIDE`) y cada recuento llega con su estado `measured`/`unavailable`.
 * La autorización va en el interceptor global; el rol de admin lo exige el servidor.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Contrato de estados (espejo de `FLOW_STATE_GUIDE`)
 * ──────────────────────────────────────────────────────────────────────────── */

export type RecoveryActionKey =
  | 'retry-source'
  | 'replace-source'
  | 'fix-slug'
  | 'inspect-duplicate'
  | 'revise-brief'
  | 'add-evidence'
  | 'targeted-rewrite'
  | 'retry-review'
  | 'request-manual-review'
  | 'archive';

export type FlowDimension = 'candidate' | 'editorial' | 'execution' | 'publication' | 'seo';

export interface FlowStateMeta {
  key: string;
  label: string;
  definition: string;
  notImplies: string[];
  admittedActions: RecoveryActionKey[];
}

export interface RecoveryActionMeta {
  key: RecoveryActionKey;
  label: string;
  definition: string;
}

export interface FlowStateGuide {
  version: string;
  candidate: Record<string, FlowStateMeta>;
  editorial: Record<string, FlowStateMeta>;
  execution: Record<string, FlowStateMeta>;
  publication: Record<string, FlowStateMeta>;
  seo: Record<string, FlowStateMeta>;
  recoveryActions: Record<string, RecoveryActionMeta>;
}

export interface FlowGuideResponse {
  contractVersion: string;
  guide: FlowStateGuide;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Embudo
 * ──────────────────────────────────────────────────────────────────────────── */

export type FlowScopeKey =
  | 'from'
  | 'to'
  | 'cycleId'
  | 'origin'
  | 'category'
  | 'stage'
  | 'state'
  | 'failureReason'
  | 'model'
  | 'provider'
  | 'publicationStatus';

/** Ámbito que se envía como query string; cada clave vacía se omite. */
export type FlowScopeQuery = Partial<Record<FlowScopeKey, string>>;

export interface FlowConversionRate {
  from: string;
  ratio: number | null;
  lost: number | null;
  crossDimension: boolean;
  unavailableReason: string | null;
}

export interface FlowDrillDown {
  ids: string[];
  total: number;
  returned: number;
  truncated: boolean;
  endpoint: string;
}

export interface FunnelStage {
  key: string;
  dimension: FlowDimension;
  dimensionLabel: string;
  label: string;
  description: string;
  state: 'measured' | 'unavailable';
  /** `null` siempre que `state` es `unavailable`: nunca se presenta un 0 de relleno. */
  count: number | null;
  unavailableReason: string | null;
  drillDown: FlowDrillDown;
  queries: Array<{ collection: string; filter: Record<string, unknown>; note?: string }>;
  notes: string[];
  conversionFromPrevious: FlowConversionRate | null;
}

export interface FunnelReport {
  contractVersion: string;
  generatedAt: string;
  scope: {
    requested: Record<string, string>;
    applied: Array<{ key: FlowScopeKey; value: string }>;
    note: string;
  };
  stages: FunnelStage[];
  dimensions: Array<{ dimension: FlowDimension; label: string; stages: string[]; total: null; totalNote: string }>;
  totals: { global: null; globalNote: string; byDimension: Array<{ dimension: FlowDimension; total: null }> };
  availability: { connected: boolean; note: string | null };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Ficha de tema
 * ──────────────────────────────────────────────────────────────────────────── */

export interface TopicDimensionView {
  dimension: FlowDimension;
  state: string;
  label: string;
  definition: string;
  notImplies: string[];
  provenance: { collection: string; workflowVersion: string };
  rawState: string | null;
  reason: string | null;
}

export interface AvailableAction {
  key: RecoveryActionKey;
  label: string;
  definition: string;
  dimension: string;
}

export interface TopicHistoryEntry {
  at: string;
  dimension: FlowDimension | 'tema';
  what: string;
  detail: string | null;
  source: string;
}

export interface TopicView {
  topicId: string;
  identity: {
    topicId: string;
    slug: string | null;
    title: string | null;
    category: string | null;
    jobId: string | null;
    postId: string | null;
    publicUrl: string | null;
  };
  createdAt: string | null;
  updatedAt: string | null;
  origin: { kind: 'automatic' | 'manual' | 'no-consta'; detail: string };
  editorialBrief: { title: string | null; intent: string | null; explanation: string[] } | null;
  presence: { queue: boolean; job: boolean; ledger: boolean; post: boolean; inspection: boolean };
  dimensions: Record<FlowDimension, TopicDimensionView>;
  sources: Array<{ url: string; from: string }>;
  lastCompletedStage: { name: string; at: string | null; source: string } | null;
  blockingReason: { reason: string; source: string; technical: boolean } | null;
  retries: { attempts: number | null; maxAttempts: number | null; source: string | null };
  reviewCycles: { count: number | null; log: string[]; source: string | null };
  jobId: string | null;
  availableActions: AvailableAction[];
  unavailableActionsNote: string | null;
  history: TopicHistoryEntry[];
  dataGaps: string[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Recuperación
 * ──────────────────────────────────────────────────────────────────────────── */

export interface RecoveryRequestInput {
  topicId: string;
  action: RecoveryActionKey;
  sources?: string[];
  brief?: { title?: string; intent?: string };
  note?: string;
}

export interface RecoveryResult {
  topicId: string;
  action: RecoveryActionKey;
  applied: boolean;
  gateway: string | null;
  requestId: string | null;
  detail: string;
  fingerprint: string;
  inspectedDuplicates?: Array<{ id: string; title: string; similarity: number }>;
}

export type BulkRecoveryCode = 'not-found' | 'not-applicable' | 'unchanged-condition' | 'error';

export interface BulkRecoveryItem {
  topicId: string;
  ok: boolean;
  gateway: string | null;
  requestId: string | null;
  detail: string;
  code?: BulkRecoveryCode;
}

export interface BulkRecoveryResult {
  action: RecoveryActionKey;
  results: BulkRecoveryItem[];
  succeeded: number;
  failed: number;
  note: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Reconciliación de registros legacy
 * ──────────────────────────────────────────────────────────────────────────── */

export type ReconciliationVerdict = 'publicado' | 'no publicado' | 'desconocido';

export interface ReconciliationRecord {
  postId: string;
  slug: string;
  title: string;
  status: string | null;
  reviewState: string | null;
  publishedAt: string | null;
  publicUrl: string | null;
  inSitemap: boolean;
  sitemapRule: string;
  gsc: { inspected: boolean; coverageState: string | null; inspectedAt: string | null; seoState: string } | null;
  eligibilityGates: Array<{ gate: string; label: string; status: 'ok' | 'missing' | 'unknown'; detail: string; source: string }>;
  verdict: ReconciliationVerdict;
  verdictReason: string;
  unknowns: string[];
}

export interface ReconciliationReport {
  generatedAt: string;
  rule: string;
  count: number;
  records: ReconciliationRecord[];
  mass: { total: number; published: number; notPublished: number; unknown: number; note: string };
  dataGaps: string[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Planificador y publicación manual (se informan por separado)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface SchedulerStatus {
  generatedAt: string;
  generation: {
    enabled: boolean;
    paused: boolean;
    activated: boolean;
    active: boolean;
    scheduleHours: number;
    nextRunAt: string | null;
    lastSeenAt: string | null;
    runner: { online: boolean; status: string; lastError: string | null; process: { configured: boolean; running: boolean; pid: number | null } };
    lastCycle: { at: string; result: string; reason: string | null; queued: number; generated: number } | null;
    notes: string[];
  };
  publication: {
    automatic: { envEnabled: boolean; activated: boolean; paused: boolean; active: boolean; dailyLimit: number };
    manual: { available: boolean; blockedBy: string[]; note: string };
  };
  queue: { manualPending: number; discovered: number; running: number } | null;
  notes: string[];
}

/** Error de transporte con el cuerpo de la API intacto (para leer 409 y sus bloqueos). */
export class EditorialFlowHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
    readonly details: unknown
  ) {
    super(message);
    this.name = 'EditorialFlowHttpError';
  }
}

const errorFrom = (error: unknown, fallback: string): EditorialFlowHttpError => {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as
      | { error?: { message?: string; code?: string; details?: unknown }; message?: string }
      | string
      | null;
    const payload = typeof body === 'object' && body ? body.error : null;
    const message =
      (payload && typeof payload === 'object' && typeof payload.message === 'string' && payload.message) ||
      (typeof body === 'object' && body && typeof body.message === 'string' && body.message) ||
      (typeof body === 'string' && body) ||
      fallback;
    const code = payload && typeof payload === 'object' && typeof payload.code === 'string' ? payload.code : null;
    return new EditorialFlowHttpError(error.status, code, message, payload && typeof payload === 'object' ? payload.details : null);
  }
  return new EditorialFlowHttpError(0, null, error instanceof Error ? error.message : fallback, null);
};

export interface FlowApiResponse<T> {
  success: boolean;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class AdminEditorialFlowService {
  private readonly baseUrl = `${environment.API_BASE_URL}/admin/editorial/flow`;

  constructor(private readonly http: HttpClient) {}

  /** Contrato versionado de estados; la guía (Vista A) se renderiza desde aquí. */
  getGuide(): Observable<FlowGuideResponse> {
    return this.http
      .get<FlowApiResponse<FlowGuideResponse>>(`${this.baseUrl}/guide`)
      .pipe(map((resp) => resp.data), catchError((error) => throwError(() => errorFrom(error, 'No se pudo cargar el contrato de estados'))));
  }

  /** Embudo en vivo. Cada etapa conserva su `measured`/`unavailable`. */
  getFunnel(scope: FlowScopeQuery = {}): Observable<FunnelReport> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(scope)) {
      if (typeof value === 'string' && value.trim()) params.set(key, value.trim());
    }
    const suffix = params.toString();
    return this.http
      .get<FlowApiResponse<FunnelReport>>(`${this.baseUrl}/funnel${suffix ? `?${suffix}` : ''}`)
      .pipe(map((resp) => resp.data), catchError((error) => throwError(() => errorFrom(error, 'No se pudo cargar el embudo del flujo editorial'))));
  }

  /** Ficha completa de un tema: cuatro dimensiones + SEO, motivo de bloqueo y acciones. */
  getTopic(topicId: string): Observable<TopicView> {
    return this.http
      .get<FlowApiResponse<TopicView>>(`${this.baseUrl}/topic/${encodeURIComponent(topicId)}`)
      .pipe(map((resp) => resp.data), catchError((error) => throwError(() => errorFrom(error, 'No se pudo cargar la ficha del tema'))));
  }

  /** Reconciliación de los registros legacy (veredicto publicado/no publicado/desconocido). */
  getReconciliation(scope: FlowScopeQuery = {}): Observable<ReconciliationReport> {
    const params = new URLSearchParams();
    for (const key of ['from', 'to', 'category', 'publicationStatus'] as const) {
      const value = scope[key];
      if (typeof value === 'string' && value.trim()) params.set(key, value.trim());
    }
    const suffix = params.toString();
    return this.http
      .get<FlowApiResponse<ReconciliationReport>>(`${this.baseUrl}/reconciliation${suffix ? `?${suffix}` : ''}`)
      .pipe(map((resp) => resp.data), catchError((error) => throwError(() => errorFrom(error, 'No se pudo cargar la reconciliación de registros'))));
  }

  /** Estado del planificador y de la publicación manual, informados por separado. */
  getScheduler(): Observable<SchedulerStatus> {
    return this.http
      .get<FlowApiResponse<SchedulerStatus>>(`${this.baseUrl}/scheduler`)
      .pipe(map((resp) => resp.data), catchError((error) => throwError(() => errorFrom(error, 'No se pudo cargar el estado del planificador'))));
  }

  /** Recuperación individual. Un 409 llega con su motivo en español. */
  recover(input: RecoveryRequestInput): Observable<RecoveryResult> {
    const body: Record<string, unknown> = { action: input.action };
    if (input.sources?.length) body['sources'] = input.sources;
    if (input.brief) body['brief'] = input.brief;
    if (input.note) body['note'] = input.note;
    return this.http
      .post<FlowApiResponse<RecoveryResult>>(`${this.baseUrl}/recovery/${encodeURIComponent(input.topicId)}`, body)
      .pipe(map((resp) => resp.data), catchError((error) => throwError(() => errorFrom(error, 'No se pudo ejecutar la recuperación'))));
  }

  /** Recuperación en lote: un resultado por ítem; un fallo no cancela el resto. */
  recoverBulk(input: { topicIds: string[]; action: RecoveryActionKey; note?: string }): Observable<BulkRecoveryResult> {
    const body: Record<string, unknown> = { topicIds: input.topicIds, action: input.action };
    if (input.note) body['note'] = input.note;
    return this.http
      .post<FlowApiResponse<BulkRecoveryResult>>(`${this.baseUrl}/recovery/bulk`, body)
      .pipe(map((resp) => resp.data), catchError((error) => throwError(() => errorFrom(error, 'No se pudo ejecutar la recuperación en lote'))));
  }

  /** Publicación manual inmediata por la ruta real; exige la clave de revisión humana y una clave de idempotencia. */
  publishNow(postId: string, reviewKey: string, reviewer: string, idempotencyKey: string): Observable<unknown> {
    const headers = new HttpHeaders({
      'x-editorial-review-key': reviewKey,
      'x-editorial-reviewer': reviewer,
      'Idempotency-Key': idempotencyKey,
    });
    return this.http
      .post<FlowApiResponse<unknown>>(`${this.baseUrl}/publication/${encodeURIComponent(postId)}/now`, {}, { headers })
      .pipe(map((resp) => resp.data), catchError((error) => throwError(() => errorFrom(error, 'No se pudo publicar el artículo'))));
  }
}
