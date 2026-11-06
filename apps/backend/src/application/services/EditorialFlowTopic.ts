/**
 * M14-R7 — Ficha completa de un tema (identidad, cuatro dimensiones, fuentes,
 * bloqueo, reintentos, ciclos de revisión, jobId, acciones e historia).
 *
 * Todo lo que se devuelve consta en un documento real. Lo que no consta se
 * declara como hueco de datos (`dataGaps`) o como estado 'sin-datos'/'desconocido'
 * del contrato compartido; NUNCA se rellena una historia inventada.
 */

import {
  CANDIDATE_META,
  EDITORIAL_META,
  EXECUTION_META,
  PUBLICATION_META,
  SEO_META,
  mapBlogPost,
  mapGscInspection,
  mapJobRecord,
  mapLedgerJob,
  mapQueueItem,
  type DimensionMarker,
  type FlowView,
} from '../editorialflow';
import { topicActions, topicHistory, type AvailableAction, type TopicHistoryEntry } from './EditorialFlowTopicTimeline';

export type { AvailableAction, TopicHistoryEntry } from './EditorialFlowTopicTimeline';

export type TopicStateValue = string;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const isoOrNull = (value: unknown): string | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};
const isMarker = (value: string): value is DimensionMarker => value === 'desconocido' || value === 'sin-datos';

export interface TopicDimensionView {
  dimension: 'candidate' | 'editorial' | 'execution' | 'publication' | 'seo';
  state: TopicStateValue;
  label: string;
  definition: string;
  notImplies: string[];
  provenance: { collection: string; workflowVersion: string };
  rawState: string | null;
  reason: string | null;
}

