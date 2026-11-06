/**
 * M14-R7 — Historia de transiciones y acciones disponibles de un tema.
 *
 * La historia SOLO contiene entradas que constan en un documento real (fechas y
 * estados almacenados). No se rellena ningún paso intermedio que el sistema no
 * haya registrado, y no se ordena nada que no tenga fecha.
 */

import {
  CANDIDATE_META,
  EDITORIAL_META,
  EXECUTION_META,
  PUBLICATION_META,
  RECOVERY_ACTIONS,
  RECOVERY_ACTIONS_META,
  SEO_META,
  type RecoveryAction,
} from '../editorialflow';

export interface TopicHistoryEntry {
  at: string;
  dimension: 'candidate' | 'editorial' | 'execution' | 'publication' | 'seo' | 'tema';
  what: string;
  detail: string | null;
  source: string;
}

export interface AvailableAction {
  key: RecoveryAction;
  label: string;
  definition: string;
  dimension: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const isoOrNull = (value: unknown): string | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export interface HistoryInput {
  queueItem?: Record<string, unknown>;
  job?: Record<string, unknown>;
  ledger?: Record<string, unknown>;
  post?: Record<string, unknown>;
  inspection?: Record<string, unknown>;
  publicationState: string;
}

/** Construye la historia con los sellos de tiempo realmente almacenados. */
export function topicHistory(input: HistoryInput): TopicHistoryEntry[] {
  const entries: Array<TopicHistoryEntry | null> = [];
  const push = (at: unknown, dimension: TopicHistoryEntry['dimension'], what: string, detail: string | null, source: string) => {
    const value = isoOrNull(at);
    if (value) entries.push({ at: value, dimension, what, detail, source });
  };

  if (input.queueItem) {
    push(input.queueItem.updatedAt, 'candidate', 'Última actualización del tema en la cola', `state=${text(input.queueItem.state) || 'no consta'}`, 'editorial_queue_snapshot');
  }
  if (input.job) {
    push(input.job.startedAt, 'execution', 'Ejecución del runner registrada', `state=${text(input.job.state) || 'no consta'}`, 'editorial_jobs');
    push(input.job.receivedAt, 'execution', 'Resultado de la ejecución recibido por la API', text(input.job.reason) || null, 'editorial_jobs');
  }
  if (input.ledger) {
    push(input.ledger.createdAt, 'execution', 'Trabajo registrado en el libro de ejecución', `kind=${text(input.ledger.kind) || 'no consta'}`, 'editorial_job_ledger');
    const stages = Array.isArray(input.ledger.stages) ? (input.ledger.stages as Array<Record<string, unknown>>) : [];
    for (const stage of stages) {
      push(stage.startedAt, 'editorial', `Etapa iniciada: ${text(stage.name) || 'no consta'}`, text(stage.detail) || null, 'editorial_job_ledger.stages');
      push(stage.endedAt, 'editorial', `Etapa terminada: ${text(stage.name) || 'no consta'}`, `estado=${text(stage.state) || 'no consta'}`, 'editorial_job_ledger.stages');
    }
  }
  if (input.post) {
    push(input.post.createdAt, 'tema', 'Artículo creado en el CMS', null, 'blog_posts');
    push(input.post.publishedAt, 'publication', 'Artículo publicado', null, 'blog_posts');
    push(input.post.updatedAt, 'publication', 'Última modificación del artículo', `status=${text(input.post.status) || 'no consta'}`, 'blog_posts');
  }
  if (input.inspection) {
    push(input.inspection.inspectedAt, 'seo', 'Inspección de Search Console', text(input.inspection.coverageState) || null, 'editorial_gsc_inspections');
  }

  const hasPublicationEntry = entries.some((entry) => entry?.what === 'Artículo publicado');
  const jobUrl = text(input.job?.publicUrl);
  if (input.publicationState === 'published' && !hasPublicationEntry && jobUrl) {
    push(input.job?.receivedAt, 'publication', 'URL pública registrada por la ejecución', jobUrl, 'editorial_jobs.publicUrl');
  }

  const present = entries.filter((entry): entry is TopicHistoryEntry => entry !== null);
  const seen = new Set<string>();
  return present
    .filter((entry) => {
      const key = `${entry.at}|${entry.what}|${entry.detail ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

const META_BY_DIMENSION = {
  candidate: CANDIDATE_META,
  editorial: EDITORIAL_META,
  execution: EXECUTION_META,
  publication: PUBLICATION_META,
  seo: SEO_META,
} as const;

/** Acciones admitidas por los estados reales del tema, en el orden del contrato. */
export function topicActions(states: Record<'candidate' | 'editorial' | 'execution' | 'publication' | 'seo', string>): AvailableAction[] {
  const found: RecoveryAction[] = [];
  for (const dimension of ['candidate', 'editorial', 'execution', 'publication', 'seo'] as const) {
    const state = states[dimension];
    if (state === 'desconocido' || state === 'sin-datos') continue;
    const meta = (META_BY_DIMENSION[dimension] as Record<string, { admittedActions: RecoveryAction[] }>)[state];
    for (const action of meta?.admittedActions ?? []) if (!found.includes(action)) found.push(action);
  }
  return RECOVERY_ACTIONS.filter((action) => found.includes(action)).map((action) => ({
    key: action,
    label: RECOVERY_ACTIONS_META[action].label,
    definition: RECOVERY_ACTIONS_META[action].definition,
    dimension: 'varias',
  }));
}
