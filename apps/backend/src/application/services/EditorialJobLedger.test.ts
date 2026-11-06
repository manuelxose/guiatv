import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EditorialJobLedger,
  LedgerPage,
  LedgerQuery,
  JobLedgerRecord,
  JobLedgerRepository,
} from './EditorialJobLedger';

class MemoryLedger implements JobLedgerRepository {
  private rows = new Map<string, JobLedgerRecord>();
  async insert(job: JobLedgerRecord): Promise<void> {
    if (this.rows.has(job.jobId)) throw Object.assign(new Error('duplicate'), { code: 11000 });
    this.rows.set(job.jobId, structuredClone(job));
  }
  async get(jobId: string): Promise<JobLedgerRecord | null> {
    const row = this.rows.get(jobId);
    return row ? structuredClone(row) : null;
  }
  async getByPublicationKey(key: string): Promise<JobLedgerRecord | null> {
    const row = [...this.rows.values()].find((job) => job.publicationKey === key);
    return row ? structuredClone(row) : null;
  }
  async replace(job: JobLedgerRecord): Promise<boolean> {
    const current = this.rows.get(job.jobId);
    if (!current || current.revision !== job.revision - 1) return false;
    this.rows.set(job.jobId, structuredClone(job));
    return true;
  }
  async list(query: LedgerQuery, now: Date): Promise<LedgerPage> {
    let rows = [...this.rows.values()];
    if (query.states?.length) rows = rows.filter((job) => query.states!.includes(job.state));
    if (query.kind) rows = rows.filter((job) => job.kind === query.kind);
    if (query.slug) rows = rows.filter((job) => job.slug === query.slug);
    if (query.archived !== undefined) rows = rows.filter((job) => Boolean(job.archivedAt) === query.archived);
    if (query.q) rows = rows.filter((job) => job.jobId.includes(query.q!) || job.slug.includes(query.q!));
    if (query.staleOnly) rows = rows.filter((job) => ['running', 'cancelling'].includes(job.state) && Boolean(job.lease) && Date.parse(job.lease!.expiresAt) <= now.getTime());
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const limit = Math.min(query.limit ?? 25, 100);
    const skip = query.skip ?? 0;
    return { items: rows.slice(skip, skip + limit).map((job) => structuredClone(job)), total: rows.length, limit, skip };
  }
  async remove(jobId: string, revision: number): Promise<boolean> {
    if (this.rows.get(jobId)?.revision !== revision) return false;
    return this.rows.delete(jobId);
  }
}

