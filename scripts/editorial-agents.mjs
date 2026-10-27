#!/usr/bin/env node
// M11-B AI editorial pipeline CLI over apps/backend/dist (run `npm run build -w apps/backend` first).
// Nothing here writes to a database unless `save-draft`/`publish` is pointed at an API with an admin key.
//
//   run <topics.json> [--replay answers.json] [--mock-images] [--report <api>] [--out artifacts/m11b/runs] [--site https://guiaprogramaciontv.com]
//       Research → evidence → editorial → SEO → critic → gates → cover, one run file per topic (covers in <out>/media).
//       Live models need Anthropic credentials; --replay feeds recorded role answers ({ "<slug>": { research: [...], ... } }).
//       Routes: EDITORIAL_ROUTES / EDITORIAL_IMAGE_ROUTES (JSON, see docs/adr/0001); --mock-images uses the local mock.
//       --report sends each run summary (no text, no evidence) to the Admin job list.
//   verify <run.json>          re-fetches every source and re-checks the evidence and publication gates (no model)
//   maintain [--runs dir] [--site url]  freshness report: due reviews, re-verified evidence, legacy guides (no model)
//   save-draft <run.json> --api http://127.0.0.1:4000   POST as a NEW draft with provenance (refuses existing slugs)
//   publish <run.json> --api ...   policy approval; the API refuses unless EDITORIAL_POLICY_PUBLISHING=enabled
// Secrets (ANTHROPIC_API_KEY, ANALYTICS_ADMIN_KEY, EDITORIAL_REVIEW_KEY) come from the environment and are never printed.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { marked } from 'marked';

const require = createRequire(import.meta.url);
const dist = resolve('apps/backend/dist');
if (!existsSync(join(dist, 'application/services/EditorialAgentPipeline.js'))) {
  console.error('apps/backend/dist is missing: npm run build -w apps/backend'); process.exit(2);
}
const pipeline = require(join(dist, 'application/services/EditorialAgentPipeline.js'));
const evidence = require(join(dist, 'application/services/EditorialEvidence.js'));

const [command, target] = process.argv.slice(2);
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const site = arg('site', 'https://guiaprogramaciontv.com').replace(/\/$/, '');
const out = resolve(arg('out', arg('runs', 'artifacts/m11b/runs')));
const readJson = (p) => JSON.parse(readFileSync(resolve(p), 'utf8'));
const UA = 'GuiaTV-Editorial-Agent/1.0 (+https://guiaprogramaciontv.com/politica-editorial)';

