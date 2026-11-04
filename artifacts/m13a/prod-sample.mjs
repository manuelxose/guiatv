// M13-A: small SEQUENTIAL read-only GET sampler for production (never concurrent, never a load test).
// Usage: node prod-sample.mjs <out.json> [rounds=12] [roundGapMs=15000] [spacingMs=250]
// Rounds interleave all targets so L1 (30 s) and nginx/Redis TTL expiry are crossed; sample 1 of each target is the
// first request after the process started, so it is the closest thing to "cold" this harness can observe from outside.
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';

const BASE = process.env.PERF_BASE || 'https://guiaprogramaciontv.com';
const [out, rounds = '12', gap = '15000', spacing = '250'] = process.argv.slice(2);
const UA = 'GuiaTV-M13A-baseline/1.0 (owner-authorized sequential read-only sample)';
const api = [
  '/v2/health', '/v2/health/metrics', '/v2/tv/read', '/v2/tv/read/channels', '/v2/tv/surface/channels/la-1',
  '/v2/catalog/slug/movie/gladiator', '/v2/catalog/slug/series/modern-family',
  '/v2/catalog?types=movie,series&availability=streaming&limit=12',
  '/v2/sports/football/home', '/v2/sports/football/competitions',
];
const ssr = ['/', '/canales', '/canales/la-1', '/peliculas/gladiator', '/series/modern-family', '/deportes/futbol', '/guias'];
const targets = [...api.map((p) => ({ kind: 'api', path: p })), ...ssr.map((p) => ({ kind: 'ssr', path: p }))];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h = (res, n) => res.headers.get(n) ?? null;

async function sample(t) {
  const started = performance.now();
  try {
    const res = await fetch(BASE + t.path, { headers: { 'user-agent': UA, accept: t.kind === 'ssr' ? 'text/html' : 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const ttfbMs = performance.now() - started;
    const body = Buffer.from(await res.arrayBuffer());
    const totalMs = performance.now() - started;
    const r = { status: res.status, ttfbMs: +ttfbMs.toFixed(1), totalMs: +totalMs.toFixed(1), decodedBytes: body.length,
      wireBytes: Number(h(res, 'content-length')) || null, encoding: h(res, 'content-encoding'),
      cf: h(res, 'cf-cache-status'), nginx: h(res, 'x-cache-status'), serverTiming: h(res, 'server-timing'), age: h(res, 'age') };
    if (t.kind === 'ssr') {
      const html = body.toString('utf8');
      r.canonical = /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)/i.exec(html)?.[1] ?? null;
      r.metaRobots = /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']+)/i.exec(html)?.[1] ?? null;
      r.xRobots = h(res, 'x-robots-tag');
      const st = /<script[^>]+id=["']ng-state["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
      r.transferStateBytes = st ? Buffer.byteLength(st[1]) : 0;
      r.location = h(res, 'location');
    }
    return r;
  } catch (e) {
    return { status: 0, error: String(e?.name || e), totalMs: +(performance.now() - started).toFixed(1) };
  }
}

const results = Object.fromEntries(targets.map((t) => [t.path, { kind: t.kind, samples: [] }]));
const t0 = new Date().toISOString();
for (let i = 0; i < Number(rounds); i++) {
  for (const t of targets) {
    results[t.path].samples.push({ at: new Date().toISOString(), round: i + 1, ...(await sample(t)) });
    await sleep(Number(spacing));
  }
  if (i < Number(rounds) - 1) await sleep(Number(gap));
}
writeFileSync(out, JSON.stringify({ base: BASE, startedAt: t0, finishedAt: new Date().toISOString(), rounds: Number(rounds), results }, null, 1));
console.log('wrote', out);