function bed() {
  let now = new Date('2026-11-05T18:00:00.000Z');
  const repo = new MemoryLedger();
  const service = new EditorialJobLedger(repo, () => now);
  return { service, repo, clock: () => now, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
}
const worker = { id: 'worker-1', host: 'vmi', pid: 1234 };

test('register → claim creates a fencing lease and an article deadline', async () => {
  const b = bed();
  const job = await b.service.register({ jobId: 'job-a', slug: 'guia-de-prueba', maxAttempts: 3, stageMs: 60_000, articleMs: 120_000 });
  assert.equal(job.state, 'queued');
  assert.equal(job.revision, 1);
  const claimed = await b.service.claim('job-a', worker);
  assert.equal(claimed.state, 'running');
  assert.equal(claimed.attempt, 1);
  assert.equal(claimed.lease?.generation, 1);
  assert.ok(claimed.lease?.token);
  assert.equal(claimed.articleDeadlineAt, '2026-11-05T18:02:00.000Z');
  assert.equal((await b.service.register({ jobId: 'job-a', slug: 'guia-de-prueba' })).jobId, 'job-a');
  await assert.rejects(() => b.service.register({ jobId: 'job-a', slug: 'otra-guia' }), /already exists/);
});

test('stale worker cannot write after another worker recovers an expired lease', async () => {
  const b = bed();
  await b.service.register({ jobId: 'job-b', slug: 'guia-lease', stageMs: 60_000, articleMs: 600_000 });
  const first = await b.service.claim('job-b', worker);
  b.advance(91_000);
  const recovered = await b.service.recover('job-b');
  assert.equal(recovered.state, 'queued');
  const second = await b.service.claim('job-b', { id: 'worker-2', host: 'vmi', pid: 5678 });
  assert.equal(second.lease?.generation, 2);
  assert.equal(second.attempt, 2);
  await assert.rejects(
    () => b.service.startStage('job-b', first.lease!.token, first.lease!.generation, 'research-synthesis'),
    /lease/i,
  );
  const stage = await b.service.startStage('job-b', second.lease!.token, second.lease!.generation, 'research-synthesis');
  assert.equal(stage.currentStage, 'research-synthesis');
  assert.equal(stage.stages.at(-1)?.state, 'running');
  const done = await b.service.finishStage('job-b', second.lease!.token, second.lease!.generation, 'research-synthesis', 'completed', undefined, '3 claims');
  assert.equal(done.stages.at(-1)?.state, 'completed');
  assert.equal(done.stages.at(-1)?.detail, '3 claims');
});

test('heartbeat exposes cancellation and stops renewing after the article deadline', async () => {
  const b = bed();
  await b.service.register({ jobId: 'job-c', slug: 'guia-cancel', stageMs: 60_000, articleMs: 100_000 });
  const claimed = await b.service.claim('job-c', worker);
  await b.service.cancel('job-c', 'admin', 'prueba');
  const beat = await b.service.heartbeat('job-c', claimed.lease!.token, claimed.lease!.generation);
  assert.equal(beat.cancelRequested, true);
  assert.equal(beat.job.state, 'cancelling');
  const finished = await b.service.finish('job-c', claimed.lease!.token, claimed.lease!.generation, 'cancelled', { classification: 'cancelled', message: 'ack' });
  assert.equal(finished.state, 'cancelled');
  assert.equal(finished.lease, null);

  await b.service.register({ jobId: 'job-d', slug: 'guia-deadline', stageMs: 60_000, articleMs: 60_000 });
  const d = await b.service.claim('job-d', worker);
  b.advance(61_000);
  const late = await b.service.heartbeat('job-d', d.lease!.token, d.lease!.generation);
  assert.equal(late.job.state, 'failed');
  assert.equal(late.job.error?.classification, 'deadline-exceeded');
});

test('cancellation of a queued job is immediate; a running job is reconciled only later', async () => {
  const b = bed();
  await b.service.register({ jobId: 'job-e', slug: 'guia-queued', stageMs: 60_000, articleMs: 600_000 });
  const cancelled = await b.service.cancel('job-e', 'admin', 'no hace falta');
  assert.equal(cancelled.state, 'cancelled');
  await assert.rejects(() => b.service.cancel('job-e', 'admin', 'otra vez'), /cancelled/);

  await b.service.register({ jobId: 'job-f', slug: 'guia-running', stageMs: 60_000, articleMs: 600_000 });
  const f = await b.service.claim('job-f', worker);
  const requested = await b.service.cancel('job-f', 'admin', 'parar');
  assert.equal(requested.state, 'cancelling');
  assert.equal(requested.cancelRequested, true);
  await assert.rejects(() => b.service.recover('job-f'), /live/i);
  b.advance(91_000);
  const reconciled = await b.service.recover('job-f');
  assert.equal(reconciled.state, 'cancelled');
  assert.equal(reconciled.lease, null);
  assert.equal(f.lease?.token.length, 36);
});

test('pause and resume keep the job claimable only after an explicit resume', async () => {
  const b = bed();
  await b.service.register({ jobId: 'job-g', slug: 'guia-pausa', stageMs: 60_000, articleMs: 600_000 });
  await b.service.pause('job-g', 'admin');
  await assert.rejects(() => b.service.claim('job-g', worker), /paused/);
  const resumed = await b.service.resume('job-g', 'admin');
  assert.equal(resumed.state, 'queued');
  assert.equal((await b.service.claim('job-g', worker)).state, 'running');
});

test('stopping a running job requests a pause, and the worker acknowledges it', async () => {
  const b = bed();
  await b.service.register({ jobId: 'job-h', slug: 'guia-stop', stageMs: 60_000, articleMs: 600_000 });
  const claimed = await b.service.claim('job-h', worker);
  const pausing = await b.service.pause('job-h', 'admin');
  assert.equal(pausing.pauseRequested, true);
  const beat = await b.service.heartbeat('job-h', claimed.lease!.token, claimed.lease!.generation);
  assert.equal(beat.pauseRequested, true);
  const paused = await b.service.finish('job-h', claimed.lease!.token, claimed.lease!.generation, 'paused');
  assert.equal(paused.state, 'paused');
  assert.equal(paused.lease, null);
});

test('retry respects the attempt cap and preserves stage history', async () => {
  const b = bed();
  await b.service.register({ jobId: 'job-i', slug: 'guia-retry', maxAttempts: 2, stageMs: 60_000, articleMs: 600_000 });
  const first = await b.service.claim('job-i', worker);
  await b.service.startStage('job-i', first.lease!.token, first.lease!.generation, 'article-drafting');
  await b.service.finish('job-i', first.lease!.token, first.lease!.generation, 'failed', { classification: 'provider-timeout', message: 'timeout' });
  const retried = await b.service.retry('job-i', 'admin');
  assert.equal(retried.state, 'queued');
  assert.equal(retried.attempt, 1);
  const second = await b.service.claim('job-i', worker);
  assert.equal(second.attempt, 2);
  await b.service.finish('job-i', second.lease!.token, second.lease!.generation, 'failed', { classification: 'provider-timeout', message: 'timeout' });
  await assert.rejects(() => b.service.retry('job-i', 'admin'), /Maximum attempts/);
});

test('deleting terminal metadata does not require archiving and rejects active jobs', async () => {
  const b = bed();
  await b.service.register({ jobId: 'job-j', slug: 'guia-borrado', stageMs: 60_000, articleMs: 600_000 });
  const claimed = await b.service.claim('job-j', worker);
  await assert.rejects(() => b.service.archive('job-j', 'admin'), /terminal/);
  await assert.rejects(() => b.service.deleteMetadata('job-j'), /terminal/);
  await b.service.finish('job-j', claimed.lease!.token, claimed.lease!.generation, 'completed');
  await b.service.deleteMetadata('job-j');
  await assert.rejects(() => b.service.get('job-j'), /not found/);
});

test('deletion refuses a concurrent retry and preserves publication fences', async () => {
  const b = bed();
  await b.service.register({ jobId: 'job-race', slug: 'guia-race', maxAttempts: 2 });
  const claimed = await b.service.claim('job-race', worker);
  await b.service.finish('job-race', claimed.lease!.token, claimed.lease!.generation, 'failed');
  const remove = b.repo.remove.bind(b.repo);
  b.repo.remove = async (id, revision) => { await b.service.retry(id, 'admin'); return remove(id, revision); };
  await assert.rejects(() => b.service.deleteMetadata('job-race'), /changed/);
  assert.equal((await b.service.get('job-race')).state, 'queued');

  await b.service.register({ jobId: 'job-published', slug: 'guia-publicada' });
  const owner = await b.service.claim('job-published', worker);
  await b.service.beginPublication('job-published', owner.lease!.token, owner.lease!.generation, 'guia:hash', null);
  await b.service.finishPublication('job-published', owner.lease!.token, owner.lease!.generation, 'published', null);
  await b.service.finish('job-published', owner.lease!.token, owner.lease!.generation, 'completed');
  await assert.rejects(() => b.service.deleteMetadata('job-published'), /Publication metadata/);
});

test('a completed publication key cannot be reused by another job', async () => {
  const b = bed();
  await b.service.register({ jobId: 'job-k', slug: 'guia-dup', stageMs: 60_000, articleMs: 600_000 });
  const k = await b.service.claim('job-k', worker);
  await b.service.beginPublication('job-k', k.lease!.token, k.lease!.generation, 'guia-dup:hash', 'https://guiaprogramaciontv.com/guias/guia-dup');
  await b.service.finishPublication('job-k', k.lease!.token, k.lease!.generation, 'published', 'https://guiaprogramaciontv.com/guias/guia-dup');
  await b.service.finish('job-k', k.lease!.token, k.lease!.generation, 'completed');

  await b.service.register({ jobId: 'job-l', slug: 'guia-dup', stageMs: 60_000, articleMs: 600_000 });
  const l = await b.service.claim('job-l', worker);
  await assert.rejects(
    () => b.service.beginPublication('job-l', l.lease!.token, l.lease!.generation, 'guia-dup:hash', null),
    /already completed/,
  );
});

test('a publication key lost at the unique index in a race is a conflict, not an unknown error', async () => {
  // Reproduces the M14-R6 reliability finding F1: two jobs reach beginPublication with the same key at once.
  // The pre-check is a read, so the loser can only be stopped by the unique publicationKey index (E11000).
  class RacingLedger extends MemoryLedger {
    private raced = false;
    override async getByPublicationKey(key: string): Promise<JobLedgerRecord | null> {
      // The first lookup misses (both requests read before either writes); later lookups see the winner.
      if (!this.raced) { this.raced = true; return null; }
      return super.getByPublicationKey(key);
    }
    override async replace(job: JobLedgerRecord): Promise<boolean> {
      const winner = await super.getByPublicationKey(job.publicationKey ?? '');
      if (job.publication?.state === 'publishing' && winner && winner.jobId !== job.jobId) {
        throw Object.assign(new Error('E11000 duplicate key error collection: editorial_job_ledger index: publicationKey_1'), { code: 11000 });
      }
      return super.replace(job);
    }
  }
  const repo = new RacingLedger();
  const now = new Date('2026-11-05T18:00:00.000Z');
  const service = new EditorialJobLedger(repo, () => now);
  await service.register({ jobId: 'race-a', slug: 'guia-race', stageMs: 60_000, articleMs: 600_000 });
  await service.register({ jobId: 'race-b', slug: 'guia-race', stageMs: 60_000, articleMs: 600_000 });
  const a = await service.claim('race-a', worker);
  const b = await service.claim('race-b', worker);
  await service.beginPublication('race-a', a.lease!.token, a.lease!.generation, 'guia-race:hash', null);
  await assert.rejects(
    () => service.beginPublication('race-b', b.lease!.token, b.lease!.generation, 'guia-race:hash', null),
    (error: Error & { message: string }) => error.message.includes('already in progress') && !/E11000/.test(error.message),
  );
  assert.equal((await service.get('race-b')).publicationKey, null);
});

test('ledger listing filters state, text and stale leases, and recovers stale work', async () => {
  const b = bed();
  await b.service.register({ jobId: 'job-m', slug: 'guia-uno', kind: 'article', stageMs: 60_000, articleMs: 600_000 });
  await b.service.register({ jobId: 'job-n', slug: 'guia-dos', kind: 'discovery', stageMs: 60_000, articleMs: 600_000 });
  await b.service.claim('job-n', worker);
  b.advance(91_000);
  const page = await b.service.list({ q: 'job-n', staleOnly: true });
  assert.equal(page.total, 1);
  assert.equal(page.items[0].jobId, 'job-n');
  const recovered = await b.service.recoverStale();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].state, 'queued');
  assert.equal((await b.service.list({ kind: 'article' })).total, 1);
  assert.equal((await b.service.list({ states: ['queued'] })).total, 2);
});

