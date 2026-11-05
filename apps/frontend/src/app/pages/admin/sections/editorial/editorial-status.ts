import { EditorialPostSummary, EditorialQueueItem } from '../../../../services/admin-editorial.service';

/** One map from every pipeline/queue/job state to its label and badge tone (cf. auctorio's content-status.ts). */
export const STATE_LABELS: Record<string, string> = {
  queued: 'En cola', running: 'En ejecución', completed: 'Completada', failed: 'Fallida', cancelled: 'Cancelada',
  published: 'Publicado', held: 'Retenido', rejected: 'Rechazado', expired: 'Caducado', 'approved-by-policy': 'Aprobado por política',
  verified: 'Revisión humana', blocked: 'Bloqueado', 'requires-update': 'Requiere actualización', draft: 'Borrador', researched: 'Investigado',
  pass: 'Aprobado', revise: 'Revisar', block: 'Bloquea', 'discovery-error': 'Error de descubrimiento', ran: 'Ejecutado',
};

export const STATE_BADGE: Record<string, string> = {
  published: 'healthy', completed: 'healthy', 'approved-by-policy': 'active', pass: 'healthy', queued: 'queued',
  verified: 'current', running: 'current', 'requires-update': 'warning', revise: 'warning', failed: 'failed',
  blocked: 'failed', block: 'failed', held: 'warning', rejected: 'failed', expired: 'unconfigured', cancelled: 'unconfigured', ok: 'healthy',
  partial: 'warning', 'quota-exceeded': 'warning', 'missing-credentials': 'unconfigured', forbidden: 'failed', error: 'failed',
  'discovery-error': 'failed', ran: 'healthy',
};

export type PipelineStage = 'queued' | 'running' | 'review' | 'held' | 'published';
export const PIPELINE_STAGES: Array<{ id: PipelineStage; label: string; hint: string }> = [
  { id: 'queued', label: 'En cola', hint: 'Esperan al runner' },
  { id: 'running', label: 'Generando', hint: 'El runner trabaja en ellos' },
  { id: 'review', label: 'En revisión', hint: 'Necesitan una persona' },
  { id: 'held', label: 'Retenidos', hint: 'Bloqueados o fallidos' },
  { id: 'published', label: 'Publicados', hint: 'Ya en la web' },
];

/** Queue entries that are finished (rejected, expired, published, cancelled) have no stage: they are history, not work. */
export function queueStage(item: Pick<EditorialQueueItem, 'status' | 'state'>): PipelineStage | null {
  const s = item.status ?? item.state;
  if (s === 'queued') return 'queued';
  if (s === 'running') return 'running';
  if (s === 'held' || s === 'failed') return 'held';
  return null;
}

export function postStage(p: Pick<EditorialPostSummary, 'status' | 'pipelineState'>): PipelineStage {
  if (p.status === 'publish') return 'published';
  if (p.pipelineState === 'blocked' || p.pipelineState === 'requires-update') return 'held';
  return 'review';
}