export interface TopicSourceReference {
  url: string;
  from: string;
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
  dimensions: {
    candidate: TopicDimensionView;
    editorial: TopicDimensionView;
    execution: TopicDimensionView;
    publication: TopicDimensionView;
    seo: TopicDimensionView;
  };
  sources: TopicSourceReference[];
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

export interface TopicSourceBundle {
  topicId: string;
  /** Ítem de `editorial_queue_snapshot.items[]` (cola vigente). */
  queueItem?: Record<string, unknown>;
  /** Documento de `editorial_jobs` (pasada del runner). */
  job?: Record<string, unknown>;
  /** Documento de `editorial_job_ledger`. */
  ledger?: Record<string, unknown>;
  /** Documento de `blog_posts`. */
  post?: Record<string, unknown>;
  /** Documento de `editorial_gsc_inspections`. */
  inspection?: Record<string, unknown>;
  /** Solicitudes de generación asociadas al tema (para deducir el origen). */
  generationRequests?: Array<Record<string, unknown>>;
  /** Acciones de cola registradas para el tema (decisión manual). */
  queueActions?: Array<Record<string, unknown>>;
}

const PROVENANCE_ORDER = {
  candidate: ['queueItem', 'ledger', 'job'],
  editorial: ['post', 'job', 'ledger', 'queueItem'],
  execution: ['ledger', 'job', 'queueItem'],
  publication: ['post', 'job', 'ledger', 'queueItem'],
} as const;

interface SourceView {
  key: 'queueItem' | 'job' | 'ledger' | 'post';
  view: FlowView;
}

function viewsOf(bundle: TopicSourceBundle): SourceView[] {
  const views: SourceView[] = [];
  if (bundle.queueItem) views.push({ key: 'queueItem', view: mapQueueItem(bundle.queueItem) });
  if (bundle.job) views.push({ key: 'job', view: mapJobRecord(bundle.job) });
  if (bundle.ledger) views.push({ key: 'ledger', view: mapLedgerJob(bundle.ledger) });
  if (bundle.post) views.push({ key: 'post', view: mapBlogPost(bundle.post) });
  return views;
}

interface PickedDimension {
  value: TopicStateValue;
  provenance: { collection: string; workflowVersion: string };
  rawState: string | null;
  reason: string | null;
}

function pickDimension(dimension: keyof typeof PROVENANCE_ORDER, views: SourceView[]): PickedDimension {
  for (const source of PROVENANCE_ORDER[dimension]) {
    const found = views.find((entry) => entry.key === source);
    if (!found) continue;
    const value = String(found.view[dimension]);
    if (isMarker(value)) continue;
    return { value, provenance: found.view.provenance, rawState: found.view.rawState, reason: found.view.reason };
  }
  const fallback = views[0];
  return {
    value: 'sin-datos',
    provenance: fallback?.view.provenance ?? { collection: 'ninguna', workflowVersion: 'no-consta' },
    rawState: fallback?.view.rawState ?? null,
    reason: fallback?.view.reason ?? null,
  };
}

type MetaMap = Record<string, { label: string; definition: string; notImplies: string[] }>;
const META: Record<'candidate' | 'editorial' | 'execution' | 'publication' | 'seo', MetaMap> = {
  candidate: CANDIDATE_META as unknown as MetaMap,
  editorial: EDITORIAL_META as unknown as MetaMap,
  execution: EXECUTION_META as unknown as MetaMap,
  publication: PUBLICATION_META as unknown as MetaMap,
  seo: SEO_META as unknown as MetaMap,
};

function dimensionView(
  dimension: 'candidate' | 'editorial' | 'execution' | 'publication',
  picked: PickedDimension
): TopicDimensionView {
  const meta = META[dimension][picked.value];
  return {
    dimension,
    state: picked.value,
    label: meta?.label ?? (picked.value === 'desconocido' ? 'Desconocido' : 'Sin datos'),
    definition:
      meta?.definition ??
      'El registro existe, pero no consta en qué estado está en esta dimensión: no se rellena con un estado inventado.',
    notImplies: meta?.notImplies ?? ['No consta: no se puede afirmar nada sobre esta dimensión.'],
    provenance: picked.provenance,
    rawState: picked.rawState,
    reason: picked.reason,
  };
}

function seoDimensionView(bundle: TopicSourceBundle): TopicDimensionView {
  const inspection = (bundle.inspection ?? null) as Parameters<typeof mapGscInspection>[0];
  const value = mapGscInspection(inspection);
  const meta = META.seo[value];
  return {
    dimension: 'seo',
    state: value,
    label: meta?.label ?? (value === 'desconocido' ? 'Desconocido' : 'Sin datos'),
    definition:
      meta?.definition ?? 'No hay inspección de Search Console registrada para la URL: la indexación no consta y no se deduce de la publicación.',
    notImplies: meta?.notImplies ?? ['No consta: publicado no implica indexado.'],
    provenance: { collection: 'editorial_gsc_inspections', workflowVersion: 'no-consta' },
    rawState: bundle.inspection ? text(bundle.inspection.coverageState) || null : null,
    reason: bundle.inspection ? text(bundle.inspection.error) || null : null,
  };
}

function sourcesOf(bundle: TopicSourceBundle): TopicSourceReference[] {
  const references: TopicSourceReference[] = [];
  const push = (url: unknown, from: string) => {
    const value = text(url);
    if (value) references.push({ url: value, from });
  };
  if (Array.isArray(bundle.queueItem?.sources)) (bundle.queueItem!.sources as unknown[]).forEach((url) => push(url, 'editorial_queue_snapshot'));
  const editorial = bundle.post?.editorial as { bundle?: { sources?: Array<{ url?: unknown }> } } | undefined;
  if (Array.isArray(editorial?.bundle?.sources)) {
    (editorial!.bundle!.sources as Array<{ url?: unknown }>).forEach((source) => push(source?.url, 'blog_posts.editorial.bundle'));
  }
  return [...new Map(references.map((reference) => [`${reference.url}|${reference.from}`, reference])).values()];
}

/** Compone la ficha del tema a partir de los documentos reales encontrados. */
export function composeTopicView(bundle: TopicSourceBundle): TopicView {
  const views = viewsOf(bundle);
  const dimensions = {
    candidate: dimensionView('candidate', pickDimension('candidate', views)),
    editorial: dimensionView('editorial', pickDimension('editorial', views)),
    execution: dimensionView('execution', pickDimension('execution', views)),
    publication: dimensionView('publication', pickDimension('publication', views)),
    seo: seoDimensionView(bundle),
  };

  const ledgerStages = Array.isArray(bundle.ledger?.stages) ? (bundle.ledger!.stages as Array<Record<string, unknown>>) : [];
  const completed = ledgerStages
    .filter((stage) => text(stage.state) === 'completed' && isoOrNull(stage.endedAt))
    .sort((left, right) => Date.parse(String(right.endedAt)) - Date.parse(String(left.endedAt)))[0];
  const lastCompletedStage = completed
    ? { name: text(completed.name) || 'no consta', at: isoOrNull(completed.endedAt), source: 'editorial_job_ledger.stages' }
    : null;

  const jobBlocked = text(bundle.job?.state) === 'blocked' ? text(bundle.job?.reason) : '';
  const queueReason = ['rejected', 'held', 'expired'].includes(text(bundle.queueItem?.state)) ? text(bundle.queueItem?.reason) : '';
  const postNotes = text(bundle.post?.reviewState) === 'rejected' ? text(bundle.post?.reviewNotes) : '';
  const blockingText = jobBlocked || queueReason || postNotes;
  const blockingSource = jobBlocked
    ? 'editorial_jobs.reason'
    : queueReason
      ? 'editorial_queue_snapshot.items[].reason'
      : postNotes
        ? 'blog_posts.reviewNotes'
        : null;
  const blockingReason = blockingText
    ? { reason: blockingText, source: blockingSource!, technical: /^error:/i.test(blockingText) }
    : null;

  const attempts = Number.isInteger(bundle.queueItem?.attempts) ? Number(bundle.queueItem!.attempts) : null;
  const ledgerAttempt = Number.isInteger(bundle.ledger?.attempt) ? Number(bundle.ledger!.attempt) : null;
  const retries = {
    attempts: ledgerAttempt ?? attempts,
    maxAttempts: Number.isInteger(bundle.ledger?.maxAttempts) ? Number(bundle.ledger!.maxAttempts) : null,
    source: ledgerAttempt !== null ? 'editorial_job_ledger.attempt' : attempts !== null ? 'editorial_queue_snapshot.items[].attempts' : null,
  };

  const jobRevisions = Number.isInteger(bundle.job?.revisions) ? Number(bundle.job!.revisions) : null;
  const postRevisions = Array.isArray(bundle.post?.revisions) ? (bundle.post!.revisions as unknown[]).length : null;
  const reviewCycles = {
    count: jobRevisions ?? postRevisions,
    log: Array.isArray(bundle.job?.revisionLog) ? (bundle.job!.revisionLog as unknown[]).map((entry) => text(entry)).filter(Boolean) : [],
    source: jobRevisions !== null ? 'editorial_jobs.revisions' : postRevisions !== null ? 'blog_posts.revisions' : null,
  };

  const jobId = text(bundle.ledger?.jobId) || text(bundle.job?.jobId) || null;
  const slug = text(bundle.queueItem?.id) || text(bundle.post?.slug) || text(bundle.ledger?.slug) || text(bundle.job?.slug) || null;
  const title = text(bundle.queueItem?.title) || text(bundle.post?.title) || null;
  const postCategories = Array.isArray(bundle.post?.categories) ? (bundle.post!.categories as Array<{ name?: unknown }>) : [];
  const category = text(bundle.queueItem?.category) || text(postCategories[0]?.name) || null;
  const postId = bundle.post?._id ? String(bundle.post._id) : null;
  const publicUrl =
    text(bundle.job?.publicUrl) ||
    (text(bundle.post?.status) === 'publish' && text(bundle.post?.slug) ? `https://guiaprogramaciontv.com/guias/${text(bundle.post?.slug)}` : '');

  const queueAction = (bundle.queueActions ?? []).find((row) => text(row.status) !== 'cancelled');
  const generated = (bundle.generationRequests ?? []).find((row) => text(row.kind) === 'generate');
  const origin = queueAction
    ? { kind: 'manual' as const, detail: `Decisión manual registrada para el tema (solicitud ${text(queueAction.id) || 'sin id'}, creada por ${text(queueAction.createdBy) || 'un operador'})` }
    : generated
      ? { kind: 'manual' as const, detail: `Solicitud de generación ${text(generated.id) || 'sin id'} creada por ${text(generated.createdBy) || 'un operador'}` }
      : bundle.queueItem
        ? { kind: 'automatic' as const, detail: 'Tema publicado por el ciclo de descubrimiento del runner.' }
        : { kind: 'no-consta' as const, detail: 'No hay registro del origen del tema en las colecciones consultadas.' };

  const presence = {
    queue: Boolean(bundle.queueItem),
    job: Boolean(bundle.job),
    ledger: Boolean(bundle.ledger),
    post: Boolean(bundle.post),
    inspection: Boolean(bundle.inspection),
  };

  const dataGaps: string[] = [];
  if (!presence.queue) dataGaps.push('No consta el tema en la cola vigente (editorial_queue_snapshot): el estado de candidato y el motivo de rechazo pueden faltar.');
  if (!presence.job) dataGaps.push('No hay ejecución registrada (editorial_jobs) para este tema: la última pasada del runner no consta.');
  if (!presence.ledger) dataGaps.push('No hay trabajo en el libro de ejecución (editorial_job_ledger): las etapas, los reintentos y el jobId no constan.');
  if (!presence.post) dataGaps.push('No hay artículo en blog_posts: el estado editorial y la publicación solo pueden deducirse de la ejecución.');
  if (!presence.inspection) dataGaps.push('No hay inspección de Search Console: el estado SEO queda como «no inspeccionado» y no se deduce de la publicación.');

  const states = {
    candidate: dimensions.candidate.state,
    editorial: dimensions.editorial.state,
    execution: dimensions.execution.state,
    publication: dimensions.publication.state,
    seo: dimensions.seo.state,
  };

  return {
    topicId: bundle.topicId,
    identity: { topicId: bundle.topicId, slug, title, category, jobId, postId, publicUrl: publicUrl || null },
    createdAt: isoOrNull(bundle.queueItem?.createdAt) ?? isoOrNull(bundle.post?.createdAt) ?? null,
    updatedAt: isoOrNull(bundle.queueItem?.updatedAt) ?? isoOrNull(bundle.post?.updatedAt) ?? null,
    origin,
    editorialBrief: bundle.queueItem
      ? {
          title: text(bundle.queueItem.title) || null,
          intent: text(bundle.queueItem.intent) || null,
          explanation: Array.isArray(bundle.queueItem.explanation) ? (bundle.queueItem.explanation as unknown[]).map((line) => text(line)).filter(Boolean) : [],
        }
      : null,
    presence,
    dimensions,
    sources: sourcesOf(bundle),
    lastCompletedStage,
    blockingReason,
    retries,
    reviewCycles,
    jobId,
    availableActions: topicActions(states),
    unavailableActionsNote:
      isMarker(states.candidate) && isMarker(states.execution)
        ? 'No hay ningún estado de origen reconocido: no se ofrecen acciones de recuperación porque no se pueden validar contra el estado real.'
        : null,
    history: topicHistory({
      queueItem: bundle.queueItem,
      job: bundle.job,
      ledger: bundle.ledger,
      post: bundle.post,
      inspection: bundle.inspection,
      publicationState: states.publication,
    }),
    dataGaps,
  };
}