test('checkpoints are bounded and require an owning lease', async () => {
  const b = bed();
  await b.service.register({ jobId: 'job-o', slug: 'guia-checkpoint', stageMs: 60_000, articleMs: 600_000 });
  const o = await b.service.claim('job-o', worker);
  for (let i = 0; i < 60; i++) await b.service.checkpoint('job-o', o.lease!.token, o.lease!.generation, { stage: 'article-drafting', ref: `run-${i}`, hash: String(i) });
  const job = await b.service.get('job-o');
  assert.equal(job.checkpoints.length, 50);
  await assert.rejects(() => b.service.checkpoint('job-o', 'wrong', 1, { stage: null, ref: 'x', hash: null }), /lease/i);
});

test('escenario 1 — cancelación durante un stream: estado terminal, sin etapa posterior, sin publicación y coste reconciliado', async () => {
  const b = bed();
  await b.service.register({ jobId: 's1', slug: 'guia-stream-cancelado', stageMs: 60_000, articleMs: 600_000 });
  const claimed = await b.service.claim('s1', worker);
  await b.service.startStage('s1', claimed.lease!.token, claimed.lease!.generation, 'article-drafting', 'escribiendo');
  // La cancelación se pide en pleno stream: queda 'cancelling' y el worker la ve en el siguiente heartbeat.
  const cancelling = await b.service.cancel('s1', 'admin', 'parada de emergencia');
  assert.deepEqual([cancelling.state, cancelling.cancelRequested], ['cancelling', true]);
  const beat = await b.service.heartbeat('s1', claimed.lease!.token, claimed.lease!.generation);
  assert.equal(beat.cancelRequested, true);
  // Ninguna etapa posterior: una nueva etapa se rechaza una vez pedida la cancelación.
  await assert.rejects(() => b.service.startStage('s1', claimed.lease!.token, claimed.lease!.generation, 'seo-enrichment'), /cancellation requested/i);
  // Ninguna publicación: la publicación se rechaza tras la petición de cancelación.
  await assert.rejects(() => b.service.beginPublication('s1', claimed.lease!.token, claimed.lease!.generation, 'guia-stream-cancelado:hash', null), /cancellation requested/i);
  // El worker reconoce la cancelación con su coste parcial: estado terminal y coste reconciliado.
  const done = await b.service.finish('s1', claimed.lease!.token, claimed.lease!.generation, 'cancelled', { classification: 'cancelled', message: 'abortado' }, { modelCalls: 3, usd: 1.25 });
  assert.deepEqual([done.state, done.lease], ['cancelled', null]);
  assert.deepEqual([done.usage.modelCalls, done.usage.usd], [3, 1.25]);
  assert.equal(done.error?.classification, 'cancelled');
});

