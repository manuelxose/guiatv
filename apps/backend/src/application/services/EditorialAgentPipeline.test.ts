import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorialModel, runEditorialBatch, runEditorialJob } from './EditorialAgentPipeline';
import { DEFAULT_EDITORIAL_LIMITS, evaluateEvidence } from './EditorialEvidence';
import { deps, draft, GOOD, NOW, pass, research, scripted, topic } from './EditorialAgentPipeline.fixtures';

test('pipeline: a researched, verified and independently reviewed draft is approved by policy', async () => {
  const m = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft()], critic: [pass] });
  const run = await runEditorialJob(topic, deps(m.model));
  assert.equal(run.state, 'approved-by-policy', JSON.stringify(run.findings));
  assert.deepEqual(run.findings.filter((f) => f.severity !== 'warn').map((f) => f.code), ['unverified-claims']);
  assert.equal(run.provenance!.bundle.claims.find((c) => c.id === 'c5')!.status, 'unverified', 'a quote absent from its source is dropped');
  assert.deepEqual(run.value, { internalClaims: 1, publishers: 4, tables: 0, claimsUsed: 4 });
  assert.equal(run.draft!.authorName, 'Redacción IA de Guía TV');
  assert.match(run.draft!.content, /data-ai-disclosure/);
  assert.doesNotMatch(run.draft!.content, /\[\[c/);
  assert.equal(run.provenance!.nextReviewAt, '2026-10-27T10:00:00.000Z');
  // Strong models decide facts; the critic is a separate call that never sees the writer's prompt.
  assert.deepEqual(m.calls.map((c) => `${c.role}:${c.model}`), ['research:claude-opus-5-5', 'evidence:claude-opus-5-5', 'editorial:claude-opus-5-5', 'critic:claude-opus-5-5']);
  assert.doesNotMatch(m.calls[3].prompt, /Reglas: markdown/);
  assert.equal(run.cost.entries.length, 4);
  assert.equal(run.cost.usd, 0.116); // 4 × (2000×4 + 800×20)/1e6 + 2 searches × 0.01
  assert.equal(run.cost.sourceFetches, 4);
  // The stored provenance re-validates on its own (what the CMS approval endpoint does).
  assert.deepEqual(evaluateEvidence({ content: run.draft!.content, author: { name: run.draft!.authorName } }, run.provenance!, NOW), []);
});

test('pipeline: seed pages are fetched for the research agent and kept as sources with their own publisher', async () => {
  const seeded = { ...topic, seedUrls: ['https://www.rtve.es/play/la-2/'] };
  const cited = { ...research, sources: research.sources.filter((s) => s.id !== 'r1'), claims: research.claims.map((c) => (c.id === 'c4' ? { ...c, quotes: [{ sourceId: 's1', quote: c.quotes[0].quote }] } : c)) };
  const m = scripted({ research: [cited], evidence: [{ conflicts: [] }], editorial: [draft()], critic: [pass] });
  const run = await runEditorialJob(seeded, deps(m.model));
  // Without server tools the model can only quote what it is given: the page text must be in its prompt.
  assert.match(m.calls[0].prompt, /### s1 https:\/\/www\.rtve\.es\/play\/la-2\/ \(rtve\.es\)\nLa 2 emite cine clásico/);
  const s1 = run.provenance!.bundle.sources.find((s) => s.id === 's1')!;
  assert.deepEqual([s1.publisher, s1.kind, s1.httpStatus], ['rtve.es', 'official', 200]);
  assert.equal(run.provenance!.bundle.claims.find((c) => c.id === 'c4')!.status, 'supported');

  // A text fragment starts the prompt excerpt there; the request itself has no fragment.
  const deep = scripted({ research: [cited] });
  await runEditorialJob({ ...seeded, seedUrls: ['https://www.rtve.es/play/la-2/#:~:text=a%20partir%20de'] }, deps(deep.model));
  assert.match(deep.calls[0].prompt, /\(rtve\.es\)\na partir de las 22:00\./);
});

test('pipeline: sources that cannot be retrieved leave too little evidence and the job is held', async () => {
  const m = scripted({ research: [research], evidence: [{ conflicts: [] }] });
  const run = await runEditorialJob(topic, deps(m.model, { fetchSource: async () => ({ status: 404, text: '' }) }));
  assert.equal(run.state, 'blocked');
  assert.match(run.reason!, /0 afirmaciones verificadas/);
  assert.equal(m.calls.filter((c) => c.role === 'editorial').length, 0, 'no draft is written without evidence');
});

test('pipeline: an evidence conflict demotes claims and the writer cannot use them', async () => {
  const m = scripted({ research: [research], evidence: [{ conflicts: [{ claimIds: ['c1', 'c4'], note: 'la parrilla de RTVE no coincide' }] }] });
  const run = await runEditorialJob(topic, deps(m.model));
  assert.equal(run.state, 'blocked');
  assert.match(run.reason!, /solo 2 afirmaciones/);
});

test('pipeline: uncited figures go back to the writer with the gate findings, then pass', async () => {
  const sloppy = `${GOOD}\n\nTambién la emitió Antena 3 en 2019.`;
  const m = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft(sloppy), draft()], critic: [pass] });
  const run = await runEditorialJob(topic, deps(m.model));
  assert.equal(run.state, 'approved-by-policy');
  assert.equal(run.cost.draftAttempts, 2);
  assert.equal(run.cost.reviewFailures, 1);
  assert.match(m.calls.filter((c) => c.role === 'editorial')[1].prompt, /uncited-factual-statement/);
});

