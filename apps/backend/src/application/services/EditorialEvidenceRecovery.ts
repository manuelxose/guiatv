/**
 * M14-R7 — Recuperación segura de un tema.
 *
 * Cada acción se valida contra el ESTADO REAL del tema (las acciones admitidas
 * las declara el contrato de T1) y se ejecuta con el mecanismo que ya existe:
 * - solicitud de generación (`editorial_generation_requests`),
 * - acción de cola (`queue-action`, la que aplica el runner),
 * - libro de ejecución (`editorial_job_ledger`, con su lease y sus reintentos).
 *
 * Nunca se publica, nunca se sube el límite diario y nunca se reactiva la
 * generación programada desde aquí.
 *
 * El reintento no repite la misma condición: se calcula una huella de la causa
 * (acción + fuentes + motivo + estado de partida). Si la huella no ha cambiado
 * desde el intento anterior registrado, se responde 409 explicando por qué NO se
 * relanza la misma petición.
 */

import { createHash } from 'node:crypto';
import { ConflictError, ValidationError } from '../../shared/errors';
import { RECOVERY_ACTIONS, RECOVERY_ACTIONS_META, type RecoveryAction } from '../editorialflow';
import type { FlowReadPort } from './EditorialFlowScope';
import type { TopicView } from './EditorialFlowTopic';
import { cleanSlug, similarity, topicTokens } from './EditorialTopicQueue';

export const MAX_BULK_RECOVERY = 50;

/** Acciones que relanzan trabajo: son las únicas sujetas a la comprobación de "misma condición". */
const RELAUNCH_ACTIONS: ReadonlySet<RecoveryAction> = new Set<RecoveryAction>([
  'retry-source',
  'replace-source',
  'add-evidence',
  'fix-slug',
  'revise-brief',
  'targeted-rewrite',
  'retry-review',
]);

export interface RecoveryRequest {
  topicId: string;
  action: RecoveryAction;
  actor: string;
  /** Fuentes nuevas para «sustituir fuente» / «añadir evidencia» / «reescritura dirigida». */
  sources?: string[];
  /** Nuevo brief para «revisar brief». */
  brief?: { title?: string; intent?: string };
  /** Nota de quien ejecuta la acción (queda en la auditoría). */
  note?: string;
}

export interface RecoveryExecutionPorts {
  generate: {
    createRequest(kind: 'generate', input: Record<string, unknown>, actor: string): Promise<{ id: string }>;
    createQueueAction(input: Record<string, unknown>, actor: string): Promise<{ id: string }>;
  };
  ledger: {
    retry(jobId: string, actor: string): Promise<{ state: string }>;
    archive(jobId: string, actor: string): Promise<{ archivedAt: string | null }>;
  };
  audit: {
    insert(row: Record<string, unknown>): Promise<void>;
    list(filter: Record<string, unknown>, options?: { limit?: number; sort?: Record<string, 1 | -1> }): Promise<Array<Record<string, unknown>>>;
  };
  topic: (topicId: string) => Promise<TopicView>;
  read: FlowReadPort;
  clock?: () => Date;
}

export interface RecoveryResult {
  topicId: string;
  action: RecoveryAction;
  applied: boolean;
  gateway: 'generation-request' | 'queue-action' | 'ledger-retry' | 'ledger-archive' | 'inspection' | null;
  requestId: string | null;
  detail: string;
  fingerprint: string;
  inspectedDuplicates?: Array<{ id: string; title: string; similarity: number }>;
}

