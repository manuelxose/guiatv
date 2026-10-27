import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  chooseRoutes, DEFAULT_ROUTES, EditorialModel, policyProviderProblem, RouteTable, routesFromEnv, runEditorialBatch, runEditorialJob,
} from './EditorialAgentPipeline';
import { DEFAULT_EDITORIAL_LIMITS, evaluateEvidence, provenanceSignatureValid } from './EditorialEvidence';
import { coverUrl, ImageModel, imageInfo } from './EditorialImages';
import { policyGateFailures } from './EditorialReviewPolicy';
import { MockImageModel } from '../../infrastructure/external/MockImageModel';
import { deps, draft, pass, research, scripted, topic } from './EditorialAgentPipeline.fixtures';

const script = () => ({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft()], critic: [pass] });
const MOCK_ROUTE = [{ provider: 'mock', model: 'mock-cover-1' }];
const withProvider = (m: EditorialModel, provider: string, webSearch = true): EditorialModel => ({ provider, webSearch, call: (r) => m.call(r) });

test('routing: the first configured, priced and capable route wins; research needs web search', () => {
  const table: RouteTable = { ...DEFAULT_ROUTES, editorial: [{ provider: 'openai', model: 'claude-opus-5-5', effort: 'medium' }, ...DEFAULT_ROUTES.editorial] };
  const a = withProvider(scripted({}).model, 'anthropic');
  assert.equal(chooseRoutes(table, [a]).editorial.route.provider, 'anthropic', 'openai has no adapter here, so the fallback is used');
  assert.throws(() => chooseRoutes(DEFAULT_ROUTES, [withProvider(a, 'anthropic', false)]), /research: ninguna ruta disponible con búsqueda web/);
  assert.throws(() => routesFromEnv({ EDITORIAL_ROUTES: JSON.stringify({ seo: [{ provider: 'deepseek', model: 'deepseek-unpriced', effort: 'low' }] }) }), /unpriced/);
  assert.throws(() => routesFromEnv({ EDITORIAL_IMAGE_ROUTES: JSON.stringify([{ provider: 'x', model: 'img-unpriced' }]) }), /unpriced/);
  assert.equal(policyProviderProblem({ backend: 'anthropic' }), null);
  assert.match(policyProviderProblem({ backend: 'anthropic+kimi' })!, /no verificado: anthropic\+kimi/);
  assert.match(policyProviderProblem({ backend: 'anthropic', images: [{ provider: 'mock' } as never] })!, /imagen no verificado: mock/);
});

test('routing: a mixed route records every provider, and a missing route holds the job before any call', async () => {
  const s = scripted(script());
  const table: RouteTable = { ...DEFAULT_ROUTES, seo: [{ provider: 'second', model: 'claude-haiku-5-5', effort: 'low' }] };
  const run = await runEditorialJob(topic, { ...deps(undefined as never), model: undefined, models: [withProvider(s.model, 'anthropic'), withProvider(s.model, 'second')], routes: table });
  assert.equal(run.provenance!.backend, 'anthropic+second');
  assert.notEqual(policyProviderProblem(run.provenance!), null, 'a provider without a real adapter cannot publish by policy');
  const none = await runEditorialJob(topic, { ...deps(undefined as never), model: undefined, models: [] });
  assert.equal(none.state, 'blocked');
  assert.match(none.reason!, /research: ninguna ruta/);
  assert.equal(s.calls.length, 4);
});

test('provider outage and invalid answers hold the job; the fallback route is never switched to mid-job', async () => {
  const fallback = scripted(script());
  const down: EditorialModel = { provider: 'anthropic', webSearch: true, async call(r) { if (r.role === 'editorial') throw new Error('503 overloaded'); return fallback.model.call(r); } };
  const table: RouteTable = { ...DEFAULT_ROUTES, editorial: [...DEFAULT_ROUTES.editorial, { provider: 'backup', model: 'claude-sonnet-5-5', effort: 'medium' }] };
  const run = await runEditorialJob(topic, { ...deps(undefined as never), model: undefined, models: [down, withProvider(fallback.model, 'backup')], routes: table });
  assert.deepEqual([run.state, run.reason], ['blocked', 'error: 503 overloaded']);
  assert.equal(fallback.calls.filter((c) => c.role === 'editorial').length, 0);
  // A schema-breaking answer (no markdown) is an error, not a draft.
  const broken = await runEditorialJob(topic, deps(scripted({ ...script(), editorial: [{ title: 'x' }] }).model));
  assert.equal(broken.state, 'blocked');
  assert.match(broken.reason!, /^error:/);
});

