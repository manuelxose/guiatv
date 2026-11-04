// M13-A: controlled SSR comparison of two frontend builds against identical API fixtures (never against production).
//   node scripts/m13a-transfer-state-bench.mjs discover <urls.json> <dist>   local only: lists the API URLs the 7 pages request
//   node scripts/m13a-transfer-state-bench.mjs fetch-fixtures <urls.json> <fixtures.json>   ONE sequential read-only GET per URL
//   node scripts/m13a-transfer-state-bench.mjs bench <fixtures.json> <out.json> <distA> <distB> [rounds=15]
//        ABBA runs of the production SSR entrypoint on each dist; every sample is a fresh render (an auth-shaped cookie
//        makes ssr-server.mjs skip its page cache), so the timings are render + serialisation, not cache hits.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { launchSsr } from './entity-ssr-harness.mjs';

const ROUTES = process.env.M13A_ROUTES?.split(',') ?? ['/', '/canales', '/canales/la-1', '/peliculas/gladiator', '/series/modern-family', '/deportes/futbol', '/guias'];
const PROD = 'https://guiaprogramaciontv.com';
const [mode, fixturesPath, outPath, distA, distB, roundsArg] = process.argv.slice(2);

async function stub(handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { origin: `http://127.0.0.1:${server.address().port}`, stop: () => { server.closeAllConnections(); server.close(); } };
}

const stateOf = (html) => /<script[^>]+id=["']ng-state["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1] ?? '';
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? +s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)].toFixed(2) : null; };

if (mode === 'discover') {
  // Local only: which API URLs do the 7 pages request? Answers 404 to everything and never contacts production.
  const seen = new Set();
  const backend = await stub((req, res) => { seen.add(req.url); res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"success":false}'); });
  process.env.FRONTEND_RELEASE_DIR = outPath; // <dist>
  const ssr = await launchSsr(backend.origin);
  for (const route of ROUTES) await fetch(ssr.origin + route, { headers: { cookie: 'session=m13a' } }).then((r) => r.text());
  await ssr.stop(); backend.stop();
  writeFileSync(fixturesPath, JSON.stringify([...seen].filter((u) => u.startsWith('/v2/')), null, 1));
  console.log('API URLs requested:', seen.size);
} else if (mode === 'fetch-fixtures') {
  // One sequential, read-only GET per distinct URL listed by `discover` (outPath = fixtures file).
  const fixtures = {};
  for (const url of JSON.parse(readFileSync(fixturesPath, 'utf8'))) {
    const r = await fetch(PROD + url, { headers: { 'user-agent': 'GuiaTV-M13A-fixture-capture/1.0 (read-only, sequential)' }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    fixtures[url] = { status: r.status, body: await r.text() };
    await new Promise((ok) => setTimeout(ok, 400));
  }
  writeFileSync(outPath, JSON.stringify(fixtures));
  console.log('fixtures:', Object.entries(fixtures).map(([u, f]) => `${f.status} ${f.body.length}B ${u}`).join(String.fromCharCode(10)));
} else if (mode === 'bench') {
  const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf8'));
  const rounds = Number(roundsArg || 15);
  const calls = [];
  const backend = await stub((req, res) => {
    calls.push(req.url);
    const hit = fixtures[req.url];
    res.writeHead(hit ? hit.status : 404, { 'content-type': 'application/json' });
    res.end(hit ? hit.body : '{"success":false}');
  });
  const results = { fixtures: Object.keys(fixtures), rounds, runs: [] };
  const order = process.env.M13A_FLIP // M13A_FLIP=1: after-first (B A A B), so a first-slot effect is not always charged to 'before'
    ? [['after', distB], ['before', distA], ['before', distA], ['after', distB]]
    : [['before', distA], ['after', distB], ['after', distB], ['before', distA]];
  for (const [label, dist] of order) {
    if (!existsSync(dist)) throw new Error(`missing dist ${dist}`);
    process.env.FRONTEND_RELEASE_DIR = dist;
    const ssr = await launchSsr(backend.origin);
    const get = async (route) => {
      const started = performance.now();
      const res = await fetch(ssr.origin + route, { headers: { cookie: 'session=m13a-bench' } });
      const ttfb = performance.now() - started;
      const html = await res.text();
      return { status: res.status, ttfbMs: ttfb, totalMs: performance.now() - started, html };
    };
    for (const route of ROUTES) await get(route); // warm-up: JIT, module graph, lazy chunks
    calls.length = 0;
    const perRoute = {};
    for (let i = 0; i < rounds; i++) {
      for (const route of ROUTES) {
        const r = await get(route);
        const state = stateOf(r.html);
        const parseStarted = performance.now();
        if (state) JSON.parse(state);
        (perRoute[route] ??= []).push({
          status: r.status, ttfbMs: r.ttfbMs, totalMs: r.totalMs, htmlBytes: Buffer.byteLength(r.html), stateBytes: Buffer.byteLength(state),
          gzipBytes: gzipSync(r.html, { level: 6 }).length,
          brotliBytes: brotliCompressSync(r.html, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length,
          stateParseMs: performance.now() - parseStarted,
        });
      }
    }
    results.runs.push({ label, dist, apiCallsPerRound: calls.length / rounds, perRoute });
    await ssr.stop();
  }
  backend.stop();
  writeFileSync(outPath, JSON.stringify(results));
  for (const label of ['before', 'after']) {
    console.log(`\n== ${label}`);
    for (const route of ROUTES) {
      const xs = results.runs.filter((r) => r.label === label).flatMap((r) => r.perRoute[route]);
      const f = (k, q) => pct(xs.map((x) => x[k]), q);
      console.log(route.padEnd(24), `n=${xs.length}`, `status=${[...new Set(xs.map((x) => x.status))]}`,
        `total p50=${f('totalMs', .5)} p95=${f('totalMs', .95)} max=${f('totalMs', 1)}`,
        `html=${xs[0].htmlBytes} state=${xs[0].stateBytes} gzip=${xs[0].gzipBytes} br=${xs[0].brotliBytes} stateParse p50=${f('stateParseMs', .5)}ms`);
    }
  }
} else {
  console.error('usage: discover <urls.json> <dist> | fetch-fixtures <urls.json> <fixtures.json> | bench <fixtures.json> <out.json> <distBefore> <distAfter> [rounds]');
  process.exit(2);
}
