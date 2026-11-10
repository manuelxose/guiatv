#!/usr/bin/env node
/**
 * M15 local end-to-end check of the editorial control plane across real processes: the real API (apps/backend/dist)
 * on a throwaway Mongo database, the real runner (scripts/editorial-agents.mjs cycle) and a stub model gateway.
 * No production access, no real credential (keys are random per run, never printed).
 *
 *   npm run build -w apps/backend
 *   E2E_MONGO_URI="mongodb://127.0.0.1:27119/?directConnection=true" node scripts/ops/editorial-e2e-local.mjs
 *
 * 1. A manual request is claimed and the runner is KILLED mid-run (the model gateway hangs): the request stays running.
 * 2. Its lease expires (claimedAt moved back 7 h, the only simulated step): the next work fetch requeues it, token revoked.
 * 3. A signed, policy-eligible draft is pending for a second request's slug: the next cycle publishes it by policy
 *    without a model call, the first request is finished as failed with its reason (gateway down), nothing stays running.
 * 4. The article is public through the API, exactly one approval row exists, and a second cycle changes nothing.
 * Exit 0 only if every check passes.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const require = createRequire(join(ROOT, 'apps/backend/package.json'));
const { MongoClient } = require('mongodb');
const dist = (p) => require(join(ROOT, 'apps/backend/dist', p));
const MONGO = process.env.E2E_MONGO_URI ?? 'mongodb://127.0.0.1:27119/?directConnection=true';
const DB = `guiatv_m15_e2e_${process.pid}`;
const API_PORT = 3349;
const API = `http://127.0.0.1:${API_PORT}`;
const keys = { admin: randomBytes(24).toString('hex'), policy: randomBytes(24).toString('hex'), signing: randomBytes(24).toString('hex'), review: randomBytes(24).toString('hex') };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const admin = (path, init = {}) => fetch(`${API}${path}`, { ...init, headers: { 'content-type': 'application/json', 'x-admin-key': keys.admin, ...init.headers } });

// Stub model gateway: 'hang' never answers (a live call in flight when the runner dies), 'down' fails every call.
let gatewayMode = 'hang';
const modelCalls = [];
const gateway = http.createServer((req, res) => {
  if (!req.url.startsWith('/v1/messages')) { res.writeHead(404).end(); return; }
  modelCalls.push(gatewayMode);
  if (gatewayMode === 'hang') return; // never answered
  res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'gateway down' } }));
});
await new Promise((r) => gateway.listen(0, '127.0.0.1', r));
const GATEWAY = `http://127.0.0.1:${gateway.address().port}`;

const mongo = await MongoClient.connect(MONGO);
const db = mongo.db(DB);
const state = mkdtempSync(join(tmpdir(), 'm15-e2e-'));
const children = [];
const stopAll = () => { for (const c of children) try { c.kill('SIGKILL'); } catch { /* gone */ } };

function startApi() {
  const child = spawn(process.execPath, [join(ROOT, 'apps/backend/dist/server/index.js')], {
    cwd: join(ROOT, 'apps/backend'), stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env, PORT: String(API_PORT), MONGODB_URI: MONGO, MONGODB_DB_NAME: DB, ANALYTICS_ADMIN_KEY: keys.admin, JWT_SECRET: keys.admin, JWT_REFRESH_SECRET: keys.admin,
      EDITORIAL_REVIEW_KEY: keys.review, EDITORIAL_POLICY_KEY: keys.policy, EDITORIAL_PIPELINE_SIGNING_KEY: keys.signing, EDITORIAL_POLICY_PUBLISHING: 'enabled',
      DISABLE_SCHEDULED_JOBS: 'true', STORAGE_LOCAL_PATH: join(state, 'storage'), CORS_ORIGIN: '*', NODE_ENV: 'development',
      DEEPSEEK_API_KEY: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', TMDB_API_KEY: '', FOOTBALL_DATA_API_KEY: '', AI_API_KEY: '',
    },
  });
  let err = '';
  child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
  child.on('exit', (code) => { if (code) console.error(`API exited ${code}: ${err}`); });
  children.push(child);
  return child;
}
function runner() {
  const child = spawn(process.execPath, ['scripts/editorial-agents.mjs', 'cycle', '--report', API, '--site', API], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, ANALYTICS_ADMIN_KEY: keys.admin, EDITORIAL_POLICY_KEY: keys.policy, EDITORIAL_PIPELINE_SIGNING_KEY: keys.signing,
      EDITORIAL_REVIEW_KEY: '', AUCTORIO_EDITORIAL_REVIEW_KEY: '', EDITORIAL_SPEND_DIR: join(state, 'spend'), GUIATV_EDITORIAL_STATE: join(state, 'state'),
      ANTHROPIC_BASE_URL: GATEWAY, ANTHROPIC_API_KEY: 'stub', ANTHROPIC_AUTH_TOKEN: '', DEEPSEEK_API_KEY: '', OPENAI_API_KEY: '', EDITORIAL_BUDGET: 'unlimited',
    },
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  children.push(child);
  return { child, output: () => output, done: new Promise((r) => child.on('exit', (code) => r(code))) };
}
async function waitFor(fn, what, ms = 120_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn().catch(() => null); if (v) return v; await sleep(500); }
  throw new Error(`timeout: ${what}`);
}
const request = (id) => db.collection('editorial_generation_requests').findOne({ id });
const manual = (slug, title) => ({
  title, slug, topic: 'Horario legal de la publicidad de juego y apuestas en la televisión en España',
  intent: 'Saber a qué horas pueden emitirse anuncios de apuestas en televisión y qué excepciones fija la norma',
  category: 'Televisión', volatility: 'stable', contentType: 'guide', length: 'medium',
  seedUrls: ['https://www.boe.es/buscar/act.php?id=BOE-A-2020-13495', 'https://www.cnmc.es/prensa/informe-decreto-actividades-juego-comunicaciones-comerciales-cnmc-20200526'],
});

