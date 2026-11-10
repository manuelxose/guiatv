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
const finishes = [];
let work = null;
let oldBackend = false;
let drafts = {};
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
  if (oldBackend && req.url.endsWith('/claim-owned')) return json(404, {});
  if (/\/requests\/other\/claim(?:-owned)?$/.test(req.url)) return json(409, {});
  if (/\/requests\/mine\/claim(?:-owned)?$/.test(req.url)) return json(200, { data: work?.ownershipProtocols ? { claimToken: 'owner-token' } : {} });
  if (req.url.includes('/generation/runner/requests/') && req.url.endsWith('/finish')) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { finishes.push({ body: JSON.parse(body), token: req.headers['x-editorial-claim-token'] }); json(200, {}); });
    return;
  }
  if (req.url.startsWith('/v2/admin/editorial/overview')) return policy.unreadable ? json(500, {}) : json(200, { data: { policy } });
  if (req.url.startsWith('/v2/admin/editorial/jobs')) return json(201, {});
  // M15: posts that already hold a slug (an earlier run's draft), their Admin detail and their policy approval.
  const bySlug = /^\/v2\/blog\?slug=([^&]+)/.exec(req.url);
  if (bySlug && drafts[decodeURIComponent(bySlug[1])]) return json(200, [drafts[decodeURIComponent(bySlug[1])].found]);
  const byId = (id) => Object.values(drafts).find((d) => d.found.id === id);
  const detail = /^\/v2\/admin\/editorial\/posts\/([^/?]+)$/.exec(req.url);
  if (detail && byId(detail[1])) {
    if (req.method !== 'DELETE') return json(200, { data: byId(detail[1]).detail });
    const d = byId(detail[1]);
    if (d.deletable) delete drafts[d.found.slug];
    return d.deletable ? json(200, { data: { deleted: true } }) : json(409, { error: { message: 'changed' } });
  }
  if (req.method === 'POST' && req.url === '/v2/blog') return json(201, { data: { post: { id: 'post-nuevo' } } });
  const approve = /^\/v2\/blog\/([^/]+)\/approve-by-policy$/.exec(req.url);
  if (approve?.[1] === 'post-nuevo') return json(200, { data: {} });
  if (approve && byId(approve[1])) {
    const d = byId(approve[1]);
    if (d.approve === 200) d.found.status = 'publish';
    return json(d.approve, d.approve === 200 ? { data: {} } : { error: { message: d.approveMessage } });
  }
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
      env: { ...process.env, EDITORIAL_SPEND_DIR: dir, EDITORIAL_REVIEW_KEY: '', AUCTORIO_EDITORIAL_REVIEW_KEY: '', ANTHROPIC_BASE_URL: base, ANTHROPIC_API_KEY: 'test', ANTHROPIC_AUTH_TOKEN: '', EDITORIAL_BUDGET: 'unlimited', EDITORIAL_JOB_LEDGER: 'off', ...env },
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

