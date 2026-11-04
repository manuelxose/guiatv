// M13-B3b benchmark: RelatedWorkIndex refresh (indexableWorks + graph) against a LOCAL throwaway MongoDB (docker mongo:8).
// Nothing here touches production. Each arm runs in a fresh child process (cold JIT, like a boot), ABBA order.
//
//   node artifacts/m13b3/related-works-bench.mjs --base <baseline apps/backend> --candidate <candidate apps/backend> \
//        [--sizes 20000,60000,150000] [--runs 5] [--port 27118] [--label name]
//   (both backends must already be built: `npm run build` in each; the baseline is a checkout of cf19518)
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const CONTAINER = 'guiatv-m13b3-bench';

// ---------------------------------------------------------------------------------------------- child
if (process.argv.includes('--child')) {
  const backend = resolve(arg('child'));
  const uri = arg('uri');
  const dbName = arg('db');
  process.env.WORK_SEO_POLICY = 'on';
  process.env.LOG_LEVEL = 'error';
  const require = createRequire(join(backend, 'package.json'));
  const mongoose = require('mongoose');
  const { monitorEventLoopDelay } = require('node:perf_hooks');
  await mongoose.connect(uri, { dbName, monitorCommands: true, maxPoolSize: 30 });
  const cmd = { find: 0, getMore: 0, aggregate: 0, docs: 0, replyBytesApprox: 0 };
  mongoose.connection.getClient().on('commandSucceeded', (e) => {
    if (!(e.commandName in cmd)) return;
    cmd[e.commandName] += 1;
    const batch = e.reply?.cursor?.firstBatch ?? e.reply?.cursor?.nextBatch;
    if (Array.isArray(batch)) cmd.docs += batch.length;
  });
  const { MediaCatalogModel } = require(join(backend, 'dist/infrastructure/database/models/MediaCatalogEntry.model.js'));
  const { indexableWorks } = require(join(backend, 'dist/application/services/WorkSeoPolicy.js'));
  const { RelatedWorkIndex } = require(join(backend, 'dist/application/services/RelatedWorks.js'));
  const { stepTimelineSnapshot, stepsOverlapping } = require(join(backend, 'dist/shared/utils/stepTimeline.js'));
  const mode = arg('mode', 'default');
  // Ablations on the candidate build only (never change the code under test on disk):
  //   cursorOnly: cursor + batchSize, but TimeSlice never yields (isolates the effect of slicing);
  //   batch1000:  same as the candidate with batchSize 1000 instead of 500.
  if (mode === 'cursorOnly') require(join(backend, 'dist/shared/utils/timeSlice.js')).TimeSlice.prototype.tick = async function tick() {};
  if (mode === 'batch1000') require(join(backend, 'dist/application/services/WorkSeoPolicy.js')).READ_BATCH_SIZE = 1000;
  await MediaCatalogModel.findOne().lean().exec(); // connection + pool warm, not part of the measurement
  const warmupDocs = cmd.docs; Object.assign(cmd, { find: 0, getMore: 0, aggregate: 0, docs: 0 });

  // Drift timer: max lateness of a 5 ms timer is the stall a request would see. Histogram for p95/p99.
  const hist = monitorEventLoopDelay({ resolution: 5 }); hist.enable();
  let last = performance.now(); let maxLate = 0; const lates = []; const stallSteps = [];
  const drift = setInterval(() => { const now = performance.now(); const late = now - last - 5; last = now; if (late > maxLate) maxLate = late; if (late >= 100) { lates.push(Math.round(late)); stallSteps.push({ lateMs: Math.round(late), steps: stepsOverlapping(now - late - 5, now).map((x) => x.step.replace('related_works.', '') + (x.running ? '*' : '')) }); } }, 5);
  let peakRss = 0; let peakHeap = 0;
  const mem = setInterval(() => { const m = process.memoryUsage(); peakRss = Math.max(peakRss, m.rss); peakHeap = Math.max(peakHeap, m.heapUsed); }, 25);

  let captured = [];
  const index = new RelatedWorkIndex(async () => { captured = await indexableWorks(process.env); return captured; });
  const cpu0 = process.cpuUsage(); const elu0 = performance.eventLoopUtilization(); const t0 = performance.now();
  last = performance.now();
  const graph = await index.refresh();
  const wallMs = performance.now() - t0; const cpu = process.cpuUsage(cpu0); const elu = performance.eventLoopUtilization(elu0);
  await new Promise((r) => setTimeout(r, 30)); // let the drift timer observe the last block
  clearInterval(drift); clearInterval(mem); hist.disable();
  const m = process.memoryUsage(); peakRss = Math.max(peakRss, m.rss); peakHeap = Math.max(peakHeap, m.heapUsed);

  // Output equivalence: the full work list and, for every work, its related-works answer.
  const worksDigest = createHash('sha256').update(JSON.stringify(captured)).digest('hex');
  const rel = createHash('sha256');
  for (const w of captured) rel.update(`${w.kind}:${w.tmdbId}>${graph.related(w.kind, w.tmdbId, w.genreIds, 8).map((x) => x.path).join('|')};`);
  const steps = [...stepTimelineSnapshot().startup, ...stepTimelineSnapshot().recent].filter((s) => s.step.startsWith('related_works.'))
    .map((s) => ({ step: s.step, durationMs: s.durationMs, cpuMs: s.cpuMs }));
  console.log(JSON.stringify({
    wallMs: Math.round(wallMs), cpuMs: Math.round((cpu.user + cpu.system) / 1000), elu: +elu.utilization.toFixed(2),
    maxStallMs: Math.round(maxLate), stallsOver100: lates.length, stallsOver250: lates.filter((l) => l >= 250).length,
    topStalls: lates.sort((a, b) => b - a).slice(0, 5), stallSteps: stallSteps.sort((a, b) => b.lateMs - a.lateMs).slice(0, 5),
    histMs: { p50: +(hist.percentile(50) / 1e6).toFixed(1), p95: +(hist.percentile(95) / 1e6).toFixed(1), p99: +(hist.percentile(99) / 1e6).toFixed(1), max: +(hist.max / 1e6).toFixed(1) },
    peakRssMb: Math.round(peakRss / 1048576), peakHeapMb: Math.round(peakHeap / 1048576),
    commands: { find: cmd.find, getMore: cmd.getMore, aggregate: cmd.aggregate, docsReturned: cmd.docs }, warmupDocs,
    works: captured.length, graphSize: graph.size, steps, worksDigest, relatedDigest: rel.digest('hex'),
  }));
  await mongoose.disconnect();
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------- parent
const sh = (...a) => execFileSync('docker', a, { encoding: 'utf8' }).trim();
const baseBackend = resolve(arg('base')); const candBackend = resolve(arg('candidate'));
const sizes = arg('sizes', '20000,60000,150000').split(',').map(Number);
const runs = Number(arg('runs', 5)); const port = Number(arg('port', 27118)); const label = arg('label', 'bench');
const uri = `mongodb://127.0.0.1:${port}`;
const requireC = createRequire(join(candBackend, 'package.json'));
const { MongoClient } = requireC('mongodb');
const { slugifyTitle } = requireC(join(candBackend, 'dist/domain/services/detailPath.js'));
const { slugLookupKey } = requireC(join(candBackend, 'dist/application/services/VerifiedWorkLinks.js'));

try { sh('rm', '-f', CONTAINER); } catch { /* none */ }
sh('run', '-d', '--name', CONTAINER, '-p', `127.0.0.1:${port}:27017`, 'mongo:8');
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 30000 });
await client.connect();