try {
  await db.collection('editorial_settings').insertMany([
    { _id: 'policy', paused: false, dailyLimit: 10, activatedAt: new Date(), activatedBy: 'E2E' },
    { _id: 'generation', settings: { enabled: false, scheduleHours: 3, topicsPerCycle: 1, categories: ['Televisión'], contentTypes: ['guide'], defaultLength: 'medium', sourceDomains: ['boe.es', 'cnmc.es'] } },
  ]);
  startApi();
  await waitFor(async () => (await fetch(`${API}/v2/health`)).status === 200, 'API health');

  // 1. Crash mid-run.
  const first = (await (await admin('/v2/admin/editorial/generation/requests', { method: 'POST', body: JSON.stringify(manual('publicidad-apuestas-television-horario-prueba', 'Publicidad de apuestas en televisión: horario permitido (prueba)')) })).json()).data;
  check('manual request created', first?.status === 'queued', first?.status);
  const run1 = runner();
  await waitFor(async () => modelCalls.length > 0, 'first model call', 180_000).catch((e) => { console.error(run1.output()); throw e; });
  const running = await request(first.id);
  check('request claimed with an ownership token before the crash', running?.status === 'running' && typeof running.claimToken === 'string');
  run1.child.kill('SIGKILL');
  await run1.done;
  check('after the crash the request is stranded in running', (await request(first.id))?.status === 'running');

  // 2. Lease expiry → recovery.
  await db.collection('editorial_generation_requests').updateOne({ id: first.id }, { $set: { claimedAt: new Date(Date.now() - 7 * 3600e3) } });
  const overview = (await (await admin('/v2/admin/editorial/overview')).json()).data;
  const recovered = await request(first.id);
  check('expired claim requeued once, token revoked', recovered?.status === 'queued' && !recovered.claimToken && /interrumpida/.test(recovered.reason), recovered?.reason);
  check('overview shows the scheduler as not ticking', overview?.scheduler?.active === false && overview?.nextRunAt === null);

  // 3. A pending draft of the second request's slug, signed by the pipeline (as a crash between save and approval leaves it).
  const fixtures = dist('application/services/EditorialAgentPipeline.fixtures.js');
  const pipeline = dist('application/services/EditorialAgentPipeline.js');
  const { DEFAULT_EDITORIAL_LIMITS } = dist('application/services/EditorialEvidence.js');
  const slug = 'el-padrino-en-la-2-pendiente';
  const m = fixtures.scripted({ research: [fixtures.research], evidence: [{ conflicts: [] }], editorial: [fixtures.draft(fixtures.LONG)], critic: [fixtures.pass] }, undefined, 'anthropic');
  const run = await pipeline.runEditorialJob({ ...fixtures.topic, slug }, fixtures.deps(m.model, { now: () => new Date(), signingKey: keys.signing }), { ...DEFAULT_EDITORIAL_LIMITS, maxResearchCalls: 1, maxReviewLoops: 0 });
  const saved = await admin('/v2/blog', { method: 'POST', body: JSON.stringify({ ...run.draft, editorial: run.provenance }) });
  check('pending draft saved (unreviewed, version 0)', saved.status === 201, `${saved.status}`);
  const second = (await (await admin('/v2/admin/editorial/generation/requests', { method: 'POST', body: JSON.stringify({ ...manual(slug, 'El Padrino en La 2: horario y cómo verla en abierto'), category: 'Televisión' }) })).json()).data;

  gatewayMode = 'down';
  const callsBefore = modelCalls.length;
  const run2 = runner();
  const code = await run2.done;
  check('second cycle ends normally (generation paused: manual requests only)', code === 0, run2.output().split('\n').filter(Boolean).slice(-3).join(' | '));
  const [r1, r2] = [await request(first.id), await request(second.id)];
  check('recovered request finished as failed with its reason (not stranded)', r1?.status === 'failed' && r1.reason.length > 0, r1?.reason?.slice(0, 160));
  check('pending draft resumed: request completed by retrying its approval', r2?.status === 'completed' && /reintentar la aprobación/.test(r2.reason), r2?.reason);
  const post = await db.collection('blog_posts').findOne({ slug });
  check('published by policy (server re-ran every gate)', post?.status === 'publish' && post?.reviewedBy === 'policy:m11b-evidence-gate', `${post?.status} ${post?.reviewedBy}`);
  const pub = await (await fetch(`${API}/v2/blog?slug=${slug}`)).json();
  check('public API serves the article', pub?.[0]?.slug === slug);
  check('exactly one policy approval row', await db.collection('editorial_policy_approvals').countDocuments({ postId: post?._id }) === 1);
  // runTopics prints "<state> <slug>  $<cost>" for every generated run: the resumed slug must have none.
  check('the resumed draft was not regenerated', !new RegExp(`${slug}  \\$`).test(run2.output()), `${modelCalls.length - callsBefore} model call(s), all for the other request`);
  check('nothing left running', await db.collection('editorial_generation_requests').countDocuments({ status: 'running' }) === 0);

  // 4. Idempotence: another cycle neither republishes nor duplicates.
  const run3 = runner();
  await run3.done;
  check('a further cycle adds no post and no approval', await db.collection('blog_posts').countDocuments({ slug }) === 1 && await db.collection('editorial_policy_approvals').countDocuments({}) === 1);
} catch (error) {
  check('harness', false, error instanceof Error ? error.message : String(error));
} finally {
  stopAll();
  gateway.close();
  await db.dropDatabase().catch(() => null);
  await mongo.close();
  rmSync(state, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
