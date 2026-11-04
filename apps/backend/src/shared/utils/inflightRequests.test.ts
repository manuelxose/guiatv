import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import { inflightRequestTracker } from '../../presentation/middlewares/inflightRequestTracker';
import { EventLoopDiagnostics } from './eventLoopDiagnostics';
import {
  InflightRequestRegistry,
  inflightRequests,
  OTHER_ROUTE,
  UNMATCHED_ROUTE,
  UNRESOLVED_ROUTE,
  type RouteSource,
} from './inflightRequests';
import { resetStepTimeline } from './stepTimeline';

function clock() {
  const c = { t: 0 };
  return { c, now: () => c.t };
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function busy(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) { /* hold the event loop */ }
}

test('concurrent requests are listed oldest first with their age, and cleaned up exactly once', () => {
  const { c, now } = clock();
  const reg = new InflightRequestRegistry({ now });
  const a: RouteSource = { method: 'GET' };
  const b: RouteSource = { method: 'POST' };
  const d: RouteSource = { method: 'GET' };
  const doneA = reg.begin(a); c.t = 100;
  const doneB = reg.begin(b); c.t = 250;
  const doneD = reg.begin(d); c.t = 1_000;
  const o = reg.overlap(0, 1_000);
  assert.equal(o.activeCount, 3);
  assert.deepEqual(o.inFlight.map((e) => [e.method, e.ageMs]), [['GET', 1_000], ['POST', 900], ['GET', 750]]);
  doneB(); doneB(); // a repeated close must not double-decrement
  assert.equal(reg.stats().active, 2);
  doneA(); doneD();
  assert.deepEqual(reg.stats(), { active: 0, tracked: 0, peakActive: 3, started: 3, evicted: 0, labels: 0 });
});

test('aborted requests leave the registry and are reported as aborted, not as in flight', () => {
  const { c, now } = clock();
  const reg = new InflightRequestRegistry({ now });
  const done = reg.begin({ method: 'GET' });
  c.t = 400;
  done(true);
  const o = reg.overlap(0, 500);
  assert.equal(o.activeCount, 0);
  assert.equal(o.inFlight.length, 0);
  assert.deepEqual(o.completed, [{ method: 'GET', route: UNMATCHED_ROUTE, durationMs: 400, aborted: true }]);
});

test('the route label follows Express: unresolved while earlier middleware runs, the template once matched', () => {
  const { c, now } = clock();
  const reg = new InflightRequestRegistry({ now });
  const req: RouteSource = { method: 'GET', baseUrl: '/v2' };
  const done = reg.begin(req);
  c.t = 50;
  assert.equal(reg.overlap(0, 50).inFlight[0].route, UNRESOLVED_ROUTE, 'a stall before routing is still visible');
  req.route = { path: '/catalog' };
  assert.equal(reg.overlap(0, 50).inFlight[0].route, '/v2/catalog', 'the label is updated when the route is known');
  c.t = 80;
  done();
  assert.equal(reg.overlap(0, 80).completed[0].route, '/v2/catalog');
});

test('missing or untrusted route templates are classified with fixed labels, never guessed', () => {
  const { now } = clock();
  const reg = new InflightRequestRegistry({ now });
  const regexRoute: RouteSource = { method: 'GET', route: { path: /^\/x\/(\d+)$/ } };
  const noisy: RouteSource = { method: 'GET', baseUrl: '/v2', route: { path: '/a?token=abc&x=1' } };
  const spaced: RouteSource = { method: 'GET', route: { path: '/has space' } };
  const longPath: RouteSource = { method: 'GET', route: { path: `/${'a'.repeat(300)}` } };
  const throwing = { method: 'GET', get route(): never { throw new Error('boom'); } } as unknown as RouteSource;
  for (const r of [regexRoute, noisy, spaced, longPath, throwing]) reg.begin(r);
  const labels = reg.overlap(0, 10).inFlight.map((e) => e.route).sort();
  assert.deepEqual(labels, [OTHER_ROUTE, OTHER_ROUTE, OTHER_ROUTE, UNRESOLVED_ROUTE, UNRESOLVED_ROUTE].sort());
});

