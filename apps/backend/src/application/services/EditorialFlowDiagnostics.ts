/**
 * M14-R7 — Servicio de diagnóstico del Observatorio editorial.
 *
 * Agrega lecturas reales (sin caché ni métricas inventadas) para:
 * - el embudo por etapas (`funnel`),
 * - la ficha completa de un tema (`topic`),
 * - la reconciliación de los registros legacy (`reconciliation`),
 * - el estado honesto del planificador y de la publicación manual (`scheduler`).
 *
 * La lógica pura vive en módulos hermanos (funnel, topic, reconciliation); este
 * servicio solo consulta el puerto de lectura y compone.
 */

import { FLOW_CONTRACT_VERSION } from '../editorialflow';
import { topicNotFound } from './EditorialFlowErrors';
import { assertKnownStage, deriveFunnel, type FunnelReport } from './EditorialFlowFunnel';
import { composeReconciliation, type ReconciliationReport } from './EditorialFlowReconciliation';
import { parseScope, type FlowFilter, type FlowQuery, type FlowReadPort } from './EditorialFlowScope';
import { composeTopicView, type TopicSourceBundle, type TopicView } from './EditorialFlowTopic';

export interface EditorialFlowDiagnosticsDeps {
  read: FlowReadPort;
  /** Reloj inyectable para pruebas deterministas. */
  clock?: () => Date;
  contractVersion?: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const OBJECT_ID = /^[0-9a-f]{24}$/i;

export class EditorialFlowDiagnostics {
  constructor(private readonly deps: EditorialFlowDiagnosticsDeps) {}

  private get read(): FlowReadPort {
    return this.deps.read;
  }

  private now(): Date {
    return (this.deps.clock ?? (() => new Date()))();
  }

  private version(): string {
    return this.deps.contractVersion ?? FLOW_CONTRACT_VERSION;
  }

  /** Embudo con ámbito explícito y trazabilidad de la consulta de cada etapa. */
  async funnel(query: Record<string, unknown> = {}): Promise<FunnelReport> {
    const scope = parseScope(query);
    assertKnownStage(scope.stage);
    return deriveFunnel(this.read, scope, { contractVersion: this.version(), now: this.now() });
  }

  /** Ficha completa de un tema, reconstruida solo con documentos reales. */
  async topic(rawId: string): Promise<TopicView> {
    const id = String(rawId || '').trim();
    if (!id) throw topicNotFound(id);
    if (!this.read.connected()) {
      throw topicNotFound(id);
    }

    const first = async (collection: FlowQuery['collection'], filters: FlowFilter[]): Promise<Record<string, unknown> | undefined> => {
      for (const filter of filters) {
        const [doc] = await this.read.find(collection, filter, { limit: 1 });
        if (doc) return doc;
      }
      return undefined;
    };

    const [queueDoc] = await this.read.find('editorial_queue_snapshot', { _id: 'current' }, { projection: { items: 1 } });
    const queueItems = Array.isArray(queueDoc?.items) ? (queueDoc!.items as Array<Record<string, unknown>>) : [];
    const queueItem = queueItems.find((item) => text(item.id) === id);

    const job = await first('editorial_jobs', [{ jobId: id }, { slug: id }]);
    const ledger = await first('editorial_job_ledger', [{ jobId: id }, { slug: id }]);
    const post = await first('blog_posts', [...(OBJECT_ID.test(id) ? [{ _id: id }] : []), { slug: id }]);

    const slug = text(queueItem?.id) || text(post?.slug) || text(ledger?.slug) || text(job?.slug) || id;
    const second: Record<string, Record<string, unknown> | undefined> = {};
    if (!job && slug !== id) second.job = await first('editorial_jobs', [{ slug }]);
    if (!ledger && slug !== id) second.ledger = await first('editorial_job_ledger', [{ slug }]);
    if (!post && slug !== id) second.post = await first('blog_posts', [{ slug }]);

    const resolvedJob = job ?? second.job;
    const resolvedLedger = ledger ?? second.ledger;
    const resolvedPost = post ?? second.post;

    const [inspection] = await this.read.find(
      'editorial_gsc_inspections',
      { url: `https://guiaprogramaciontv.com/guias/${slug}` },
      { limit: 1 }
    );
    const generationRequests = await this.read.find('editorial_generation_requests', { $or: [{ 'topic.slug': slug }, { id }] }, { limit: 20 });
    const queueActions = await this.read.find('editorial_generation_requests', { kind: 'queue-action', 'queueAction.topicId': slug }, { limit: 20 });

    if (!queueItem && !resolvedJob && !resolvedLedger && !resolvedPost) throw topicNotFound(id);

    const bundle: TopicSourceBundle = {
      topicId: id,
      queueItem,
      job: resolvedJob,
      ledger: resolvedLedger,
      post: resolvedPost,
      inspection,
      generationRequests,
      queueActions,
    };
    return composeTopicView(bundle);
  }

