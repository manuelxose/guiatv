/**
 * M11-F maintenance revisions by policy on a throwaway database (`guiatv_test_m11f_<pid>`, dropped after):
 * a certified revision replaces the published guide and keeps the old one as a revision; anything else leaves it alone.
 *   TEST_MONGO_URI=mongodb://127.0.0.1:27119 npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { BlogController } from './BlogController';
import { BlogPostModel } from '../../infrastructure/database/models/BlogPost.model';
import { POLICY_REVIEWER } from '../../application/services/EditorialReviewPolicy';
import { runEditorialJob } from '../../application/services/EditorialAgentPipeline';
import { DEFAULT_EDITORIAL_LIMITS } from '../../application/services/EditorialEvidence';
import { deps, draft, LONG, pass, research, scripted, topic } from '../../application/services/EditorialAgentPipeline.fixtures';
import { editorialEpoch } from '../../shared/utils/editorialEpoch';

const controller = new BlogController();
type Outcome = { code?: number; body?: any; error?: any };
const call = (handler: (req: any, res: any, next: any) => Promise<void>, req: { params?: object; body?: object } = {}) =>
  new Promise<Outcome>((resolve) => {
    const res = { code: 0, status(c: number) { this.code = c; return this; }, json(body: unknown) { resolve({ code: this.code, body }); } };
    void handler({ params: req.params ?? {}, body: req.body ?? {}, query: {}, header: () => undefined }, res, (error: unknown) => resolve({ error }));
  });
const KEY = 'test-pipeline-signing-key';
const SLUG = 'el-padrino-mantenimiento';
async function pipelineRun(markdown: string, critic: object = pass) {
  const m = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft(markdown)], critic: [critic] }, undefined, 'anthropic');
  const run = await runEditorialJob({ ...topic, slug: SLUG }, deps(m.model, { now: () => new Date(), signingKey: KEY }), { ...DEFAULT_EDITORIAL_LIMITS, maxResearchCalls: 1, maxReviewLoops: 0 });
  assert.ok(run.draft && run.provenance, run.reason);
  return { post: { ...run.draft, editorial: run.provenance }, draftHash: run.provenance.draftHash };
}

test('M11-F revise-by-policy: certified update, failed update, conflicts, stop and rollback', { skip: !process.env.TEST_MONGO_URI }, async () => {
  await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName: `guiatv_test_m11f_${process.pid}` });
  const env = { ...process.env };
  process.env.EDITORIAL_PIPELINE_SIGNING_KEY = KEY;
  process.env.EDITORIAL_POLICY_PUBLISHING = 'enabled';
  try {
    await BlogPostModel.init();
    await BlogPostModel.db.collection<{ _id: string }>('editorial_settings').updateOne({ _id: 'policy' }, { $set: { activatedAt: new Date(), activatedBy: 'Propietario prueba', dailyLimit: 10 } }, { upsert: true });
    const v1 = await pipelineRun(LONG);
    const id = (await call(controller.createPost, { body: v1.post })).body.data.post.id as string;
    const epoch = editorialEpoch();
    assert.equal((await call(controller.approveByPolicy, { params: { id } })).body?.data.post.status, 'publish');
    assert.notEqual(editorialEpoch(), epoch, 'a publication changes the editorial epoch the SSR polls');
    const published = (await BlogPostModel.findById(id).lean())!;

    // A revision whose critic did not pass is refused and the published guide is untouched.
    const failed = await pipelineRun(LONG.replace('Merece verla', 'Conviene verla'), { verdict: 'block', issues: [{ severity: 'high', message: 'inventa' }] });
    const refused = await call(controller.reviseByPolicy, { params: { id }, body: { expectedDraftHash: v1.draftHash, post: failed.post } });
    assert.ok((refused.error?.details ?? []).some((d: { field: string }) => d.field === 'critic-rejected'), String(refused.error));
    const still = (await BlogPostModel.findById(id).lean())!;
    assert.deepEqual([still.status, still.content, still.revisions?.length ?? 0], ['publish', published.content, 0]);

    // The runner verified another version than the one now live: 409, nothing written.
    const v2 = await pipelineRun(LONG.replace('Merece verla', 'Vale la pena verla'));
    assert.match(String((await call(controller.reviseByPolicy, { params: { id }, body: { expectedDraftHash: 'stale', post: v2.post } })).error), /changed since it was verified/);
    // A revision cannot move the guide to another slug, nor arrive without new provenance.
    assert.match(String((await call(controller.reviseByPolicy, { params: { id }, body: { expectedDraftHash: v1.draftHash, post: { ...v2.post, slug: 'otro-slug-distinto' } } })).error?.details?.[0]?.message), /keeps the slug/);
    assert.match(String((await call(controller.reviseByPolicy, { params: { id }, body: { expectedDraftHash: v1.draftHash, post: { ...v2.post, editorial: undefined } } })).error?.details?.[0]?.message), /keeps the slug/);
    // A forged signature is refused like on approval.
    const forged = { ...v2.post, editorial: { ...v2.post.editorial, signature: 'x'.repeat(64) } };
    assert.match(String((await call(controller.reviseByPolicy, { params: { id }, body: { expectedDraftHash: v1.draftHash, post: forged } })).error?.details?.[0]?.message), /not signed by the pipeline/);

    // The emergency stop wins over maintenance too.
    await BlogPostModel.db.collection<{ _id: string }>('editorial_settings').updateOne({ _id: 'policy' }, { $set: { paused: true, pausedReason: 'prueba' } });
    assert.match(String((await call(controller.reviseByPolicy, { params: { id }, body: { expectedDraftHash: v1.draftHash, post: v2.post } })).error), /emergency stop/);
    await BlogPostModel.db.collection<{ _id: string }>('editorial_settings').updateOne({ _id: 'policy' }, { $set: { paused: false } });

    // Certified revision: published in place, same URL and first publication date, the old version kept.
    const ok = await call(controller.reviseByPolicy, { params: { id }, body: { expectedDraftHash: v1.draftHash, post: v2.post } });
    assert.equal(ok.code, 200, JSON.stringify(ok.error));
    const after = (await BlogPostModel.findById(id).lean())!;
    assert.deepEqual([after.status, after.slug, after.reviewedBy, after.editorial?.draftHash, after.editorial?.state], ['publish', SLUG, POLICY_REVIEWER, v2.draftHash, 'published']);
    assert.equal(after.publishedAt?.toISOString(), published.publishedAt?.toISOString());
    assert.match(String(after.content), /Vale la pena verla/);
    assert.match(String(after.reviewNotes), /^Maintenance revision by the M11-B evidence policy/);
    assert.deepEqual(after.revisions!.map((r) => [r.version, r.reason, r.snapshot.status]), [[1, 'maintenance by policy', 'publish']]);
    // Replaying the same revision is refused (ledger), and it counted against the daily cap.
    assert.match(String((await call(controller.reviseByPolicy, { params: { id }, body: { expectedDraftHash: v2.draftHash, post: v2.post } })).error), /already published by policy once/);
    assert.equal(await BlogPostModel.db.collection('editorial_policy_approvals').countDocuments({ postId: after._id }), 2);

    // Safe rollback to the previous published version stays available (human review key, router).
    const rolled = await call(controller.rollbackPost, { params: { id }, body: { version: 1 } });
    assert.equal(rolled.body?.data.post.status, 'publish');
    assert.equal((await BlogPostModel.findById(id).lean())!.content, published.content);

    // A guide a person approved is never replaced by the policy.
    await BlogPostModel.updateOne({ _id: id }, { reviewedBy: 'Revisora Prueba' });
    const v3 = await pipelineRun(LONG.replace('Merece verla', 'Hay que verla'));
    assert.match(String((await call(controller.reviseByPolicy, { params: { id }, body: { expectedDraftHash: v1.draftHash, post: v3.post } })).error), /Only a guide published by the policy/);
  } finally {
    process.env = env;
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