test('cardinality: tracked entries, completed entries, reported entries and distinct labels are all bounded', () => {
  const { c, now } = clock();
  const reg = new InflightRequestRegistry({ now, maxActive: 4, maxRecent: 3, maxReported: 2 });
  const dones = Array.from({ length: 10 }, (_, i) => { c.t = i; return reg.begin({ method: 'GET', route: { path: `/r${i}` } }); });
  let s = reg.stats();
  assert.equal(s.active, 10, 'the true count is exact even beyond the tracked bound');
  assert.equal(s.tracked, 4);
  assert.equal(s.evicted, 6);
  const o = reg.overlap(0, 20);
  assert.equal(o.inFlight.length, 2);
  assert.equal(o.omitted, 2);
  assert.ok(o.byRoute.length <= 2);
  dones.forEach((d) => d());
  s = reg.stats();
  assert.equal(s.active, 0);
  assert.equal(s.tracked, 0);
  assert.ok(reg.overlap(0, 100).completed.length <= 2);

  const wide = new InflightRequestRegistry({ now });
  for (let i = 0; i < 400; i += 1) wide.begin({ method: 'GET', route: { path: `/dyn${i}` } })();
  assert.equal(wide.stats().labels, 256, 'the distinct-label set is capped');
  const next = wide.begin({ method: 'GET', route: { path: '/another' } });
  assert.equal(wide.overlap(0, 100).inFlight[0].route, OTHER_ROUTE);
  next();
});

test('redaction: nothing but the method and a route label can appear in a snapshot', () => {
  const { now } = clock();
  const reg = new InflightRequestRegistry({ now });
  const secret = 'Bearer s3cr3t-token';
  const req = {
    method: 'FROB', // not a standard method
    url: '/v2/users/42?token=s3cr3t-token',
    originalUrl: '/v2/users/42?token=s3cr3t-token',
    headers: { authorization: secret, cookie: 'sid=s3cr3t-token' },
    ip: '203.0.113.7',
    body: { password: 's3cr3t-token' },
    user: { id: 'user-42' },
    baseUrl: '/v2/session/s3cr3t-token@evil',
    route: { path: '/users/:id' },
  } as unknown as RouteSource;
  const done = reg.begin(req);
  const text = JSON.stringify(reg.overlap(0, 10));
  done();
  const text2 = JSON.stringify(reg.overlap(0, 10));
  for (const t of [text, text2]) {
    for (const leaked of ['s3cr3t', 'token', 'Bearer', '203.0.113', 'user-42', 'sid=', '?']) assert.ok(!t.includes(leaked), `leaked ${leaked}: ${t}`);
    assert.ok(t.includes('"OTHER"'));
  }
});

test('exception safety: a failing registry operation never throws into the request path', () => {
  const reg = new InflightRequestRegistry({ now: () => { throw new Error('clock'); } });
  let done: (aborted?: boolean) => void = () => undefined;
  assert.doesNotThrow(() => { done = reg.begin({ method: 'GET' }); });
  assert.doesNotThrow(() => done());
  assert.doesNotThrow(() => reg.overlap(0, 1));
  assert.equal(reg.stats().active, 0, 'counters are consistent after a failure');
});

test('stall-time snapshot: the event carries the overlapping requests and an explicit correlation class', () => {
  resetStepTimeline();
  const { c, now } = clock();
  const reg = new InflightRequestRegistry({ now });
  const diag = new EventLoopDiagnostics({
    now, wallClock: () => Date.UTC(2026, 10, 4, 12, 0, 0), intervalMs: 100, stallThresholdMs: 250, windowMs: 1e9,
    requestOverlap: (from, to) => reg.overlap(from, to),
  });
  c.t = 100; diag.tick();

  // 1) A stall with nothing instrumented overlapping: explicitly unattributed.
  c.t = 900; diag.tick();
  // 2) A stall with two open requests and one that completed inside it.
  const open1 = { method: 'GET', baseUrl: '/v2', route: { path: '/tv/read/channels' } };
  const open2 = { method: 'GET', baseUrl: '', route: { path: '/sitemap.xml' } };
  const gone = { method: 'GET', baseUrl: '/v2', route: { path: '/catalog' } };
  reg.begin(open1); reg.begin(open2);
  c.t = 920; const doneGone = reg.begin(gone);
  c.t = 1_600; doneGone();
  c.t = 1_700; diag.tick();

  const events = (diag.snapshot() as any).stalls.recent;
  assert.equal(events.length, 2);
  assert.equal(events[0].correlation, 'none');
  assert.deepEqual(events[0].requests.inFlight, []);
  assert.equal(events[1].correlation, 'requests');
  assert.equal(events[1].requests.activeCount, 2);
  assert.deepEqual(events[1].requests.inFlight.map((e: any) => e.route), ['/v2/tv/read/channels', '/sitemap.xml']);
  assert.equal(events[1].requests.completed[0].route, '/v2/catalog');
  assert.equal(events[1].requests.completed[0].durationMs, 680);
});

