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
//   cycle --report <api> [--confirm-production-write]   M11-F unattended cycle (scripts/editorial-scheduled.mjs runs it):
//       MAINTAIN (re-verify due guides; regenerate and revise-by-policy only when evidence changed) → DISCOVER (one model
//       call proposes topics; deterministic screening, seed fetch, scoring, diversity) → pick EDITORIAL_CYCLE_TOPICS
//       (default 1) → the same run/--autopublish path. Queue: <spend dir>/topic-queue.json; log: cycles.jsonl.
//   discover --report <api>    discovery only: proposes, screens and queues topics (no article is written)
//   verify <run.json>          re-fetches every source and re-checks the evidence and publication gates (no model)
//   maintain [--runs dir] [--site url] [--report <api> --apply]  freshness report: due reviews, re-verified evidence,
//       legacy guides (no model). M11-F: with --report, guides published by the policy are re-verified from the API;
//       --apply regenerates a guide whose evidence changed and publishes the new revision through revise-by-policy.
//   enrich <slug> --report <api> [--note "…"] [--links /a,/b] [--seeds url#:~:text=…]  M11-G: one re-certified revision of
//       a policy-published guide with GuíaTV's own facts and verified internal links (revise-by-policy, daily cap applies).
//   save-draft <run.json> --api http://127.0.0.1:4000   POST as a NEW draft with provenance (refuses existing slugs)
//   publish <run.json> --api ...   policy approval; the API refuses unless EDITORIAL_POLICY_PUBLISHING=enabled
// Secrets (ANTHROPIC_API_KEY, ANALYTICS_ADMIN_KEY, EDITORIAL_PIPELINE_SIGNING_KEY, EDITORIAL_POLICY_KEY) come from the
// environment and are never printed. The human EDITORIAL_REVIEW_KEY must not be here: the runner refuses to start with it.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { createLedgerLifecycle, ledgerEnabled, ledgerOptions } from './editorial-job-ledger.mjs';

const require = createRequire(import.meta.url);
const dist = resolve('apps/backend/dist');
if (!existsSync(join(dist, 'application/services/EditorialAgentPipeline.js'))) {
  console.error('apps/backend/dist is missing: npm run build -w apps/backend'); process.exit(2);
}
const pipeline = require(join(dist, 'application/services/EditorialAgentPipeline.js'));
const evidence = require(join(dist, 'application/services/EditorialEvidence.js'));
const queueLib = require(join(dist, 'application/services/EditorialTopicQueue.js'));

const [command, target] = process.argv.slice(2);
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const site = arg('site', 'https://guiaprogramaciontv.com').replace(/\/$/, '');
// M15: run files are the provenance maintenance re-verifies, so they default to the durable state directory
// (GUIATV_EDITORIAL_STATE, same layout as editorial-scheduled.mjs), never to the release the runner happens to run in.
const out = resolve(arg('out', arg('runs', process.env.GUIATV_EDITORIAL_STATE ? join(process.env.GUIATV_EDITORIAL_STATE, 'm11d', 'runs') : 'artifacts/m11b/runs')));
const readJson = (p) => JSON.parse(readFileSync(resolve(p), 'utf8'));
const UA = 'GuiaTV-Editorial-Agent/1.0 (+https://guiaprogramaciontv.com/politica-editorial)';