  /** Reconciliación de registros legacy aprobados o en revisión. */
  async reconciliation(query: Record<string, unknown> = {}): Promise<ReconciliationReport> {
    const scope = parseScope(query);
    const filter: FlowFilter = { origin: 'ai-assisted', reviewState: { $in: ['approved', 'in-review'] } };
    if (scope.publicationStatus) filter.status = scope.publicationStatus;
    if (scope.from || scope.to) {
      const range: Record<string, Date> = {};
      if (scope.from) range.$gte = new Date(scope.from);
      if (scope.to) range.$lte = new Date(scope.to);
      filter.publishedAt = range;
    }
    if (scope.category) filter['categories.name'] = scope.category;

    const posts = await this.read.find('blog_posts', filter, {
      projection: { slug: 1, title: 1, status: 1, reviewState: 1, publishedAt: 1, createdAt: 1, updatedAt: 1, editorial: 1, seo: 1 },
      limit: 500,
    });
    const slugs = posts.map((post) => text(post.slug)).filter(Boolean);
    const [inspections, queueDoc, ledgerJobs] = await Promise.all([
      this.read.find('editorial_gsc_inspections', {}, { projection: { url: 1, coverageState: 1, inspectedAt: 1 } }),
      this.read.find('editorial_queue_snapshot', { _id: 'current' }, { projection: { items: 1 } }),
      slugs.length
        ? this.read.find('editorial_job_ledger', { slug: { $in: slugs } }, { projection: { jobId: 1, slug: 1, state: 1, attempt: 1 } })
        : Promise.resolve([]),
    ]);
    const queueItems = Array.isArray(queueDoc[0]?.items) ? (queueDoc[0]!.items as Array<Record<string, unknown>>) : [];
    const signingKey = process.env.EDITORIAL_PIPELINE_SIGNING_KEY;
    return composeReconciliation({
      posts,
      inspections,
      queueItems,
      ledgerJobs,
      scope,
      now: this.now(),
      signingKeyConfigured: Boolean(signingKey),
      signingKey,
    });
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Estado del planificador y de la publicación manual (composición honesta)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface SchedulerPolicyState {
  envEnabled: boolean;
  paused: boolean;
  activated: boolean;
  active: boolean;
  activatedAt: string | null;
  activatedBy: string | null;
  pausedAt: string | null;
  pausedBy: string | null;
  pausedReason: string | null;
  dailyLimit: number;
}

export interface SchedulerOperationsState {
  generation: { enabled: boolean; scheduleHours: number; topicsPerCycle?: number };
  runner: { online: boolean; lastSeenAt: string | Date | null; version: string | null; status: string; lastError: string | null };
  nextRunAt: string | null;
  lastCycle: { at: string | Date; result: string; reason: string | null; queued: number; generated: number } | null;
  queueSummary?: { manualPending: number; discovered: number; running: number };
}

export interface SchedulerRunnerProcessState {
  configured: boolean;
  running: boolean;
  pid: number | null;
  command: string | null;
}

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
    runner: SchedulerOperationsState['runner'] & { process: SchedulerRunnerProcessState };
    lastCycle: SchedulerOperationsState['lastCycle'];
    sources: { enabled: string; paused: string; activated: string; lastSeenAt: string };
    notes: string[];
  };
  publication: {
    automatic: { envEnabled: boolean; activated: boolean; paused: boolean; active: boolean; dailyLimit: number };
    manual: { available: boolean; blockedBy: string[]; note: string };
  };
  queue: SchedulerOperationsState['queueSummary'] | null;
  notes: string[];
}

const isoOf = (value: string | Date | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/**
 * Compone el estado del planificador. Deliberadamente separa:
 * - generación programada (`generation.enabled`), que es lo que el despliegue puede apagar;
 * - publicación manual, cuya disponibilidad se informa de forma INDEPENDIENTE.
 */
export function composeSchedulerStatus(input: {
  policy: SchedulerPolicyState;
  operations: SchedulerOperationsState;
  runnerProcess: SchedulerRunnerProcessState;
  now: Date;
}): SchedulerStatus {
  const { policy, operations, runnerProcess } = input;
  const manualBlockedBy: string[] = [];
  if (!policy.envEnabled) manualBlockedBy.push('La publicación por política está apagada en el despliegue (EDITORIAL_POLICY_PUBLISHING).');
  if (!policy.activated) manualBlockedBy.push('La publicación por política no se ha activado desde el Admin (requiere la clave de revisión humana).');
  if (policy.paused) manualBlockedBy.push(`La publicación está detenida por la parada de emergencia${policy.pausedReason ? `: ${policy.pausedReason}` : ''}.`);

  return {
    generatedAt: input.now.toISOString(),
    generation: {
      enabled: operations.generation.enabled,
      paused: policy.paused,
      activated: policy.activated,
      active: policy.active,
      scheduleHours: operations.generation.scheduleHours,
      nextRunAt: isoOf(operations.nextRunAt),
      lastSeenAt: isoOf(operations.runner.lastSeenAt),
      runner: { ...operations.runner, lastSeenAt: isoOf(operations.runner.lastSeenAt), process: runnerProcess },
      lastCycle: operations.lastCycle,
      sources: {
        enabled: 'editorial_settings (_id=generation).settings.enabled',
        paused: 'editorial_settings (_id=policy).paused',
        activated: 'editorial_settings (_id=policy).activatedAt',
        lastSeenAt: 'editorial_runner (_id=current).lastSeenAt',
      },
      notes: [
        'La generación programada está desactivada por defecto y no se reactiva desde el Observatorio.',
        'El estado se lee de los ajustes persistidos; si no hay documento, se informa el valor por defecto (desactivada).',
        'nextRunAt solo se puede calcular cuando hay generación habilitada y el runner ha enviado un latido; si no consta, se devuelve null.',
      ],
    },
    publication: {
      automatic: {
        envEnabled: policy.envEnabled,
        activated: policy.activated,
        paused: policy.paused,
        active: policy.active,
        dailyLimit: policy.dailyLimit,
      },
      manual: {
        available: manualBlockedBy.length === 0,
        blockedBy: manualBlockedBy,
        note: 'La publicación manual se informa de forma independiente de generation.enabled: apagar la generación programada no impide publicar a mano si los gates de publicación están activos.',
      },
    },
    queue: operations.queueSummary ?? null,
    notes: [
      'No se inventan métricas: cada valor procede de editorial_settings o editorial_runner.',
      'El estado "active" exige interruptor de despliegue, activación humana y ausencia de parada de emergencia.',
    ],
  };
}
