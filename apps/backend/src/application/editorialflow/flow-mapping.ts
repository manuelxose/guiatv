/**
 * M14-R7 — Funciones puras de mapeo desde los datos existentes hacia la vista
 * compuesta de las cuatro dimensiones + SEO.
 *
 * Principios:
 * - Sin mutación de la entrada (las funciones son puras).
 * - Sin heurísticas ocultas: cada mapeo pasa por una TABLA explícita exportada.
 * - Sin fabricar historia: lo que no consta se representa como 'sin-datos'; un
 *   valor presente pero no reconocido se representa como 'desconocido'.
 * - La procedencia (colección + versión de flujo o 'no-consta') viaja siempre.
 */

import {
  CANDIDATE_STATES,
  EDITORIAL_STATES,
  EXECUTION_STATES,
  PUBLICATION_STATES,
  SEO_STATES,
  UNKNOWN,
  NO_DATA,
  type CandidateState,
  type EditorialState,
  type ExecutionState,
  type PublicationState,
  type SeoState,
  type DimensionMarker,
} from './flow-states';

export interface FlowProvenance {
  /** Colección MongoDB de origen del registro. */
  collection: string;
  /** Versión del flujo si consta en el registro; 'no-consta' en caso contrario. */
  workflowVersion: string | 'no-consta';
}

export type DimensionField<State extends string> = State | DimensionMarker;

/** Vista compuesta producida por cada función de mapeo. */
export interface FlowView {
  candidate: DimensionField<CandidateState>;
  editorial: DimensionField<EditorialState>;
  execution: DimensionField<ExecutionState>;
  publication: DimensionField<PublicationState>;
  seo: DimensionField<SeoState>;
  /** Valor crudo del estado de origen, para trazabilidad. */
  rawState: string | null;
  /** Motivo crudo del estado de origen, para trazabilidad. */
  reason: string | null;
  provenance: FlowProvenance;
  /** true solo cuando el registro quedó bloqueado por un error técnico ('error: …'). */
  technicalFailure: boolean;
}

/* ────────────────────────────────────────────────────────────────────────────
 * TABLAS DE MAPEO EXPLÍCITAS (documentadas y exportadas para las pruebas)
 * ──────────────────────────────────────────────────────────────────────────── */

/** editorial_jobs.state → dimensión de ejecución (valor terminal del pipeline). */
export const JOB_STATE_TO_EXECUTION: Record<string, ExecutionState | DimensionMarker> = {
  blocked: 'blocked', // refinado por el motivo: 'error:' → 'failed', 'agotados…' → 'blocked'
  discovery: 'completed',
  published: 'completed',
  'maintenance-verified': 'completed',
  'maintenance-unverifiable': 'blocked',
};

/** editorial_jobs.state → dimensión de publicación. */
export const JOB_STATE_TO_PUBLICATION: Record<string, PublicationState | DimensionMarker> = {
  blocked: 'unpublished',
  discovery: 'unpublished',
  published: 'published',
  'maintenance-verified': 'published',
  'maintenance-unverifiable': 'published',
};

/** editorial_jobs.state → dimensión editorial (refinada por el motivo cuando es 'blocked'). */
export const JOB_STATE_TO_EDITORIAL: Record<string, EditorialState | DimensionMarker> = {
  blocked: UNKNOWN, // se resuelve por el motivo (ver JOB_BLOCKED_REASON_TO_EDITORIAL)
  discovery: NO_DATA,
  published: 'approved',
  'maintenance-verified': 'approved',
  'maintenance-unverifiable': 'approved',
};

/** Motivo de un editorial_jobs bloqueado → dimensión editorial. */
export const JOB_BLOCKED_REASON_TO_EDITORIAL: Record<string, EditorialState | DimensionMarker> = {
  'review-exhausted': 'rejected', // "agotados los ciclos de revisión"
  technical: NO_DATA, // "error: …"
  limit: NO_DATA, // "límite: …"
  other: NO_DATA,
};

/** Motivo de un editorial_jobs bloqueado → dimensión de ejecución. */
export const JOB_BLOCKED_REASON_TO_EXECUTION: Record<string, ExecutionState> = {
  'review-exhausted': 'blocked',
  technical: 'failed',
  limit: 'blocked',
  other: 'blocked',
};

/** editorial_queue_snapshot.items[].state → dimensión de candidato. */
export const QUEUE_STATE_TO_CANDIDATE: Record<string, CandidateState | DimensionMarker> = {
  queued: 'eligible',
  running: 'eligible',
  published: 'eligible',
  held: 'retained',
  rejected: 'rejected', // refinado por el prefijo del motivo
  expired: 'rejected',
};

