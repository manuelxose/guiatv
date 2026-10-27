#!/usr/bin/env node
// M11-D: drives the real `scripts/editorial-agents.mjs run` entry point against a local fake Claude API, site and
// Admin job endpoint. No paid call is possible: ANTHROPIC_BASE_URL points here and the ambient auth token is removed.
//   npm run build -w apps/backend && node scripts/m11d-cli-check.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

let mode = 'http-529';
let providerHits = 0;
const reports = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url.startsWith('/v1/messages')) {
      providerHits++;
      if (mode === 'http-529') return res.writeHead(529, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }));
      if (mode === 'reset') return req.socket.destroy();
      return undefined; // 'hang': never answers
    }
    if (req.url.startsWith('/v2/admin/editorial/jobs')) { reports.push(JSON.parse(body)); return res.writeHead(201).end('{}'); }
    if (req.url.startsWith('/v2/blog')) return res.writeHead(200, { 'content-type': 'application/json' }).end('[]');
    return res.writeHead(200).end('ok');
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const dir = mkdtempSync(join(tmpdir(), 'm11d-cli-'));
const out = join(dir, 'runs');
const topics = join(dir, 'topics.json');
writeFileSync(topics, JSON.stringify([{ slug: 'm11d-cli-check', topic: 'Comprobación del CLI', intent: 'prueba', volatility: 'stable', categories: ['television'], internalSources: [] }]));
const day = new Date().toISOString().slice(0, 10);
const spend = () => (existsSync(join(out, 'spend.jsonl')) ? readFileSync(join(out, 'spend.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []);

function cli(extraEnv = {}, { killWhen, outDir = out, topicsFile = topics } = {}) {
  const env = { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-fake-m11d', ANTHROPIC_BASE_URL: base, EDITORIAL_PIPELINE_SIGNING_KEY: 'm11d-signing-test', EDITORIAL_SPEND_DIR: out, ...extraEnv };
  for (const k of ['ANTHROPIC_AUTH_TOKEN', 'EDITORIAL_REVIEW_KEY', 'AUCTORIO_EDITORIAL_REVIEW_KEY']) if (!(k in extraEnv)) delete env[k];
  const child = spawn(process.execPath, ['scripts/editorial-agents.mjs', 'run', topicsFile, '--out', outDir, '--site', base, '--report', base], { env });
  let text = '';
  child.stdout.on('data', (d) => { text += d; });
  child.stderr.on('data', (d) => { text += d; });
  if (killWhen) {
    const timer = setInterval(() => { if (killWhen()) { clearInterval(timer); child.kill('SIGKILL'); } }, 50);
  }
  return new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal, text })));
}

const results = [];
const check = async (name, fn) => { await fn(); results.push(name); console.log(`ok   ${name}`); };

try {
  await check('runner refuses the human review key', async () => {
    const r = await cli({ EDITORIAL_REVIEW_KEY: 'human' });
    assert.equal(r.code, 2); assert.match(r.text, /must not be in the runner environment/); assert.equal(providerHits, 0);
    const auctorio = await cli({ AUCTORIO_EDITORIAL_REVIEW_KEY: 'bot' });
    assert.equal(auctorio.code, 2); assert.match(auctorio.text, /AUCTORIO_EDITORIAL_REVIEW_KEY is a reviewer key/);
  });
  await check('duplicate topic slugs are refused', async () => {
    const dup = join(dir, 'dup.json');
    writeFileSync(dup, JSON.stringify([...JSON.parse(readFileSync(topics, 'utf8')), ...JSON.parse(readFileSync(topics, 'utf8'))]));
    const r = await cli({}, { topicsFile: dup });
    assert.equal(r.code, 2); assert.match(r.text, /duplicate topic slugs/);
  });
  await check('malformed spend cap stops the run', async () => {
    const r = await cli({ EDITORIAL_MAX_DAILY_USD: 'abc' });
    assert.equal(r.code, 2); assert.match(r.text, /EDITORIAL_MAX_DAILY_USD must be a positive number/);
  });
  await check('provider HTTP failure: job blocked, known zero spend settled, job reported', async () => {
    mode = 'http-529';
    const r = await cli();
    assert.equal(r.code, 0, r.text); assert.match(r.text, /blocked\s+m11d-cli-check .*error: research/);
    assert.ok(providerHits >= 1);
    assert.deepEqual(spend().map((e) => [e.kind, e.usd]), [['reserve', 3], ['settle', 0]]);
    assert.equal(reports.at(-1).costUsd, 0); assert.equal(reports.at(-1).state, 'blocked');
    assert.ok(!existsSync(join(out, 'run.lock')), 'lock released');
  });
  await check('stream cut (unknown billing): the whole allowance is settled and reported', async () => {
    mode = 'reset';
    const r = await cli();
    assert.equal(r.code, 0, r.text);
    assert.deepEqual(spend().slice(-2).map((e) => [e.kind, e.usd]), [['reserve', 3], ['settle', 3]]);
    assert.equal(reports.at(-1).costUsd, 3);
  });
  await check('budget exhausted: no provider call, job held', async () => {
    const hits = providerHits;
    const r = await cli({ EDITORIAL_MAX_DAILY_USD: '3' });
    assert.equal(r.code, 0, r.text); assert.match(r.text, /límite diario de 3 USD/); assert.equal(providerHits, hits);
  });
  await check('interrupted run: reservation stays counted, lock blocks a duplicate run', async () => {
    rmSync(join(out, 'spend.jsonl'));
    mode = 'hang';
    const killed = await cli({}, { killWhen: () => spend().some((e) => e.kind === 'reserve') });
    assert.equal(killed.signal, 'SIGKILL');
    assert.deepEqual(spend().map((e) => e.kind), ['reserve']);
    const dup = await cli();
    assert.equal(dup.code, 3); assert.match(dup.text, /run\.lock exists/);
    rmSync(join(out, 'run.lock'));
    const after = await cli({ EDITORIAL_MAX_DAILY_USD: '3' });
    assert.match(after.text, /límite diario de 3 USD/, 'the unsettled reservation still counts against the day');
    const elsewhere = await cli({ EDITORIAL_MAX_DAILY_USD: '3' }, { outDir: join(dir, 'other-out') });
    assert.match(elsewhere.text, /límite diario de 3 USD/, 'another --out shares the same journal');
  });
  console.log(`\n${results.length} CLI checks passed (day ${day}, provider calls to the fake API: ${providerHits}, no real provider contacted)`);
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