test('escenario 2 — muerte de worker con lease vigente: expiración, vallado por generación y recuperación sin publicación duplicada', async () => {
  const b = bed();
  await b.service.register({ jobId: 's2', slug: 'guia-worker-caido', maxAttempts: 3, stageMs: 60_000, articleMs: 600_000 });
  const first = await b.service.claim('s2', worker);
  await b.service.startStage('s2', first.lease!.token, first.lease!.generation, 'article-drafting');
  // El worker muere con su lease vigente: nadie puede recuperarlo hasta que expire.
  await assert.rejects(() => b.service.recover('s2'), /live/i);
  b.advance(91_000);
  assert.equal((await b.service.recover('s2')).state, 'queued');
  // Un segundo worker toma el trabajo: generación 2, intento 2.
  const second = await b.service.claim('s2', { id: 'worker-2', host: 'vmi', pid: 5678 });
  assert.deepEqual([second.lease?.generation, second.attempt], [2, 2]);
  // El worker obsoleto queda vallado por generación: no puede publicar ni terminar.
  await assert.rejects(() => b.service.beginPublication('s2', first.lease!.token, first.lease!.generation, 'guia-worker-caido:hash', null), /lease/i);
  await assert.rejects(() => b.service.finish('s2', first.lease!.token, first.lease!.generation, 'completed'), /lease/i);
  // El worker correcto publica una sola vez y cierra.
  await b.service.beginPublication('s2', second.lease!.token, second.lease!.generation, 'guia-worker-caido:hash', 'https://guiaprogramaciontv.com/guias/guia-worker-caido');
  await b.service.finishPublication('s2', second.lease!.token, second.lease!.generation, 'published', 'https://guiaprogramaciontv.com/guias/guia-worker-caido');
  const done = await b.service.finish('s2', second.lease!.token, second.lease!.generation, 'completed');
  assert.deepEqual([done.state, done.publication?.state], ['completed', 'published']);
  assert.equal(done.publicationKey, 'guia-worker-caido:hash');
});