// M14-B: a SIGTERM is a request to stop, not proof of cancellation. Abort the live job, let it acknowledge
// and close its lease, then exit; the server reconciles anything that could not be acknowledged.
let activeLedger = null;
let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`[editorial] ${signal}: cerrando el trabajo en curso y su lease`);
  const done = activeLedger?.abortAll('cancelled') ?? Promise.resolve();
  done.catch(() => null).finally(() => process.exit(143));
  setTimeout(() => process.exit(143), 5000).unref?.();
};
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

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
  for (const p of list) {
    posts.push({
      slug: p.slug, title: p.title?.rendered ?? p.slug, categories: (p.categories_name ?? []).map((c) => c?.name ?? String(c)),
      categorySlugs: (p.categories_name ?? []).map((c) => c?.slug).filter(Boolean),
      content: (await (await fetch(`${site}/v2/blog?slug=${encodeURIComponent(p.slug)}`)).json())[0]?.content?.rendered ?? '',
    });
  }
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
// Cost is indicative, never limiting: unlimited by default (spend is still estimated, journaled and reported). EDITORIAL_BUDGET=capped re-enables the USD caps.
const BUDGET = process.env.EDITORIAL_BUDGET ?? 'unlimited';
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
  if (['run', 'save-draft', 'publish', 'cycle', 'discover', 'maintain', 'enrich'].includes(command) && process.env[name]) {
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
// Declared before the command dispatch below: it runs at module top level and reaches these (TDZ otherwise).
let activeRoutes = null;
const generationApi = (report, path, options = {}) => fetch(`${report}/v2/admin/editorial/generation/${path}`, { ...options, headers: { ...adminHeaders(), ...options.headers } });
const generationPost = (report, path, body = {}, headers = {}) => generationApi(report, path, { method: 'POST', body: JSON.stringify(body), headers });

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
  // M11-B1: `revises: <its own slug>` drafts a revision of a guide a person approved, as a local run file only. Saving
  // it is the named reviewer's call (policy guides use `enrich`), so it never reports, publishes or shares a batch.
  const revises = topics.filter((t) => t.revises);
  if (revises.length && (topics.length > 1 || report || revises[0].revises !== revises[0].slug)) {
    console.error('a revision topic runs alone, keeps its own slug (revises = slug) and is never reported or published'); process.exit(2);
  }
  acquireLock();
  if (report) {
    const policy = await adminPolicy(report);
    // Fail closed: an Admin that cannot be read means no run, not the env default.
    if (!policy) { console.error(`cannot read the Admin daily limit from ${report}`); process.exit(2); }
    if (autopublish && !policy.active) { console.error('automatic publication is not active in the Admin (switch, activation or emergency stop): run without --autopublish'); process.exit(2); }
  }
  // The guide being revised is not another page: it would only block its own slug (duplicates skip it already).
  await runTopics(topics, { report, autopublish, replay, corpus: (await publicCorpus()).filter((p) => p.slug !== revises[0]?.slug) });
} else if (command === 'cycle' || command === 'discover') {
  limits();
  const report = apiBase(arg('report'));
  acquireLock();
  try {
    await runCycle(report, command === 'discover');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await generationPost(report, 'runner/heartbeat', { version: 'm11g-2', status: 'error', error: message, providers: liveProviderNames(), webSearch: true }).catch(() => null);
    let queue;
    try { queue = loadQueue(); } catch { /* Preserve the last server snapshot when the local queue is unreadable. */ }
    if (queue) await reportCycle(report, 'failed', message, queue).catch(() => null);
    throw error;
  }
} else if (command === 'verify') {
  const run = readJson(target);
  const r = await reverify(run.provenance);
  const findings = evidence.evaluateEvidence({ ...run.draft, author: { name: run.draft.authorName }, seo: { metaTitle: run.draft.metaTitle, metaDescription: run.draft.metaDescription } }, { ...run.provenance, bundle: r.bundle, bundleHash: evidence.hashBundle(r.bundle), critic: { ...run.provenance.critic, bundleHash: evidence.hashBundle(r.bundle) } });
  console.log(JSON.stringify({ slug: run.slug, changed: r.changed, findings }, null, 1));
  process.exit(findings.some((f) => f.severity === 'block') ? 1 : 0);
} else if (command === 'maintain') {
  const now = new Date();
  const report = { at: now.toISOString(), runs: [], guides: [], published: [] };
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
  if (arg('report')) {
    const api = apiBase(arg('report'));
    const apply = process.argv.includes('--apply');
    // Always: maintenance.json and any revision must not race a scheduled cycle.
    acquireLock();
    const policy = await adminPolicy(api);
    if (!policy) { console.error(`cannot read the Admin policy from ${api}`); process.exit(2); }
    // --force re-verifies every policy guide now, whatever its interval (a manual check).
    report.published = await maintainPublished(api, { apply: apply && policy.active, policy, max: Number(arg('max', 3)), force: process.argv.includes('--force'), corpus: await publicCorpus() });
  }
  mkdirSync(resolve('artifacts/m11b'), { recursive: true });
  writeFileSync(resolve('artifacts/m11b/freshness.json'), JSON.stringify(report, null, 1));
  for (const x of [...report.runs, ...report.guides]) console.log(`${x.due ? 'DUE ' : 'ok  '} ${x.nextReviewAt.slice(0, 10)} ${x.slug}${x.changedEvidence?.length ? `  changed: ${x.changedEvidence.join(', ')}` : ''}`);
  for (const x of report.published) console.log(`${x.result.padEnd(20)} ${x.slug}${x.note ? `  (${x.note})` : ''}`);
} else if (command === 'enrich') {
  // M11-G: one versioned, re-certified revision of a guide the policy published, to add verified GuíaTV context and
  // relevant internal links. Same path as maintenance: the published version stays unless every gate passes.
  // Validated before any network call (an exit with a socket open can crash Node on Windows).
  limits();
  const list = (name) => String(arg(name, '')).split(',').map((s) => s.trim()).filter(Boolean);
  if (!target || target.startsWith('--')) { console.error('usage: enrich <slug> --report <api>'); process.exit(2); }
  if (list('links').some((p) => !/^\/(?!\/)[\w\-/]*$/.test(p))) { console.error('--links takes site paths such as /canales'); process.exit(2); }
  if (list('seeds').some((u) => !/^https:\/\//.test(u))) { console.error('--seeds takes https URLs'); process.exit(2); }
  const api = apiBase(arg('report'));
  acquireLock();
  const policy = await adminPolicy(api);
  if (!policy?.active) { console.error('automatic publication is not active in the Admin (switch, activation or emergency stop)'); process.exit(2); }
  if (serverCapacity < 1) { console.error('the Admin daily limit is used up'); process.exit(2); }
  const res = await enrichPublished(api, target, { note: arg('note', ''), links: list('links'), seeds: list('seeds'), corpus: await publicCorpus() });
  console.log(`${res.state}${res.reason ? `: ${res.reason}` : ''}`);
  if (res.state !== 'updated') process.exitCode = 1;
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
  console.error('usage: editorial-agents.mjs run|cycle|discover|verify|maintain|enrich|save-draft|publish …'); process.exit(2);
}

// Function declarations only below: the command code above runs before any top-level `const` here would exist.

/**
 * One runner at a time: two processes would each read the same day's spend and both spend it. M11-F: a lock left by
 * a dead runner (crash, reboot) is recovered instead of stopping every later scheduled cycle; its unsettled reserves
 * stay counted in spend.jsonl, and topics it left `running` go back to the queue (recoverQueue).
 */
function acquireLock() {
  mkdirSync(spendDir, { recursive: true });
  const lock = join(spendDir, 'run.lock');
  const take = () => { writeFileSync(lock, `${process.pid} ${new Date().toISOString()}\n`, { flag: 'wx' }); process.on('exit', () => { try { unlinkSync(lock); } catch { /* already gone */ } }); };
  try { return take(); } catch { /* held: is its owner alive? */ }
  const content = readFileSync(lock, 'utf8');
  const [pid, at] = content.trim().split(' ');
  if (lockAlive(Number(pid), at)) { console.error(`${lock}: another run (pid ${pid}, since ${at}) is active`); process.exit(3); }
  // Renamed, then checked: if another runner replaced the stale lock meanwhile, it is put back and we stop.
  const moved = `${lock}.stale-${process.pid}`;
  try { renameSync(lock, moved); } catch { console.error(`${lock}: another runner is recovering it`); process.exit(3); }
  if (readFileSync(moved, 'utf8') !== content) { renameSync(moved, lock); console.error(`${lock}: taken by another runner`); process.exit(3); }
  console.log(`lock huérfano recuperado (pid ${pid}, ${at}); sus reservas sin cerrar siguen contando`);
  try { return take(); } catch { console.error(`${lock}: taken by another runner`); process.exit(3); }
}
function lockAlive(pid, at) {
  // Older than any real cycle (5 revisions × a few minutes): the owner hung or the pid was reused.
  if (!(Date.now() - Date.parse(at) < 6 * 3600e3)) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** The Admin policy (limit, publications in 24 h, active), or null when it cannot be read. Sets the runner's capacity. */
async function adminPolicy(report) {
  const overview = await fetch(`${report}/v2/admin/editorial/overview`, { headers: adminHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const policy = overview?.data?.policy;
  if (!Number.isInteger(policy?.dailyLimit) || policy.dailyLimit < 1 || !Number.isInteger(policy?.approvalsLast24h)) return null;
  serverCapacity = Math.max(0, policy.dailyLimit - policy.approvalsLast24h);
  console.log(`daily limit from the Admin: ${policy.dailyLimit} article(s), ${policy.approvalsLast24h} published in 24 h, budget ${BUDGET}, active ${policy.active}`);
  return policy;
}

function liveModels() {
  const models = [];
  // Only providers with a server-side credential are offered. A stale ANTHROPIC_AUTH_TOKEN pointing at a dead
  // loopback gateway must not be advertised: M14-A moved production to DeepSeek's server-owned API.
  if (process.env.ANTHROPIC_API_KEY) models.push(new (require(join(dist, 'infrastructure/external/AnthropicEditorialModel.js')).AnthropicEditorialModel)());
  if (process.env.OPENAI_API_KEY) models.push(new (require(join(dist, 'infrastructure/external/OpenAIEditorialModel.js')).OpenAIEditorialModel)());
  if (process.env.DEEPSEEK_API_KEY) models.push(new (require(join(dist, 'infrastructure/external/DeepSeekEditorialModel.js')).DeepSeekEditorialModel)());
  if (!models.length) throw new Error('No live model provider is configured (DEEPSEEK_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY)');
  return models;
}
function liveProviderNames() {
  return [...(process.env.ANTHROPIC_API_KEY ? ['anthropic'] : []), ...(process.env.OPENAI_API_KEY ? ['openai'] : []), ...(process.env.DEEPSEEK_API_KEY ? ['deepseek'] : [])];
}
async function reportCycle(report, result, reason, q, generated = 0) {
  if (result === 'discovery-error') await generationPost(report, 'runner/heartbeat', { version: 'm11g-2', status: 'error', error: reason, providers: liveProviderNames(), webSearch: true }).catch(() => null);
  await generationPost(report, 'runner/cycles', { result, reason, queued: q.topics.filter((t) => t.state === 'queued').length, generated, queue: q.topics }).catch(() => null);
}
// Function declaration is hoisted: top-level command dispatch may reach runCycle before this line executes.
function manualTopic(topic, settings = {}) {
  if (!topic || typeof topic !== 'object') throw new Error('manual request missing topic');
  return {
    ...topic,
    categories: [topic.category],
    length: settings.lengths?.[topic.length] ?? { short: { min: 600, max: 900 }, medium: { min: 900, max: 1400 }, long: { min: 1400, max: 2000 } }[topic.length],
  };
}

/**
 * The `run` job: research → … → gates per topic, then (autopublish) policy publication and the Admin job report.
 * `publish` is publishRun (a new guide) or, for maintenance, a revise-by-policy of the published one.
 */
async function runTopics(topics, { report, autopublish, replay = null, corpus, publish = publishRun }) {
  const { routes: envRoutes, imageRoutes } = pipeline.routesFromEnv();
  const routes = activeRoutes ?? envRoutes;
  const mockImages = process.argv.includes('--mock-images');
  const images = mockImages ? [new (require(join(dist, 'infrastructure/external/MockImageModel.js')).MockImageModel)()] : [];
  // M14-B: every article runs under a durable lease with stage telemetry. A ledger outage stops the run (fail closed).
  const ledger = ledgerEnabled(report) ? createLedgerLifecycle({ ...ledgerOptions(report), logger: console }) : null;
  activeLedger = ledger;
  const deps = (slug) => ({
    // Live adapters, one per provider with credentials; a new provider is added here once it exists (docs/adr/0001).
    ...(replay ? { model: replayModel(structuredClone(replay[slug] ?? {}), slug) } : { models: liveModels() }),
    routes, images, imageRoutes: mockImages && !process.env.EDITORIAL_IMAGE_ROUTES ? [{ provider: 'mock', model: 'mock-cover-1' }] : imageRoutes,
    fetchSource, internalLinkStatus, corpus, render: (md) => marked.parse(md),
    signingKey: process.env.EDITORIAL_PIPELINE_SIGNING_KEY,
    ...(ledger ? { lifecycle: ledger.lifecycle } : {}),
  });
  mkdirSync(join(out, 'media'), { recursive: true });
  const startedAt = new Date().toISOString();
  const jobId = (slug) => `${startedAt}-${slug}`;
  const persist = ({ media = [], ...run }) => {
    for (const { asset, bytes } of media) writeFileSync(join(out, 'media', `${asset.sha256}.${MEDIA_EXT[asset.contentType]}`), bytes);
    writeFileSync(runFileFor(run, startedAt), JSON.stringify({ ...run, modelBackend: run.provenance?.backend ?? (replay ? 'replay' : null) }, null, 1));
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
    const session = ledger?.session(run.slug) ?? null;
    // Live jobs were persisted as they settled; replays (no spend) and jobs held before starting are written here.
    if (!settled.has(run.slug)) { persist(run); if (replay) appendSpend({ kind: 'settle', jobId: jobId(run.slug), slug: run.slug, usd: run.cost.usd ?? 0 }); }
    const blocks = run.findings.filter((f) => f.severity === 'block');
    let publication = null;
    if (autopublish && run.state === 'approved-by-policy') {
      const key = `${run.slug}:${run.provenance?.draftHash ?? 'sin-draft'}`;
      let begun = false;
      try {
        // The publication is fenced: it only starts while this worker still owns the lease, and the ledger
        // refuses a key another completed job already published.
        await session?.startStage('publication', 'publicación por política');
        await session?.publicationBegin(key);
        begun = true;
        publication = await publish(run, report, out);
      } catch (error) {
        publication = { ok: false, message: `publicación no iniciada: ${error instanceof Error ? error.message : String(error)}` };
      }
      if (begun) await session?.publicationFinish(publication.ok ? 'published' : 'rejected', publication.url ?? null).catch(() => null);
      else if (session) session.publication = { key, state: 'rejected', url: null };
      if (publication.ok) { run.state = publication.state ?? 'published'; run.publicUrl = publication.url; } else run.reason = `publicación rechazada: ${publication.message}`.slice(0, 1000);
      // A published URL is only "registered" when the public sitemap really lists it; the sitemap is generated, not submitted.
      if (publication.ok) {
        const listed = await fetch(`${site}/sitemap-blog.xml`, { headers: { 'user-agent': UA } })
          .then((response) => response.text()).then((xml) => xml.includes(`/guias/${run.slug}`)).catch(() => null);
        const detail = listed === null ? 'no se pudo leer sitemap-blog.xml' : 'listado comprobado en sitemap-blog.xml';
        await session?.startStage('sitemap-registration', detail).catch(() => null);
        await session?.finishStage('sitemap-registration', listed === null ? 'skipped' : listed ? 'completed' : 'failed',
          listed === false ? { classification: 'publication', message: 'la URL publicada no aparece en sitemap-blog.xml' } : undefined, detail).catch(() => null);
      }
      await session?.finishStage('publication', publication.ok ? 'completed' : 'failed',
        publication.ok ? undefined : { classification: 'publication', message: publication.message }, publication.ok ? publication.url : undefined).catch(() => null);
      persist({ ...run, publication });
    }
    if (autopublish && run.state === 'verified') {
      // M15: a text that passed every check but needs a person's decision goes to the CMS review inbox as a draft
      // with its reasons; nothing approves it automatically, and an editorial hold is no longer a lost run file.
      const review = await draftForRun(run, report, out).catch((error) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }));
      if (review.ok) { run.reviewDraftId = review.id; run.reason = `requiere revisión humana (borrador en Admin → Editorial): ${run.reason ?? ''}`.slice(0, 1000); }
      else run.reason = `${run.reason ?? 'requiere revisión humana'}; no se pudo dejar en la bandeja de revisión: ${review.message}`.slice(0, 1000);
      persist({ ...run, review });
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
    // The lease is released last: a crash before this line is recovered from the expired lease.
    await ledger?.close(run.slug, run);
  }
  activeLedger = null;
  return runs;
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
  const id = await draftForRun(run, api, runDir);
  if (!id.ok) return id;
  const res = await approveByPolicy(api, id.id);
  return res.ok ? { ok: true, url: `${site}/guias/${run.slug}` } : res;
}

async function postDetail(api, id) {
  return (await (await fetch(`${api}/v2/admin/editorial/posts/${id}`, { headers: adminHeaders() })).json().catch(() => null))?.data ?? null;
}
/**
 * M15: a draft this pipeline saved that nobody has touched since: no review, no edit (version 0), no revision, no
 * pending edit, signed provenance. Only such a draft is retried or replaced automatically; anything else is a person's.
 */
function untouchedPipelineDraft(found, detail) {
  return found?.status === 'draft' && Boolean(detail) && !detail.post.reviewedBy && !detail.pendingEdit && detail.version === 0
    && !(detail.revisions ?? []).length && (detail.post.reviewState ?? 'unreviewed') === 'unreviewed' && detail.provenance?.signed === true;
}
/**
 * The draft that holds THIS run: the run's own (same draft hash, after a crash) is reused; an untouched draft of an
 * EARLIER run of the slug (its approval failed, see resumePendingDraft) is replaced — deleted under its version, so a
 * concurrent edit wins — and this run is saved; a published or human-touched post is never touched.
 */
async function draftForRun(run, api, runDir) {
  const found = await findPost(api, run.slug);
  if (found) {
    const detail = await postDetail(api, found.id);
    const untouched = untouchedPipelineDraft(found, detail);
    if (untouched && detail.provenance?.critic?.draftHash === run.provenance.draftHash) return { ok: true, id: found.id };
    if (!untouched) return { ok: false, message: `${run.slug} ya existe (${found.status}) y no es un borrador intacto de este proceso: no se toca; revísalo en Admin → Editorial` };
    const removed = await fetch(`${api}/v2/admin/editorial/posts/${found.id}`, { method: 'DELETE', headers: adminHeaders(), body: JSON.stringify({ expectedVersion: 0, expectedStatus: 'draft' }) });
    if (!removed.ok) return { ok: false, message: `no se pudo sustituir el borrador anterior de ${run.slug}: ${removed.status} ${(await removed.text()).slice(0, 300)}` };
    console.log(`   borrador anterior de ${run.slug} sustituido por esta ejecución (su fichero de ejecución conserva la versión previa)`);
  }
  return saveDraft(run, api, runDir);
}
/**
 * M15: before a new generation of `slug`, retry the policy approval of the draft an earlier run saved but could not
 * publish (cap reached or stop pressed between save and approval, runner killed in between, ambiguous save). The
 * server re-runs every gate, the signature, the cap and the stop. Returns null when nothing blocks a new run;
 * `{ skip }` when no new run should start (published, a person's draft, approval waiting for the cap or the stop).
 */
async function resumePendingDraft(api, slug) {
  const found = await findPost(api, slug).catch(() => null);
  if (!found) return null;
  if (found.status === 'publish') return { ok: false, skip: true, message: `${slug} ya está publicado: no se genera de nuevo` };
  const detail = await postDetail(api, found.id);
  if (!untouchedPipelineDraft(found, detail)) return { ok: false, skip: true, review: true, message: `${slug} tiene un borrador en manos de una persona (revisado, editado o rechazado): se decide en Admin → Editorial` };
  if (detail.provenance?.state !== 'approved-by-policy') return { ok: false, skip: true, review: true, message: `${slug} espera revisión humana en Admin → Editorial (${(detail.policyBlockers ?? []).map((f) => f.code).join(', ') || detail.provenance?.state})` };
  const res = await approveByPolicy(api, found.id);
  if (res.ok) return { ok: true, url: `${site}/guias/${slug}` };
  // An approval that landed although its answer was lost: the post is public now.
  if ((await findPost(api, slug).catch(() => null))?.status === 'publish') return { ok: true, url: `${site}/guias/${slug}` };
  // Cap, stop or switch: the draft is still good; wait for them instead of paying for a new text.
  if (/^403\b/.test(res.message)) return { ok: false, skip: true, transient: true, message: `aprobación del borrador pendiente en espera: ${res.message}` };
  console.log(`   el borrador pendiente de ${slug} ya no pasa la aprobación (${res.message.slice(0, 200)}): se genera de nuevo`);
  return null;
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

// ---------------------------------------------------------------------------------------------------------------
// M11-F autonomous operations: topic queue, unattended cycle, verified internal links, maintenance.

function queuePath() { return join(spendDir, 'topic-queue.json'); }
function loadQueue() {
  if (!existsSync(queuePath())) return { version: 1, topics: [] };
  let queue;
  try { queue = JSON.parse(readFileSync(queuePath(), 'utf8')); }
  catch (error) { throw new Error('Cannot read editorial topic queue; preserve the file and inspect it', { cause: error }); }
  if (!queue || queue.version !== 1 || !Array.isArray(queue.topics)) throw new Error('Unsupported editorial topic queue format; preserve the file and inspect it');
  return queue;
}
// Write-then-rename: a crash mid-write leaves the previous queue, never half a file.
function saveQueue(q) { writeFileSync(`${queuePath()}.tmp`, JSON.stringify(q, null, 1)); renameSync(`${queuePath()}.tmp`, queuePath()); }
function cycleLog(row) { writeFileSync(join(spendDir, 'cycles.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`, { flag: 'a' }); }
async function reportJob(report, row) {
  const res = await fetch(`${report}/v2/admin/editorial/jobs`, { method: 'POST', headers: adminHeaders(), body: JSON.stringify({ startedAt: new Date().toISOString(), costUsd: 0, budget: BUDGET, ...row }) }).catch((e) => ({ ok: false, status: e.message }));
  if (!res.ok) console.log(`   job report FAILED ${res.status}`);
}

/**
 * One scheduled cycle. Order matters: maintenance first (published guides stay true before new ones are added), then
 * discovery only when the queue runs low, then at most EDITORIAL_CYCLE_TOPICS new articles through the normal
 * certified path. Nothing is written while the Admin policy is inactive or stopped; an empty queue ends quietly.
 */
async function runCycle(report, discoverOnly) {
  const now = new Date();
  const q = loadQueue();
  const recovered = queueLib.recoverQueue(q, now);
  saveQueue(q);
  await generationPost(report, 'runner/heartbeat', { version: 'm11g-2', providers: liveProviderNames(), webSearch: true }).catch(() => null);
  const workResponse = await generationApi(report, 'runner/work').then((r) => r.ok ? r.json() : null).catch(() => null);
  const work = workResponse?.data;
  const policy = work?.policy ?? await adminPolicy(report);
  if (work?.settings) activeRoutes = work.settings.routes;
  if (!policy) { cycleLog({ result: 'admin-unreadable', recovered }); await reportCycle(report, 'failed', 'No se puede leer la configuración del Admin', q); process.exitCode = 2; return; }
  serverCapacity = Math.max(0, policy.dailyLimit - policy.approvalsLast24h);
  const corpus = await publicCorpus();
  const log = { recovered, policy: { active: policy.active, dailyLimit: policy.dailyLimit, publishedLast24h: policy.approvalsLast24h } };
  // Human decisions on queued topics apply first and even while publication is stopped: they only edit the queue.
  const ownedQ = work?.ownershipProtocols?.includes('v1');
  for (const request of (work?.requests ?? []).filter((r) => r.kind === 'queue-action')) {
    const r = await generationPost(report, `runner/requests/${request.id}/${ownedQ ? 'claim-owned' : 'claim'}`).then((x) => x.ok ? x.json() : null).catch(() => null);
    const token = r?.data?.claimToken;
    if (!r || (ownedQ && typeof token !== 'string')) continue;
    let status = 'completed';
    let reason;
    try { reason = queueLib.applyQueueAction(q, request.queueAction, new Date()); saveQueue(q); } catch (e) { status = 'failed'; reason = String(e.message).slice(0, 500); }
    await generationPost(report, `runner/requests/${request.id}/finish`, { status, reason }, token ? { 'x-editorial-claim-token': token } : {});
  }
  if (!discoverOnly) log.maintenance = (await maintainPublished(report, { apply: policy.active, max: 2, corpus })).map((x) => `${x.slug}: ${x.result}`);
  if (!policy.active) { cycleLog({ ...log, result: 'inactive' }); await reportCycle(report, 'inactive', 'Publicación automática inactiva o parada de emergencia', q); return; }
  // M15: the pause stops SCHEDULED generation (queue + automatic discovery) only; a person's manual requests below
  // still run, under the same policy, gates and caps. Before, a manual start with the pause on did nothing.
  const paused = work?.settings?.enabled === false;
  if (log.maintenance?.length && !(await adminPolicy(report))?.active) { cycleLog({ ...log, result: 'inactive' }); await reportCycle(report, 'inactive', 'Publicación detenida durante mantenimiento', q); return; }
  let generated = 0;
  const manual = (work?.requests ?? []).filter((r) => r.kind === 'discover' || r.kind === 'generate');
  const ownedClaims = work?.ownershipProtocols?.includes('v1');
  const claim = (request) => generationPost(report, `runner/requests/${request.id}/${ownedClaims ? 'claim-owned' : 'claim'}`)
    .then((response) => response.ok ? response.json() : null).then((response) => {
      const token = response?.data?.claimToken;
      return response && (!ownedClaims || typeof token === 'string') ? { request, token } : null;
    }).catch(() => null);
  const finish = (claim, status, reason) => generationPost(report, `runner/requests/${claim.request.id}/finish`,
    { status, reason }, claim.token ? { 'x-editorial-claim-token': claim.token } : {});
  if (discoverOnly || manual.some((r) => r.kind === 'discover')) {
    const claimed = [];
    for (const request of manual.filter((r) => r.kind === 'discover')) {
      const owner = await claim(request);
      if (owner) claimed.push(owner);
    }
    if (discoverOnly || claimed.length) log.discovery = await discover(q, corpus, report);
    for (const owner of claimed) await finish(owner, log.discovery?.error ? 'failed' : 'completed', log.discovery?.error ?? `${log.discovery?.queued?.length ?? 0} temas añadidos`);
    if (discoverOnly) { const result = log.discovery?.error ? 'discovery-error' : 'discovered'; if (log.discovery?.error) process.exitCode = 1; cycleLog({ ...log, result }); await reportCycle(report, log.discovery?.error ? 'discovery-error' : 'ran', log.discovery?.error ?? 'Descubrimiento completado', q); return; }
  }
  for (const request of manual.filter((r) => r.kind === 'generate')) {
    if (serverCapacity < 1) break;
    const claimed = await claim(request);
    if (!claimed) continue;
    // Once claimed, every ordinary exception must be reconciled through the owned finish endpoint.
    // A process crash is recovered separately by the server-side lease/fencing protocol.
    let status = 'failed';
    let reason = 'Sin resultado';
    let published = false;
    try {
      const topic = manualTopic(request.topic, work.settings);
      const resumed = await resumePendingDraft(report, topic.slug);
      if (resumed?.ok) {
        published = true;
        status = 'completed';
        reason = `publicado al reintentar la aprobación del borrador pendiente: ${resumed.url}`;
        await reportJob(report, { jobId: `${new Date().toISOString()}-${topic.slug}-resume`, slug: topic.slug, state: 'published', reason, publicUrl: resumed.url });
      } else if (resumed?.skip) {
        // Nothing new is generated: the draft is a person's (review, edit) or its approval waits for the cap or the stop.
        status = resumed.review ? 'completed' : 'failed';
        reason = resumed.message;
      } else {
        const seeds = await queueLib.checkSeeds({ title: topic.title, intent: topic.intent, seedUrls: topic.seedUrls }, fetchSource);
        if (seeds.some((s) => !s.ok)) {
          reason = seeds.filter((s) => !s.ok).map((s) => `${s.url}: ${s.note}`).join('; ');
        } else {
          const [run] = await runTopics([topic], { report, autopublish: true, corpus });
          published = run?.state === 'published';
          // A text held for a person's decision is in the review inbox: the request did its job, the article waits there.
          status = published || run?.reviewDraftId ? 'completed' : 'failed';
          reason = run?.reason ?? run?.state ?? 'Sin resultado';
        }
      }
    } catch (error) {
      reason = `error de generación manual: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500);
    }
    const finished = await finish(claimed, status, reason);
    if (!finished.ok) throw new Error(`cannot finish manual request ${request.id}: HTTP ${finished.status}`);
    generated += published ? 1 : 0;
    serverCapacity = Math.max(0, serverCapacity - (published ? 1 : 0));
  }
  if (paused) {
    cycleLog({ ...log, result: 'generation-paused', generated });
    await reportCycle(report, 'generation-paused', generated ? `Generación programada en pausa; ${generated} solicitud(es) manual(es) publicada(s)` : 'Generación programada en pausa', q, generated);
    return;
  }
  const queued = q.topics.filter((t) => t.state === 'queued').length;
  if (!log.discovery && queued < 3 && now - Date.parse(q.lastDiscoveryAt ?? 0) >= 12 * 3600e3) log.discovery = await discover(q, corpus, report);
  const perCycle = work?.settings?.topicsPerCycle ?? integer('EDITORIAL_CYCLE_TOPICS', 1, 10);
  const room = Math.min(serverCapacity, perCycle);
  if (room <= 0) { const result = log.discovery?.error ? 'discovery-error' : 'daily-limit'; if (log.discovery?.error) process.exitCode = 1; cycleLog({ ...log, result }); await reportCycle(report, result, log.discovery?.error ?? 'Límite diario alcanzado', q, generated); return; }
  const allowed = new Set(work?.settings?.categories ?? []);
  const picks = queueLib.pickTopics(q, room, q.topics.filter((t) => t.startedAt?.slice(0, 10) === today())).filter((t) => !allowed.size || allowed.has(t.category));
  if (!picks.length) { const result = log.discovery?.error ? 'discovery-error' : 'no-eligible-topics'; if (log.discovery?.error) process.exitCode = 1; cycleLog({ ...log, result }); await reportCycle(report, result, log.discovery?.error ?? (generated ? 'Solicitudes manuales procesadas; no hay más temas elegibles' : 'No hay temas elegibles en la cola'), q, generated); return; }
  // M15: a topic whose earlier draft is still pending is resumed (approval retried) instead of regenerated.
  const fresh = [];
  for (const t of picks) {
    const resumed = await resumePendingDraft(report, t.id);
    const at = new Date().toISOString();
    if (resumed?.ok) { Object.assign(t, { state: 'published', publicUrl: resumed.url, reason: 'aprobación reintentada del borrador pendiente', updatedAt: at }); generated++; }
    else if (resumed?.skip) Object.assign(t, { state: resumed.transient ? 'queued' : 'held', reason: resumed.message.slice(0, 500), updatedAt: at });
    else fresh.push(t);
  }
  for (const t of fresh) {
    t.topic.linkTargets = await verifiedTargets(t.topic.linkTargets ?? []);
    t.topic.length ??= { min: 900, max: 1400 };
    t.topic.contentType ??= 'guide';
    Object.assign(t, { state: 'running', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  saveQueue(q);
  const runs = fresh.length ? await runTopics(fresh.map((t) => t.topic), { report, autopublish: true, corpus }) : [];
  for (const t of fresh) {
    const run = runs.find((r) => r.slug === t.id);
    t.updatedAt = new Date().toISOString();
    if (run?.state === 'published') { Object.assign(t, { state: 'published', publicUrl: run.publicUrl, reason: undefined }); generated++; }
    else if (/^límite diario|limit reached/.test(run?.reason ?? '')) Object.assign(t, { state: 'queued', reason: run.reason });
    // In the review inbox: not retried (a new run would only collide with that draft); a person decides there.
    else if (run?.reviewDraftId) Object.assign(t, { state: 'held', reason: run.reason.slice(0, 500) });
    else {
      t.attempts++;
      t.state = t.attempts >= queueLib.DEFAULT_QUEUE_POLICY.maxAttempts ? 'held' : 'queued';
      t.reason = `${run?.state ?? 'sin resultado'}: ${run?.reason ?? (run?.findings ?? []).filter((f) => f.severity === 'block').map((f) => f.code).join(', ')}`.slice(0, 500);
    }
  }
  saveQueue(q);
  const result = log.discovery?.error ? 'discovery-error' : 'ran';
  if (log.discovery?.error) process.exitCode = 1;
  cycleLog({ ...log, result, topics: picks.map((t) => `${t.id}: ${t.state}`) });
  await reportCycle(report, result, [log.discovery?.error, ...picks.map((t) => `${t.id}: ${t.state}`)].filter(Boolean).join('; '), q, generated);
}

/** DISCOVER → SCORE → QUEUE. The model only proposes; screening, seed checks, links and the score are code. */
async function discover(q, corpus, report) {
  const now = new Date();
  const inventory = await siteInventory(corpus);
  const coverage = coverageItems(corpus, q);
  let result;
  try {
    result = await queueLib.proposeTopics(liveModels(), activeRoutes ?? pipeline.routesFromEnv().routes, { now, coverage, queue: q.topics, siteInventory: inventoryText(inventory) });
  } catch (e) {
    // Provider outage or bad answer: the cycle goes on with the queue it has; the next cycle may try again.
    console.log(`descubrimiento fallido: ${e.message}`);
    return { error: String(e.message).slice(0, 300) };
  }
  q.lastDiscoveryAt = now.toISOString();
  const jobId = `${now.toISOString()}-discovery`;
  appendSpend({ kind: 'settle', jobId, slug: 'discovery', usd: result.cost.usd });
  const summary = { proposed: result.proposals.length, queued: [], rejected: [], usd: +result.cost.usd.toFixed(4), model: result.model };
  for (const p of result.proposals) {
    p.slug = queueLib.cleanSlug(p.slug);
    const ctx = { now, coverage, queue: q.topics };
    let reasons = queueLib.screenProposal(p, ctx);
    let seeds = [];
    let targets = [];
    if (!reasons.length) {
      seeds = await queueLib.checkSeeds(p, fetchSource);
      if (queueLib.seedPublishers(seeds.filter((s) => s.ok).map((s) => s.url)) < 2) reasons = [`insufficient-evidence: menos de dos entidades editoras verificadas (${seeds.map((s) => `${s.url} ${s.note}`).join('; ')})`];
    }
    const accepted = { ...p, seedUrls: seeds.filter((s) => s.ok).map((s) => s.url) };
    const own = firstPartySources(`${p.title} ${p.topic} ${p.intent}`);
    if (!reasons.length) targets = await linkTargetsFor(`${p.title} ${p.topic} ${p.intent}`, inventory, p.slug);
    const scored = reasons.length ? { score: 0, explanation: [] }
      : queueLib.scoreProposal(accepted, { ...ctx, seeds, linkTargets: targets.length, publishedCategories: corpus.flatMap((c) => c.categories) });
    const at = new Date().toISOString();
    q.topics.push({
      id: String(p.slug || `sin-slug-${at}`).slice(0, 80), title: String(p.title ?? ''), intent: String(p.intent ?? ''), category: String(p.category ?? ''),
      sourceCandidates: Array.isArray(p.seedUrls) ? p.seedUrls : [], sourceFamilies: [...new Set(accepted.seedUrls.map(queueLib.sourceFamily))],
      score: scored.score, scoreExplanation: [...scored.explanation, ...seeds.map((s) => `semilla ${s.ok ? 'verificada' : 'descartada'}: ${s.url} (${s.note})`)],
      freshUntil: p.freshUntil ?? null, duplicateCheck: queueLib.closestCoverage(p, ctx), createdAt: at, updatedAt: at,
      state: reasons.length ? 'rejected' : 'queued', ...(reasons.length ? { reason: reasons.join('; ').slice(0, 1000) } : {}), attempts: 0,
      topic: { ...queueLib.topicFor(accepted, own), linkTargets: targets }, whyDistinct: p.whyDistinct ?? null,
    });
    (reasons.length ? summary.rejected : summary.queued).push(`${p.slug}${reasons.length ? ` → ${reasons[0]}` : ` (${scored.score})`}`);
    // Saved after each one: a crash during the seed checks keeps what was already screened.
    saveQueue(q);
  }
  console.log(`descubrimiento: ${summary.proposed} propuestos, ${summary.queued.length} en cola, ${summary.rejected.length} descartados, ${summary.usd} USD`);
  for (const line of [...summary.queued.map((s) => `  + ${s}`), ...summary.rejected.map((s) => `  - ${s}`)]) console.log(line);
  await reportJob(report, {
    jobId, slug: 'discovery', state: 'discovery', costUsd: result.cost.usd, costEntries: result.cost.entries, backend: 'anthropic',
    reason: `${summary.proposed} propuestos, ${summary.queued.length} en cola, ${summary.rejected.length} descartados`,
  });
  return summary;
}

/** What is already covered, with the source families each runner-published guide relied on (from its run file). */
function coverageItems(corpus, q) {
  const inQueue = new Set(q.topics.map((t) => t.id));
  const families = new Map();
  for (const f of runFiles()) {
    try {
      const run = JSON.parse(readFileSync(join(out, f), 'utf8'));
      if (['published', 'updated'].includes(run.state) && run.provenance?.bundle) {
        families.set(run.slug, [...new Set(run.provenance.bundle.sources.filter((s) => evidence.sourceKindFor(s.url) !== 'internal').map((s) => queueLib.sourceFamily(s.url)))]);
      }
    } catch { /* an unreadable run file only loses its family count */ }
  }
  // A queued topic that was published counts once, through the queue.
  return corpus.map((c) => ({ slug: c.slug, title: c.title, categories: c.categories, sourceFamilies: inQueue.has(c.slug) ? [] : families.get(c.slug) ?? [] }));
}

/**
 * Public pages a guide may link: the static hubs and channels of the sitemap (indexable, canonical by construction)
 * and the public guides. /programas comes from EPG data whose metadata is not authoritative (M11-E): never linked
 * automatically. Every pick is still fetched and checked before use (verifiedTargets).
 */
async function siteInventory(corpus) {
  const locs = async (name) => [...(await (await fetch(`${site}/${name}`, { headers: { 'user-agent': UA } })).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  const label = (path) => decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '').replace(/-/g, ' ');
  const [statics, channels] = await Promise.all([locs('sitemap-static.xml'), locs('sitemap-channels.xml')]).catch(() => [[], []]);
  const categories = new Map(corpus.flatMap((c) => c.categorySlugs.map((slug, i) => [slug, c.categories[i]])));
  return [
    ...statics.filter((p) => p !== '/').map((p) => ({ path: p, label: p.split('/').join(' ').replace(/-/g, ' ').trim(), kind: 'sección' })),
    ...[...categories].map(([slug, name]) => ({ path: `/guias/categoria/${slug}`, label: `guías de ${name}`, kind: 'sección' })),
    ...channels.map((p) => ({ path: p, label: `canal ${label(p)}`, kind: 'canal', name: label(p) })),
    ...corpus.map((c) => ({ path: `/guias/${c.slug}`, label: c.title, kind: 'guía' })),
  ];
}
function inventoryText(inventory) {
  const of = (kind) => inventory.filter((t) => t.kind === kind);
  return `- Secciones: ${of('sección').map((t) => t.path).join(', ')}\n- Canales con ficha y parrilla (${of('canal').length}): ${of('canal').map((t) => t.name).join(', ')}\n- Guías publicadas: ${of('guía').length}`;
}
function plainText(s) { return ` ${String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, ' ')} `; }
/**
 * M11-G: GuíaTV's own facts (GET /v2/editorial/facts) as an internal source for topics about broadcast TV. Only the
 * curated TDT line-up: football broadcasters are inferred from the EPG, and EPG film metadata is not reliable.
 */
function firstPartySources(text) {
  // Broadcast TV, not TV sets ("tele 4K"), radio chains or motor-racing grids. The line-up is context only: it never
  // counts as the article's own value (EditorialEvidence LINEUP_FACTS), so a loose match costs tokens, not quality.
  return /\b(?:tdt|televisi[oó]n(?:es)?|tele|canales de (?:la )?(?:tele|televisi[oó]n|tdt)|sintonizar)\b(?!\s*(?:4k|8k|oled|qled|led|smart|barata|port[aá]til))/i.test(text)
    ? [{ id: 'gtv-tdt', url: `${site}/v2/editorial/facts?kind=channels&group=tdt&format=text` }] : [];
}
async function enrichPublished(api, slug, { note, links, seeds, corpus }) {
  const found = await findPost(api, slug).catch(() => null);
  const detail = found && (await fetch(`${api}/v2/admin/editorial/posts/${found.id}`, { headers: adminHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null))?.data;
  if (detail?.post?.reviewedBy !== 'policy:m11b-evidence-gate') return { state: 'refused', reason: 'solo guías publicadas por la política (las demás las revisa una persona)' };
  const published = detail.provenance?.critic?.draftHash;
  const run = published && latestRunFor(slug, published);
  if (!run) return { state: 'refused', reason: 'sin el fichero de ejecución de la versión publicada' };
  const topic = maintenanceTopic(run, [], []);
  topic.notes = `Revisión de una guía ya publicada para hacerla más útil. ${note} Conserva los datos verificados que siguen valiendo y el enfoque.`.trim();
  const text = `${run.draft.title} ${topic.topic} ${topic.intent}`;
  for (const s of firstPartySources(text)) if (!topic.internalSources.some((x) => x.url === s.url)) topic.internalSources.push(s);
  // A seed with a text fragment replaces the same page, so one page is never two sources.
  for (const s of seeds) topic.seedUrls = [...topic.seedUrls.filter((u) => u.split('#')[0] !== s.split('#')[0]), s];
  const inventory = await siteInventory(corpus);
  const extra = links.map((path) => inventory.find((t) => t.path === path) ?? { path, label: path.split('/').filter(Boolean).join(' ').replace(/-/g, ' ') });
  topic.linkTargets = await verifiedTargets([...new Map([...topic.linkTargets, ...extra.map(({ path, label }) => ({ path, label }))].map((t) => [t.path, t])).values()]);
  const [res] = await runTopics([topic], {
    report: api, autopublish: true, corpus: corpus.filter((x) => x.slug !== slug),
    publish: (next) => reviseRun(next, api, found.id, published),
  });
  return res;
}
function channelsHub() { return { path: '/canales', label: 'canales de televisión y su programación' }; }
async function linkTargetsFor(text, inventory, selfSlug, always = []) {
  const words = queueLib.topicTokens(text);
  const scored = [];
  for (const t of inventory) {
    if (t.path === `/guias/${selfSlug}`) continue;
    // A channel is relevant when the topic names it; another page when most of its own words are in the topic.
    const own = queueLib.topicTokens(t.label);
    const s = t.kind === 'canal' ? (t.name.length >= 4 && plainText(text).includes(plainText(t.name)) ? 1 : 0)
      : own.size ? [...own].filter((w) => words.has(w)).length / own.size : 0;
    if (s >= 0.5) scored.push({ ...t, s });
  }
  scored.sort((a, b) => b.s - a.s);
  const picked = [...scored.filter((t) => t.kind === 'canal').slice(0, 3), ...scored.filter((t) => t.kind !== 'canal').slice(0, 4)];
  return verifiedTargets([...always, ...picked.filter((t) => !always.some((a) => a.path === t.path)).map(({ path, label }) => ({ path, label }))]);
}
/** 200 without a redirect, a self-referencing canonical and no noindex: only such pages are offered to the writer. */
async function verifiedTargets(targets) {
  const ok = [];
  for (const t of targets) {
    const res = await fetch(`${site}${t.path}`, { redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (res?.status !== 200) continue;
    const html = (await res.text()).slice(0, 400000);
    const canonical = /<link[^>]*rel="canonical"[^>]*href="([^"]+)"/i.exec(html)?.[1] ?? /<link[^>]*href="([^"]+)"[^>]*rel="canonical"/i.exec(html)?.[1];
    const robots = /<meta[^>]*name="robots"[^>]*content="([^"]+)"/i.exec(html)?.[1] ?? '';
    if (canonical && new URL(canonical, site).href.replace(/\/$/, '') === `${site}${t.path}`.replace(/\/$/, '') && !/noindex/i.test(robots)) ok.push(t);
  }
  return ok;
}

/**
 * SCAN → DETECT → VERIFY → REVISE → RECERTIFY → UPDATE for guides the policy published. Each is re-fetched on its own
 * interval (stable facts monthly, changeable ones weekly or sooner, always once past nextReviewAt). Unchanged
 * evidence = no model call. Changed evidence = a full pipeline run published through revise-by-policy, which keeps
 * the old version unless every gate passes. A source that is merely down is retried before it counts as a change.
 */
async function maintainPublished(api, { apply, max, force = false, corpus }) {
  const statePath = join(spendDir, 'maintenance.json');
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
  const save = () => { writeFileSync(`${statePath}.tmp`, JSON.stringify(state, null, 1)); renameSync(`${statePath}.tmp`, statePath); };
  const now = Date.now();
  const days = (n) => new Date(now + n * 864e5).toISOString();
  const results = [];
  let checked = 0;
  for (const c of corpus) {
    const prev = state[c.slug];
    if (!force && prev && now < Date.parse(prev.nextCheckAt)) continue;
    if (checked >= max) break;
    const found = await findPost(api, c.slug).catch(() => null);
    const detail = found && (await fetch(`${api}/v2/admin/editorial/posts/${found.id}`, { headers: adminHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null))?.data;
    const published = detail?.provenance?.critic?.draftHash;
    // The full provenance (draft markdown, used claims) is in the runner's own run file of the published version.
    const run = published && latestRunFor(c.slug, published);
    const record = (result, note, nextDays, extra = {}) => {
      state[c.slug] = { result, note, checkedAt: new Date(now).toISOString(), nextCheckAt: days(nextDays), ...extra };
      results.push({ slug: c.slug, result, note });
      save();
    };
    if (!detail?.provenance?.bundle || detail.post.reviewedBy !== 'policy:m11b-evidence-gate') { record('not-policy', 'no publicada por la política: la revisa una persona', 30); continue; }
    // Every outcome a person may need to act on is reported to the Admin job list, not only logged here.
    const alert = (jobState) => reportJob(api, { jobId: `${new Date().toISOString()}-maint-${c.slug}`, slug: c.slug, state: jobState, reason: state[c.slug]?.note ?? null });
    if (!run) {
      record('no-local-provenance', 'sin el fichero de ejecución de la versión publicada: no se puede re-verificar', 7);
      await alert('maintenance-unverifiable');
      continue;
    }
    checked++;
    const r = await reverify(run.provenance);
    const unreachable = r.bundle.sources.filter((s) => !s.retrievedAt).map((s) => s.id);
    const interval = checkIntervalDays(run.provenance);
    const overdue = Date.parse(run.provenance.nextReviewAt ?? '') <= now;
    if (!r.changed.length) {
      record('verified', `${r.bundle.claims.filter((x) => x.status === 'supported').length} afirmaciones verificadas${unreachable.length ? `; fuentes caídas: ${unreachable.join(', ')}` : ''}${overdue ? '; fecha de revisión vencida, evidencia sin cambios' : ''}`, interval);
      await alert('maintenance-verified');
      continue;
    }
    // A claim whose only quotes come from a source that did not answer is not proof of a change: retry, 3 times at most.
    const lostOnlyToOutage = r.changed.every((id) => r.bundle.claims.find((x) => x.id === id)?.quotes.every((qt) => unreachable.includes(qt.sourceId)));
    const outages = (prev?.result === 'source-unavailable' ? prev.outages ?? 1 : 0) + 1;
    if (lostOnlyToOutage && outages < 3) { record('source-unavailable', `fuentes sin respuesta: ${unreachable.join(', ')}`, 1, { outages }); continue; }
    // Consecutive daily checks that confirmed the change: on the second, a guide that could not be recertified goes offline.
    const confirmed = (['requires-update', 'update-held'].includes(prev?.result) ? prev.confirmed ?? 1 : 0) + 1;
    const lost = r.changed.map((id) => run.provenance.bundle.claims.find((x) => x.id === id)?.text).filter(Boolean);
    if (!apply) { record('requires-update', `ya no se verifican: ${r.changed.join(', ')}`, 1, { confirmed }); await alert('maintenance-requires-update'); continue; }
    const topic = maintenanceTopic(run, lost, unreachable);
    topic.linkTargets = await verifiedTargets(topic.linkTargets);
    const [res] = await runTopics([topic], {
      report: api, autopublish: true, corpus: corpus.filter((x) => x.slug !== c.slug),
      publish: (next) => reviseRun(next, api, found.id, published),
    });
    if (res.state === 'updated') { record('updated', `nueva revisión publicada; cambiaron ${r.changed.join(', ')}`, checkIntervalDays(res.provenance)); continue; }
    // Failed recertification: the published version stays (the server never saw a passing candidate) and is retried
    // next day. If the change is confirmed again and still cannot be fixed, the established reversible hold applies:
    // back to draft (out of the site and the sitemap), the published version kept as a revision for rollback.
    if (confirmed >= 2) {
      const held = await fetch(`${api}/v2/blog/${found.id}`, { method: 'PUT', headers: adminHeaders(), body: JSON.stringify({ status: 'draft' }) }).catch(() => null);
      record(held?.ok ? 'held-offline' : 'hold-failed', `${held?.ok ? 'retirada (borrador, reversible)' : `retirada FALLIDA ${held?.status ?? 0}`}: ya no se verifican ${r.changed.join(', ')}; ${res.state}: ${res.reason ?? ''}`.slice(0, 300), 1, { confirmed });
      await alert(held?.ok ? 'maintenance-held-offline' : 'maintenance-hold-failed');
    } else {
      record('update-held', `${res.state}: ${res.reason ?? ''}`.slice(0, 300), 1, { confirmed });
      await alert('maintenance-requires-update');
    }
  }
  return results;
}
/**
 * A rerun overwrites its day's run file, except the file of a version that went live: a same-day revision (maintenance,
 * enrich) writes beside it, so a revision that fails certification never loses the provenance of the published guide.
 */
function runFileFor(run, startedAt) {
  const base = join(out, `${today()}-${run.slug}.json`);
  try {
    const prev = JSON.parse(readFileSync(base, 'utf8'));
    if (['published', 'updated'].includes(prev.state) && prev.provenance?.draftHash !== run.provenance?.draftHash) {
      return join(out, `${today()}-${startedAt.replace(/[^0-9]/g, '').slice(8, 14)}-${run.slug}.json`);
    }
  } catch { /* no file yet, or unreadable: the base name */ }
  return base;
}
function latestRunFor(slug, draftHash) {
  const files = runFiles().filter((f) => f.endsWith(`-${slug}.json`)).sort().reverse();
  for (const f of files) {
    const run = JSON.parse(readFileSync(join(out, f), 'utf8'));
    if (run.provenance?.draftHash === draftHash && run.provenance?.draftMarkdown) return run;
  }
  return null;
}
function checkIntervalDays(provenance) {
  const shortest = Math.min(...provenance.bundle.claims.map((c) => evidence.REVIEW_CADENCE_DAYS[c.volatility] ?? 365));
  return shortest >= 365 ? 30 : Math.max(1, Math.min(7, shortest));
}
function maintenanceTopic(run, lost, unreachable) {
  const { bundle } = run.provenance;
  const internal = bundle.sources.filter((s) => evidence.sourceKindFor(s.url) === 'internal');
  const shortest = bundle.claims.map((c) => c.volatility).sort((a, b) => evidence.REVIEW_CADENCE_DAYS[a] - evidence.REVIEW_CADENCE_DAYS[b])[0];
  return {
    slug: run.slug, topic: bundle.topic, intent: bundle.intent, volatility: run.draft.evergreen ? 'stable' : shortest ?? 'stable',
    categories: run.draft.categories, internalSources: internal.map((s) => ({ id: s.id, url: s.url })),
    seedUrls: [...new Set(bundle.sources.filter((s) => !internal.includes(s) && !unreachable.includes(s.id)).map((s) => s.url))].slice(0, 4),
    notes: `Actualización de una guía ya publicada. Estas afirmaciones ya no se encuentran en sus fuentes: ${lost.map((t) => `«${t}»`).join('; ')}. Comprueba qué ha cambiado, corrige solo eso con datos verificados y conserva el resto del enfoque. Cita solo lo que digan literalmente las fuentes.`,
    linkTargets: [...new Set([...run.draft.content.matchAll(/href="(\/(?!\/|politica-editorial)[^"#]*)"[^>]*>([^<]+)</g)].map((m) => JSON.stringify({ path: m[1], label: m[2] })))].map((s) => JSON.parse(s)),
  };
}
/** A maintenance revision: the server checks it in memory and replaces the published guide only if it passes. */
async function reviseRun(run, api, id, expectedDraftHash) {
  const problem = pipeline.policyProviderProblem(run.provenance);
  if (problem) return { ok: false, message: problem };
  const res = await fetch(`${api}/v2/blog/${id}/revise-by-policy`, {
    method: 'POST', headers: { ...adminHeaders(), 'x-editorial-policy-key': process.env.EDITORIAL_POLICY_KEY || '' },
    body: JSON.stringify({ expectedDraftHash, post: { ...run.draft, editorial: run.provenance } }),
  });
  return res.ok ? { ok: true, url: `${site}/guias/${run.slug}`, state: 'updated' } : { ok: false, message: `${res.status} ${(await res.text()).slice(0, 800)}` };
}