test('a failing request provider cannot lose the stall event', () => {
  const { c, now } = clock();
  const diag = new EventLoopDiagnostics({
    now, wallClock: () => 1_700_000_000_000, intervalMs: 100, stallThresholdMs: 250, windowMs: 1e9,
    requestOverlap: () => { throw new Error('registry down'); },
  });
  c.t = 100; diag.tick();
  c.t = 1_000; diag.tick();
  const event = (diag.snapshot() as any).stalls.recent[0];
  assert.equal(event.durationMs, 800);
  assert.equal(event.correlation, 'none');
  assert.equal(event.requests.activeCount, 0);
});

test('instrumentation overhead: begin/finish costs microseconds, not milliseconds', () => {
  const reg = new InflightRequestRegistry();
  const req: RouteSource = { method: 'GET', baseUrl: '/v2', route: { path: '/catalog' } };
  for (let i = 0; i < 5_000; i += 1) reg.begin(req)(); // warm-up
  const n = 100_000;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i += 1) reg.begin(req)();
  const perPairUs = Number(process.hrtime.bigint() - t0) / 1_000 / n;
  assert.ok(perPairUs < 20, `begin+finish ${perPairUs.toFixed(2)} µs (ceiling 20 µs; measured ~1-2 µs)`);
});

// ---------------------------------------------------------------- Express integration (real sockets, real timers)

async function withServer(fn: (base: string) => Promise<void>, build: (app: express.Express) => void): Promise<void> {
  const app = express();
  app.use(inflightRequestTracker);
  build(app);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await fn(base);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('express: response bytes are unchanged, the route template is resolved, nothing leaks after completion', async () => {
  inflightRequests.reset();
  await withServer(async (base) => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) => fetch(`${base}/items/${i}?secret=abc`).then(async (r) => [r.status, await r.text()] as const))
    );
    assert.deepEqual(responses, [0, 1, 2, 3, 4].map((i) => [200, `item-${i}`]));
    assert.equal((await fetch(`${base}/nothing/here?secret=abc`)).status, 404);
    await sleep(20);
    const stats = inflightRequests.stats();
    assert.equal(stats.active, 0);
    assert.equal(stats.tracked, 0);
    const text = JSON.stringify(inflightRequests.overlap(0, performance.now() + 1));
    assert.ok(text.includes('/items/:id'));
    assert.ok(text.includes(UNMATCHED_ROUTE));
    assert.ok(!text.includes('secret') && !text.includes('/items/1'));
  }, (app) => {
    app.get('/items/:id', (req, res) => { res.send(`item-${req.params.id}`); });
  });
});

test('express: a client that disconnects mid-request is cleaned up as aborted', async () => {
  inflightRequests.reset();
  await withServer(async (base) => {
    const controller = new AbortController();
    const pending = fetch(`${base}/slow`, { signal: controller.signal }).catch(() => 'aborted');
    await sleep(60);
    assert.equal(inflightRequests.stats().active, 1);
    assert.equal(inflightRequests.overlap(0, performance.now()).inFlight[0].route, '/slow');
    controller.abort();
    assert.equal(await pending, 'aborted');
    await sleep(60);
    assert.equal(inflightRequests.stats().active, 0);
    const done = inflightRequests.overlap(0, performance.now() + 1).completed;
    assert.ok(done.some((e) => e.route === '/slow' && e.aborted), JSON.stringify(done));
  }, (app) => {
    app.get('/slow', (_req, res) => { setTimeout(() => res.send('late'), 1_000).unref(); });
  });
});

test('express: an error handled by the app does not leak an entry', async () => {
  inflightRequests.reset();
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/boom`)).status, 500);
    await sleep(20);
    assert.equal(inflightRequests.stats().active, 0);
  }, (app) => {
    app.get('/boom', () => { throw new Error('handler failure'); });
  });
});

test('real stall: a handler that blocks the loop is named by route in the stall event', async () => {
  resetStepTimeline();
  inflightRequests.reset();
  const diag = new EventLoopDiagnostics({ intervalMs: 20, stallThresholdMs: 100, windowMs: 60_000, maxLogsPerMinute: 1 });
  diag.start();
  try {
    await withServer(async (base) => {
      await fetch(`${base}/work/7`).then((r) => r.text());
      await sleep(100);
      const worst = (diag.snapshot() as any).stalls.worst;
      assert.ok(worst && worst.durationMs >= 250, JSON.stringify(worst));
      assert.equal(worst.steps.length, 0, 'no instrumented step ran: the request is the only candidate');
      const routes = [...worst.requests.inFlight, ...worst.requests.completed].map((e: any) => e.route);
      assert.ok(routes.includes('/work/:id'), JSON.stringify(worst.requests));
      assert.match(worst.correlation, /requests/);
    }, (app) => {
      app.get('/work/:id', (_req, res) => { busy(350); res.send('ok'); });
    });
  } finally {
    diag.stop();
  }
});
