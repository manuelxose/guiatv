/**
 * M14-R7 — Controlador del Observatorio editorial: contrato HTTP de los
 * endpoints, publicación idempotente que no puede saltarse los gates y estado
 * honesto del planificador.
 *
 *   node --test dist/presentation/controllers/EditorialFlowController.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenError } from '../../shared/errors';
import { COLLECTIONS, MemoryFlowRead, emptyCollections } from '../../application/services/EditorialFlow.fixtures';
import { EditorialFlowDiagnostics, type SchedulerPolicyState } from '../../application/services/EditorialFlowDiagnostics';
import { EditorialEvidenceRecovery } from '../../application/services/EditorialEvidenceRecovery';
import { postNotFound } from '../../application/services/EditorialFlowErrors';
import {
  EditorialFlowPublicationService,
  type PublicationGateway,
  type PublicationIdempotencyRecord,
  type PublicationIdempotencyStore,
} from '../../application/services/EditorialFlowPublication';
import { EditorialFlowController } from './EditorialFlowController';

const NOW = new Date('2026-11-06T12:00:00.000Z');

type Outcome = { code: number; body: any; error?: any };
const call = (
  handler: (req: any, res: any, next: any) => Promise<void>,
  req: { params?: object; body?: unknown; query?: object; headers?: Record<string, string> } = {}
) =>
  new Promise<Outcome>((resolve) => {
    const res = {
      code: 200,
      status(code: number) {
        this.code = code;
        return this;
      },
      json(body: unknown) {
        resolve({ code: this.code, body });
      },
    };
    const request = {
      params: req.params ?? {},
      body: req.body ?? {},
      query: req.query ?? {},
      header: (name: string) => req.headers?.[name.toLowerCase()],
    };
    Promise.resolve(handler(request, res, (error: unknown) => resolve({ code: 500, body: null, error }))).catch((error) =>
      resolve({ code: 500, body: null, error })
    );
  });

function storeHarness() {
  const records = new Map<string, PublicationIdempotencyRecord>();
  const store: PublicationIdempotencyStore = {
    async claim(key, record) {
      if (records.has(key)) return 'existing';
      records.set(key, { ...record });
      return 'claimed';
    },
    async complete(key, patch) {
      const current = records.get(key);
      if (!current) throw new Error(`no existe la reserva ${key}`);
      records.set(key, { ...current, ...patch });
    },
    async get(key) {
      return records.get(key) ?? null;
    },
  };
  const auditRows: Array<Record<string, unknown>> = [];
  return { store, records, auditRows, audit: { insert: async (row: Record<string, unknown>) => { auditRows.push(row); } } };
}

function publicationHarness(options: { eligible?: boolean; blockers?: Array<{ code: string; message: string }>; failWith?: Error } = {}) {
  const state = { eligible: options.eligible ?? true, blockers: options.blockers ?? [], failWith: options.failWith };
  const calls = { eligibility: 0, publish: 0 };
  const gateway: PublicationGateway = {
    async eligibility(postId) {
      calls.eligibility += 1;
      return {
        postId,
        status: 'draft',
        reviewState: 'approved',
        eligible: state.eligible,
        alreadyPublished: false,
        blockers: state.blockers,
      };
    },
    async publish(postId) {
      calls.publish += 1;
      if (state.failWith) throw state.failWith;
      return { post: { id: postId, status: 'publish' }, qualityFindings: [] };
    },
  };
  const harness = storeHarness();
  const publication = new EditorialFlowPublicationService({
    gateway,
    store: harness.store,
    audit: harness.audit,
    clock: () => NOW,
  });
  return { publication, calls, records: harness.records, auditRows: harness.auditRows };
}

/** Gateway que se comporta como Mongo sin artículo: 404 con mensaje en español. */
function publicationWithNothing(): EditorialFlowPublicationService {
  const harness = storeHarness();
  return new EditorialFlowPublicationService({
    gateway: {
      async eligibility(postId: string) {
        throw postNotFound(postId);
      },
      async publish() {
        throw new Error('no se debe publicar en una base vacía');
      },
    },
    store: harness.store,
    audit: harness.audit,
    clock: () => NOW,
  });
}

