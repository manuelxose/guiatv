// M11-F scheduler scenarios against a local stub API and a stub model gateway (no network, no real model).
//   npm run build -w apps/backend && node --test scripts/editorial-cycle.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const policy = { dailyLimit: 10, approvalsLast24h: 0, active: true };
const seen = [];
const heartbeats = [];
let work = null;
const server = http.createServer((req, res) => {
  seen.push(`${req.method} ${req.url}`);
  const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url === '/v2/admin/editorial/generation/runner/heartbeat') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { heartbeats.push(JSON.parse(body)); json(200, {}); });
    return;
  }
  if (req.url === '/v2/admin/editorial/generation/runner/work' && work) return json(200, { data: work });
  if (req.url === '/v2/admin/editorial/generation/runner/requests/other/claim') return json(409, {});
  if (req.url === '/v2/admin/editorial/generation/runner/requests/mine/claim') return json(200, { data: {} });
  if (req.url.includes('/generation/runner/requests/') && req.url.endsWith('/finish')) return json(200, {});
  if (req.url.startsWith('/v2/admin/editorial/overview')) return policy.unreadable ? json(500, {}) : json(200, { data: { policy } });
  if (req.url.startsWith('/v2/admin/editorial/jobs')) return json(201, {});
  if (req.url.startsWith('/v2/blog')) return json(200, []);
  // The model gateway is down: every model call fails (provider outage).
  if (req.url.startsWith('/v1/messages')) return json(500, { type: 'error', error: { type: 'api_error', message: 'gateway down' } });
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

function cycle(dir, env = {}, command = 'cycle', target = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/editorial-agents.mjs', command, ...target, '--report', base, '--site', base, '--out', join(dir, 'out')], {
      env: { ...process.env, EDITORIAL_SPEND_DIR: dir, EDITORIAL_REVIEW_KEY: '', AUCTORIO_EDITORIAL_REVIEW_KEY: '', ANTHROPIC_BASE_URL: base, ANTHROPIC_API_KEY: 'test', ANTHROPIC_AUTH_TOKEN: '', EDITORIAL_BUDGET: 'unlimited', ...env },
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('exit', (code) => resolve({ code, output }));
  });
}
const lastCycle = (dir) => JSON.parse(readFileSync(join(dir, 'cycles.jsonl'), 'utf8').trim().split('\n').pop());
const fresh = () => mkdtempSync(join(tmpdir(), 'm11f-cycle-'));
const queued = (id, over = {}) => ({
  id, title: `Tema ${id}`, intent: `intención ${id}`, category: 'Streaming', sourceCandidates: [], sourceFamilies: [], score: 50, scoreExplanation: [], freshUntil: null,
  duplicateCheck: { maxSimilarity: 0, closest: null }, createdAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z', state: 'queued', attempts: 0,
  topic: { slug: id, topic: `Tema ${id}`, intent: `intención ${id}`, volatility: 'stable', categories: ['Streaming'], internalSources: [], seedUrls: ['https://www.boe.es/a', 'https://www.cnmc.es/b'] }, ...over,
});

test('emergency stop or inactive policy: the cycle writes nothing and calls no model', async () => {
  const dir = fresh();
  Object.assign(policy, { active: false });
  const r = await cycle(dir);
  Object.assign(policy, { active: true });
  assert.equal(r.code, 0, r.output);
  assert.equal(lastCycle(dir).result, 'inactive');
  assert.ok(!seen.some((s) => s.startsWith('POST /v1/messages')), 'no model call while stopped');
  rmSync(dir, { recursive: true });
});

test('the scheduler never runs with the human review key, and discovery respects the stop', async () => {
  const dir = fresh();
  for (const command of ['cycle', 'discover', 'maintain']) {
    const r = await cycle(dir, { EDITORIAL_REVIEW_KEY: 'human-key' }, command);
    assert.equal(r.code, 2, command);
    assert.match(r.output, /EDITORIAL_REVIEW_KEY is a reviewer key/);
  }
  Object.assign(policy, { active: false });
  const before = seen.length;
  await cycle(dir, {}, 'discover');
  Object.assign(policy, { active: true });
  assert.equal(lastCycle(dir).result, 'inactive');
  assert.ok(!seen.slice(before).some((s) => s.startsWith('POST /v1/messages')), 'no discovery call while stopped');
  rmSync(dir, { recursive: true });
});