/** Prefijo del motivo de la cola (state=rejected) → dimensión de candidato. */
export const QUEUE_REASON_PREFIX_TO_CANDIDATE: Record<string, CandidateState> = {
  'insufficient-evidence:': 'rejected',
  'invalid-candidate:': 'invalid',
  'duplicate:': 'duplicate',
  'manual:': 'rejected',
};

/** editorial_queue_snapshot.items[].state → dimensión de ejecución. */
export const QUEUE_STATE_TO_EXECUTION: Record<string, ExecutionState | DimensionMarker> = {
  queued: 'queued',
  running: 'running',
  published: 'completed',
  held: 'blocked',
  rejected: NO_DATA,
  expired: NO_DATA,
};

/** blog_posts.status → dimensión de publicación. */
export const BLOG_STATUS_TO_PUBLICATION: Record<string, PublicationState> = {
  publish: 'published',
  draft: 'unpublished', // 'draft' + reviewState 'approved' se refina a 'ready'
};

/** blog_posts.reviewState → dimensión editorial. */
export const BLOG_REVIEW_STATE_TO_EDITORIAL: Record<string, EditorialState | DimensionMarker> = {
  approved: 'approved',
  rejected: 'rejected',
  'in-review': 'reviewing',
  unreviewed: 'drafting',
};

/** editorial_job_ledger.state → dimensión de ejecución. */
export const LEDGER_STATE_TO_EXECUTION: Record<string, ExecutionState | DimensionMarker> = {
  queued: 'queued',
  running: 'running',
  paused: 'paused',
  cancelling: 'cancelled',
  cancelled: 'cancelled',
  completed: 'completed',
  failed: 'failed',
  'dead-letter': 'failed',
  blocked: 'blocked',
};

/** editorial_job_ledger.publication.state → dimensión de publicación. */
export const LEDGER_PUBLICATION_STATE_TO_PUBLICATION: Record<string, PublicationState> = {
  publishing: 'publishing',
  published: 'published',
  rejected: 'unpublished',
};

/** Etapa del ledger (StageName) → dimensión editorial. */
export const STAGE_TO_EDITORIAL: Record<string, EditorialState | DimensionMarker> = {
  'topic-selection': NO_DATA,
  'source-discovery': 'researching',
  'source-retrieval': 'researching',
  'evidence-validation': 'researching',
  'research-synthesis': 'researching',
  'editorial-outline': 'researching',
  'article-drafting': 'drafting',
  'seo-enrichment': 'drafting',
  'quality-evaluation': 'reviewing',
  revision: 'revision-required',
  'publication-eligibility': 'reviewing',
  publication: 'approved',
  'sitemap-registration': 'approved',
};

/** editorial_gsc_inspections.coverageState (texto de Google, ES) → estado SEO. */
export const GSC_COVERAGE_TO_SEO: Record<string, SeoState> = {
  'Google no reconoce esta URL': 'no-reconocida',
  'Descubierta: actualmente sin indexar': 'descubierta-sin-indexar',
  'Rastreada: actualmente sin indexar': 'crawleada-sin-indexar',
  'Página indexada': 'indexada',
};

/** Clasificación normalizada de GSC (SearchConsoleMonitor.GscIndexClass) → estado SEO. */
export const GSC_INDEX_CLASS_TO_SEO: Record<string, SeoState> = {
  indexed: 'indexada',
  blocked: 'bloqueada',
  'fetch-error': 'error-de-fetch',
  'alternate-canonical': 'no-reconocida',
  'crawled-not-indexed': 'crawleada-sin-indexar',
  'discovered-not-indexed': 'descubierta-sin-indexar',
  'not-discovered': 'no-reconocida',
  'insufficient-evidence': 'evidencia-insuficiente',
};

/* ────────────────────────────────────────────────────────────────────────────
 * UTILIDADES PURAS
 * ──────────────────────────────────────────────────────────────────────────── */

export function isCandidateState(value: string): value is CandidateState {
  return (CANDIDATE_STATES as readonly string[]).includes(value);
}
export function isEditorialState(value: string): value is EditorialState {
  return (EDITORIAL_STATES as readonly string[]).includes(value);
}
export function isExecutionState(value: string): value is ExecutionState {
  return (EXECUTION_STATES as readonly string[]).includes(value);
}
export function isPublicationState(value: string): value is PublicationState {
  return (PUBLICATION_STATES as readonly string[]).includes(value);
}
export function isSeoState(value: string): value is SeoState {
  return (SEO_STATES as readonly string[]).includes(value);
}

/** Resuelve un valor crudo contra una tabla: tabla → valor | 'desconocido' | (vacío → 'sin-datos'). */
function mapByTable<State extends string>(
  raw: string | null | undefined,
  table: Record<string, State | DimensionMarker>,
): State | DimensionMarker {
  if (raw === null || raw === undefined || raw === '') return NO_DATA;
  const value = table[raw];
  return value === undefined ? UNKNOWN : value;
}