const ACTIVE_POLICY: SchedulerPolicyState = {
  envEnabled: true,
  paused: false,
  activated: true,
  active: true,
  activatedAt: '2026-10-27T20:20:57.000Z',
  activatedBy: 'Propietario',
  pausedAt: null,
  pausedBy: null,
  pausedReason: null,
  dailyLimit: 10,
};

function buildController(
  readCollections = COLLECTIONS,
  connected = true,
  publication = publicationHarness().publication,
  policy: SchedulerPolicyState = ACTIVE_POLICY
) {
  const read = new MemoryFlowRead(readCollections, connected);
  const diagnostics = new EditorialFlowDiagnostics({ read, clock: () => NOW });
  const recovery = new EditorialEvidenceRecovery({
    read,
    topic: (id) => diagnostics.topic(id),
    generate: {
      createRequest: async () => ({ id: 'req-1' }),
      createQueueAction: async () => ({ id: 'queue-1' }),
    },
    ledger: { retry: async () => ({ state: 'queued' }), archive: async () => ({ archivedAt: null }) },
    audit: { insert: async () => undefined, list: async () => [] },
    clock: () => NOW,
  });
  const controller = new EditorialFlowController({
    diagnostics,
    recovery,
    publication,
    policy: async () => policy,
    operations: async () => ({
      generation: { enabled: false, scheduleHours: 3, topicsPerCycle: 1 },
      runner: { online: true, lastSeenAt: new Date('2026-11-06T08:11:03.838Z'), version: 'm14', status: 'ready', lastError: null },
      nextRunAt: null,
      lastCycle: { at: '2026-11-06T08:11:03.838Z', result: 'no-eligible-topics', reason: 'No hay temas elegibles en la cola', queued: 0, generated: 0 },
      queueSummary: { manualPending: 0, discovered: 1, running: 0 },
    }),
    runnerProcess: () => ({ configured: true, running: false, pid: null, command: 'editorial-agents.mjs' }),
    clock: () => NOW,
  });
  return { controller, diagnostics };
}

test('M14-R7 API: guía, embudo, ficha y reconciliación responden con datos reales', async () => {
  const { controller } = buildController();

  const guide = await call(controller.guide);
  assert.equal(guide.code, 200);
  assert.equal(guide.body.data.contractVersion, 'm14-r7.1');
  assert.ok(guide.body.data.guide.recoveryActions['add-evidence'].label);

  const funnel = await call(controller.funnel, { query: { category: 'Televisión' } });
  assert.equal(funnel.code, 200);
  const retained = funnel.body.data.stages.find((stage: any) => stage.key === 'candidate.retained');
  assert.equal(retained.count, 1);
  assert.deepEqual(funnel.body.data.scope.applied, [{ key: 'category', value: 'Televisión' }]);
  // La consulta queda expuesta para poder contrastarla contra MongoDB a mano.
  assert.equal(retained.queries[0].collection, 'editorial_queue_snapshot');
  assert.deepEqual(retained.queries[0].filter, { _id: 'current' });

  const topic = await call(controller.topic, { params: { id: 'cnmc-derechos-audiovisuales-accesibilidad-plataformas' } });
  assert.equal(topic.code, 200);
  const view = topic.body.data;
  assert.equal(view.dimensions.candidate.state, 'retained');
  assert.equal(view.dimensions.execution.state, 'blocked');
  assert.equal(view.jobId, 'm14-ledger-1');
  assert.match(view.blockingReason.reason, /agotados los ciclos de revisión/);
  assert.equal(view.retries.attempts, 2);
  assert.equal(view.reviewCycles.count, 4);
  assert.deepEqual(view.reviewCycles.log, ['revise/rewrite:figure-in-words', 'revise/re-research:figure-not-in-claim']);
  assert.ok(view.availableActions.some((action: any) => action.key === 'add-evidence'));
  assert.ok(view.sources.every((source: any) => source.url.startsWith('https://')));
  assert.equal(view.presence.queue, true);
  assert.equal(view.presence.ledger, true);
  // Historia solo con lo registrado: sin eventos inventados.
  const whats = view.history.map((entry: any) => entry.what);
  assert.ok(whats.indexOf('Trabajo registrado en el libro de ejecución') >= 0);
  for (const entry of view.history) assert.ok(Number.isFinite(Date.parse(entry.at)));

  const reconciliation = await call(controller.reconciliation);
  assert.equal(reconciliation.code, 200);
  assert.equal(reconciliation.body.data.mass.unknown, 1);
  assert.equal(reconciliation.body.data.mass.published, 4);

  const missingTopic = await call(controller.topic, { params: { id: 'no-existe' } });
  assert.equal(missingTopic.error.statusCode, 404);
  assert.match(missingTopic.error.message, /No existe ningún tema/);
});

