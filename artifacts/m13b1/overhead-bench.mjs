// M13-B1: controlled LOCAL before/after overhead benchmark of the diagnostics. Nothing here touches production.
//
//   node overhead-bench.mjs <distBefore> <distAfter> [processes=8] [queries=4000]
//
// distBefore = backend `dist` built from origin/main (2334f71); distAfter = built from this branch.
//  A) query: CatalogService.query cold-miss path with zero-latency stubs (cache always misses, TMDB/providers/channels
//     return instantly), so the number is the CPU cost of one query's own code plus the instrumentation.
//  B) loop: a fixed CPU workload on the event loop with the stall monitor on vs off (after build only): iterations/s.
// Each arm runs in a fresh process, arms alternate in ABBA order, and the per-process medians are reported (no pooled
// percentile claims). Differences below the harness noise (see the A/A control) are NOT an effect.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [before, after, procs = '8', queries = '4000'] = process.argv.slice(2);
if (process.argv[2] === '--child') await child(process.argv[3], process.argv[4], Number(process.argv[5]));
else main();

function runChild(dist, mode, n) {
  const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--child', resolve(dist), mode, String(n)], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`child failed: ${r.stderr.slice(0, 500)}`);
  return JSON.parse(r.stdout.trim().split('\n').at(-1));
}

function median(values) { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

function main() {
  const n = Number(queries);
  const result = { startedAt: new Date().toISOString(), node: process.version, processes: Number(procs), queriesPerProcess: n, query: { before: [], after: [], afterControl: [] }, loop: { off: [], on: [] } };
  // ABBA order: [before, after, after, before, ...], and an A/A control (the same `after` dist twice) for the noise floor.
  for (let i = 0; i < Number(procs); i++) {
    const order = i % 2 === 0 ? ['before', 'after', 'afterControl'] : ['afterControl', 'after', 'before'];
    for (const arm of order) result.query[arm].push(runChild(arm === 'before' ? before : after, 'query', n));
  }
  for (let i = 0; i < Number(procs); i++) {
    const order = i % 2 === 0 ? ['off', 'on'] : ['on', 'off'];
    for (const arm of order) result.loop[arm].push(runChild(after, arm === 'on' ? 'loop-on' : 'loop-off', 0));
  }
  const q = (arm) => result.query[arm].map((r) => r.medianUs);
  result.summary = {
    queryMedianMicrosPerProcess: { before: q('before'), after: q('after'), afterControl: q('afterControl') },
    queryMedianOfMedians: { before: median(q('before')), after: median(q('after')), afterControl: median(q('afterControl')) },
    loopIterationsPerSecondPerProcess: { off: result.loop.off.map((r) => r.itersPerSec), on: result.loop.on.map((r) => r.itersPerSec) },
    loopMedianOfMedians: { off: median(result.loop.off.map((r) => r.itersPerSec)), on: median(result.loop.on.map((r) => r.itersPerSec)) },
  };
  writeFileSync(new URL('./overhead-bench.json', import.meta.url), JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result.summary, null, 1));
}

async function child(dist, mode, n) {
  process.env.TZ = 'Europe/Madrid';
  process.env.NODE_ENV = 'test';
  const req = (await import('node:module')).createRequire(dist + '/');
  if (mode === 'query') {
    const { CatalogService } = req('./application/services/CatalogService.js');
    const store = new Map();
    const cache = { get: async () => null, set: async (k, v) => void store.set(k, v) };
    const tmdb = {
      discoverMovies: async () => ({ results: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, title: `Pelicula ${i + 1}`, overview: 'x', vote_average: 7 })) }),
      getImageUrl: () => undefined,
    };
    const providers = { getMovieProviders: async () => null };
    const service = new CatalogService({ findAll: async () => [] }, cache, tmdb, providers, {}, {});
    const timings = [];
    const total = n + 500;
    for (let i = 0; i < total; i++) {
      const t0 = process.hrtime.bigint();
      await service.query({ types: ['movie'], availability: ['streaming'], limit: 12, page: (i % 50) + 2 }); // page>1: no hot key
      if (i >= 500) timings.push(Number(process.hrtime.bigint() - t0) / 1000);
    }
    timings.sort((a, b) => a - b);
    console.log(JSON.stringify({ medianUs: +timings[Math.floor(timings.length / 2)].toFixed(1), p95Us: +timings[Math.floor(timings.length * 0.95)].toFixed(1), n: timings.length }));
  } else {
    if (mode === 'loop-on') req('./shared/utils/eventLoopDiagnostics.js').startEventLoopDiagnostics({});
    const end = performance.now() + 3000;
    let iters = 0;
    let sink = 0;
    await new Promise((done) => {
      const step = () => {
        for (let k = 0; k < 20000; k++) sink += Math.sqrt(k);
        iters++;
        if (performance.now() < end) setImmediate(step); else done();
      };
      step();
    });
    console.log(JSON.stringify({ itersPerSec: +(iters / 3).toFixed(1), sink: sink > 0 }));
    process.exit(0);
  }
}
