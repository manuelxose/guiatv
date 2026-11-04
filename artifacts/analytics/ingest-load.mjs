// Load generator for ingest-server.mjs. Simulates `--users` concurrent visitors, each doing a session start and
// `--views` page views (with one click per view). The baseline client sends one request per item
// (session/start + event + event …); the candidate client sends the same items in /collect batches (as the
// browser collector does: session + first events, then one batch per 5 s window -> here one batch per 5 views).
//   node artifacts/analytics/ingest-load.mjs --url http://127.0.0.1:4101 --mode cand --users 200 --views 10 --concurrency 64
import { randomUUID } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith('--') ? [...acc, [v.slice(2), a[i + 1]]] : acc), []));
const base = args.url;
const mode = args.mode;
const users = Number(args.users || 200);
const views = Number(args.views || 10);
const concurrency = Number(args.concurrency || 64);
const latencies = [];
let statusCounts = {};
let items = 0;

async function post(path, body, ip) {
  const t = performance.now();
  const res = await fetch(`${base}/v2/telemetry${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Mobile Safari/537.36' }, body: JSON.stringify(body) });
  await res.arrayBuffer();
  latencies.push(performance.now() - t);
  statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
}

function requestsFor(u) {
  const sessionId = randomUUID();
  const anonId = randomUUID();
  const ip = `81.2.69.${(u % 200) + 20}`;
  const now = Date.now();
  const events = [];
  for (let v = 0; v < views; v++) {
    events.push({ eventId: randomUUID(), type: 'page_view', name: 'page_view', path: `/contenido/program:20261104_antena_3_202611042${v % 10}0000`, occurredAt: new Date(now + v * 1000).toISOString() });
    events.push({ eventId: randomUUID(), type: 'click', name: 'card', path: '/', data: { analyticsId: 'card', tag: 'a' }, occurredAt: new Date(now + v * 1000 + 500).toISOString() });
  }
  items += 1 + events.length;
  if (mode === 'base') {
    return [() => post('/session/start', { sessionId, anonId, initialPath: '/', startedAt: new Date(now).toISOString(), screen: { width: 407, height: 904 }, viewport: { width: 406, height: 724 } }, ip),
      ...events.map((e) => () => post('/event', { sessionId, anonId, ...e }, ip))];
  }
  const batches = [];
  for (let i = 0; i < events.length; i += 10) batches.push(events.slice(i, i + 10));
  return batches.map((batch, i) => () => post('/collect', { v: 1, sessionId, anonId, session: i === 0 ? { startedAt: new Date(now).toISOString(), initialPath: '/', screen: { width: 407, height: 904 }, viewport: { width: 406, height: 724 }, device: { type: 'mobile', orientation: 'portrait' } } : undefined, events: batch }, ip));
}

await fetch(`${base}/__reset`, { method: 'POST' });
// Per-user requests stay sequential (a session's order), users run concurrently.
const queues = Array.from({ length: users }, (_, u) => requestsFor(u));
const start = performance.now();
let next = 0;
async function worker() {
  while (next < queues.length) {
    const queue = queues[next++];
    for (const send of queue) await send();
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, users) }, worker));
const wall = performance.now() - start;
const stats = await (await fetch(`${base}/__stats`)).json();
const sorted = latencies.sort((a, b) => a - b);
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const result = { mode, users, views, concurrency, items, requests: sorted.length, wallMs: Math.round(wall), itemsPerSec: Math.round(items / (wall / 1000)),
  latencyMs: { p50: +pct(50).toFixed(2), p95: +pct(95).toFixed(2), p99: +pct(99).toFixed(2), max: +sorted[sorted.length - 1].toFixed(2) }, statusCounts, server: stats };
console.log(JSON.stringify(result));