test('M14-R7 API: el estado del planificador es honesto y separa la publicación manual', async () => {
  const { controller } = buildController();
  const scheduler = await call(controller.scheduler);
  assert.equal(scheduler.code, 200);
  const status = scheduler.body.data;
  assert.equal(status.generation.enabled, false, 'la generación programada está apagada y así se informa');
  assert.equal(status.generation.paused, false);
  assert.equal(status.generation.activated, true);
  assert.equal(status.generation.active, true);
  assert.equal(status.generation.lastSeenAt, '2026-11-06T08:11:03.838Z');
  assert.equal(status.generation.nextRunAt, null, 'sin generación habilitada no se inventa la próxima ejecución');
  assert.equal(status.generation.runner.process.running, false);
  assert.equal(status.publication.manual.available, true);
  assert.deepEqual(status.publication.manual.blockedBy, []);
  assert.match(status.publication.manual.note, /independiente de generation.enabled/);
  assert.equal(status.publication.automatic.dailyLimit, 10);

  const pausedPolicy: SchedulerPolicyState = {
    ...ACTIVE_POLICY,
    paused: true,
    pausedAt: '2026-11-06T09:00:00.000Z',
    pausedBy: 'admin@guia.tv',
    pausedReason: 'prueba de parada',
    active: false,
  };
  const paused = buildController(COLLECTIONS, true, publicationHarness().publication, pausedPolicy);
  const pausedStatus = (await call(paused.controller.scheduler)).body.data;
  assert.equal(pausedStatus.generation.paused, true);
  assert.equal(pausedStatus.generation.active, false);
  assert.equal(pausedStatus.publication.manual.available, false);
  assert.ok(pausedStatus.publication.manual.blockedBy.some((line: string) => /parada de emergencia/.test(line)));
});

test('M14-R7 API: publicación manual idempotente por clave (no duplica publicación ni evento)', async () => {
  const harness = publicationHarness();
  const { controller } = buildController(COLLECTIONS, true, harness.publication);

  const first = await call(controller.publishNow, { params: { postId: '6ae134cdf4a4ff1acf24a48b' }, headers: { 'idempotency-key': 'clave-1' } });
  assert.equal(first.code, 200);
  assert.equal(first.body.data.alreadyApplied, false);
  assert.equal(first.body.data.post.status, 'publish');
  assert.equal(harness.calls.publish, 1);
  assert.deepEqual(harness.auditRows.map((row) => row.action), ['editorial-flow-publication-start', 'editorial-flow-publication']);

  const second = await call(controller.publishNow, { params: { postId: '6ae134cdf4a4ff1acf24a48b' }, headers: { 'idempotency-key': 'clave-1' } });
  assert.equal(second.code, 200);
  assert.equal(second.body.data.alreadyApplied, true);
  assert.equal(second.body.data.publishedAt, NOW.toISOString());
  assert.match(second.body.data.note, /no se ha vuelto a publicar/);
  assert.equal(harness.calls.publish, 1, 'la segunda petición no publica');
  assert.equal(harness.auditRows.length, 2, 'la segunda petición no registra un segundo evento');
  assert.equal(harness.records.get('clave-1')?.state, 'completed');

  const withoutKey = await call(controller.publishNow, { params: { postId: 'otro' } });
  assert.equal(withoutKey.error.statusCode, 400);
  assert.match(withoutKey.error.message, /clave de idempotencia/);
});

