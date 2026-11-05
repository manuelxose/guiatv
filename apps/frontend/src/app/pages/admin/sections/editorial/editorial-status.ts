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

export interface DiffLine { kind: 'same' | 'add' | 'del'; text: string }

/**
 * Line diff of two HTML/text bodies (tags start a new line so a paragraph change reads as one line).
 * shortcut: LCS table is O(n*m), so very large inputs fall back to "everything changed"; upgrade if posts exceed ~1500 lines.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const split = (s: string) => s.replace(/></g, '>\n<').split('\n').map((l) => l.trim()).filter(Boolean);
  const a = split(before);
  const b = split(after);
  if (a.length * b.length > 2_250_000) return [...a.map((text) => ({ kind: 'del' as const, text })), ...b.map((text) => ({ kind: 'add' as const, text }))];
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: 'del', text: a[i++] });
    else out.push({ kind: 'add', text: b[j++] });
  }
  while (i < a.length) out.push({ kind: 'del', text: a[i++] });
  while (j < b.length) out.push({ kind: 'add', text: b[j++] });
  return out;
}

/** Messages of a rejected quality gate (the API lists each failed check), for showing next to the approve button. */
export function gateDetails(error: unknown): string[] {
  const body = (error as { error?: { error?: { details?: unknown }; details?: unknown; errors?: unknown } })?.error;
  const list = body?.error?.details ?? body?.details ?? body?.errors;
  return Array.isArray(list) ? list.map((x) => String((x as { message?: string })?.message ?? x)).filter(Boolean) : [];
}

/** The pipeline's roles in the order a run goes through them. */
export const RUN_STEPS: Array<{ role: string; label: string }> = [
  { role: 'research', label: 'Investigación' }, { role: 'evidence', label: 'Evidencias' }, { role: 'editorial', label: 'Redacción' },
  { role: 'seo', label: 'SEO' }, { role: 'critic', label: 'Crítico' },
];