test('escenario 3 — proveedor que no termina: plazos por etapa y artículo, clasificación y fin terminal (nunca running infinito)', async () => {
  const b = bed();
  await b.service.register({ jobId: 's3', slug: 'guia-proveedor-colgado', maxAttempts: 2, stageMs: 60_000, articleMs: 60_000 });
  const claimed = await b.service.claim('s3', worker);
  assert.equal(claimed.articleDeadlineAt, '2026-11-05T18:01:00.000Z', 'plazo por artículo');
  const stage = await b.service.startStage('s3', claimed.lease!.token, claimed.lease!.generation, 'article-drafting');
  assert.equal(stage.stages.at(-1)?.deadlineAt, '2026-11-05T18:01:00.000Z', 'plazo por etapa');
  // El proveedor cuelga y el worker deja de emitir heartbeat: el plazo del artículo cierra el trabajo, no lo deja corriendo.
  b.advance(61_000);
  const late = await b.service.heartbeat('s3', claimed.lease!.token, claimed.lease!.generation);
  assert.deepEqual([late.job.state, late.job.error?.classification], ['failed', 'deadline-exceeded']);
  assert.equal(late.job.lease, null);
  // Reintento seguro y acotado: un segundo intento y, agotado el tope, dead-letter.
  assert.equal((await b.service.retry('s3', 'admin')).state, 'queued');
  const second = await b.service.claim('s3', worker);
  assert.equal(second.attempt, 2);
  b.advance(91_000);
  assert.equal((await b.service.recover('s3')).state, 'dead-letter');
  // La clasificación de un fallo de proveedor se conserva en el ledger.
  await b.service.register({ jobId: 's3b', slug: 'guia-timeout-proveedor', stageMs: 60_000, articleMs: 600_000 });
  const c = await b.service.claim('s3b', worker);
  const failed = await b.service.finish('s3b', c.lease!.token, c.lease!.generation, 'failed', { classification: 'provider-timeout', message: 'request timed out' });
  assert.equal(failed.error?.classification, 'provider-timeout');
});