test('M14-R7 API: la publicación no evita los gates y un fallo no republica', async () => {
  // No elegible: 409 con bloqueos nombrados y sin llamar a publicar.
  const blocked = publicationHarness({ eligible: false, blockers: [{ code: 'review', message: 'El artículo no supera la revisión editorial de calidad.' }] });
  const blockedController = buildController(COLLECTIONS, true, blocked.publication).controller;
  const notEligible = await call(blockedController.publishNow, { params: { postId: 'post-1' }, headers: { 'idempotency-key': 'clave-x' } });
  assert.equal(notEligible.code, 409);
  assert.equal(notEligible.body.error.code, 'NOT_ELIGIBLE');
  assert.equal(notEligible.body.error.details.blockers[0].code, 'review');
  assert.match(notEligible.body.error.details.blockers[0].message, /revisión editorial/);
  assert.equal(blocked.calls.publish, 0);

  // Límite diario: el error existente se propaga tal cual (no se convierte en éxito).
  const limited = publicationHarness({ failWith: new ForbiddenError('Policy publishing limit reached (10 in 24 h)') });
  const limitedController = buildController(COLLECTIONS, true, limited.publication).controller;
  const overLimit = await call(limitedController.publishNow, { params: { postId: 'post-2' }, headers: { 'idempotency-key': 'clave-y' } });
  assert.equal(overLimit.error.statusCode, 403);
  assert.match(overLimit.error.message, /limit reached/);
  assert.equal(limited.calls.publish, 1);
  assert.equal(limited.records.get('clave-y')?.state, 'failed');
  assert.deepEqual(limited.auditRows.map((row) => row.action), ['editorial-flow-publication-start', 'editorial-flow-publication-failed']);

  // Repetir con la misma clave reproduce el fallo sin volver a intentar publicar.
  const replay = await call(limitedController.publishNow, { params: { postId: 'post-2' }, headers: { 'idempotency-key': 'clave-y' } });
  assert.equal(replay.error.statusCode, 409);
  assert.match(replay.error.message, /ya intentó publicar y falló/);
  assert.equal(limited.calls.publish, 1);
});

test('M14-R7 API: recuperación individual y en lote responden por ítem', async () => {
  const { controller } = buildController();
  const ok = await call(controller.recovery, {
    params: { topicId: 'cnmc-derechos-audiovisuales-accesibilidad-plataformas' },
    body: { action: 'archive' },
  });
  assert.equal(ok.code, 200);
  assert.equal(ok.body.data.gateway, 'ledger-archive');

  const notApplicable = await call(controller.recovery, {
    params: { topicId: 'cnmc-derechos-audiovisuales-accesibilidad-plataformas' },
    body: { action: 'fix-slug' },
  });
  assert.equal(notApplicable.error.statusCode, 409);
  assert.match(notApplicable.error.message, /no aplica al estado real/);

  const bulk = await call(controller.recoveryBulk, {
    body: { action: 'archive', topicIds: ['cnmc-derechos-audiovisuales-accesibilidad-plataformas', 'no-existe'] },
  });
  assert.equal(bulk.code, 200);
  assert.equal(bulk.body.data.results.length, 2);
  assert.deepEqual(bulk.body.data.results.map((row: any) => row.ok), [true, false]);
});

test('M14-R7 API: base vacía responde sin excepciones y sin métricas inventadas', async () => {
  const { controller } = buildController(emptyCollections(), true, publicationWithNothing());
  const funnel = await call(controller.funnel);
  assert.equal(funnel.code, 200);
  const stages = funnel.body.data.stages;
  assert.ok(stages.every((stage: any) => stage.count === 0 || stage.state === 'unavailable'));
  assert.equal(stages.find((stage: any) => stage.key === 'publication.published').count, 0);
  assert.equal(stages.find((stage: any) => stage.key === 'candidate.eligible').state, 'unavailable');

  const reconciliation = await call(controller.reconciliation);
  assert.equal(reconciliation.code, 200);
  assert.equal(reconciliation.body.data.mass.total, 0);
  assert.equal(reconciliation.body.data.mass.unknown, 0);

  const eligibility = await call(controller.eligibility, { params: { postId: 'post-inexistente' } });
  assert.equal(eligibility.error.statusCode, 404);
  assert.match(eligibility.error.message, /No existe ningún artículo/);
});
