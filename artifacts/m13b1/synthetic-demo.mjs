// M13-B1: local SYNTHETIC demonstration that the new instrumentation names the cause of a stall and reads a cold catalogue
// miss correctly. Nothing here touches production or a database.
//   node synthetic-demo.mjs <backend dist dir> <out.json>
//
// 1. RelatedWorkIndex.warm() with a synthetic catalogue of N works: the graph build is synchronous CPU on the event loop.
//    The stall monitor must record a stall whose `steps` contain `related_works.build_graph` and a CPU-bound signature.
//    N is a parameter, not a claim about production size: it shows how the build time scales (hypothesis check only).
// 2. CatalogService.query cold miss with TMDB-like latencies (discover ~700 ms, 40 provider lookups of 100-600 ms in
//    parallel): `cat_providers` must be the wall-clock of the slowest chain, while desc carries n=40 and the summed work.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

process.env.TZ = 'Europe/Madrid';
const dist = resolve(process.argv[2]);
const out = process.argv[3];
const req = createRequire(dist + '/');
const { startEventLoopDiagnostics } = req('./shared/utils/eventLoopDiagnostics.js');
const { RelatedWorkIndex } = req('./application/services/RelatedWorks.js');
const { runtimeMetricsSnapshot } = req('./shared/utils/runtimeMetrics.js');
const { CatalogService } = req('./application/services/CatalogService.js');
const { withRequestTiming, formatServerTiming } = req('./shared/utils/performanceTiming.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

startEventLoopDiagnostics({ DIAG_STALL_THRESHOLD_MS: '100' });
await sleep(300);

const builds = [];
for (const n of [2_000, 10_000, 40_000]) {
  const works = Array.from({ length: n }, (_, i) => ({
    kind: i % 3 ? 'movie' : 'tv', tmdbId: i + 1, path: `/${i % 3 ? 'peliculas' : 'series'}/obra-${i}`, title: `Obra ${i}`,
    genreIds: Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => 1 + Math.floor(rnd() * 20)),
  }));
  const index = new RelatedWorkIndex(async () => works, 60_000);
  const t0 = performance.now();
  index.warm();
  await index.get();
  while (!(await index.get())) await sleep(20);
  await sleep(150);
  builds.push({ works: n, wallMs: +(performance.now() - t0).toFixed(1) });
}

// 2. cold catalogue miss with TMDB-like latencies
let limit = 24;
const cache = { get: async () => null, set: async () => undefined };
const tmdb = {
  discoverMovies: async () => { await sleep(700); return { results: Array.from({ length: 40 }, (_, i) => ({ id: i + 1, title: `Pelicula ${i + 1}` })) }; },
  getImageUrl: () => undefined,
};
const providers = { getMovieProviders: async () => { await sleep(100 + Math.floor(rnd() * 500)); return null; } };
const service = new CatalogService({ findAll: async () => [] }, cache, tmdb, providers, {}, {});
const ctx = { phases: new Map() };
const t0 = performance.now();
await new Promise((resolveQuery, reject) => withRequestTiming(ctx, () => { service.query({ types: ['movie'], availability: ['streaming'], limit }).then(resolveQuery, reject); }));
const serverTiming = formatServerTiming(ctx, performance.now() - t0);

const snapshot = runtimeMetricsSnapshot();
const diagnostics = snapshot.diagnostics;
const result = {
  note: 'Synthetic. Graph builds are real CPU on this machine; catalogue latencies are stubbed sleeps.',
  node: process.version,
  graphBuilds: builds,
  stalls: diagnostics.eventLoop.stalls,
  startupAndBackgroundSteps: diagnostics.steps,
  catalogueServerTiming: serverTiming,
  catalogue: diagnostics.catalogue,
  cumulativeEventLoopLagMs: snapshot.process.eventLoopLagMs,
};
writeFileSync(out, JSON.stringify(result, null, 1));
console.log('graph builds:', JSON.stringify(builds));
console.log('stalls:', diagnostics.eventLoop.stalls.count, 'worst:', JSON.stringify(diagnostics.eventLoop.stalls.worst));
console.log('Server-Timing:', serverTiming);
process.exit(0);