export interface BatchRecoveryResult {
  action: RecoveryAction;
  results: Array<{
    topicId: string;
    ok: boolean;
    gateway: RecoveryResult['gateway'];
    requestId: string | null;
    detail: string;
    code?: 'not-found' | 'not-applicable' | 'unchanged-condition' | 'error';
  }>;
  succeeded: number;
  failed: number;
  note: string;
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const asAction = (value: unknown): RecoveryAction => {
  if (!(RECOVERY_ACTIONS as readonly string[]).includes(String(value))) {
    throw new ValidationError('La acción de recuperación no existe en el contrato del flujo', [
      { field: 'action', message: RECOVERY_ACTIONS.join(', '), value: value === undefined ? 'ausente' : String(value) },
    ]);
  }
  return value as RecoveryAction;
};

/** Huella estable de la causa por la que se va a relanzar trabajo. */
export function recoveryFingerprint(input: {
  action: RecoveryAction;
  sources: string[];
  reason: string | null;
  slug: string | null;
  candidateState: string;
  editorialState: string;
  executionState: string;
}): string {
  const payload = JSON.stringify({
    action: input.action,
    sources: [...input.sources].map((url) => url.trim()).sort(),
    reason: input.reason ?? null,
    slug: input.slug ?? null,
    candidate: input.candidateState,
    editorial: input.editorialState,
    execution: input.executionState,
  });
  return createHash('sha256').update(payload).digest('hex');
}

function categoryOf(topic: TopicView): string | null {
  return topic.identity.category;
}

function sourcesFor(topic: TopicView, override?: string[]): string[] {
  const candidate = (override ?? []).map((url) => url.trim()).filter(Boolean);
  const recorded = topic.sources.map((source) => source.url).filter(Boolean);
  const unique = [...new Set(candidate.length ? candidate : recorded)];
  return unique.slice(0, 4);
}

/** Motivo comparable de la causa registrada del bloqueo. */
function reasonOf(topic: TopicView): string | null {
  return topic.blockingReason?.reason ?? null;
}

export class EditorialEvidenceRecovery {
  constructor(private readonly ports: RecoveryExecutionPorts) {}

  private now(): Date {
    return (this.ports.clock ?? (() => new Date()))();
  }

  private async audit(row: Record<string, unknown>): Promise<void> {
    await this.ports.audit.insert({ at: this.now(), ...row });
  }

  private async lastAttempts(topicId: string, action: RecoveryAction): Promise<Array<Record<string, unknown>>> {
    return this.ports.audit.list({ topicId, recoveryAction: action }, { limit: 20, sort: { at: -1 } });
  }

  private guardApplicability(topic: TopicView, action: RecoveryAction): void {
    const admitted = topic.availableActions.map((entry) => entry.key);
    if (!admitted.includes(action)) {
      const states = [
        `candidato=${topic.dimensions.candidate.state}`,
        `editorial=${topic.dimensions.editorial.state}`,
        `ejecución=${topic.dimensions.execution.state}`,
        `publicación=${topic.dimensions.publication.state}`,
      ].join(', ');
      throw new ConflictError(
        `La acción «${RECOVERY_ACTIONS_META[action].label}» no aplica al estado real del tema (${states}). Acciones admitidas: ${
          admitted.length ? admitted.join(', ') : 'ninguna'
        }.`
      );
    }
  }