// Deterministic PRNG so every size and rerun produces the same data.
function prng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const ADJ = ['Gran', 'Última', 'Secreto', 'Eterno', 'Oscuro', 'Salvaje', 'Perdido', 'Dorado', 'Silencioso', 'Rápido', 'Antiguo', 'Nuevo'];
const NOUN = ['Misión', 'Ciudad', 'Verano', 'Frontera', 'Memoria', 'Ladrón', 'Isla', 'Reino', 'Camino', 'Sombra', 'Viaje', 'Guerra'];
const GENRES = [28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 53, 10752, 37, 10759, 10765];
const LOREM = 'Una historia de intriga y emoción que sigue a un grupo de personajes atrapados entre su pasado y un futuro incierto mientras descubren secretos que cambiarán sus vidas para siempre. ';

async function seed(n) {
  const db = client.db(`m13b3_bench_${n}`);
  await db.dropDatabase();
  const rnd = prng(n);
  const media = []; const airings = [];
  for (let i = 0; i < n; i += 1) {
    const isTv = rnd() < 0.4;
    const tmdbId = isTv ? 1000 + Math.floor(i * 1.7) : 500 + i; // overlapping numeric ids across kinds, by design
    const dup = rnd() < 0.02 && i > 10; // 2% namesakes: same title, different id
    const title = dup ? media[Math.floor(rnd() * i)].title : `${ADJ[Math.floor(rnd() * 12)]} ${NOUN[Math.floor(rnd() * 12)]} ${i}`;
    const enriched = rnd() < 0.85; const synLen = rnd() < 0.8 ? 320 + Math.floor(rnd() * 500) : 160 + Math.floor(rnd() * 120);
    media.push({
      tmdbId, tmdbType: isTv ? 'tv' : 'movie', contentType: isTv ? 'series' : 'movie', title,
      normalizedTitle: slugLookupKey(slugifyTitle(title)), originalTitle: title, normalizedIdentity: `${slugifyTitle(title)}:${i}`,
      canonicalGenres: ['drama'], tmdbGenres: Array.from({ length: rnd() < 0.05 ? 0 : 1 + Math.floor(rnd() * 3) }, () => ({ id: GENRES[Math.floor(rnd() * GENRES.length)], name: 'Género' })),
      synopsis: LOREM.repeat(Math.ceil(synLen / LOREM.length)).slice(0, synLen), year: String(1960 + Math.floor(rnd() * 65)),
      runtimeMinutes: isTv ? undefined : 70 + Math.floor(rnd() * 90), rating: +(rnd() * 10).toFixed(1), voteCount: Math.floor(rnd() * 5000),
      posterPath: rnd() < 0.95 ? `/p${i}.jpg` : undefined, backdropPath: `/b${i}.jpg`,
      castSummary: Array.from({ length: 6 + Math.floor(rnd() * 6) }, (_, k) => ({ name: `Actor ${k} ${i}`, character: `Personaje ${k}`, profilePath: `/a${k}.jpg` })),
      directors: rnd() < 0.9 ? [`Director ${i % 997}`] : [], metadataSource: 'tmdb', lastEnrichedAt: enriched ? new Date(1.7e12 + i) : undefined,
      createdAt: new Date(1.7e12), updatedAt: new Date(1.7e12),
    });
    if (rnd() < 0.75) for (let k = 0; k < 3; k += 1) airings.push({
      date: `2026-11-0${1 + k}`, program: { tmdbId, editorialCategory: isTv ? 'Series' : 'Cine', title, brandKey: `b${i}`, synopsis: 'x'.repeat(200) },
      airing: { start: new Date(1.78e12 + k * 3.6e6), channelId: `ch${k}` }, padding: 'y'.repeat(400),
    });
  }
  for (let i = 0; i < media.length; i += 5000) await db.collection('media_catalog').insertMany(media.slice(i, i + 5000), { ordered: false });
  for (let i = 0; i < airings.length; i += 5000) await db.collection('tv_read_airings').insertMany(airings.slice(i, i + 5000), { ordered: false });
  await db.collection('media_catalog').createIndex({ tmdbType: 1, tmdbId: 1 }, { unique: true, sparse: true });
  await db.collection('media_catalog').createIndex({ normalizedTitle: 1 });
  await db.collection('tv_read_airings').createIndex({ 'program.tmdbId': 1, date: 1 });
  const stats = await db.command({ collStats: 'media_catalog' });
  return { rows: media.length, airings: airings.length, mediaAvgObjBytes: Math.round(stats.avgObjSize), mediaBytes: stats.size };
}