// One polite GET per cited page: no crawling, 2 MB cap, text only.
async function fetchSource(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/json;q=0.9,*/*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const raw = (await res.text()).slice(0, 2_000_000);
    const text = /json/.test(res.headers.get('content-type') || '') ? raw
      : raw.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    return { status: res.status, text };
  } catch { return { status: 0, text: '' }; }
}
const internalLinkStatus = async (path) => (await fetch(`${site}${path}`, { redirect: 'manual', headers: { 'user-agent': UA } })).status;
async function publicCorpus() {
  const list = await (await fetch(`${site}/v2/blog?limit=0`)).json();
  const posts = [];
  for (const p of list) posts.push({ slug: p.slug, content: (await (await fetch(`${site}/v2/blog?slug=${encodeURIComponent(p.slug)}`)).json())[0]?.content?.rendered ?? '' });
  return posts;
}
// Replay: recorded role answers instead of API calls. A missing answer saves the exact prompt that role
// would get (system, prompt, schema), so a separate agent can answer it and the run can resume.
function replayModel(answers, slug) {
  return {
    provider: 'replay',
    async call(req) {
      // Each recorded answer is used once, in order, like the live calls it stands for.
      const json = (answers[req.role] ?? []).shift();
      if (json === undefined) {
        const dir = resolve('artifacts/m11b/prompts');
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `${slug}-${req.role}.md`);
        writeFileSync(file, `# ${req.role} (${req.model}, effort ${req.effort}${req.webSearches ? `, ${req.webSearches} searches` : ''})\n\n## System\n\n${req.system}\n\n## Prompt\n\n${req.prompt}\n\n## Answer schema\n\n\`\`\`json\n${JSON.stringify(req.schema, null, 1)}\n\`\`\`\n`);
        throw new Error(`awaiting ${req.role} answer: ${file}`);
      }
      return { json, usage: { input_tokens: 0, output_tokens: 0 }, searches: 0 };
    },
  };
}
// A malformed cap must stop the run, not silently disable the cap (NaN compares false).
const positive = (name, fallback) => {
  if (process.env[name] === undefined) return fallback;
  const v = Number(process.env[name]);
  if (!Number.isFinite(v) || v <= 0) { console.error(`${name} must be a positive number`); process.exit(2); }
  return v;
};
const limits = () => ({
  ...evidence.DEFAULT_EDITORIAL_LIMITS,
  maxArticleUsd: positive('EDITORIAL_MAX_ARTICLE_USD', evidence.DEFAULT_EDITORIAL_LIMITS.maxArticleUsd),
  maxDailyUsd: positive('EDITORIAL_MAX_DAILY_USD', evidence.DEFAULT_EDITORIAL_LIMITS.maxDailyUsd),
  maxDailyArticles: positive('EDITORIAL_MAX_DAILY', evidence.DEFAULT_EDITORIAL_LIMITS.maxDailyArticles),
});
const today = () => new Date().toISOString().slice(0, 10);
const runFiles = () => (existsSync(out) ? readdirSync(out).filter((f) => f.endsWith('.json')) : []);
// Append-only: a rerun overwrites its run file, but the money it spent stays counted for the day.
const spendLog = () => join(out, 'spend.jsonl');
const spentToday = () => (existsSync(spendLog()) ? readFileSync(spendLog(), 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [])
  .filter((e) => e.day === today()).reduce((sum, e) => sum + e.usd, 0);
const MEDIA_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
// A production API is a production write: only with the owner's authorisation.
function apiBase(value) {
  const api = String(value || '').replace(/\/$/, '');
  if (!api) { console.error('--api is required (a production API is a production write: needs the owner\'s authorisation)'); process.exit(2); }
  if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(api) && !process.argv.includes('--confirm-production-write')) {
    console.error(`${api} is not local: add --confirm-production-write once the owner has authorised this write`); process.exit(2);
  }
  return api;
}
const adminHeaders = () => ({ 'content-type': 'application/json', 'x-admin-key': process.env.ANALYTICS_ADMIN_KEY || '' });

if (command === 'run') {
  const topics = readJson(target);
  const replay = arg('replay') ? readJson(arg('replay')) : null;
  const report = arg('report') ? apiBase(arg('report')) : null;
  const { routes, imageRoutes } = pipeline.routesFromEnv();
  const mockImages = process.argv.includes('--mock-images');
  const images = mockImages ? [new (require(join(dist, 'infrastructure/external/MockImageModel.js')).MockImageModel)()] : [];
  const corpus = await publicCorpus();
  const deps = (slug) => ({
    // Live adapters, one per provider with credentials; a new provider is added here once it exists (docs/adr/0001).
    ...(replay ? { model: replayModel(structuredClone(replay[slug] ?? {}), slug) } : { models: [new (require(join(dist, 'infrastructure/external/AnthropicEditorialModel.js')).AnthropicEditorialModel)()] }),
    routes, images, imageRoutes: mockImages && !process.env.EDITORIAL_IMAGE_ROUTES ? [{ provider: 'mock', model: 'mock-cover-1' }] : imageRoutes,
    fetchSource, internalLinkStatus, corpus, render: (md) => marked.parse(md),
    signingKey: process.env.EDITORIAL_PIPELINE_SIGNING_KEY,
  });
  mkdirSync(join(out, 'media'), { recursive: true });
  const startedAt = new Date().toISOString();
  // Other articles started today; a rerun of the same topic does not use up the quota again.
  const doneToday = runFiles().filter((f) => f.startsWith(today()) && !topics.some((t) => f === `${today()}-${t.slug}.json`)).length;
  // A replay is per slug, so replayed topics run one by one; live runs share one client under the batch caps.
  const runs = replay
    ? await Promise.all(topics.map((t, i) => (i < limits().maxDailyArticles - doneToday
      ? pipeline.runEditorialJob(t, deps(t.slug), limits()).catch((e) => ({ slug: t.slug, state: 'draft', reason: e.message, findings: [], cost: {} }))
      : { slug: t.slug, state: 'blocked', reason: 'límite diario', findings: [], cost: {} })))
    : await pipeline.runEditorialBatch(topics, deps(), limits(), doneToday, spentToday());
  for (const { media = [], ...run } of runs) {
    for (const { asset, bytes } of media) writeFileSync(join(out, 'media', `${asset.sha256}.${MEDIA_EXT[asset.contentType]}`), bytes);
    const file = join(out, `${today()}-${run.slug}.json`);
    writeFileSync(file, JSON.stringify({ ...run, modelBackend: run.provenance?.backend ?? (replay ? 'replay' : null) }, null, 1));
    writeFileSync(spendLog(), `${JSON.stringify({ day: today(), at: startedAt, slug: run.slug, usd: run.cost.usd ?? 0 })}\n`, { flag: 'a' });
    const blocks = run.findings.filter((f) => f.severity === 'block');
    console.log(`${run.state.padEnd(18)} ${run.slug}  $${(run.cost.usd ?? 0).toFixed(3)}  value=${JSON.stringify(run.value ?? {})}${run.reason ? `  (${run.reason})` : ''}${run.imageFailure ? `  [sin portada: ${run.imageFailure}]` : ''}`);
    for (const f of blocks) console.log(`   block ${f.code}: ${f.message}`);
    if (report) {
      const res = await fetch(`${report}/v2/admin/editorial/jobs`, { method: 'POST', headers: adminHeaders(), body: JSON.stringify({
        jobId: `${startedAt}-${run.slug}`, slug: run.slug, state: run.state, reason: run.reason ?? null, startedAt,
        backend: run.provenance?.backend ?? null, costUsd: run.cost.usd ?? 0, costEntries: run.cost.entries ?? [],
        blockingCodes: blocks.map((f) => f.code), imageFailure: run.imageFailure ?? null,
      }) }).catch((e) => ({ ok: false, status: e.message }));
      if (!res.ok) console.log(`   job report FAILED ${res.status}`);
    }
  }
} else if (command === 'verify') {
  const run = readJson(target);
  const r = await reverify(run.provenance);
  const findings = evidence.evaluateEvidence({ ...run.draft, author: { name: run.draft.authorName }, seo: { metaTitle: run.draft.metaTitle, metaDescription: run.draft.metaDescription } }, { ...run.provenance, bundle: r.bundle, bundleHash: evidence.hashBundle(r.bundle), critic: { ...run.provenance.critic, bundleHash: evidence.hashBundle(r.bundle) } });
  console.log(JSON.stringify({ slug: run.slug, changed: r.changed, findings }, null, 1));
  process.exit(findings.some((f) => f.severity === 'block') ? 1 : 0);
} else if (command === 'maintain') {
  const now = new Date();
  const report = { at: now.toISOString(), runs: [], guides: [] };
  for (const f of runFiles()) {
    const run = JSON.parse(readFileSync(join(out, f), 'utf8'));
    if (!run.provenance?.nextReviewAt) continue;
    const due = Date.parse(run.provenance.nextReviewAt) <= now.getTime();
    // Targeted: only due runs are re-fetched, and only claims that lost support need rewriting.
    const r = due ? await reverify(run.provenance) : { changed: [] };
    report.runs.push({ slug: run.slug, nextReviewAt: run.provenance.nextReviewAt, due, changedEvidence: r.changed, state: r.changed.length ? 'requires-update' : run.state });
  }
  const cadence = evidence.REVIEW_CADENCE_DAYS;
  for (const g of readJson('docs/seo/editorial-drafts/publish.json')) {
    const next = new Date(Date.parse(`${g.verifiedOn}T00:00:00Z`) + cadence[g.volatility ?? 'stable'] * 864e5);
    report.guides.push({ slug: g.slug, volatility: g.volatility, verifiedOn: g.verifiedOn, nextReviewAt: next.toISOString().slice(0, 10), due: next <= now, provenance: false });
  }
  mkdirSync(resolve('artifacts/m11b'), { recursive: true });
  writeFileSync(resolve('artifacts/m11b/freshness.json'), JSON.stringify(report, null, 1));
  for (const x of [...report.runs, ...report.guides]) console.log(`${x.due ? 'DUE ' : 'ok  '} ${x.nextReviewAt.slice(0, 10)} ${x.slug}${x.changedEvidence?.length ? `  changed: ${x.changedEvidence.join(', ')}` : ''}`);
} else if (command === 'save-draft' || command === 'publish') {
  const run = readJson(target);
  const api = apiBase(arg('api'));
  const headers = adminHeaders();
  const found = await (await fetch(`${api}/v2/blog?slug=${encodeURIComponent(run.slug)}&status=all`, { headers })).json();
  if (command === 'save-draft') {
    if (found[0]) { console.error(`${run.slug} already exists (${found[0].status}); a PUT would take a live guide offline. Refusing.`); process.exit(1); }
    if (!run.draft || run.state === 'blocked') { console.error(`${run.slug} is ${run.state}: nothing reviewable to save`); process.exit(1); }
    // Covers first: the draft points at their content-addressed URLs, which must exist before anyone previews it.
    for (const asset of run.provenance?.images ?? []) {
      const bytes = readFileSync(join(resolve(target, '..'), 'media', `${asset.sha256}.${MEDIA_EXT[asset.contentType]}`));
      const up = await fetch(`${api}/v2/admin/editorial/media/${asset.sha256}`, { method: 'POST', headers: { ...headers, 'content-type': asset.contentType }, body: bytes });
      if (!up.ok) { console.error(`cover upload FAILED ${up.status} ${await up.text()}`); process.exit(1); }
    }
    const res = await fetch(`${api}/v2/blog`, { method: 'POST', headers, body: JSON.stringify({ ...run.draft, editorial: run.provenance }) });
    console.log(`${res.ok ? 'saved draft' : `FAILED ${res.status}`} ${run.slug} ${res.ok ? (await res.json()).data.post.id : await res.text()}`);
  } else {
    if (!found[0]) { console.error(`${run.slug} is not in the CMS: save-draft first`); process.exit(1); }
    const res = await fetch(`${api}/v2/blog/${found[0].id}/approve-by-policy`, { method: 'POST', headers: { ...headers, 'x-editorial-review-key': process.env.EDITORIAL_REVIEW_KEY || '' } });
    console.log(`${res.ok ? 'published' : `REFUSED ${res.status}`} ${run.slug}`, res.ok ? '' : await res.text());
  }
} else {
  console.error('usage: editorial-agents.mjs run|verify|maintain|save-draft|publish …'); process.exit(2);
}

/** Re-fetch every source of a bundle; return the re-verified bundle and the claims that lost support. */
async function reverify(provenance) {
  const snapshots = new Map();
  const sources = [];
  for (const s of provenance.bundle.sources) {
    const res = await fetchSource(s.url);
    const ok = res.status === 200 && res.text.trim();
    if (ok) snapshots.set(s.id, res.text);
    sources.push({ ...s, httpStatus: res.status, ...(ok ? { retrievedAt: new Date().toISOString(), contentHash: evidence.hashText(res.text) } : { retrievedAt: undefined, contentHash: undefined }) });
  }
  const bundle = evidence.verifyBundle({ ...provenance.bundle, sources }, snapshots);
  return { bundle, changed: evidence.changedClaims(provenance.bundle, bundle, provenance.draftMarkdown) };
}
