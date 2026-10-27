#!/usr/bin/env node
// M11-B AI editorial pipeline CLI over apps/backend/dist (run `npm run build -w apps/backend` first).
// Nothing here writes to a database unless `save-draft`/`publish` is pointed at an API with an admin key.
//
//   run <topics.json> [--replay answers.json] [--mock-images] [--report <api>] [--autopublish] [--out artifacts/m11b/runs] [--site https://guiaprogramaciontv.com]
//       Research → evidence → editorial → SEO → critic → gates → cover, one run file per topic (covers in <out>/media).
//       M11-E2: failed drafts are revised (re-research for evidence gaps), each version re-verified and re-criticised.
//       --autopublish (needs --report, the Admin activation and EDITORIAL_POLICY_KEY): every run that passes is saved and
//       published by policy, no person per article. EDITORIAL_BUDGET=unlimited lifts the USD caps (spend still recorded);
//       EDITORIAL_MAX_REVISIONS (default 5) and EDITORIAL_MAX_DAILY_ATTEMPTS (default 30) keep retries bounded.
//       Live models need Anthropic credentials; --replay feeds recorded role answers ({ "<slug>": { research: [...], ... } }).
//       Routes: EDITORIAL_ROUTES / EDITORIAL_IMAGE_ROUTES (JSON, see docs/adr/0001); --mock-images uses the local mock.
//       --report sends each run summary (no text, no evidence) to the Admin job list.
//   verify <run.json>          re-fetches every source and re-checks the evidence and publication gates (no model)
//   maintain [--runs dir] [--site url]  freshness report: due reviews, re-verified evidence, legacy guides (no model)
//   save-draft <run.json> --api http://127.0.0.1:4000   POST as a NEW draft with provenance (refuses existing slugs)
//   publish <run.json> --api ...   policy approval; the API refuses unless EDITORIAL_POLICY_PUBLISHING=enabled
// Secrets (ANTHROPIC_API_KEY, ANALYTICS_ADMIN_KEY, EDITORIAL_PIPELINE_SIGNING_KEY, EDITORIAL_POLICY_KEY) come from the
// environment and are never printed. The human EDITORIAL_REVIEW_KEY must not be here: the runner refuses to start with it.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const integer = (name, fallback, max) => {
  const v = positive(name, fallback);
  if (!Number.isInteger(v) || v > max) { console.error(`${name} must be an integer from 1 to ${max}`); process.exit(2); }
  return v;
};
// M11-E2 testing profile: EDITORIAL_BUDGET=unlimited lifts both USD caps; spend is still estimated, journaled and reported.
const BUDGET = process.env.EDITORIAL_BUDGET ?? 'capped';
if (!['capped', 'unlimited'].includes(BUDGET)) { console.error('EDITORIAL_BUDGET must be capped or unlimited'); process.exit(2); }
// M11-D: articles per day are set in the Admin; with --report the runner obeys that value (minus today's publications).
let serverCapacity = null;
const limits = () => ({
  ...evidence.DEFAULT_EDITORIAL_LIMITS,
  maxArticleUsd: BUDGET === 'unlimited' ? Infinity : positive('EDITORIAL_MAX_ARTICLE_USD', evidence.DEFAULT_EDITORIAL_LIMITS.maxArticleUsd),
  maxDailyUsd: BUDGET === 'unlimited' ? Infinity : positive('EDITORIAL_MAX_DAILY_USD', evidence.DEFAULT_EDITORIAL_LIMITS.maxDailyUsd),
  maxDailyArticles: serverCapacity ?? positive('EDITORIAL_MAX_DAILY', evidence.DEFAULT_EDITORIAL_LIMITS.maxDailyArticles),
  // Unlimited money must not mean unlimited retries: revisions per article and jobs per day stay bounded.
  maxReviewLoops: integer('EDITORIAL_MAX_REVISIONS', evidence.DEFAULT_EDITORIAL_LIMITS.maxReviewLoops, 10),
  maxDailyAttempts: integer('EDITORIAL_MAX_DAILY_ATTEMPTS', evidence.DEFAULT_EDITORIAL_LIMITS.maxDailyAttempts, 100),
});
const today = () => new Date().toISOString().slice(0, 10);
const runFiles = () => (existsSync(out) ? readdirSync(out).filter((f) => f.endsWith('.json')) : []);
// Append-only: a rerun overwrites its run file, but the money it spent stays counted for the day.
// M11-D: a job writes `reserve` (its whole allowance) before it may spend and `settle` when it ends, so a job
// that never settled (crash, kill) keeps counting its whole allowance. Rows without `kind` are pre-M11-D spends.
// One journal and lock per machine, whatever --out says, so two output dirs cannot each spend the day's ceiling.
const spendDir = resolve(process.env.EDITORIAL_SPEND_DIR || fileURLToPath(new URL('../artifacts/m11b/runs', import.meta.url)));
const spendLog = () => join(spendDir, 'spend.jsonl');
const spentToday = () => {
  const rows = (existsSync(spendLog()) ? readFileSync(spendLog(), 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []).filter((e) => e.day === today());
  const settled = new Set(rows.filter((e) => e.kind === 'settle').map((e) => e.jobId));
  return rows.filter((e) => e.kind !== 'reserve' || !settled.has(e.jobId)).reduce((sum, e) => sum + e.usd, 0);
};
// M11-E2: attempts per day = jobs in the machine-wide journal (reruns included), not run files in one --out dir.
const jobsToday = () => new Set((existsSync(spendLog()) ? readFileSync(spendLog(), 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []).filter((e) => e.day === today()).map((e) => e.jobId)).size;
const appendSpend = (row) => writeFileSync(spendLog(), `${JSON.stringify({ day: today(), at: new Date().toISOString(), ...row })}\n`, { flag: 'a' });
// The runner may sign and publish by policy, never approve as a person or lift the emergency stop.
for (const name of ['EDITORIAL_REVIEW_KEY', 'AUCTORIO_EDITORIAL_REVIEW_KEY']) {
  if (['run', 'save-draft', 'publish'].includes(command) && process.env[name]) {
    console.error(`${name} is a reviewer key and must not be in the runner environment; publish uses EDITORIAL_POLICY_KEY`); process.exit(2);
  }
}
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
  // Job ids and the journal are per slug: a repeated slug would let one settle cancel two reserves.
  if (new Set(topics.map((t) => t.slug)).size !== topics.length) { console.error('duplicate topic slugs'); process.exit(2); }
  limits(); // validates the env caps before any network call (an exit with a socket open can crash Node on Windows)
  const report = arg('report') ? apiBase(arg('report')) : null;
  // M11-E2: a run that passes every gate is saved and published by policy in the same job, with no per-article person.
  const autopublish = process.argv.includes('--autopublish');
  if (autopublish && (!report || replay || process.argv.includes('--mock-images'))) { console.error('--autopublish needs --report <api> and live models (no replay, no mock images)'); process.exit(2); }
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
  mkdirSync(spendDir, { recursive: true });
  // One runner at a time: two processes would each read the same day's spend and both spend it.
  // A crash leaves the lock: whoever removes it checks spend.jsonl first (unsettled reserves stay counted anyway).
  const lock = join(spendDir, 'run.lock');
  try { writeFileSync(lock, `${process.pid} ${new Date().toISOString()}\n`, { flag: 'wx' }); } catch {
    console.error(`${lock} exists: another run is active or one crashed. Check spend.jsonl, then remove the lock.`); process.exit(3);
  }
  process.on('exit', () => { try { unlinkSync(lock); } catch { /* already gone */ } });
  if (report) {
    const overview = await fetch(`${report}/v2/admin/editorial/overview`, { headers: adminHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const n = overview?.data?.policy?.dailyLimit;
    const published = overview?.data?.policy?.approvalsLast24h;
    // Fail closed: an Admin that cannot be read means no run, not the env default.
    if (!Number.isInteger(n) || n < 1 || !Number.isInteger(published)) { console.error(`cannot read the Admin daily limit from ${report}`); process.exit(2); }
    serverCapacity = Math.max(0, n - published);
    if (autopublish && !overview.data.policy.active) { console.error('automatic publication is not active in the Admin (switch, activation or emergency stop): run without --autopublish'); process.exit(2); }
    console.log(`daily limit from the Admin: ${n} article(s), ${published} published in 24 h, budget ${BUDGET}`);
  }
  const startedAt = new Date().toISOString();
  const jobId = (slug) => `${startedAt}-${slug}`;
  const persist = ({ media = [], ...run }) => {
    for (const { asset, bytes } of media) writeFileSync(join(out, 'media', `${asset.sha256}.${MEDIA_EXT[asset.contentType]}`), bytes);
    writeFileSync(join(out, `${today()}-${run.slug}.json`), JSON.stringify({ ...run, modelBackend: run.provenance?.backend ?? (replay ? 'replay' : null) }, null, 1));
  };
  const journal = {
    reserve: (slug, usd) => appendSpend({ kind: 'reserve', jobId: jobId(slug), slug, usd }),
    settle: (run, usd) => { persist(run); appendSpend({ kind: 'settle', jobId: jobId(run.slug), slug: run.slug, usd }); settled.set(run.slug, usd); },
  };
  const settled = new Map();
  // Every job started today on this machine counts, reruns of the same topic too: with no money cap this is the brake.
  const doneToday = jobsToday();
  // A replay is per slug, so replayed topics run one by one; live runs share one client under the batch caps.
  const runs = replay
    ? await Promise.all(topics.map((t, i) => (i < Math.min(limits().maxDailyArticles, limits().maxDailyAttempts - doneToday)
      ? pipeline.runEditorialJob(t, deps(t.slug), limits()).catch((e) => ({ slug: t.slug, state: 'draft', reason: e.message, findings: [], cost: {} }))
      : { slug: t.slug, state: 'blocked', reason: 'límite diario', findings: [], cost: {} })))
    : await pipeline.runEditorialBatch(topics, deps(), limits(), doneToday, spentToday(), journal);
  for (const run of runs) {
    // Live jobs were persisted as they settled; replays (no spend) and jobs held before starting are written here.
    if (!settled.has(run.slug)) { persist(run); if (replay) appendSpend({ kind: 'settle', jobId: jobId(run.slug), slug: run.slug, usd: run.cost.usd ?? 0 }); }
    const blocks = run.findings.filter((f) => f.severity === 'block');
    let publication = null;
    if (autopublish && run.state === 'approved-by-policy') {
      publication = await publishRun(run, report, out);
      if (publication.ok) run.state = 'published';
      else run.reason = `publicación rechazada: ${publication.message}`.slice(0, 1000);
      persist({ ...run, publication });
    }
    const tries = run.revisions ?? [];
    console.log(`${run.state.padEnd(18)} ${run.slug}  $${(run.cost.usd ?? 0).toFixed(3)}  revisiones=${Math.max(0, tries.length - 1)} [${tries.map((r) => `${r.verdict}/${r.action}`).join(' ')}]  value=${JSON.stringify(run.value ?? {})}${run.reason ? `  (${run.reason})` : ''}${run.imageFailure ? `  [sin portada: ${run.imageFailure}]` : ''}${publication?.ok ? `  → ${publication.url}` : ''}`);
    for (const f of blocks) console.log(`   block ${f.code}: ${f.message}`);
    if (report) {
      const res = await fetch(`${report}/v2/admin/editorial/jobs`, { method: 'POST', headers: adminHeaders(), body: JSON.stringify({
        jobId: jobId(run.slug), slug: run.slug, state: run.state, reason: run.reason ?? null, startedAt,
        // The settled amount: an unresolved spend reports its whole allowance, as the journal counts it.
        backend: run.provenance?.backend ?? null, costUsd: settled.get(run.slug) ?? run.cost.usd ?? 0, costEntries: run.cost.entries ?? [],
        blockingCodes: blocks.map((f) => f.code), imageFailure: run.imageFailure ?? null,
        revisions: Math.max(0, tries.length - 1), revisionLog: tries.map((r) => `${r.verdict}/${r.action}${r.blocking.length ? `:${r.blocking.join('+')}` : ''}`),
        budget: BUDGET, publicUrl: publication?.ok ? publication.url : null,
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
  const found = await findPost(api, run.slug);
  if (command === 'save-draft') {
    if (found) { console.error(`${run.slug} already exists (${found.status}); a PUT would take a live guide offline. Refusing.`); process.exit(1); }
    const saved = await saveDraft(run, api, resolve(target, '..'));
    if (!saved.ok) { console.error(saved.message); process.exit(1); }
    console.log(`saved draft ${run.slug} ${saved.id}`);
  } else {
    // Same path as --autopublish: only this run's own unreviewed draft (or a fresh save of it) is published by policy.
    const res = await publishRun(run, api, resolve(target, '..'));
    console.log(`${res.ok ? `published ${res.url}` : 'REFUSED'} ${run.slug}`, res.ok ? '' : res.message);
    if (!res.ok) process.exitCode = 1;
  }
} else {
  console.error('usage: editorial-agents.mjs run|verify|maintain|save-draft|publish …'); process.exit(2);
}

async function findPost(api, slug) {
  return (await (await fetch(`${api}/v2/blog?slug=${encodeURIComponent(slug)}&status=all`, { headers: adminHeaders() })).json())[0] ?? null;
}
/** POST a run as a NEW draft with its provenance; covers first, so the draft never points at a missing image. */
async function saveDraft(run, api, runDir) {
  // M11-D: a run held only by judgements (e.g. a critic 'revise') goes to a named reviewer; any hard block stays out.
  const hardBlocks = (run.findings ?? []).filter((f) => f.severity === 'block');
  if (!run.draft || hardBlocks.length) return { ok: false, message: `${run.slug} is ${run.state}${hardBlocks.length ? ` (${hardBlocks.map((f) => f.code).join(', ')})` : ''}: nothing reviewable to save` };
  for (const asset of run.provenance?.images ?? []) {
    const bytes = readFileSync(join(runDir, 'media', `${asset.sha256}.${MEDIA_EXT[asset.contentType]}`));
    const up = await fetch(`${api}/v2/admin/editorial/media/${asset.sha256}`, { method: 'POST', headers: { ...adminHeaders(), 'content-type': asset.contentType }, body: bytes });
    if (!up.ok) return { ok: false, message: `cover upload FAILED ${up.status} ${await up.text()}` };
  }
  const res = await fetch(`${api}/v2/blog`, { method: 'POST', headers: adminHeaders(), body: JSON.stringify({ ...run.draft, editorial: run.provenance }) });
  return res.ok ? { ok: true, id: (await res.json()).data.post.id } : { ok: false, message: `save FAILED ${res.status} ${await res.text()}` };
}
// A function declaration, like the helpers above: the top-level command code runs before any `const` below it exists.
async function approveByPolicy(api, id) {
  const res = await fetch(`${api}/v2/blog/${id}/approve-by-policy`, { method: 'POST', headers: { ...adminHeaders(), 'x-editorial-policy-key': process.env.EDITORIAL_POLICY_KEY || '' } });
  return { ok: res.ok, message: res.ok ? '' : `${res.status} ${(await res.text()).slice(0, 800)}` };
}
/**
 * M11-E2 autonomous publication of one passed run. The server re-runs every gate, the signature and the daily cap.
 * Idempotent after a crash: only a draft of THIS run (same draft hash) that no person has reviewed is reused; any
 * other post with the slug (published, human-reviewed, older evidence) is left alone.
 */
async function publishRun(run, api, runDir) {
  const problem = pipeline.policyProviderProblem(run.provenance);
  if (problem) return { ok: false, message: problem };
  const found = await findPost(api, run.slug);
  let id = null;
  if (found) {
    const detail = (await (await fetch(`${api}/v2/admin/editorial/posts/${found.id}`, { headers: adminHeaders() })).json().catch(() => null))?.data;
    const same = found.status === 'draft' && detail && !detail.post.reviewedBy && detail.provenance?.critic?.draftHash === run.provenance.draftHash;
    if (!same) return { ok: false, message: `${run.slug} ya existe (${found.status}) y no es el borrador de esta ejecución: no se toca` };
    id = found.id;
  }
  if (!id) {
    const saved = await saveDraft(run, api, runDir);
    if (!saved.ok) return saved;
    id = saved.id;
  }
  const res = await approveByPolicy(api, id);
  return res.ok ? { ok: true, url: `${site}/guias/${run.slug}` } : res;
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
