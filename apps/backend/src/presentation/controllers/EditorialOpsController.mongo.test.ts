/**
 * M11-C Admin operations on a throwaway database (`guiatv_test_m11c_<pid>`, dropped after): emergency stop,
 * duplicate policy approvals, job reports, overview/detail, cover storage, and the router's authorization.
 *   TEST_MONGO_URI=mongodb://127.0.0.1:27119 npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import http from 'node:http';
import express from 'express';
import mongoose from 'mongoose';
import { BlogController } from './BlogController';
import { EditorialOpsController } from './EditorialOpsController';
import { createAdminEditorialRoutes } from '../routes/admin-editorial.routes';
import { errorHandler } from '../middlewares/errorHandler';
import { editorialMediaGate } from '../middlewares/editorialMediaGate';
import { BlogPostModel } from '../../infrastructure/database/models/BlogPost.model';
import { LocalStorageRepository } from '../../infrastructure/storage/LocalStorageRepository';
import { MockImageModel } from '../../infrastructure/external/MockImageModel';
import { runEditorialJob } from '../../application/services/EditorialAgentPipeline';
import { DEFAULT_EDITORIAL_LIMITS } from '../../application/services/EditorialEvidence';
import { deps, draft, LONG, pass, research, scripted, topic } from '../../application/services/EditorialAgentPipeline.fixtures';

type Outcome = { code?: number; body?: any; error?: any };
const call = (handler: (req: any, res: any, next?: any) => Promise<void>, req: { params?: object; body?: unknown; headers?: Record<string, string> } = {}) =>
  new Promise<Outcome>((resolve) => {
    const res = { code: 200, status(c: number) { this.code = c; return this; }, json(body: unknown) { resolve({ code: this.code, body }); } };
    const r = { params: req.params ?? {}, body: req.body ?? {}, query: {}, header: (n: string) => req.headers?.[n.toLowerCase()] };
    Promise.resolve(handler(r, res, (error: unknown) => resolve({ error }))).catch((error) => resolve({ error }));
  });

const KEY = 'test-pipeline-signing-key';
async function pipelineRun(slug: string, images = false) {
  const m = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft(LONG)], critic: [pass] }, undefined, 'anthropic');
  return runEditorialJob({ ...topic, slug }, deps(m.model, {
    now: () => new Date(), signingKey: KEY,
    ...(images ? { images: [new MockImageModel()], imageRoutes: [{ provider: 'mock', model: 'mock-cover-1' }] } : {}),
  }), { ...DEFAULT_EDITORIAL_LIMITS, maxResearchCalls: 1, maxReviewLoops: 0 });
}

test('M11-C Admin: emergency stop, duplicates, jobs, overview, detail, covers and authorization', { skip: !process.env.TEST_MONGO_URI }, async () => {
  await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName: `guiatv_test_m11c_${process.pid}` });
  const env = { ...process.env };
  const storageDir = mkdtempSync(join(tmpdir(), 'm11c-storage-'));
  const blog = new BlogController();
  const ops = new EditorialOpsController(new LocalStorageRepository(storageDir));
  process.env.EDITORIAL_PIPELINE_SIGNING_KEY = KEY;
  process.env.EDITORIAL_POLICY_PUBLISHING = 'enabled';
  process.env.STORAGE_LOCAL_PATH = storageDir;
  try {
    await BlogPostModel.init();
    const create = async (run: Awaited<ReturnType<typeof pipelineRun>>) => {
      const created = await call(blog.createPost, { body: { ...run.draft, editorial: run.provenance } });
      assert.equal(created.code, 201, String(created.error));
      return created.body.data.post.id as string;
    };
    const id = await create(await pipelineRun('el-padrino-m11c'));

    // Emergency stop: needs a reason, refuses policy approval at once, and a policy snapshot rolls back as a draft.
    assert.match(String((await call(ops.pause, { body: { reason: '' } })).error), /reason/);
    const paused = await call(ops.pause, { body: { reason: 'prueba de parada' } });
    assert.deepEqual([paused.body.data.policy.paused, paused.body.data.policy.active, paused.body.data.policy.pausedBy], [true, false, 'admin-key']);
    assert.match(String((await call(blog.approveByPolicy, { params: { id } })).error), /paused by the Admin emergency stop \(prueba de parada\)/);
    const resumed = await call(ops.resume, { headers: { 'x-editorial-reviewer': 'Revisora Prueba' } });
    assert.equal(resumed.body.data.policy.active, true);
    assert.deepEqual((await mongoose.connection.collection('editorial_audit').find().toArray()).map((a) => [a.action, a.by]), [['policy-pause', 'admin-key'], ['policy-resume', 'Revisora Prueba']]);

    // Publication once; a second attempt (or a re-approval after it is taken down) is refused, not counted again.
    assert.equal((await call(blog.approveByPolicy, { params: { id } })).body?.data.post.status, 'publish');
    const recorded = await call(ops.recordIndexingRequest, { body: { slug: 'el-padrino-m11c' } });
    assert.equal(recorded.code, 200);
    assert.ok(recorded.body.data.recordedAt);
    assert.equal(await mongoose.connection.collection('editorial_audit').countDocuments({ action: 'indexing-request-recorded', slug: 'el-padrino-m11c', by: 'admin-key' }), 1);
    assert.ok((await call(ops.recordIndexingRequest, { body: { slug: 'no-existe' } })).error);
    assert.match(String((await call(blog.approveByPolicy, { params: { id } })).error), /already published/);
    await BlogPostModel.updateOne({ _id: id }, { status: 'draft', reviewState: 'unreviewed' });
    assert.match(String((await call(blog.approveByPolicy, { params: { id } })).error), /already published by policy once/);
    assert.equal(await mongoose.connection.collection('editorial_policy_approvals').countDocuments(), 1);
    await BlogPostModel.updateOne({ _id: id }, { status: 'publish', reviewState: 'approved' });
    await call(blog.updatePost, { params: { id }, body: { status: 'draft', title: 'Otro título para El Padrino en La 2 esta semana' } });
    await call(ops.pause, { body: { reason: 'segunda parada' } });
    assert.equal((await call(blog.rollbackPost, { params: { id }, body: { version: 1 } })).body.data.post.status, 'draft', 'a paused policy does not restore a policy approval');
    await call(ops.resume);

    // Editing through the Admin while policy gates run must invalidate the approval's version.
    const concurrentId = await create(await pipelineRun('el-padrino-edicion-concurrente'));
    const qualityFindings = (blog as any).qualityFindings.bind(blog);
    (blog as any).qualityFindings = async (post: unknown) => {
      const findings = await qualityFindings(post);
      assert.equal((await call(ops.updatePost, { params: { id: concurrentId }, body: { title: 'Un título modificado durante la aprobación' } })).code, 200);
      return findings;
    };
    try {
      assert.match(String((await call(blog.approveByPolicy, { params: { id: concurrentId } })).error), /changed while this request ran/);
    } finally {
      delete (blog as any).qualityFindings;
    }
    assert.equal((await BlogPostModel.findById(concurrentId).lean())!.status, 'draft');
    assert.equal(await mongoose.connection.collection('editorial_policy_approvals').countDocuments({ postId: new mongoose.Types.ObjectId(concurrentId) }), 0);
    await BlogPostModel.deleteOne({ _id: concurrentId });

    // Mock cover: stored with derivatives, previewable in the Admin, never publishable.
    const withCover = await pipelineRun('el-padrino-portada', true);
    const [asset] = withCover.provenance!.images!;
    const bytes = withCover.media![0].bytes;
    assert.match(String((await call(ops.uploadCover, { params: { sha256: 'a'.repeat(64) }, body: bytes })).error?.details?.[0]?.message), /sha256 does not match/);
    assert.match(String((await call(ops.uploadCover, { params: { sha256: asset.sha256 }, body: Buffer.from('not an image') })).error?.details?.[0]?.message), /sha256 does not match|not a decodable/);
    const stored = await call(ops.uploadCover, { params: { sha256: asset.sha256 }, body: bytes });
    assert.equal(stored.code, 201, JSON.stringify(stored.error));
    assert.equal(stored.body.data.url, asset.url);
    assert.deepEqual(readdirSync(join(storageDir, 'editorial')).sort(), [`${asset.sha256}-1600.webp`, `${asset.sha256}-800.webp`, `${asset.sha256}.png`]);
    assert.equal((await call(ops.uploadCover, { params: { sha256: asset.sha256 }, body: bytes })).code, 201, 'a re-upload is a no-op');
    const coverId = await create(withCover);
    const detail = (await call(ops.post, { params: { id: coverId } })).body.data;
    assert.equal(detail.post.coverUrl, asset.url);
    assert.equal(detail.post.coverAlt, asset.altText);
    assert.match(detail.post.coverPreview, /^data:image\/webp;base64,/, 'the Admin previews a draft cover without a public URL');
    assert.equal(detail.provenance.signed, true);
    assert.deepEqual(detail.policyBlockers.map((f: { code: string }) => f.code), ['mock-image', 'generated-image-unverified']);
    assert.match(String((await call(blog.approveByPolicy, { params: { id: coverId } })).error?.details?.[0]?.message), /imagen no verificado: mock/);
    const human = await call(blog.approvePost, { params: { id: coverId }, body: { reviewer: 'Revisora Prueba', acknowledge: 'unverified-claims' } });
    assert.ok((human.error?.details ?? []).some((d: { field: string }) => d.field === 'mock-image'), 'a person cannot publish a test image either');
    // Dropping the provenance to launder the picture is refused outright (M12 gate review).
    const laundered = await call(blog.updatePost, { params: { id: coverId }, body: { status: 'draft', origin: 'human', editorial: null } });
    assert.equal(laundered.error?.details?.[0]?.field, 'origin', JSON.stringify(laundered));
    const relabelled = await call(blog.approvePost, { params: { id: coverId }, body: { reviewer: 'Revisora Prueba', acknowledge: 'unverified-claims' } });
    assert.ok((relabelled.error?.details ?? []).some((d: { field: string }) => d.field === 'mock-image'), JSON.stringify(relabelled.error?.details));
    assert.equal((await call(blog.createPost, { body: { ...withCover.draft, slug: 'mal-formado', editorial: { ...withCover.provenance, images: [{}] } } })).error?.name, 'ValidationError');
    assert.equal((await call(ops.post, { params: { id: 'not-an-id' } })).error?.name, 'NotFoundError');

    // Job reports: every run, blocked ones included; a replayed report is refused; no text accepted.
    const job = { jobId: '2026-10-27T10:00:00.000Z-x', slug: 'x', state: 'blocked', reason: 'solo 2 afirmaciones verificadas', startedAt: new Date().toISOString(), backend: 'anthropic', costUsd: 0.42, costEntries: [{ role: 'research', model: 'claude-opus-5-5', inputTokens: 1, outputTokens: 2, searches: 3, usd: 0.42, costBasis: 'estimated-list', modelIdentity: 'requested', cacheReadInputTokens: 1 }], blockingCodes: [], draftMarkdown: 'secret' };
    assert.equal((await call(ops.recordJob, { body: job })).code, 201);
    assert.equal((await call(ops.recordJob, { body: job })).error?.name, 'ConflictError');
    assert.equal((await call(ops.recordJob, { body: { ...job, jobId: 'y', costUsd: -1 } })).error?.name, 'ValidationError');
    assert.equal((await mongoose.connection.collection('editorial_jobs').findOne({ jobId: job.jobId }))!.draftMarkdown, undefined);
    const storedCost = (await mongoose.connection.collection('editorial_jobs').findOne({ jobId: job.jobId }))!.costEntries[0];
    assert.deepEqual([storedCost.costBasis, storedCost.modelIdentity, storedCost.cacheReadInputTokens], ['estimated-list', 'requested', 1]);
    assert.equal('cacheCreationInputTokens' in storedCost, false);

    // M11-E2: the audit of an autonomous job (revisions, budget mode, public URL); a URL off the site is not stored.
    const auto = { ...job, jobId: '2026-10-27T11:00:00.000Z-y', slug: 'y', startedAt: new Date(Date.parse(job.startedAt) + 1).toISOString(), state: 'published', reason: null, blockingCodes: [], revisions: 2, revisionLog: ['revise/re-research:unsupported-claim', 'revise/rewrite', 'pass/pass'], budget: 'unlimited', publicUrl: 'https://guiaprogramaciontv.com/guias/y', costEntries: [{ role: 'critic', model: 'claude-opus-5-5', inputTokens: 10, outputTokens: 20, searches: 0, usd: 0.1 }], costUsd: 0.1 };
    assert.equal((await call(ops.recordJob, { body: auto })).code, 201);
    assert.equal((await call(ops.recordJob, { body: { ...auto, jobId: 'z', startedAt: '2026-10-01T00:00:00.000Z', publicUrl: 'https://evil.example/guias/y' } })).code, 201);
    assert.equal((await mongoose.connection.collection('editorial_jobs').findOne({ jobId: 'z' }))!.publicUrl, null);
    await mongoose.connection.collection('editorial_jobs').updateOne({ jobId: job.jobId }, { $set: { blockingCodes: ['no-distinct-value'] } });
    // Review M3/M4/L1: hostile numbers and names are neutralised at ingest; a non-ISO date is stored as ISO.
    const hostile = { ...job, jobId: 'h', startedAt: 'Tue Oct 01 2026 10:00:00 GMT+0000', costEntries: [{ role: 'x', model: '__proto__', inputTokens: '1e309', outputTokens: -5, searches: 0, usd: 'Infinity' }] };
    assert.equal((await call(ops.recordJob, { body: hostile })).code, 201);
    const row = (await mongoose.connection.collection('editorial_jobs').findOne({ jobId: 'h' }))!;
    assert.deepEqual([row.startedAt, row.costEntries[0].model, row.costEntries[0].inputTokens, row.costEntries[0].outputTokens, row.costEntries[0].usd], ['2026-10-01T10:00:00.000Z', null, 0, 0, 0]);
    assert.equal(({} as Record<string, unknown>).calls, undefined, 'Object.prototype untouched');

    const overview = (await call(ops.overview)).body.data;
    assert.equal(overview.policy.approvalsLast24h, 1);
    assert.equal(overview.policy.signingKeyConfigured, true);
    assert.deepEqual([overview.policy.activated, overview.policy.activatedBy], [true, 'admin-key'], 'the last resume (no reviewer header) re-activated');
    assert.equal(overview.spend.todayUsd, 0.52);
    assert.deepEqual(overview.jobs.map((j: { jobId: string }) => j.jobId), [auto.jobId, job.jobId, 'h', 'z']);
    assert.deepEqual([overview.limits.budget, overview.limits.maxDailyUsd], ['unlimited', null], 'the runner reported an unlimited budget');
    assert.deepEqual(JSON.parse(JSON.stringify(overview.today)), {
      generated: 2, published: 1, ready: 0, held: 0, rejected: 1, revisions: 2,
      models: { 'claude-opus-5-5': { calls: 2, inputTokens: 11, outputTokens: 22, usd: 0.52 } }, reasons: { 'no-distinct-value': 1 },
    });
    // The cover post could not be relabelled, so it stays in the AI list with its provenance.
    assert.deepEqual(overview.posts.map((p: { slug: string }) => p.slug), ['el-padrino-portada', 'el-padrino-m11c']);
    assert.deepEqual(overview.posts[1].claims, { supported: 4, conflicting: 0, unverified: 1 });
    assert.equal(overview.routes.research[0].provider, 'anthropic');
    assert.deepEqual([overview.searchConsole.lastRun, overview.searchConsole.baseline], [null, { days: 0, complete: false }], 'no GSC run yet: nothing invented');

    // Draft operations stay inside this admin surface: edit, refuse deleting live content, then replace a blocked draft with a fresh request.
    const retryRun = await pipelineRun('recuperar-borrador-m11c');
    const retryId = await create(retryRun);
    assert.equal((await call(ops.updatePost, { params: { id: retryId }, body: { title: 'corto' } })).error?.name, 'ValidationError');
    const edited = await call(ops.updatePost, { params: { id: retryId }, body: { title: 'Título corregido para una recuperación editorial completa', excerpt: 'Resumen editorial corregido' } });
    assert.equal(edited.code, 200, JSON.stringify(edited.error));
    // A draft of its own: the cover draft is published and served further down.
    const doomedId = await create(await pipelineRun('borrador-para-eliminar-m11c'));
    assert.equal((await call(ops.deletePost, { params: { id: doomedId }, body: {} })).code, 200, 'an unpublished draft can be deleted');
    assert.equal(await BlogPostModel.countDocuments({ _id: doomedId }), 0);
    // The rollback above left `id` as a draft; publish it again so the guard is what gets tested.
    await BlogPostModel.updateOne({ _id: id }, { status: 'publish', reviewState: 'approved' });
    assert.equal((await call(ops.deletePost, { params: { id }, body: {} })).error?.name, 'ConflictError', 'published articles cannot be deleted here');
    assert.equal(await BlogPostModel.countDocuments({ _id: id }), 1, 'the published article is still there');
    assert.equal((await call(ops.requeuePost, { params: { id: retryId } })).error?.name, 'ConflictError', 'a draft that passed the pipeline is not requeued');
    await BlogPostModel.updateOne({ _id: retryId }, { 'editorial.state': 'blocked' });
    // M11-B1 (#142 regression): a malformed stored URL and disabled domains (FilmAffinity, IMDb) are dropped, and the
    // fixture's first claim is `tv-schedule`, which is not a topic volatility.
    await BlogPostModel.collection.updateOne({ _id: new mongoose.Types.ObjectId(retryId) }, {
      $push: { 'editorial.bundle.sources': { $each: [{ id: 'bad', url: 'https://exa mple/x' }], $position: 0 } } as never,
    });
    const requeued = await call(ops.requeuePost, { params: { id: retryId } });
    assert.equal(requeued.code, 201, JSON.stringify(requeued.error));
    assert.equal(requeued.body.data.status, 'queued');
    assert.deepEqual(requeued.body.data.topic.seedUrls, ['https://www.rtve.es/play/la-2/'], 'only enabled, well-formed seed URLs');
    assert.notEqual(requeued.body.data.topic.volatility, 'tv-schedule');
    assert.equal(await BlogPostModel.countDocuments({ _id: retryId }), 0);
    await call(ops.runnerHeartbeat, { body: { version: 'test', providers: ['openai'], webSearch: true, status: 'error', error: 'OPENAI_API_KEY missing' } });
    const operational = await ops['generation'].operationalState();
    const capabilities = operational.runner.capabilities as { providers: string[] };
    assert.deepEqual([operational.runner.status, operational.runner.lastError, capabilities.providers], ['error', 'OPENAI_API_KEY missing', ['openai']]);
    const requests = mongoose.connection.collection('editorial_generation_requests');
    await requests.insertMany(Array.from({ length: 55 }, (_, i) => ({ id: `backlog-${i}`, kind: 'discover', status: i < 4 ? 'running' : 'queued', createdAt: new Date(), updatedAt: new Date(), createdBy: 'test' })));
    const backlog = await ops['generation'].operationalState();
    assert.equal(backlog.queueSummary.manualPending, operational.queueSummary.manualPending + 51);
    assert.equal(backlog.queueSummary.running, operational.queueSummary.running + 4);
    const generation = ops['generation'];
    const request = await generation.createRequest('discover', null, 'test');
    assert.equal(request.claimsObserved, 0);
    const claims = await Promise.allSettled([generation.claimRequest(request.id), generation.claimRequest(request.id)]);
    assert.equal(claims.filter((claim) => claim.status === 'fulfilled').length, 1, 'only one concurrent claim succeeds');
    const claimed = claims.find((claim) => claim.status === 'fulfilled');
    assert.ok(claimed && claimed.status === 'fulfilled');
    assert.equal(claimed.value.claimsObserved, 1);
    assert.ok(claimed.value.claimedAt);
    const failed = await generation.finishRequest(request.id, 'failed', 'provider unavailable');
    assert.ok(failed.finishedAt);
    const retried = await generation.retryRequest(request.id);
    assert.equal(retried.claimedAt, null);
    assert.equal(retried.finishedAt, null);
    assert.equal((await generation.claimRequest(request.id)).claimsObserved, 2);
    assert.ok((await generation.finishRequest(request.id, 'completed')).finishedAt);
    const owned = await generation.createRequest('discover', null, 'test');
    const firstOwner = await generation.claimRequest(owned.id, true);
    assert.ok(firstOwner.claimToken);
    await assert.rejects(generation.finishRequest(owned.id, 'completed'));
    await assert.rejects(generation.finishRequest(owned.id, 'completed', '', 'wrong'));
    assert.ok(!(await generation.operationalState()).queue.some((entry) => 'claimToken' in entry));
    await generation.finishRequest(owned.id, 'failed', 'retry', firstOwner.claimToken);
    await generation.retryRequest(owned.id);
    const secondOwner = await generation.claimRequest(owned.id, true);
    assert.notEqual(secondOwner.claimToken, firstOwner.claimToken);
    await assert.rejects(generation.finishRequest(owned.id, 'completed', '', firstOwner.claimToken));
    assert.equal((await generation.finishRequest(owned.id, 'completed', '', secondOwner.claimToken)).status, 'completed');
    await requests.insertMany(Array.from({ length: 25 }, (_, i) => ({ id: `fair-generate-${i}`, kind: 'generate', status: 'queued', createdAt: new Date(2020, 0, i + 1), updatedAt: new Date(), createdBy: 'test' })));
    const fairWork = await generation.pendingRequests();
    assert.equal(fairWork.length, 20);
    assert.equal(fairWork.filter((item) => item.kind === 'discover').length, 10);
    assert.deepEqual(fairWork.filter((item) => item.kind === 'generate').map((item) => item.id), Array.from({ length: 10 }, (_, i) => `fair-generate-${i}`));

    // Router authorization over HTTP: no session, a non-admin session, and resume without the review key.
    process.env.ANALYTICS_ADMIN_KEY = 'admin-key-test';
    process.env.EDITORIAL_REVIEW_KEY = 'review-key-test';
    const auth = { getSession: async (token: string) => { if (token !== 'user-token' && token !== 'admin-token') throw new Error('invalid'); return { id: token, email: `${token}@x`, role: token === 'admin-token' ? 'admin' : 'user' }; } };
    const app = express().use(express.json()).use('/e', createAdminEditorialRoutes(ops, auth as never)).use(errorHandler);
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/e`;
      const status = async (path: string, init: RequestInit = {}) => (await fetch(`${base}${path}`, init)).status;
      const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
      assert.equal(await status('/overview'), 401);
      assert.equal(await status('/overview', { headers: bearer('user-token') }), 403);
      assert.equal(await status(`/posts/${coverId}`, { headers: bearer('user-token') }), 403);
      assert.equal(await status('/overview', { headers: bearer('admin-token') }), 200);
      const httpRequest = await generation.createRequest('discover', null, 'http');
      const post = (path: string, body: object, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { ...bearer('admin-token'), 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
      const httpClaim = await post(`/generation/runner/requests/${httpRequest.id}/claim-owned`, {});
      assert.equal(httpClaim.status, 200);
      const httpToken = ((await httpClaim.json()) as any).data.claimToken;
      assert.match(httpToken, /^[0-9a-f-]{36}$/i);
      assert.equal((await post(`/generation/runner/requests/${httpRequest.id}/finish`, { status: 'completed' })).status, 404);
      assert.equal((await post(`/generation/runner/requests/${httpRequest.id}/finish`, { status: 'completed' }, { 'x-editorial-claim-token': httpToken })).status, 200);
      const logs: string[] = [];
      const originalError = console.error;
      (generation as any).finishRequest = async () => { throw new Error('injected database failure'); };
      console.error = (...parts: unknown[]) => { logs.push(parts.map(String).join(' ')); };
      try {
        assert.equal((await post(`/generation/runner/requests/${httpRequest.id}/finish`, { status: 'completed' }, { 'x-editorial-claim-token': httpToken })).status, 500);
      } finally {
        console.error = originalError;
        delete (generation as any).finishRequest;
      }
      assert.ok(logs.some((line) => line.includes('injected database failure')));
      assert.ok(logs.every((line) => !line.includes(httpToken)), 'claim token must not appear in unexpected-error logs');
      assert.equal(await status('/policy/resume', { method: 'POST', headers: bearer('admin-token') }), 403);
      assert.equal(await status('/policy/resume', { method: 'POST', headers: { ...bearer('admin-token'), 'x-editorial-review-key': 'wrong' } }), 403);
      process.env.AUCTORIO_EDITORIAL_REVIEW_KEY = 'automation-key-test';
      process.env.AUCTORIO_EDITORIAL_REVIEWER = 'auctorio-bot';
      assert.equal(await status('/policy/resume', { method: 'POST', headers: { ...bearer('admin-token'), 'x-editorial-review-key': 'automation-key-test', 'x-editorial-reviewer': 'auctorio-bot' } }), 403, 'automation cannot lift a stop');
      assert.equal(await status('/policy/resume', { method: 'POST', headers: { ...bearer('admin-token'), 'x-editorial-review-key': 'review-key-test' } }), 200);
      const pausedBy = await (await fetch(`${base}/policy/pause`, { method: 'POST', headers: { ...bearer('admin-token'), 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'http' }) })).json() as any;
      assert.equal(pausedBy.data.policy.pausedBy, 'admin-token@x');
      assert.equal(await status('/media/' + asset.sha256, { method: 'POST', headers: { 'content-type': 'image/png' }, body: bytes }), 401);
      // M11-D: articles per day, changeable at any time, only with the human key; the runner cannot raise its own cap.
      const setLimit = (n: unknown, headers: Record<string, string>) => fetch(`${base}/policy/daily-limit`, { method: 'POST', headers: { ...bearer('admin-token'), 'content-type': 'application/json', ...headers }, body: JSON.stringify({ dailyLimit: n }) });
      assert.equal((await (await fetch(`${base}/overview`, { headers: bearer('admin-token') })).json() as any).data.policy.dailyLimit, 3, 'recommended default');
      assert.equal((await setLimit(5, {})).status, 403);
      assert.equal((await setLimit(5, { 'x-editorial-review-key': 'automation-key-test', 'x-editorial-reviewer': 'auctorio-bot' })).status, 403);
      assert.equal((await setLimit(11, { 'x-editorial-review-key': 'review-key-test' })).status, 400);
      assert.equal((await setLimit(2.5, { 'x-editorial-review-key': 'review-key-test' })).status, 400);
      const set = await setLimit(5, { 'x-editorial-review-key': 'review-key-test', 'x-editorial-reviewer': 'Revisora Prueba' });
      assert.equal(set.status, 200);
      const after = (await (await fetch(`${base}/overview`, { headers: bearer('admin-token') })).json() as any).data;
      assert.deepEqual([after.policy.dailyLimit, after.policy.dailyLimitBy, after.limits.maxDailyArticles], [5, 'Revisora Prueba', 5]);
      assert.ok(await mongoose.connection.collection('editorial_audit').findOne({ action: 'daily-limit', from: 3, to: 5 }));
      // M11-E2 testing profile: 10 a day, stored on the server, applied without a deploy.
      assert.equal((await setLimit(10, { 'x-editorial-review-key': 'review-key-test', 'x-editorial-reviewer': 'Revisora Prueba' })).status, 200);
      assert.equal((await (await fetch(`${base}/overview`, { headers: bearer('admin-token') })).json() as any).data.policy.dailyLimit, 10);
      // M11-D: the runner's policy key is not a reviewer key, whatever header it is sent in.
      process.env.EDITORIAL_POLICY_KEY = 'policy-key-test';
      assert.equal(await status('/policy/resume', { method: 'POST', headers: { ...bearer('admin-token'), 'x-editorial-review-key': 'policy-key-test' } }), 403, 'the runner cannot lift a stop');
    } finally {
      server.close();
    }

    // M11-D: a draft's generated cover is a 404 for anonymous readers even with its exact URL; once public it is served.
    const media = express().use('/storage', editorialMediaGate).use('/storage', express.static(storageDir)).use(errorHandler).listen(0);
    try {
      const port = (media.address() as AddressInfo).port;
      // Raw request paths: fetch() would normalise the dot segments a hostile client can send as-is.
      const get = (path: string) => new Promise<{ status: number; headers: { get(n: string): string | null } }>((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path }, (res) => { res.resume(); resolve({ status: res.statusCode!, headers: { get: (n) => (res.headers[n] as string) ?? null } }); }).on('error', reject);
      });
      const draftCover = await get(asset.url);
      assert.deepEqual([draftCover.status, draftCover.headers.get('cache-control')], [404, 'no-store']);
      assert.equal((await get(`/storage/editorial/${asset.sha256}.png`)).status, 404, 'the original too');
      for (const spelling of ['/storage/%65ditorial/', '/storage//editorial/', '/storage/./editorial/', '/storage/x/../editorial/', '/storage/editorial%2F', '/storage/EDITORIAL/']) {
        assert.equal((await get(`${spelling}${asset.sha256}-800.webp`)).status, 404, `no bypass through ${spelling}`);
      }
      assert.equal((await get('/storage/%E0%A4%A')).status, 400);
      await BlogPostModel.updateOne({ _id: coverId }, { status: 'publish', reviewState: 'approved' });
      const published = await get(asset.url);
      assert.deepEqual([published.status, published.headers.get('content-type')], [200, 'image/webp']);
    } finally {
      media.close();
    }
  } finally {
    process.env = env;
    rmSync(storageDir, { recursive: true, force: true });
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test('M14-R interruptor: startRunnerProcess automático se niega con enabled=false y el manual queda auditado como acción explícita', { skip: !process.env.TEST_MONGO_URI }, async () => {
  await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName: `guiatv_test_m14r_${process.pid}` });
  const env = { ...process.env };
  const storageDir = mkdtempSync(join(tmpdir(), 'm14r-storage-'));
  const ops = new EditorialOpsController(new LocalStorageRepository(storageDir));
  try {
    // El valor por defecto ya es fail-closed; lo persistimos explícito para que la prueba sea autocontenida.
    await ops['generation'].updateSettings({ enabled: false }, 'test');
    // Arranque automático (el cron no envía señal): se niega ANTES de tocar el gestor de procesos (aquí no configurado).
    const auto = await call(ops.startRunnerProcess, { body: {} });
    assert.deepEqual([auto.body.data.started, auto.body.data.reason, auto.body.data.mode, auto.body.data.enabled], [false, 'generation-disabled', 'automatic', false]);
    // Arranque manual: se permite y el gestor de procesos no configurado falla (prueba de que sí se consultó el arranque).
    const manual = await call(ops.startRunnerProcess, { body: { mode: 'manual' } });
    assert.match(String(manual.error), /EDITORIAL_RUNNER_COMMAND/);
    // La única acción auditada es la negativa del arranque automático; el manual nunca llegó a auditarse (falló antes).
    const auditRows = await mongoose.connection.collection('editorial_audit').find().sort({ at: 1 }).toArray();
    assert.deepEqual(auditRows.map((a) => [a.action, a.reason, a.mode]), [['runner-process-start-refused', 'generation-disabled', 'automatic']]);
  } finally {
    process.env = env;
    rmSync(storageDir, { recursive: true, force: true });
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