test('pipeline: the critic can only hold a draft, and review loops are bounded', async () => {
  const revise = { verdict: 'revise', issues: [{ severity: 'high', message: 'exagera la importancia' }] };
  const m = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft()], critic: [revise] });
  const run = await runEditorialJob(topic, deps(m.model), { ...DEFAULT_EDITORIAL_LIMITS, maxReviewLoops: 1 });
  assert.equal(run.state, 'blocked');
  assert.match(run.reason!, /ciclos de revisión/);
  assert.equal(m.calls.filter((c) => c.role === 'critic').length, 2);
  assert.ok(run.draft, 'the last draft stays reviewable');
  const blocked = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft()], critic: [{ verdict: 'block', issues: [{ severity: 'high', message: 'sin valor' }] }] });
  assert.equal((await runEditorialJob(topic, deps(blocked.model))).state, 'blocked');
});

test('pipeline: broken internal links and bad metadata are fixed by the SEO agent or blocked', async () => {
  const badMeta = { ...draft(), metaDescription: 'Corta' };
  const m = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [badMeta], seo: [{ title: draft().title, metaTitle: draft().metaTitle, metaDescription: draft().metaDescription }], critic: [pass] });
  const run = await runEditorialJob(topic, deps(m.model));
  assert.equal(run.state, 'approved-by-policy');
  assert.equal(m.calls.find((c) => c.role === 'seo')!.model, 'claude-haiku-5-5', 'metadata is a cheap-model task');

  const linked = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft(GOOD.replace('/programas/el-padrino', '/programas/no-existe'))], critic: [pass] });
  const broken = await runEditorialJob(topic, deps(linked.model), { ...DEFAULT_EDITORIAL_LIMITS, maxReviewLoops: 0 });
  assert.equal(broken.state, 'blocked');
  assert.ok(broken.findings.some((f) => f.code === 'internal-link-status'));
});

test('pipeline: a near-duplicate of a public guide needs a person, so it stops at verified', async () => {
  const fresh = () => scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft()], critic: [pass] }).model;
  const html = (await runEditorialJob(topic, deps(fresh()))).draft!.content;
  const run = await runEditorialJob(topic, deps(fresh(), { corpus: [{ slug: 'otra', content: html }] }));
  assert.equal(run.state, 'blocked', 'near-identical (≥ 0.8) is a block, not a judgement');
  const filler = Array.from({ length: html.split(/\s+/).length }, (_, i) => `relleno${i}`).join(' ');
  const near = await runEditorialJob(topic, deps(fresh(), { corpus: [{ slug: 'mitad', content: `${html}<p>${filler}</p>` }] }));
  assert.equal(near.state, 'verified');
  assert.match(near.reason!, /near-duplicate/);
});

test('cost control: the per-article budget stops the job and keeps the ledger', async () => {
  const m = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft()], critic: [pass] }, { input_tokens: 200_000, output_tokens: 40_000 });
  const run = await runEditorialJob(topic, deps(m.model), { ...DEFAULT_EDITORIAL_LIMITS, maxArticleUsd: 2 });
  assert.equal(run.state, 'blocked');
  assert.match(run.reason!, /límite: coste/);
  assert.equal(run.cost.entries.length, 2);
  const fetches = await runEditorialJob(topic, deps(scripted({ research: [research] }).model), { ...DEFAULT_EDITORIAL_LIMITS, maxSourceFetches: 2 });
  assert.match(fetches.reason!, /sourceFetches > 2/);
});

test('idempotence: the same inputs produce the same evidence, draft hash and outcome', async () => {
  const once = () => runEditorialJob(topic, deps(scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft()], critic: [pass] }).model));
  const [a, b] = [await once(), await once()];
  assert.equal(a.provenance!.bundleHash, b.provenance!.bundleHash);
  assert.equal(a.provenance!.draftHash, b.provenance!.draftHash);
  assert.equal(a.draft!.content, b.draft!.content);
  assert.equal(a.state, b.state);
});

test('batch: daily volume and concurrency limits are enforced', async () => {
  const m = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft()], critic: [pass] });
  const topics = [1, 2, 3, 4].map((n) => ({ ...topic, slug: `${topic.slug}-${n}` }));
  const runs = await runEditorialBatch(topics, deps(m.model), { ...DEFAULT_EDITORIAL_LIMITS, maxDailyArticles: 3, maxConcurrentJobs: 2 }, 1);
  assert.deepEqual(runs.map((r) => r.state), ['approved-by-policy', 'approved-by-policy', 'blocked', 'blocked']);
  assert.equal(runs.filter((r) => /límite diario/.test(r.reason ?? '')).length, 2);
  assert.equal(m.peak() <= 2, true);
});
test('review M1: a model error holds that article only; the batch and its ledger survive', async () => {
  const flaky: EditorialModel = { provider: 'scripted', async call(req) { if (req.role === 'editorial') throw new Error('refused'); return scripted({ research: [research], evidence: [{ conflicts: [] }] }).model.call(req); } };
  const runs = await runEditorialBatch([topic, { ...topic, slug: `${topic.slug}-2` }], deps(flaky));
  assert.deepEqual(runs.map((r) => [r.state, r.reason]), [['blocked', 'error: refused'], ['blocked', 'error: refused']]);
  assert.equal(runs[0].cost.entries.length, 2, 'research and evidence calls stay on the ledger');
});