  private generationInput(topic: TopicView, action: RecoveryAction, sources: string[]): Record<string, unknown> {
    const title = topic.editorialBrief?.title ?? topic.identity.title ?? '';
    if (title.trim().length < 20) {
      throw new ConflictError(
        'No se puede relanzar la generación: el tema no tiene un título registrado de al menos 20 caracteres con el que construir la petición.'
      );
    }
    const intent = topic.editorialBrief?.intent ?? title;
    const topicText = `${title}. ${intent}`.slice(0, 500);
    const slug = action === 'fix-slug' ? cleanSlug(title) : topic.identity.slug ?? cleanSlug(title);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+){2,}$/.test(slug) || slug.length > 80) {
      throw new ConflictError(
        'No se puede construir un slug válido (tres o más palabras en minúsculas separadas por guiones) con los datos registrados del tema.'
      );
    }
    if (!sources.length) {
      throw new ConflictError('No hay fuentes registradas para relanzar la generación: añade al menos una fuente verificada (acción «añadir evidencia» o «sustituir fuente»).');
    }
    for (const url of sources) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new ConflictError(`La fuente «${url}» no es una URL válida: usa una URL https completa.`);
      }
      if (parsed.protocol !== 'https:') throw new ConflictError(`La fuente «${url}» no usa HTTPS: no se admite como fuente del pipeline.`);
    }
    const category = categoryOf(topic);
    if (!category) {
      throw new ConflictError('No consta la categoría del tema: la solicitud de generación exige una categoría del catálogo editorial.');
    }
    return {
      title: title.slice(0, 110),
      slug,
      topic: topicText,
      intent: intent.slice(0, 500),
      category,
      volatility: 'stable',
      contentType: 'guide',
      length: 'medium',
      seedUrls: sources,
      internalSources: [],
    };
  }

  private async inspectDuplicate(topic: TopicView): Promise<Array<{ id: string; title: string; similarity: number }>> {
    const title = topic.identity.title ?? '';
    if (!title) return [];
    const tokens = topicTokens(title);
    const queueDoc = await this.ports.read.find('editorial_queue_snapshot', { _id: 'current' }, { projection: { items: 1 } });
    const items = Array.isArray(queueDoc[0]?.items) ? (queueDoc[0]!.items as Array<Record<string, unknown>>) : [];
    const published = await this.ports.read.find('blog_posts', { status: 'publish' }, { projection: { slug: 1, title: 1 }, limit: 200 });
    const candidates = [
      ...items.map((item) => ({ id: textOf(item.id), title: textOf(item.title) })),
      ...published.map((post) => ({ id: textOf(post.slug), title: textOf(post.title) })),
    ].filter((candidate) => candidate.title && candidate.id !== topic.topicId);
    return candidates
      .map((candidate) => ({ ...candidate, similarity: Number(similarity(tokens, topicTokens(candidate.title)).toFixed(4)) }))
      .filter((candidate) => candidate.similarity > 0)
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, 5);
  }

  /** Ejecuta una acción validada contra el estado real. Lanza 409 cuando no aplica. */
  async recover(request: RecoveryRequest): Promise<RecoveryResult> {
    const action = asAction(request.action);
    const topic = await this.ports.topic(String(request.topicId || '').trim());
    this.guardApplicability(topic, action);

    const sources = sourcesFor(topic, request.sources);
    const fingerprint = recoveryFingerprint({
      action,
      sources,
      reason: reasonOf(topic),
      slug: topic.identity.slug,
      candidateState: topic.dimensions.candidate.state,
      editorialState: topic.dimensions.editorial.state,
      executionState: topic.dimensions.execution.state,
    });

    if (RELAUNCH_ACTIONS.has(action)) {
      const previous = await this.lastAttempts(topic.topicId, action);
      const repeated = previous.find((row) => textOf(row.fingerprint) === fingerprint);
      if (repeated) {
        throw new ConflictError(
          `La causa del rechazo no ha cambiado desde el intento anterior (mismas fuentes y mismo motivo: «${reasonOf(topic) ?? 'sin motivo registrado'}»). No se relanza la misma petición: cambia las fuentes, el encargo o el slug antes de reintentar.`
        );
      }
    }

    const finish = async (
      gateway: RecoveryResult['gateway'],
      detail: string,
      requestId: string | null,
      extra: Record<string, unknown> = {}
    ): Promise<RecoveryResult> => {
      await this.audit({
        action: 'editorial-flow-recovery',
        by: request.actor,
        topicId: topic.topicId,
        recoveryAction: action,
        fingerprint,
        gateway,
        requestId,
        detail,
        note: request.note ?? null,
      });
      return { topicId: topic.topicId, action, applied: true, gateway, requestId, detail, fingerprint, ...extra };
    };

    switch (action) {
      case 'inspect-duplicate': {
        const duplicates = await this.inspectDuplicate(topic);
        return finish(
          'inspection',
          duplicates.length
            ? `Inspección de duplicados completada: ${duplicates.length} candidato(s) con solape de intención; el de mayor similitud es «${duplicates[0].title}» (${duplicates[0].similarity}).`
            : 'Inspección de duplicados completada: no se ha encontrado ningún otro tema con solape de intención.',
          null,
          { inspectedDuplicates: duplicates }
        );
      }
      case 'retry-review': {
        if (!topic.jobId || !topic.presence.ledger) {
          throw new ConflictError('No hay trabajo en el libro de ejecución para este tema: la revisión no se puede reintentar desde el ledger.');
        }
        const job = await this.ports.ledger.retry(topic.jobId, request.actor);
        return finish('ledger-retry', `Revisión relanzada: el trabajo ${topic.jobId} vuelve a la cola en estado ${job.state}.`, topic.jobId);
      }
      case 'archive': {
        if (topic.jobId && topic.presence.ledger) {
          const job = await this.ports.ledger.archive(topic.jobId, request.actor);
          return finish('ledger-archive', `Trabajo archivado en el libro de ejecución (archivedAt=${job.archivedAt ?? 'no consta'}); el tema sale del flujo activo sin borrarse.`, topic.jobId);
        }
        if (topic.presence.queue) {
          const queued = await this.ports.generate.createQueueAction(
            { action: 'reject', topicId: topic.topicId, reason: request.note || 'Archivado desde el Observatorio editorial' },
            request.actor
          );
          return finish('queue-action', 'Acción de archivo encolada para el runner (rechazo del tema en la cola).', queued.id);
        }
        throw new ConflictError('No hay ni trabajo en el ledger ni tema en la cola: no hay nada que archivar.');
      }
      case 'request-manual-review': {
        if (!topic.presence.queue) {
          throw new ConflictError('El tema no está en la cola vigente: la revisión manual se solicita sobre un tema de la cola.');
        }
        const queued = await this.ports.generate.createQueueAction(
          { action: 'approve', topicId: topic.topicId, reason: request.note || 'Revisión manual solicitada desde el Observatorio editorial' },
          request.actor
        );
        return finish(
          'queue-action',
          'Solicitud de revisión manual encolada. Aprobar un tema no lo publica: la publicación sigue pasando por sus gates.',
          queued.id
        );
      }
      case 'revise-brief': {
        const briefTitle = textOf(request.brief?.title);
        const briefIntent = textOf(request.brief?.intent);
        if (!briefTitle && !briefIntent) {
          throw new ConflictError('Revisar el brief exige indicar el nuevo título o la nueva intención del tema.');
        }
        if (!topic.presence.queue) {
          throw new ConflictError('El tema no está en la cola vigente: el brief se revisa sobre un tema de la cola.');
        }
        const queued = await this.ports.generate.createQueueAction(
          {
            action: 'edit',
            topicId: topic.topicId,
            reason: request.note || 'Brief revisado desde el Observatorio editorial',
            edit: {
              ...(briefTitle ? { title: briefTitle.slice(0, 110) } : {}),
              ...(briefIntent ? { intent: briefIntent.slice(0, 500) } : {}),
            },
          },
          request.actor
        );
        return finish('queue-action', 'Revisión de brief encolada para el runner.', queued.id);
      }
      default: {
        // retry-source | replace-source | add-evidence | fix-slug | targeted-rewrite
        const input = this.generationInput(topic, action, sources);
        const created = await this.ports.generate.createRequest('generate', input, request.actor);
        const labels: Record<string, string> = {
          'retry-source': 'Reintento de recuperación de fuente solicitado con las fuentes registradas',
          'replace-source': 'Sustitución de fuente solicitada con las fuentes indicadas',
          'add-evidence': 'Aportación de evidencia solicitada con las fuentes indicadas',
          'fix-slug': `Corrección de slug solicitada (nuevo slug: ${String(input.slug)})`,
          'targeted-rewrite': 'Reescritura dirigida solicitada sobre el mismo tema',
        };
        return finish('generation-request', `${labels[action]}.`, created.id);
      }
    }
  }

  /**
   * Recuperación en lote: misma validación por ítem y resultado por ítem. Un
   * fallo individual nunca aborta el resto.
   */
  async recoverMany(input: {
    topicIds: string[];
    action: RecoveryAction;
    actor: string;
    sources?: string[];
    brief?: { title?: string; intent?: string };
    note?: string;
  }): Promise<BatchRecoveryResult> {
    const action = asAction(input.action);
    const topicIds = [...new Set((input.topicIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
    if (!topicIds.length) throw new ValidationError('Selecciona al menos un tema para la recuperación en lote', []);
    if (topicIds.length > MAX_BULK_RECOVERY) {
      throw new ValidationError(`La recuperación en lote admite como máximo ${MAX_BULK_RECOVERY} temas`, [
        { field: 'topicIds', message: `Máximo ${MAX_BULK_RECOVERY}`, value: String(topicIds.length) },
      ]);
    }
    const results: BatchRecoveryResult['results'] = [];
    for (const topicId of topicIds) {
      try {
        const result = await this.recover({ ...input, topicId, action });
        results.push({ topicId, ok: true, gateway: result.gateway, requestId: result.requestId, detail: result.detail });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code =
          error instanceof ConflictError
            ? message.startsWith('La causa del rechazo')
              ? 'unchanged-condition'
              : 'not-applicable'
            : (error as { statusCode?: number })?.statusCode === 404
              ? 'not-found'
              : 'error';
        results.push({ topicId, ok: false, gateway: null, requestId: null, detail: message, code });
      }
    }
    return {
      action,
      results,
      succeeded: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      note: 'Cada ítem se valida contra su estado real; un fallo individual no cancela el resto.',
    };
  }
}