test('an unreadable Admin stops the cycle (fail closed)', async () => {
  const dir = fresh();
  policy.unreadable = true;
  const r = await cycle(dir);
  delete policy.unreadable;
  assert.equal(r.code, 2);
  assert.equal(lastCycle(dir).result, 'admin-unreadable');
  rmSync(dir, { recursive: true });
});

test('a live lock refuses a second runner; a dead one is recovered', async () => {
  const dir = fresh();
  writeFileSync(join(dir, 'run.lock'), `${process.pid} ${new Date().toISOString()}\n`);
  assert.equal((await cycle(dir)).code, 3, 'concurrent/duplicate job refused');
  writeFileSync(join(dir, 'run.lock'), `999999 ${new Date(Date.now() - 7 * 3600e3).toISOString()}\n`);
  writeFileSync(join(dir, 'topic-queue.json'), JSON.stringify({ version: 1, lastDiscoveryAt: new Date().toISOString(), topics: [] }));
  const r = await cycle(dir);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /lock huérfano recuperado/);
  assert.ok(!existsSync(join(dir, 'run.lock')), 'released at exit');
  rmSync(dir, { recursive: true });
});

test('discovery finishes only requests claimed by this runner', async () => {
  const dir = fresh();
  work = { policy, settings: { enabled: true }, requests: [{ id: 'other', kind: 'discover' }, { id: 'mine', kind: 'discover' }] };
  const before = seen.length;
  const beforeHeartbeats = heartbeats.length;
  try {
    const result = await cycle(dir);
    assert.equal(result.code, 1, result.output);
    const calls = seen.slice(before);
    assert.ok(calls.includes('POST /v2/admin/editorial/generation/runner/requests/mine/finish'));
    assert.ok(!calls.includes('POST /v2/admin/editorial/generation/runner/requests/other/finish'));
    assert.equal((result.output.match(/descubrimiento fallido/g) ?? []).length, 1, 'no second discovery after failure');
    assert.equal(heartbeats.slice(beforeHeartbeats).at(-1).status, 'error');
    assert.deepEqual(heartbeats.slice(beforeHeartbeats).at(-1).providers, heartbeats[beforeHeartbeats].providers);
    assert.equal(heartbeats.slice(beforeHeartbeats).at(-1).webSearch, true);
  } finally {
    work = null;
    rmSync(dir, { recursive: true });
  }
});

test('daily limit reached: nothing is started', async () => {
  const dir = fresh();
  writeFileSync(join(dir, 'topic-queue.json'), JSON.stringify({ version: 1, lastDiscoveryAt: new Date().toISOString(), topics: [queued('streaming-uno')] }));
  Object.assign(policy, { approvalsLast24h: 10 });
  const r = await cycle(dir);
  Object.assign(policy, { approvalsLast24h: 0 });
  assert.equal(lastCycle(dir).result, 'daily-limit', r.output);
  assert.equal(JSON.parse(readFileSync(join(dir, 'topic-queue.json'), 'utf8')).topics[0].state, 'queued');
  rmSync(dir, { recursive: true });
});

test('provider outage: discovery failure is reported when the queue is empty', async () => {
  const dir = fresh();
  const r = await cycle(dir);
  assert.equal(r.code, 1, r.output);
  const log = lastCycle(dir);
  assert.match(log.discovery.error, /gateway down|500/);
  assert.equal(log.result, 'discovery-error');
  rmSync(dir, { recursive: true });
});

test('provider outage: a discovery-only run reports failure', async () => {
  const dir = fresh();
  const r = await cycle(dir, {}, 'discover');
  assert.equal(r.code, 1, r.output);
  assert.equal(lastCycle(dir).result, 'discovery-error');
  rmSync(dir, { recursive: true });
});

