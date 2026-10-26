/**
 * M11-B CMS integration on a throwaway database (`guiatv_test_m11b_<pid>`, dropped after): provenance
 * persistence, the evidence gate in both approval paths, the policy switch and daily cap, versioning, rollback.
 *   TEST_MONGO_URI=mongodb://127.0.0.1:27119 npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { BlogController } from './BlogController';
import { BlogPostModel } from '../../infrastructure/database/models/BlogPost.model';
import { POLICY_REVIEWER } from '../../application/services/EditorialReviewPolicy';
import { runEditorialJob } from '../../application/services/EditorialAgentPipeline';
import { deps, draft, LONG, pass, research, scripted, topic } from '../../application/services/EditorialAgentPipeline.fixtures';

const controller = new BlogController();
type Outcome = { code?: number; body?: any; error?: any };
const call = (handler: (req: any, res: any, next: any) => Promise<void>, req: { params?: object; body?: object; headers?: Record<string, string> } = {}) =>
  new Promise<Outcome>((resolve) => {
    const res = { code: 0, status(c: number) { this.code = c; return this; }, json(body: unknown) { resolve({ code: this.code, body }); } };
    void handler({ params: req.params ?? {}, body: req.body ?? {}, query: {}, header: (n: string) => req.headers?.[n.toLowerCase()] }, res, (error: unknown) => resolve({ error }));
  });

/** A real pipeline run (scripted model, offline sources) turned into the CMS write payload. */
async function aiPost(slug: string, critic: object = pass) {
  const m = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft(LONG)], critic: [critic] });
  const run = await runEditorialJob({ ...topic, slug }, deps(m.model, { now: () => new Date() }), { maxArticleUsd: 3, maxResearchCalls: 1, maxSourceFetches: 12, maxRetries: 0, maxReviewLoops: 0, maxDailyArticles: 3, maxConcurrentJobs: 1 });
  assert.ok(run.draft && run.provenance);
  const created = await call(controller.createPost, { body: { ...run.draft, editorial: run.provenance } });
  assert.equal(created.code, 201, String(created.error));
  return created.body.data.post.id as string;
}
const fields = (o: Outcome) => (o.error?.details ?? o.error?.errors ?? []).map((d: { field: string }) => d.field);

test('M11-B CMS: evidence gate, policy approval, versioning and rollback', { skip: !process.env.TEST_MONGO_URI }, async () => {
  await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName: `guiatv_test_m11b_${process.pid}` });
  const env = { ...process.env };
  try {
    await BlogPostModel.init();
    const id = await aiPost('el-padrino-en-la-2');
    const stored = await BlogPostModel.findById(id).lean();
    assert.equal(stored!.editorial!.state, 'draft');
    assert.equal(stored!.editorial!.bundle.claims.length, 5, 'the whole evidence bundle is stored with the post');

    // Off by default: an AI verdict alone cannot publish.
    delete process.env.EDITORIAL_POLICY_PUBLISHING;
    assert.match(String((await call(controller.approveByPolicy, { params: { id } })).error), /disabled/);

    process.env.EDITORIAL_POLICY_PUBLISHING = 'enabled';
    const approved = await call(controller.approveByPolicy, { params: { id } });
    assert.equal(approved.code, 200, JSON.stringify(approved.error));
    assert.equal(approved.body.data.post.status, 'publish');
    assert.equal(approved.body.data.post.reviewedBy, null, 'no reviewer byline for a policy approval');
    assert.equal(approved.body.data.post.editorial.state, 'published');
    assert.equal((await BlogPostModel.findById(id).lean())!.reviewedBy, POLICY_REVIEWER);

    // Editing the text outside the pipeline: kept as a revision, offline, and the evidence no longer matches.
    const live = (await BlogPostModel.findById(id).lean())!;
    const edited = await call(controller.updatePost, { params: { id }, body: { status: 'draft', content: String(live.content).replace('22:00', '23:00') } });
    assert.equal(edited.body?.data.post.status, 'draft', String(edited.error?.stack));
    assert.deepEqual(fields(await call(controller.approveByPolicy, { params: { id } })), ['content-not-reviewed-draft']);
    // The human path runs the same evidence gate, and acknowledgements cannot waive a block.
    const human = await call(controller.approvePost, { params: { id }, body: { reviewer: 'Revisora Prueba', acknowledge: 'unverified-claims,near-duplicate' } });
    assert.ok(fields(human).includes('content-not-reviewed-draft'));

    const rolled = await call(controller.rollbackPost, { params: { id }, body: { version: 1 } });
    assert.equal(rolled.code, 200);
    assert.equal(rolled.body.data.post.status, 'publish', 'the approved text comes back with its approval');
    const after = (await BlogPostModel.findById(id).lean())!;
    assert.equal(after.content, live.content);
    assert.deepEqual(after.revisions!.map((r) => [r.version, r.reason, r.status]), [[1, 'update', 'publish'], [2, 'rollback to 1', 'draft']]);
    assert.match(String((await call(controller.rollbackPost, { params: { id }, body: { version: 9 } })).error), /Unknown revision/);

    // A draft the critic did not pass is refused by both paths.
    const rejected = await aiPost('el-padrino-revisar', { verdict: 'revise', issues: [{ severity: 'high', message: 'exagera' }] });
    assert.ok(fields(await call(controller.approveByPolicy, { params: { id: rejected } })).includes('critic-rejected'));
    assert.ok(fields(await call(controller.approvePost, { params: { id: rejected }, body: { reviewer: 'Revisora Prueba', acknowledge: 'unverified-claims' } })).includes('critic-rejected'));

    // A near-identical twin of a public guide is a block; the policy path never acknowledges judgements.
    assert.ok(fields(await call(controller.approveByPolicy, { params: { id: await aiPost('el-padrino-copia') } })).includes('near-identical'));

    // Posts without provenance (the ten M11-A guides) cannot use the policy path at all.
    const legacy = await BlogPostModel.create({ title: 'Guía antigua de series', slug: 'guia-antigua', origin: 'ai-assisted', content: '<p>x</p>' });
    assert.ok(fields(await call(controller.approveByPolicy, { params: { id: String(legacy._id) } })).includes('editorial'));

    // Daily cap on policy publications.
    process.env.EDITORIAL_POLICY_DAILY_LIMIT = '1';
    const third = await aiPost('el-padrino-tercero');
    assert.match(String((await call(controller.approveByPolicy, { params: { id: third } })).error), /limit reached/);
  } finally {
    process.env = env;
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