function runChild(backend, n, mode = 'default') {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', backend, '--uri', uri, '--db', `m13b3_bench_${n}`, '--mode', mode], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('exit', (code) => { try { res(JSON.parse(out.trim().split('\n').pop())); } catch { rej(new Error(`child failed (${code}): ${err.slice(-400)} ${out.slice(-200)}`)); } });
  });
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const result = { label, node: process.version, mongo: sh('exec', CONTAINER, 'mongod', '--version').split('\n')[0], runs, sizes: {} };
try {
  for (const n of sizes) {
    const data = await seed(n);
    // baseline = unmodified build; candidate = the change; cursorOnly / batch1000 = ablations of the candidate (--ablate);
    // control = a second run of the baseline (A/A, to show the noise floor).
    const names = ['baseline', 'candidate', ...(process.argv.includes('--ablate') ? ['cursorOnly', 'batch1000'] : []), ...(process.argv.includes('--aa') ? ['control'] : [])];
    const spec = { baseline: [baseBackend, 'default'], control: [baseBackend, 'default'], candidate: [candBackend, 'default'], cursorOnly: [candBackend, 'cursorOnly'], batch1000: [candBackend, 'batch1000'] };
    const arms = Object.fromEntries(names.map((k) => [k, []]));
    for (const k of names) await runChild(spec[k][0], n, 'default').catch(() => undefined); // warm file cache and JIT-independent state, discarded
    for (let i = 0; i < runs; i += 1) for (const arm of (i % 2 === 0 ? names : [...names].reverse())) arms[arm].push(await runChild(spec[arm][0], n, spec[arm][1]));
    const pick = (list, f) => median(list.map(f));
    const sum = Object.fromEntries(Object.entries(arms).map(([arm, list]) => [arm, {
      wallMs: pick(list, (r) => r.wallMs), cpuMs: pick(list, (r) => r.cpuMs), maxStallMs: pick(list, (r) => r.maxStallMs),
      worstStallSteps: list.map((r) => r.stallSteps[0]).filter(Boolean).slice(0, 3),
      maxStallRange: [Math.min(...list.map((r) => r.maxStallMs)), Math.max(...list.map((r) => r.maxStallMs))],
      stallsOver250: pick(list, (r) => r.stallsOver250), stallsOver100: pick(list, (r) => r.stallsOver100),
      histP99Ms: pick(list, (r) => r.histMs.p99), histMaxMs: pick(list, (r) => r.histMs.max),
      peakRssMb: pick(list, (r) => r.peakRssMb), peakHeapMb: pick(list, (r) => r.peakHeapMb),
      commands: list[0].commands, works: list[0].works, graphSize: list[0].graphSize,
      digestsStable: new Set(list.map((r) => r.worksDigest + r.relatedDigest)).size === 1,
    }]));
    const equal = names.every((k) => arms[k].every((r) => r.worksDigest === arms.baseline[0].worksDigest && r.relatedDigest === arms.baseline[0].relatedDigest));
    result.sizes[n] = { data, summary: sum, outputIdentical: equal, raw: arms };
    console.log(`n=${n} rows, ${data.airings} airings, avg media doc ${data.mediaAvgObjBytes} B; outputIdentical=${equal}`);
    console.table(Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, { wallMs: v.wallMs, cpuMs: v.cpuMs, maxStallMs: v.maxStallMs, '>250': v.stallsOver250, p99: v.histP99Ms, rssMb: v.peakRssMb, heapMb: v.peakHeapMb, finds: v.commands.find, getMores: v.commands.getMore, works: v.works }])));
  }
} finally {
  writeFileSync(join(here, `bench-${label}.json`), JSON.stringify(result, null, 2));
  await client.close();
  try { sh('rm', '-f', CONTAINER); } catch { /* ignore */ }
}