test('M11-G enrich: refuses the reviewer key and the stopped policy; a failed same-day revision keeps the live run file', async () => {
  const dir = fresh();
  assert.match((await cycle(dir, { EDITORIAL_REVIEW_KEY: 'human-key' }, 'enrich', ['guia-viva'])).output, /EDITORIAL_REVIEW_KEY is a reviewer key/);
  assert.match((await cycle(dir, {}, 'enrich', ['guia-viva', '--links', 'https://evil.example/x'])).output, /--links takes site paths/);
  Object.assign(policy, { active: false });
  const before = seen.length;
  const stopped = await cycle(dir, {}, 'enrich', ['guia-viva']);
  Object.assign(policy, { active: true });
  assert.equal(stopped.code, 2, stopped.output);
  assert.match(stopped.output, /automatic publication is not active/);
  assert.ok(!seen.slice(before).some((s) => s.startsWith('POST /v1/messages')), 'no model call while stopped');

  // The live version's run file of today, then a revision of the same slug that fails (gateway down).
  const out = join(dir, 'out');
  const day = new Date().toISOString().slice(0, 10);
  const live = JSON.stringify({ slug: 'guia-viva', state: 'updated', provenance: { draftHash: 'live' } });
  writeFileSync(join(dir, 'topics.json'), JSON.stringify([queued('guia-viva').topic]));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${day}-guia-viva.json`), live);
  const r = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/editorial-agents.mjs', 'run', join(dir, 'topics.json'), '--out', out, '--site', base], {
      env: { ...process.env, EDITORIAL_SPEND_DIR: dir, EDITORIAL_REVIEW_KEY: '', AUCTORIO_EDITORIAL_REVIEW_KEY: '', ANTHROPIC_BASE_URL: base, ANTHROPIC_API_KEY: 'test', ANTHROPIC_AUTH_TOKEN: '', EDITORIAL_BUDGET: 'unlimited' },
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('exit', (code) => resolve({ code, output }));
  });
  assert.equal(readFileSync(join(out, `${day}-guia-viva.json`), 'utf8'), live, r.output);
  const beside = readdirSync(out).filter((f) => f.endsWith('-guia-viva.json') && f !== `${day}-guia-viva.json`);
  assert.equal(beside.length, 1, r.output);
  assert.equal(JSON.parse(readFileSync(join(out, beside[0]), 'utf8')).state, 'blocked');
  rmSync(dir, { recursive: true });
});

test('M11-B1 revision run: alone, same slug, never reported or published, and no model call when refused', async () => {
  const dir = fresh();
  const write = (name, topics) => { const file = join(dir, name); writeFileSync(file, JSON.stringify(topics)); return file; };
  const own = { ...queued('guia-de-persona').topic, revises: 'guia-de-persona' };
  const local = (file) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/editorial-agents.mjs', 'run', file, '--site', base, '--out', join(dir, 'out')], {
      env: { ...process.env, EDITORIAL_SPEND_DIR: dir, EDITORIAL_REVIEW_KEY: '', AUCTORIO_EDITORIAL_REVIEW_KEY: '', ANTHROPIC_BASE_URL: base, ANTHROPIC_API_KEY: 'test', ANTHROPIC_AUTH_TOKEN: '', EDITORIAL_BUDGET: 'unlimited' },
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('exit', (code) => resolve({ code, output }));
  });
  const before = seen.length;
  for (const r of [
    await cycle(dir, {}, 'run', [write('reported.json', [own])]),
    await local(write('batch.json', [own, queued('otro-tema').topic])),
    await local(write('other-slug.json', [{ ...own, revises: 'otra-guia' }])),
  ]) {
    assert.equal(r.code, 2, r.output);
    assert.match(r.output, /a revision topic runs alone/);
  }
  assert.deepEqual(seen.slice(before), [], 'refused before any request: no model call, no read, no write');
  rmSync(dir, { recursive: true });
});

test('restart recovery: an interrupted topic is retried once; a failing provider then holds it, never publishes', async () => {
  const dir = fresh();
  writeFileSync(join(dir, 'topic-queue.json'), JSON.stringify({ version: 1, lastDiscoveryAt: new Date().toISOString(), topics: [queued('streaming-uno', { state: 'running' })] }));
  const r = await cycle(dir);
  const [t] = JSON.parse(readFileSync(join(dir, 'topic-queue.json'), 'utf8')).topics;
  assert.deepEqual(lastCycle(dir).recovered, ['streaming-uno: interrumpido → queued'], r.output);
  assert.equal(t.state, 'held', `${t.state} ${t.reason}`);
  assert.equal(t.attempts, 2);
  assert.ok(!seen.some((s) => /approve-by-policy|revise-by-policy|POST \/v2\/blog /.test(s)), 'nothing was saved or published');
  rmSync(dir, { recursive: true });
});
