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
    assert.match(String((await call(blog.approveByPolicy, { params: { id } })).error), /already published/);
    await BlogPostModel.updateOne({ _id: id }, { status: 'draft', reviewState: 'unreviewed' });
    assert.match(String((await call(blog.approveByPolicy, { params: { id } })).error), /already published by policy once/);
    assert.equal(await mongoose.connection.collection('editorial_policy_approvals').countDocuments(), 1);
    await BlogPostModel.updateOne({ _id: id }, { status: 'publish', reviewState: 'approved' });
    await call(blog.updatePost, { params: { id }, body: { status: 'draft', title: 'Otro título para El Padrino en La 2 esta semana' } });
    await call(ops.pause, { body: { reason: 'segunda parada' } });
    assert.equal((await call(blog.rollbackPost, { params: { id }, body: { version: 1 } })).body.data.post.status, 'draft', 'a paused policy does not restore a policy approval');
    await call(ops.resume);

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
    // Dropping the provenance does not launder the picture: generated files need their own record.
    const laundered = await call(blog.updatePost, { params: { id: coverId }, body: { status: 'draft', origin: 'human', editorial: null } });
    assert.equal(laundered.code, 200, JSON.stringify(laundered.error));
    const relabelled = await call(blog.approvePost, { params: { id: coverId }, body: { reviewer: 'Revisora Prueba' } });
    assert.ok((relabelled.error?.details ?? []).some((d: { field: string }) => d.field === 'generated-image-unverified'), JSON.stringify(relabelled.error?.details));
    assert.equal((await call(blog.createPost, { body: { ...withCover.draft, slug: 'mal-formado', editorial: { ...withCover.provenance, images: [{}] } } })).error?.name, 'ValidationError');
    assert.equal((await call(ops.post, { params: { id: 'not-an-id' } })).error?.name, 'NotFoundError');

    // Job reports: every run, blocked ones included; a replayed report is refused; no text accepted.
    const job = { jobId: '2026-10-27T10:00:00.000Z-x', slug: 'x', state: 'blocked', reason: 'solo 2 afirmaciones verificadas', startedAt: new Date().toISOString(), backend: 'anthropic', costUsd: 0.42, costEntries: [{ role: 'research', model: 'claude-opus-5-5', inputTokens: 1, outputTokens: 2, searches: 3, usd: 0.42 }], blockingCodes: [], draftMarkdown: 'secret' };
    assert.equal((await call(ops.recordJob, { body: job })).code, 201);
    assert.equal((await call(ops.recordJob, { body: job })).error?.name, 'ConflictError');
    assert.equal((await call(ops.recordJob, { body: { ...job, jobId: 'y', costUsd: -1 } })).error?.name, 'ValidationError');
    assert.equal((await mongoose.connection.collection('editorial_jobs').findOne({ jobId: job.jobId }))!.draftMarkdown, undefined);

    const overview = (await call(ops.overview)).body.data;
    assert.equal(overview.policy.approvalsLast24h, 1);
    assert.equal(overview.policy.signingKeyConfigured, true);
    assert.equal(overview.spend.todayUsd, 0.42);
    assert.deepEqual(overview.jobs.map((j: { jobId: string }) => j.jobId), [job.jobId]);
    // The relabelled post left the AI list with its provenance.
    assert.deepEqual(overview.posts.map((p: { slug: string }) => p.slug), ['el-padrino-m11c']);
    assert.deepEqual(overview.posts[0].claims, { supported: 4, conflicting: 0, unverified: 1 });
    assert.equal(overview.routes.research[0].provider, 'anthropic');

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