test('cost: the daily USD ceiling holds jobs once the day is spent, concurrent jobs included', async () => {
  const m = scripted(script());
  const topics = [1, 2, 3].map((n) => ({ ...topic, slug: `${topic.slug}-${n}` }));
  const limits = { ...DEFAULT_EDITORIAL_LIMITS, maxDailyUsd: 1, maxArticleUsd: 0.5, maxConcurrentJobs: 3 };
  const runs = await runEditorialBatch(topics, deps(m.model), limits, 0, 0.2);
  // 0.8 left: only one full 0.5 allowance fits at a time, so the others wait for what each job gives back (0.384).
  assert.deepEqual(runs.map((r) => r.state), ['approved-by-policy', 'approved-by-policy', 'approved-by-policy']);
  assert.equal(m.peak(), 1, 'the ceiling, not the concurrency setting, limited the parallelism');
  const tight = await runEditorialBatch(topics, deps(scripted(script()).model), limits, 0, 0.7);
  // 0.3 left: the first job runs on it (0.116), the second on the remaining 0.184, the third finds 0.068 < 0.116.
  assert.deepEqual(tight.map((r) => r.state), ['approved-by-policy', 'approved-by-policy', 'blocked']);
  assert.match(tight[2].reason!, /límite: coste/);
  const exhausted = await runEditorialBatch([topic], deps(scripted(script()).model), limits, 0, 1);
  assert.equal(exhausted[0].reason, 'límite diario de 1 USD');
});

test('images: a mock cover runs end to end, is signed and costed, but can never be published', async () => {
  const run = await runEditorialJob(topic, deps(scripted(script()).model, { images: [new MockImageModel()], imageRoutes: MOCK_ROUTE, signingKey: 'k' }));
  const [asset] = run.provenance!.images!;
  assert.equal(run.media![0].asset, asset);
  assert.deepEqual([asset.width, asset.height, asset.contentType, asset.provider], [1600, 900, 'image/png', 'mock']);
  assert.equal(asset.url, coverUrl(asset.sha256));
  assert.equal(run.draft!.coverImage, asset.url);
  assert.match(asset.altText, /^Ilustración generada por IA para el artículo «El Padrino/);
  assert.match(asset.prompt, /Sin texto.*carteles de películas.*personas reales/);
  assert.ok(run.cost.entries.some((e) => e.role === 'image' && e.model === 'mock-cover-1'));
  assert.ok(provenanceSignatureValid(run.provenance!, 'k'), 'the signature covers the image');
  assert.ok(!provenanceSignatureValid({ ...run.provenance!, images: [{ ...asset, sha256: 'f'.repeat(64) }] }, 'k'), 'swapping the picture breaks it');
  assert.equal(run.state, 'verified');
  assert.deepEqual(policyGateFailures(run.findings).map((f) => f.code), ['mock-image']);
  const post = { content: run.draft!.content, author: { name: run.draft!.authorName }, featuredImage: { sourceUrl: asset.url, alt: 'otra' } };
  assert.ok(evaluateEvidence(post, run.provenance!).some((f) => f.code === 'image-alt-mismatch'));
  const poster = evaluateEvidence({ ...post, featuredImage: { sourceUrl: 'https://image.tmdb.org/poster.jpg' } }, run.provenance!);
  assert.ok(poster.some((f) => f.code === 'image-not-in-provenance' && f.severity === 'human'));
});

test('images: outage, bad files, unpriced models and budget leave the text intact and record why', async () => {
  let called = 0;
  const counting: ImageModel = { provider: 'mock', generate: (r) => { called++; return new MockImageModel().generate(r); } };
  const cases: Array<[ImageModel, string, RegExp]> = [
    [{ provider: 'mock', async generate() { throw new Error('image API timeout'); } }, 'mock-cover-1', /timeout/],
    [{ provider: 'mock', async generate(r) { return { bytes: Buffer.from('<html>'), provider: 'mock', model: r.model, contentType: 'image/png' }; } }, 'mock-cover-1', /no es PNG/],
    [{ provider: 'mock', async generate(r) { return new MockImageModel().generate({ ...r, width: 1000, height: 1000 }); } }, 'mock-cover-1', /proporción 1000×1000/],
    [counting, 'dall-e-unverified', /sin precio/],
  ];
  for (const [image, model, why] of cases) {
    const run = await runEditorialJob(topic, deps(scripted(script()).model, { images: [image], imageRoutes: [{ provider: 'mock', model }] }));
    assert.match(run.imageFailure ?? '', why);
    assert.equal(run.state, 'approved-by-policy', 'the text outcome does not depend on the cover');
    assert.equal(run.provenance!.images, undefined);
    assert.equal(run.draft!.coverImage, undefined);
  }
  assert.equal(called, 0, 'an unpriced image model is never called');
});

test('imageInfo reads real PNG, JPEG and WebP headers', async () => {
  const png = (await new MockImageModel().generate({ prompt: 'x', model: 'm', width: 64, height: 36 })).bytes;
  assert.deepEqual(imageInfo(png), { contentType: 'image/png', width: 64, height: 36 });
  const base = sharp(png);
  assert.deepEqual(imageInfo(await base.clone().jpeg().toBuffer()), { contentType: 'image/jpeg', width: 64, height: 36 });
  assert.deepEqual(imageInfo(await base.clone().webp({ lossless: true }).toBuffer()), { contentType: 'image/webp', width: 64, height: 36 });
  assert.deepEqual(imageInfo(await base.clone().webp().toBuffer()), { contentType: 'image/webp', width: 64, height: 36 });
  assert.equal(imageInfo(Buffer.from('GIF89a........................')), null);
});
