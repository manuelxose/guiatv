// M13-B1: SEQUENTIAL, read-only GET sampler for production (never concurrent, never a load test, ~100 requests in ~5 min).
// Usage: node prod-steady-sample.mjs <out.json> [rounds=12] [roundGapMs=20000] [spacingMs=300]
//
// Differences from the M13-A sampler:
//  * raw https so the COMPRESSED bytes on the wire are counted (fetch hides them), with accept-encoding br,gzip;
//  * every sample keeps the Cloudflare / nginx cache headers, so edge (CF HIT) and origin answers can be told apart;
//  * three never-seen catalogue query variants are requested once each (a genuine application-cache miss: TMDB fan-out),
//    then once more 2 s later (hit), to separate cold-miss cost from steady-state cost;
//  * /v2/health/metrics is saved before and after, so process uptime and the event-loop maximum frame the sample.
// Percentiles are computed only for groups with n >= 20 (p95) and never p99; smaller groups report min/median/max.
import https from 'node:https';
import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';

const BASE = new URL(process.env.PERF_BASE || 'https://guiaprogramaciontv.com');
const [out, rounds = '12', gap = '20000', spacing = '300'] = process.argv.slice(2);
const UA = 'GuiaTV-M13B1-diagnostics/1.0 (owner-authorized sequential read-only sample)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(path) {
  return new Promise((resolve) => {
    const started = performance.now();
    const req = https.get({ host: BASE.host, path, headers: { 'user-agent': UA, 'accept-encoding': 'br, gzip', accept: path.startsWith('/v2') ? 'application/json' : 'text/html' }, timeout: 30000 }, (res) => {
      const ttfbMs = performance.now() - started;
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'];
        let body = raw;
        try { body = enc === 'br' ? zlib.brotliDecompressSync(raw) : enc === 'gzip' ? zlib.gunzipSync(raw) : raw; } catch { /* keep raw */ }
        const h = res.headers;
        const r = {
          at: new Date().toISOString(), path, status: res.statusCode, ttfbMs: +ttfbMs.toFixed(1), totalMs: +(performance.now() - started).toFixed(1),
          wireBytes: raw.length, decodedBytes: body.length, encoding: enc ?? null, viaCloudflare: Boolean(h['cf-ray']),
          cf: h['cf-cache-status'] ?? null, nginx: h['x-cache-status'] ?? null, age: h.age ?? null, serverTiming: h['server-timing'] ?? null,
        };
        if (!path.startsWith('/v2')) {
          const html = body.toString('utf8');
          r.canonical = /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)/i.exec(html)?.[1] ?? null;
          r.metaRobots = /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']+)/i.exec(html)?.[1] ?? null;
        }
        if (path === '/v2/health/metrics') { try { r.metrics = JSON.parse(body.toString('utf8')); } catch { /* ignore */ } }
        resolve(r);
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ at: new Date().toISOString(), path, status: 0, error: e.code || e.message, totalMs: +(performance.now() - started).toFixed(1) }));
  });
}

const steady = ['/v2/health', '/v2/catalog?types=movie,series&availability=streaming&limit=12', '/v2/tv/read/channels', '/canales', '/', '/guias'];
const coldVariants = ['limit=17', 'limit=19', 'limit=21'].map((l) => `/v2/catalog?types=movie&availability=streaming&${l}`);
const samples = [];
const metricsBefore = await get('/v2/health/metrics');
const startedAt = new Date().toISOString();

// Cold-miss probes: each variant once, then once more as a hit; sequential, spaced.
const coldProbes = [];
for (const path of coldVariants) {
  coldProbes.push({ phase: 'cold', ...(await get(path)) });
  await sleep(2000);
  coldProbes.push({ phase: 'repeat', ...(await get(path)) });
  await sleep(Number(spacing));
}
for (let i = 0; i < Number(rounds); i++) {
  for (const path of steady) {
    samples.push({ round: i + 1, ...(await get(path)) });
    await sleep(Number(spacing));
  }
  if (i < Number(rounds) - 1) await sleep(Number(gap));
}
const metricsAfter = await get('/v2/health/metrics');

const pct = (sorted, f) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * f) - 1)];
const groups = {};
for (const s of samples) {
  if (s.status !== 200) continue;
  const key = `${s.path} | cf=${s.cf ?? '-'} nginx=${s.nginx ?? '-'}`;
  (groups[key] ??= []).push(s);
}
const summary = Object.fromEntries(Object.entries(groups).map(([key, list]) => {
  const t = list.map((s) => s.totalMs).sort((a, b) => a - b);
  const w = list.map((s) => s.wireBytes).sort((a, b) => a - b);
  const base = { n: list.length, totalMs: { min: t[0], median: pct(t, 0.5), max: t.at(-1) }, wireBytesMedian: pct(w, 0.5), decodedBytesMedian: pct(list.map((s) => s.decodedBytes).sort((a, b) => a - b), 0.5), encoding: list[0].encoding };
  if (list.length >= 20) base.totalMs.p95 = pct(t, 0.95);
  return [key, base];
}));
const slim = (r) => { const { metrics, ...rest } = r; return rest; };
writeFileSync(out, JSON.stringify({
  base: BASE.origin, startedAt, finishedAt: new Date().toISOString(), rounds: Number(rounds),
  note: 'Sequential read-only GETs. wireBytes = compressed bytes as received (Cloudflare brotli when viaCloudflare). Groups with n<20 have no p95.',
  metricsBefore: metricsBefore.metrics?.data ?? metricsBefore.metrics ?? null,
  metricsAfter: metricsAfter.metrics?.data ?? metricsAfter.metrics ?? null,
  coldProbes: coldProbes.map(slim), summary, samples: samples.map(slim),
}, null, 1));
console.log('wrote', out, 'samples', samples.length, 'cold', coldProbes.length);