function provenanceOf(collection: string, record: Record<string, unknown>): FlowProvenance {
  const workflowVersion =
    typeof record.workflowVersion === 'string' && record.workflowVersion
      ? record.workflowVersion
      : typeof record.pipelineVersion === 'string' && record.pipelineVersion
        ? record.pipelineVersion
        : 'no-consta';
  return { collection, workflowVersion };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/** Clasifica el motivo de un editorial_jobs bloqueado en una de las 4 clases explícitas. */
export function classifyJobBlockedReason(
  reason: string | null | undefined,
): 'review-exhausted' | 'technical' | 'limit' | 'other' {
  const r = (reason ?? '').trim();
  if (r.startsWith('error:')) return 'technical';
  if (/agotados los ciclos de revisi/.test(r)) return 'review-exhausted';
  if (r.startsWith('límite:')) return 'limit';
  return 'other';
}

/** Extrae el prefijo de motivo de la cola: 'insufficient-evidence:', 'invalid-candidate:', 'duplicate:', 'manual:'. */
export function queueReasonPrefix(reason: string | null | undefined): string | null {
  const r = (reason ?? '').trim();
  const colon = r.indexOf(':');
  if (colon <= 0) return null;
  return r.slice(0, colon + 1).toLowerCase();
}

/* ────────────────────────────────────────────────────────────────────────────
 * FUNCIONES DE MAPEO (puras, sin mutación)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface JobRecord {
  jobId?: unknown;
  slug?: unknown;
  state?: unknown;
  reason?: unknown;
  publicUrl?: unknown;
  workflowVersion?: unknown;
  pipelineVersion?: unknown;
  [key: string]: unknown;
}

/** Mapea un documento de `editorial_jobs` a la vista compuesta. */
export function mapJobRecord(record: JobRecord): FlowView {
  const raw = text(record.state);
  const reason = text(record.reason);
  const base = mapByTable(raw, JOB_STATE_TO_EXECUTION);
  const publication = mapByTable(raw, JOB_STATE_TO_PUBLICATION);
  const editorial = mapByTable(raw, JOB_STATE_TO_EDITORIAL);

  let execution: DimensionField<ExecutionState> = base;
  let editorialState: DimensionField<EditorialState> = editorial;
  let technicalFailure = false;

  if (raw === 'blocked') {
    const kind = classifyJobBlockedReason(reason);
    technicalFailure = kind === 'technical';
    execution = JOB_BLOCKED_REASON_TO_EXECUTION[kind];
    editorialState = JOB_BLOCKED_REASON_TO_EDITORIAL[kind];
  }

  // La cola/discovery no tiene estado de candidato propio salvo el job de descubrimiento.
  const candidate: DimensionField<CandidateState> =
    raw === 'discovery' ? 'discovered' : raw === 'published' || raw === 'maintenance-verified' || raw === 'maintenance-unverifiable' || raw === 'blocked' ? 'eligible' : NO_DATA;

  return {
    candidate,
    editorial: editorialState,
    execution,
    publication,
    seo: NO_DATA,
    rawState: raw,
    reason,
    provenance: provenanceOf('editorial_jobs', record),
    technicalFailure,
  };
}

export interface QueueItem {
  id?: unknown;
  state?: unknown;
  reason?: unknown;
  attempts?: unknown;
  [key: string]: unknown;
}

/** Mapea un ítem de `editorial_queue_snapshot.items[]` a la vista compuesta. */
export function mapQueueItem(item: QueueItem): FlowView {
  const raw = text(item.state);
  const reason = text(item.reason);

  let candidate: DimensionField<CandidateState> = mapByTable(raw, QUEUE_STATE_TO_CANDIDATE);
  if (raw === 'rejected') {
    const prefix = queueReasonPrefix(reason);
    candidate = prefix && QUEUE_REASON_PREFIX_TO_CANDIDATE[prefix] ? QUEUE_REASON_PREFIX_TO_CANDIDATE[prefix] : 'rejected';
  }

  const execution: DimensionField<ExecutionState> = mapByTable(raw, QUEUE_STATE_TO_EXECUTION);
  const publication: DimensionField<PublicationState> = raw === 'published' ? 'published' : 'unpublished';

  // Editorial: solo se conoce si se publicó (aprobado) o si quedó retenido por revisión agotada.
  let editorial: DimensionField<EditorialState> = NO_DATA;
  if (raw === 'published') editorial = 'approved';
  else if (raw === 'held' && /agotados los ciclos de revisi/.test(reason ?? '')) editorial = 'rejected';

  return {
    candidate,
    editorial,
    execution,
    publication,
    seo: NO_DATA,
    rawState: raw,
    reason,
    provenance: { collection: 'editorial_queue_snapshot', workflowVersion: 'no-consta' },
    technicalFailure: false,
  };
}

export interface BlogPost {
  slug?: unknown;
  status?: unknown;
  origin?: unknown;
  reviewState?: unknown;
  [key: string]: unknown;
}

/** Mapea un documento de `blog_posts` a la vista compuesta. */
export function mapBlogPost(post: BlogPost): FlowView {
  const raw = text(post.status);
  const reviewState = text(post.reviewState);

  let publication: DimensionField<PublicationState> = mapByTable(raw, BLOG_STATUS_TO_PUBLICATION);
  if (raw === 'draft' && reviewState === 'approved') publication = 'ready';

  const editorial: DimensionField<EditorialState> = mapByTable(reviewState, BLOG_REVIEW_STATE_TO_EDITORIAL);

  return {
    candidate: NO_DATA, // blog_posts no registra la dimensión de candidato
    editorial,
    execution: NO_DATA, // blog_posts no registra la dimensión de ejecución
    publication,
    seo: NO_DATA, // la indexación vive en editorial_gsc_inspections, no en blog_posts
    rawState: raw,
    reason: null,
    provenance: { collection: 'blog_posts', workflowVersion: 'no-consta' },
    technicalFailure: false,
  };
}

export interface LedgerJob {
  jobId?: unknown;
  slug?: unknown;
  kind?: unknown;
  state?: unknown;
  currentStage?: unknown;
  attempt?: unknown;
  stages?: unknown;
  publication?: { state?: unknown } | null;
  [key: string]: unknown;
}

/** Mapea un documento de `editorial_job_ledger` a la vista compuesta. */
export function mapLedgerJob(job: LedgerJob): FlowView {
  const raw = text(job.state);
  const kind = text(job.kind);
  const currentStage = text(job.currentStage);
  const attempt = typeof job.attempt === 'number' ? job.attempt : 0;

  let execution: DimensionField<ExecutionState> = mapByTable(raw, LEDGER_STATE_TO_EXECUTION);
  // Reintento explícito: encolado de nuevo tras un intento previo.
  if (raw === 'queued' && attempt > 0) execution = 'retrying';

  const pubState = text(job.publication?.state);
  const publication: DimensionField<PublicationState> =
    pubState === null ? 'unpublished' : mapByTable(pubState, LEDGER_PUBLICATION_STATE_TO_PUBLICATION);

  // Editorial: publicado implica aprobado; si no, se deriva de la etapa actual.
  let editorial: DimensionField<EditorialState>;
  if (pubState === 'published') editorial = 'approved';
  else editorial = mapByTable(currentStage, STAGE_TO_EDITORIAL);

  const candidate: DimensionField<CandidateState> = kind === 'discovery' ? 'discovered' : 'eligible';

  return {
    candidate,
    editorial,
    execution,
    publication,
    seo: NO_DATA,
    rawState: raw,
    reason: null,
    provenance: { collection: 'editorial_job_ledger', workflowVersion: 'no-consta' },
    technicalFailure: false,
  };
}

export interface GscInspection {
  url?: unknown;
  coverageState?: unknown;
  indexingState?: unknown;
  pageFetchState?: unknown;
  robotsTxtState?: unknown;
  verdict?: unknown;
  gscIndexClass?: unknown;
  [key: string]: unknown;
}

/** Mapea una inspección de `editorial_gsc_inspections` a un estado SEO. */
export function mapGscInspection(inspection: GscInspection | null | undefined): SeoState | DimensionMarker {
  if (!inspection || (!inspection.coverageState && !inspection.verdict && !inspection.gscIndexClass)) return 'no-inspeccionado';

  // Si el consumidor ya normalizó la clase (SearchConsoleMonitor.GscIndexClass), gana la tabla normalizada.
  const gscClass = text(inspection.gscIndexClass);
  if (gscClass && GSC_INDEX_CLASS_TO_SEO[gscClass]) return GSC_INDEX_CLASS_TO_SEO[gscClass];

  const coverage = text(inspection.coverageState);
  if (coverage && GSC_COVERAGE_TO_SEO[coverage]) return GSC_COVERAGE_TO_SEO[coverage];

  // Fallback explícito a la clasificación conocida por el código existente.
  if (inspection.verdict === 'PASS' || inspection.verdict === 'PARTIAL') return 'indexada';
  if (inspection.robotsTxtState === 'DISALLOWED' || /^BLOCKED_BY_/.test(String(inspection.indexingState ?? ''))) return 'bloqueada';
  if (coverage && /rastreada|crawled/i.test(coverage)) return 'crawleada-sin-indexar';
  if (coverage && /descubierta|discovered/i.test(coverage)) return 'descubierta-sin-indexar';
  if (coverage) return UNKNOWN;

  return 'evidencia-insuficiente';
}
