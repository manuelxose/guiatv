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
  async remove(jobId: string): Promise<boolean> { return this.rows.delete(jobId); }
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

test('archiving and deleting execution metadata are separate and guarded', async () => {
  const b = bed();
  await b.service.register({ jobId: 'job-j', slug: 'guia-borrado', stageMs: 60_000, articleMs: 600_000 });
  const claimed = await b.service.claim('job-j', worker);
  await assert.rejects(() => b.service.archive('job-j', 'admin'), /terminal/);
  await b.service.finish('job-j', claimed.lease!.token, claimed.lease!.generation, 'completed');
  await assert.rejects(() => b.service.deleteMetadata('job-j'), /Archive/);
  const archived = await b.service.archive('job-j', 'admin');
  assert.ok(archived.archivedAt);
  await b.service.deleteMetadata('job-j');
  await assert.rejects(() => b.service.get('job-j'), /not found/);
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