test('escenario 4 — publicación idempotente: una sola publicación visible ante intentos repetidos y simultáneos', async () => {
  const b = bed();
  await b.service.register({ jobId: 's4', slug: 'guia-publicacion-unica', stageMs: 60_000, articleMs: 600_000 });
  const a = await b.service.claim('s4', worker);
  await b.service.beginPublication('s4', a.lease!.token, a.lease!.generation, 'guia-publicacion-unica:hash', null);
  // Un segundo trabajo con la misma clave de idempotencia, aún en vuelo, se rechaza.
  await b.service.register({ jobId: 's4b', slug: 'guia-publicacion-unica', stageMs: 60_000, articleMs: 600_000 });
  const other = await b.service.claim('s4b', worker);
  await assert.rejects(() => b.service.beginPublication('s4b', other.lease!.token, other.lease!.generation, 'guia-publicacion-unica:hash', null), /already in progress/);
  await b.service.finishPublication('s4', a.lease!.token, a.lease!.generation, 'published', 'https://guiaprogramaciontv.com/guias/guia-publicacion-unica');
  await b.service.finish('s4', a.lease!.token, a.lease!.generation, 'completed');
  // Tras completarse, la misma clave sigue rechazada para cualquier otro trabajo.
  await assert.rejects(() => b.service.beginPublication('s4b', other.lease!.token, other.lease!.generation, 'guia-publicacion-unica:hash', null), /already completed/);
  // Una sola publicación visible: solo el primer trabajo la registró.
  const first = await b.service.get('s4');
  const second = await b.service.get('s4b');
  assert.deepEqual([first.publication?.state, first.publicationKey], ['published', 'guia-publicacion-unica:hash']);
  assert.equal(second.publication, null);
  assert.equal(second.publicationKey, null);
});