test('corrupt or unsupported queues are preserved and reported as runner errors', async () => {
  for (const content of ['{"version":1,', JSON.stringify({ version: 2, topics: [] }), JSON.stringify({ version: 1, topics: {} })]) {
    const dir = fresh();
    const path = join(dir, 'topic-queue.json');
    writeFileSync(path, content);
    const beforeCalls = seen.length;
    const beforeHeartbeats = heartbeats.length;
    try {
      const result = await cycle(dir);
      assert.notEqual(result.code, 0, result.output);
      assert.equal(readFileSync(path, 'utf8'), content);
      assert.match(heartbeats[beforeHeartbeats].error, /editorial topic queue/);
      assert.equal(heartbeats[beforeHeartbeats].status, 'error');
      assert.ok(!seen.slice(beforeCalls).includes('POST /v2/admin/editorial/generation/runner/cycles'));
    } finally {
      rmSync(dir, { recursive: true });
    }
  }
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
  work = { policy, settings: { enabled: true }, ownershipProtocols: ['v1'], requests: [{ id: 'other', kind: 'discover' }, { id: 'mine', kind: 'discover' }] };
  const before = seen.length;
  const beforeHeartbeats = heartbeats.length;
  const beforeFinishes = finishes.length;
  try {
    const result = await cycle(dir);
    assert.equal(result.code, 1, result.output);
    const calls = seen.slice(before);
    assert.ok(calls.includes('POST /v2/admin/editorial/generation/runner/requests/mine/claim-owned'));
    assert.ok(calls.includes('POST /v2/admin/editorial/generation/runner/requests/mine/finish'));
    assert.ok(!calls.includes('POST /v2/admin/editorial/generation/runner/requests/other/finish'));
    assert.equal(finishes[beforeFinishes].token, 'owner-token');
    assert.equal(finishes[beforeFinishes].body.claimToken, undefined);
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

test('a runner can still finish a request against a legacy backend', async () => {
  const dir = fresh();
  work = { policy, settings: { enabled: true }, requests: [{ id: 'mine', kind: 'discover' }] };
  const before = finishes.length;
  try {
    const result = await cycle(dir);
    assert.equal(result.code, 1, result.output);
    assert.equal(finishes[before].body.status, 'failed');
    assert.equal(finishes[before].token, undefined);
  } finally {
    work = null;
    rmSync(dir, { recursive: true });
  }
});

test('a mixed deployment cannot accidentally claim without ownership', async () => {
  const dir = fresh();
  writeFileSync(join(dir, 'topic-queue.json'), JSON.stringify({ version: 1, lastDiscoveryAt: new Date().toISOString(), topics: [] }));
  work = { policy, settings: { enabled: true }, ownershipProtocols: ['v1'], requests: [{ id: 'mine', kind: 'discover' }] };
  oldBackend = true;
  const before = seen.length;
  try {
    const result = await cycle(dir);
    const calls = seen.slice(before);
    assert.equal(result.code, 0, result.output);
    assert.ok(calls.includes('POST /v2/admin/editorial/generation/runner/requests/mine/claim-owned'));
    assert.ok(!calls.includes('POST /v2/admin/editorial/generation/runner/requests/mine/claim'));
    assert.ok(!calls.includes('POST /v2/admin/editorial/generation/runner/requests/mine/finish'));
  } finally {
    oldBackend = false;
    work = null;
    rmSync(dir, { recursive: true });
  }
});

test('daily limit reached leaves a manual generation request queued', async () => {
  const dir = fresh();
  writeFileSync(join(dir, 'topic-queue.json'), JSON.stringify({ version: 1, lastDiscoveryAt: new Date().toISOString(), topics: [] }));
  work = { policy, settings: { enabled: true }, requests: [{ id: 'mine', kind: 'generate' }] };
  Object.assign(policy, { approvalsLast24h: 10 });
  const before = seen.length;
  try {
    const result = await cycle(dir);
    const calls = seen.slice(before);
    assert.equal(result.code, 0, result.output);
    assert.equal(lastCycle(dir).result, 'daily-limit');
    assert.ok(!calls.includes('POST /v2/admin/editorial/generation/runner/requests/mine/claim'));
    assert.ok(!calls.includes('POST /v2/admin/editorial/generation/runner/requests/mine/finish'));
    assert.ok(!calls.some((call) => call.startsWith('POST /v1/messages')));
  } finally {
    Object.assign(policy, { approvalsLast24h: 0 });
    work = null;
    rmSync(dir, { recursive: true });
  }
});

test('manual generation: a claimed request reaches seed validation and is finished on a source error', async () => {
  const dir = fresh();
  writeFileSync(join(dir, 'topic-queue.json'), JSON.stringify({ version: 1, lastDiscoveryAt: new Date().toISOString(), topics: [] }));
  const topic = { ...queued('nuevo-manual').topic, title: 'Consulta de streaming', intent: 'Verificar fuentes oficiales', category: 'Streaming', length: 'short', seedUrls: [`${base}/missing-source`] };
  work = { policy, settings: { enabled: true }, ownershipProtocols: ['v1'], requests: [{ id: 'mine', kind: 'generate', topic }] };
  const before = finishes.length;
  try {
    const r = await cycle(dir);
    assert.equal(r.code, 0, r.output);
    assert.equal(finishes.length - before, 1, 'claimed request must be reconciled exactly once');
    assert.equal(finishes[before].body.status, 'failed');
    assert.match(finishes[before].body.reason, /missing-source/);
    assert.equal(finishes[before].token, 'owner-token');
    assert.doesNotMatch(r.output, /Cannot access 'manualTopic' before initialization/);
  } finally {
    work = null;
    rmSync(dir, { recursive: true });
  }
});

test('manual generation: invalid claimed payload is finished as failed instead of being stranded active', async () => {
  const dir = fresh();
  writeFileSync(join(dir, 'topic-queue.json'), JSON.stringify({ version: 1, lastDiscoveryAt: new Date().toISOString(), topics: [] }));
  work = { policy, settings: { enabled: true }, ownershipProtocols: ['v1'], requests: [{ id: 'mine', kind: 'generate' }] };
  const before = finishes.length;
  try {
    const r = await cycle(dir);
    assert.equal(r.code, 0, r.output);
    assert.equal(finishes.length - before, 1, 'even malformed requests must be reconciled');
    assert.equal(finishes[before].body.status, 'failed');
    assert.match(finishes[before].body.reason, /manual request missing topic/);
    assert.equal(finishes[before].token, 'owner-token');
  } finally {
    work = null;
    rmSync(dir, { recursive: true });
  }
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

test('queue actions from the Admin are applied to the queue, even while publication is stopped, and reported', async () => {
  const dir = fresh();
  writeFileSync(join(dir, 'topic-queue.json'), JSON.stringify({ version: 1, lastDiscoveryAt: new Date().toISOString(), topics: [queued('streaming-uno', { state: 'held' }), queued('streaming-dos')] }));
  work = { policy: { ...policy, active: false }, settings: { enabled: true }, ownershipProtocols: ['v1'], requests: [
    { id: 'mine', kind: 'queue-action', queueAction: { action: 'reject', topicId: 'streaming-uno', reason: 'prueba' } },
    { id: 'other', kind: 'queue-action', queueAction: { action: 'reject', topicId: 'streaming-dos' } },
  ] };
  const beforeFinishes = finishes.length;
  try {
    const r = await cycle(dir);
    const topics = JSON.parse(readFileSync(join(dir, 'topic-queue.json'), 'utf8')).topics;
    assert.deepEqual(topics.map((t) => t.state), ['rejected', 'queued'], r.output);
    assert.equal(topics[0].reason, 'manual: prueba');
    assert.equal(finishes.length - beforeFinishes, 1, 'only the claimed request is finished');
    assert.equal(finishes[beforeFinishes].body.status, 'completed');
  } finally {
    work = null;
    rmSync(dir, { recursive: true });
  }
});

test('a queue action that cannot apply is finished as failed with the reason', async () => {
  const dir = fresh();
  writeFileSync(join(dir, 'topic-queue.json'), JSON.stringify({ version: 1, lastDiscoveryAt: new Date().toISOString(), topics: [] }));
  work = { policy: { ...policy, active: false }, settings: { enabled: true }, ownershipProtocols: ['v1'], requests: [{ id: 'mine', kind: 'queue-action', queueAction: { action: 'approve', topicId: 'no-existe' } }] };
  const beforeFinishes = finishes.length;
  try {
    await cycle(dir);
    assert.equal(finishes[beforeFinishes].body.status, 'failed');
    assert.match(finishes[beforeFinishes].body.reason, /ya no está en la cola/);
  } finally {
    work = null;
    rmSync(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------------------------------------------
// M15 recovery: paused generation, pending drafts, human-owned drafts.

const pendingDraft = (slug, over = {}) => ({
  found: { id: `post-${slug}`, slug, status: 'draft' },
  detail: { post: { id: `post-${slug}`, slug, status: 'draft', reviewState: 'unreviewed', reviewedBy: null }, version: 0, pendingEdit: null, revisions: [], provenance: { state: 'approved-by-policy', signed: true, critic: { draftHash: 'old' } }, policyBlockers: [] },
  approve: 200, ...over,
});

test('M15 generation paused: a manual request still runs, scheduled topics do not', async () => {
  const dir = fresh();
  writeFileSync(join(dir, 'topic-queue.json'), JSON.stringify({ version: 1, lastDiscoveryAt: new Date().toISOString(), topics: [queued('cola-en-pausa')] }));
  const topic = { ...queued('manual-en-pausa').topic, title: 'Consulta de streaming', intent: 'Verificar fuentes oficiales', category: 'Streaming', length: 'short', seedUrls: [`${base}/missing-source`] };
  work = { policy, settings: { enabled: false }, ownershipProtocols: ['v1'], requests: [{ id: 'mine', kind: 'generate', topic }] };
  const before = finishes.length;
  try {
    const r = await cycle(dir);
    assert.equal(r.code, 0, r.output);
    assert.equal(finishes.length - before, 1, 'the manual request was processed while paused');
    assert.match(finishes[before].body.reason, /missing-source/);
    assert.equal(lastCycle(dir).result, 'generation-paused');
    assert.equal(JSON.parse(readFileSync(join(dir, 'topic-queue.json'), 'utf8')).topics[0].state, 'queued', 'the scheduled topic was not started');
  } finally {
    work = null;
    rmSync(dir, { recursive: true });
  }
});

test('M15 pending draft: its approval is retried instead of paying for a new text', async () => {
  const dir = fresh();
  writeFileSync(join(dir, 'topic-queue.json'), JSON.stringify({ version: 1, lastDiscoveryAt: new Date().toISOString(), topics: [queued('pendiente-uno')] }));
  drafts = { 'pendiente-uno': pendingDraft('pendiente-uno') };
  const before = seen.length;
  try {
    const r = await cycle(dir);
    const [t] = JSON.parse(readFileSync(join(dir, 'topic-queue.json'), 'utf8')).topics;
    assert.equal(t.state, 'published', `${t.state} ${t.reason} ${r.output}`);
    assert.ok(seen.slice(before).includes('POST /v2/blog/post-pendiente-uno/approve-by-policy'));
    assert.ok(!seen.slice(before).some((s) => s.startsWith('POST /v1/messages')), 'no model call');
  } finally {
    drafts = {};
    rmSync(dir, { recursive: true });
  }
});

test('M15 pending draft: cap or stop at approval keeps the topic queued, no regeneration, no replacement', async () => {
  const dir = fresh();
  writeFileSync(join(dir, 'topic-queue.json'), JSON.stringify({ version: 1, lastDiscoveryAt: new Date().toISOString(), topics: [queued('pendiente-dos')] }));
  drafts = { 'pendiente-dos': pendingDraft('pendiente-dos', { approve: 403, approveMessage: 'Policy publishing limit reached (10 in 24 h)' }) };
  const before = seen.length;
  try {
    const r = await cycle(dir);
    const [t] = JSON.parse(readFileSync(join(dir, 'topic-queue.json'), 'utf8')).topics;
    assert.equal(t.state, 'queued', `${t.reason} ${r.output}`);
    assert.equal(t.attempts, 0, 'a cap is not an attempt');
    assert.match(t.reason, /limit reached/);
    const calls = seen.slice(before);
    assert.ok(!calls.some((s) => s.startsWith('POST /v1/messages') || s.startsWith('DELETE ')), 'no model call, nothing deleted');
  } finally {
    drafts = {};
    rmSync(dir, { recursive: true });
  }
});

test('M15 a draft a person touched is never regenerated, replaced or approved by the runner', async () => {
  const dir = fresh();
  writeFileSync(join(dir, 'topic-queue.json'), JSON.stringify({ version: 1, lastDiscoveryAt: new Date().toISOString(), topics: [queued('editado-uno')] }));
  const edited = pendingDraft('editado-uno');
  edited.detail.version = 1;
  drafts = { 'editado-uno': edited };
  const before = seen.length;
  try {
    const r = await cycle(dir);
    const [t] = JSON.parse(readFileSync(join(dir, 'topic-queue.json'), 'utf8')).topics;
    assert.equal(t.state, 'held', `${t.reason} ${r.output}`);
    assert.match(t.reason, /en manos de una persona/);
    const calls = seen.slice(before);
    assert.ok(!calls.some((s) => /approve-by-policy|^DELETE |^POST \/v1\/messages|^POST \/v2\/blog /.test(s)), calls.join('\n'));
  } finally {
    drafts = {};
    rmSync(dir, { recursive: true });
  }
});

test('M15 publish: an untouched earlier draft is replaced under its version; a changed or human one is left alone', async () => {
  const dir = fresh();
  const runFile = join(dir, 'run.json');
  writeFileSync(runFile, JSON.stringify({ slug: 'sustituir-uno', state: 'approved-by-policy', findings: [], draft: { title: 'Título de prueba suficientemente largo', slug: 'sustituir-uno', content: '<p>x</p>' }, provenance: { backend: 'deepseek', draftHash: 'new', images: [] } }));
  const publish = () => cycle(dir, {}, 'publish', [runFile, '--api', base]);
  try {
    drafts = { 'sustituir-uno': pendingDraft('sustituir-uno') };
    let before = seen.length;
    let r = await publish();
    assert.match(r.output, /REFUSED.*no se pudo sustituir/s, 'a version that changed meanwhile wins');
    assert.ok(!seen.slice(before).some((s) => s === 'POST /v2/blog' || /approve-by-policy/.test(s)));

    drafts = { 'sustituir-uno': pendingDraft('sustituir-uno', { deletable: true }) };
    before = seen.length;
    r = await publish();
    assert.match(r.output, /published .*\/guias\/sustituir-uno/, r.output);
    assert.deepEqual(seen.slice(before).filter((s) => /^(DELETE|POST) \/v2\/(admin\/editorial\/posts|blog)/.test(s)),
      ['DELETE /v2/admin/editorial/posts/post-sustituir-uno', 'POST /v2/blog', 'POST /v2/blog/post-nuevo/approve-by-policy']);

    const touched = pendingDraft('sustituir-uno', { deletable: true });
    touched.detail.revisions = [{ version: 1, reason: 'update' }];
    drafts = { 'sustituir-uno': touched };
    before = seen.length;
    r = await publish();
    assert.match(r.output, /REFUSED.*no es un borrador intacto/s);
    assert.ok(!seen.slice(before).some((s) => s.startsWith('DELETE ') || s === 'POST /v2/blog'));
  } finally {
    drafts = {};
    rmSync(dir, { recursive: true });
  }
});

test('M15 a pending draft the gates send to a person waits in the review inbox: no approval, no new run', async () => {
  const dir = fresh();
  writeFileSync(join(dir, 'topic-queue.json'), JSON.stringify({ version: 1, lastDiscoveryAt: new Date().toISOString(), topics: [queued('revision-humana')] }));
  const human = pendingDraft('revision-humana');
  human.detail.policyBlockers = [{ severity: 'human', code: 'near-duplicate', message: 'parecido a otra guía' }];
  drafts = { 'revision-humana': human };
  const before = seen.length;
  try {
    const r = await cycle(dir);
    const [t] = JSON.parse(readFileSync(join(dir, 'topic-queue.json'), 'utf8')).topics;
    assert.equal(t.state, 'held', `${t.reason} ${r.output}`);
    assert.match(t.reason, /revisión humana.*near-duplicate/);
    assert.ok(!seen.slice(before).some((s) => /approve-by-policy|^POST \/v1\/messages/.test(s)));
  } finally {
    drafts = {};
    rmSync(dir, { recursive: true });
  }
});
