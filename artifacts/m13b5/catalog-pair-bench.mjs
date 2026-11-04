// M13-B5a: local reproduction of the production "request pair" (GET /v2/catalog/:id/enrichment + GET /v2/catalog/) against a
// LOCAL throwaway MongoDB (docker mongo:8). Nothing here touches production; every document is synthetic.
// Real code under test: CatalogService + TvReadQueryService + TVReadAiringModel from a built backend (apps/backend/dist).
// Cache = in-memory string store with JSON.stringify/parse on set/get, i.e. what ValkeyCache does minus the socket.
// Each scenario runs in a fresh child process (cold JIT, like a boot), several runs, and reports event-loop stalls (5 ms drift
// timer), CPU, GC, heap, Mongo command counts, per-phase wall time (the existing PhaseRecorder / Server-Timing reports).
//
//   node artifacts/m13b5/catalog-pair-bench.mjs --backend <apps/backend> [--rows 2600,20000] [--runs 5] [--port 27119]
//        [--scenarios list] [--label name] [--out file.json]
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const CONTAINER = 'guiatv-m13b5-bench';
const SCENARIOS = ['list_cold', 'list_warm_redis', 'enrich_cold', 'enrich_warm_redis', 'pair_cold', 'pair_distinct_genres', 'list_movie_cold'];

// ------------------------------------------------------------------------------------------ fixture
// Deterministic synthetic EPG day: `rows` airings over 160 channels, ~3 KB each (provenance, assets, aliases...), Spanish titles
// with accents (localeCompare('es') cost is title-length dependent), on-the-hour starts so airtime scores tie a lot (as in prod).
export function buildRows(rows, date) {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const words = ['El', 'La', 'Los', 'Noticias', 'Cine', 'Tarde', 'Mañana', 'Sé', 'Cómo', 'Águila', 'Ñandú', 'Misterio', 'Deporte', 'Fútbol', 'Documental', 'Serie', 'Concurso', 'Telediario', 'Informativo', 'Magazine', 'Película', 'Programa', 'Naturaleza', 'Historia', 'Salud', 'Cocina'];
  const genres = ['Cine', 'Series', 'Deportes', 'Documentales', 'Informativos', 'Entretenimiento', 'Infantil', 'Magazine'];
  const channels = 160;
  const perChannel = Math.ceil(rows / channels);
  const day0 = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), -2, 0, 0); // Madrid midnight-ish
  const out = [];
  for (let c = 0; c < channels && out.length < rows; c += 1) {
    const slotMinutes = Math.max(5, Math.floor((24 * 60) / perChannel));
    for (let k = 0; k < perChannel && out.length < rows; k += 1) {
      const n = out.length;
      const title = `${words[Math.floor(rnd() * words.length)]} ${words[Math.floor(rnd() * words.length)]} ${words[Math.floor(rnd() * words.length)]} ${n % 97}`;
      const start = new Date(day0 + k * slotMinutes * 60_000);
      const end = new Date(start.getTime() + slotMinutes * 60_000);
      const genre = genres[Math.floor(rnd() * genres.length)];
      const withTmdb = rnd() < 0.35;
      const id = `${date}_ch${c}_${n}`;
      const channel = { id: `ch${c}`, name: `Canal ${c}`, normalizedName: `canal ${c}`, aliases: [`canal ${c}`, `ch${c}`, `Canal ${c} HD`], sourceIds: [`src-${c}`, `epg-${c}`], type: 'TDT', group: c < 30 ? 'tdt' : 'pay', subgroups: ['tdt', 'nacional'], sortOrder: c, icon: `/logos/ch${c}.webp`, country: 'España', countryCode: 'ES', region: 'nacional', distribution: 'terrestrial', access: 'free', operator: 'x', providers: ['p1', 'p2'], contentFacets: ['general'], market: { country: 'España', countryCode: 'ES', region: 'nacional', scope: 'national' }, quality: { resolution: 'hd', timeshift: 'none' } };
      out.push({
        id, date, viewDate: date, channel,
        program: { brandKey: title.toLowerCase().replace(/\s+/g, '_'), title, normalizedTitle: title.toLowerCase(), titleAliases: [title.toLowerCase(), `${title} (alias)`], editorialCategory: genre, genre, subgenre: 'general', tmdbId: withTmdb ? 1000 + (n % 5000) : undefined, description: `Descripción sintética del programa ${title}. `.repeat(6), titleResolutionState: 'resolved', workPath: withTmdb ? `/peliculas/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : undefined },
        airing: { id, date, start: start.toISOString(), end: end.toISOString(), durationMinutes: slotMinutes, liveNow: false, partOfDay: 'tarde', timeSlotKey: `${String(start.getUTCHours()).padStart(2, '0')}:00` },
        assets: { primary: { kind: 'poster', role: 'primary', source: 'tmdb_poster', url: `https://img.example/p/${n}.jpg` }, poster: { kind: 'poster', role: 'primary', source: 'tmdb_poster', url: `https://img.example/p/${n}.jpg` }, backdrop: { kind: 'backdrop', role: 'fallback', source: 'tmdb_backdrop', url: `https://img.example/b/${n}.jpg` }, channelLogo: { kind: 'channelLogo', role: 'fallback', source: 'channel_icon', url: `/logos/ch${c}.webp` }, fallbackChain: [{ kind: 'poster', source: 'tmdb_poster', url: `https://img.example/p/${n}.jpg` }, { kind: 'channelLogo', source: 'channel_icon', url: `/logos/ch${c}.webp` }] },
        availability: { live: true, catchup: false, streaming: false },
        sourceProvenance: { schedule: ['epg', 'epg2'], metadata: withTmdb ? ['tmdb'] : [], assets: ['tmdb_poster', 'channel_icon'] },
        timingContext: { start: start.toISOString(), end: end.toISOString(), liveNow: false, window: 'today' },
        relevance: { score: Math.floor(rnd() * 50), reason: 'synthetic' },
        trustDecision: { confidence: 'high', sourceAgreement: 'single_source', featuredSuppressed: false, consumerSuppressed: false, reasons: [] },
        searchTokens: title.toLowerCase().split(/\s+/),
        createdAt: new Date(), updatedAt: new Date(),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- child
if (process.argv.includes('--child')) {
  const backend = resolve(arg('child'));
  const uri = arg('uri');
  const dbName = arg('db');
  const scenario = arg('scenario');
  process.env.LOG_LEVEL = 'error';
  process.env.TZ = 'Europe/Madrid';
  const require = createRequire(join(backend, 'package.json'));
  const mongoose = require('mongoose');
  const perf = require('node:perf_hooks');
  const { monitorEventLoopDelay, PerformanceObserver, constants: perfConstants } = perf;
  await mongoose.connect(uri, { dbName, monitorCommands: true, maxPoolSize: 30 });
  const cmd = { find: 0, count: 0, other: 0, docs: 0 };
  mongoose.connection.getClient().on('commandSucceeded', (e) => {
    if (e.commandName === 'find' || e.commandName === 'getMore') cmd.find += 1;
    else if (e.commandName === 'aggregate' || e.commandName === 'count') cmd.count += 1; else if (!['hello', 'isMaster', 'ping', 'endSessions'].includes(e.commandName)) cmd.other += 1;
    const batch = e.reply?.cursor?.firstBatch ?? e.reply?.cursor?.nextBatch; if (Array.isArray(batch)) cmd.docs += batch.length;
  });
  const dist = (p) => require(join(backend, 'dist', p));
  const { CatalogService } = dist('application/services/CatalogService.js');
  const { TvReadQueryService } = dist('application/services/TvReadQueryService.js');
  const { TVReadAiringModel } = dist('infrastructure/database/models/TVReadAiring.model.js');
  const { l1Cache } = dist('infrastructure/cache/L1Cache.js');
  const { DateUtils } = dist('shared/utils/dateUtils.js');
  const { stepTimelineSnapshot } = dist('shared/utils/stepTimeline.js');
  const { catalogueDiagnosticsSnapshot } = dist('shared/utils/catalogueDiagnostics.js');

  const store = new Map();
  const cache = {
    async get(key) { const v = store.get(key); return v === undefined ? null : JSON.parse(v); },
    async set(key, value) { store.set(key, JSON.stringify(value)); },
    async delete(key) { store.delete(key); }, async clear() { store.clear(); }, async increment() { return 1; },
    async setIfAbsent() { return true; }, async releaseLock() {}, async exists(k) { return store.has(k); }, async ttl() { return 100; },
    async mget(keys) { return keys.map((k) => (store.has(k) ? JSON.parse(store.get(k)) : null)); }, async mset() {},
  };
  // M13-B5c: the real channel repository against the seeded `channels` collection (the first harness stubbed it with [], which
  // is why production's 4 s `channels` phase never showed up locally).
  const { MongoChannelRepository } = dist('infrastructure/repositories/MongoChannelRepository.js');
  const channelRepo = process.env.CHANNELS === '0' ? { findAll: async () => [], findById: async () => null } : new MongoChannelRepository();
  const tvRead = new TvReadQueryService(cache);
  const empty = async () => ({ results: [] });
  const service = new CatalogService(
    channelRepo, cache,
    { getImageUrl: (p) => (p ? `https://img.example${p}` : undefined), discoverMovies: empty, discoverTV: empty, searchMovies: async () => [], searchTV: async () => [], getMovieDetails: async () => null, getTVDetails: async () => null },
    { getMovieProviders: async () => null, getTVProviders: async () => null },
    { findByUserAndContentIds: async () => [], findByUser: async () => [] }, tvRead,
    undefined, undefined, { get: () => ({ related: () => [] }) }
  );

  // after every module is loaded: mongoose schemas keep the real Date
  if (process.env.FROZEN_NOW) { // parity runs: identical clock in every arm, so time-derived fields (liveNow, airtime score) compare exactly
    const T = new Date(process.env.FROZEN_NOW).getTime(); const RealDate = Date;
    globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [T])); } static now() { return T; } };
  }
  const date = DateUtils.getTodayYYYYMMDD();
  const probe = await TVReadAiringModel.findOne({ date }).lean().exec();
  if (!probe) throw new Error('fixture missing');
  const programId = (await TVReadAiringModel.findOne({ date, 'channel.sortOrder': 3 }).lean().exec()).id;
  const listParams = (genre) => ({ types: ['program'], sort: 'airtime', limit: 8, ...(genre ? { genres: [genre] } : {}) });
  const genres = ['Cine', 'Series', 'Deportes', 'Documentales', 'Informativos', 'Entretenimiento', 'Infantil', 'Magazine'];

  const hist = monitorEventLoopDelay({ resolution: 5 }); hist.enable();
  const gc = { count: 0, totalMs: 0, maxMs: 0, major: 0 };
  const gcObs = new PerformanceObserver((list) => { for (const e of list.getEntries()) { gc.count += 1; gc.totalMs += e.duration; gc.maxMs = Math.max(gc.maxMs, e.duration); if (e.detail && e.detail.kind === perfConstants.NODE_PERFORMANCE_GC_MAJOR) gc.major += 1; } });
  gcObs.observe({ entryTypes: ['gc'] });
  let last = performance.now(); let maxLate = 0; const lates = [];
  const drift = setInterval(() => { const now = performance.now(); const late = now - last - 5; last = now; if (late > maxLate) maxLate = late; if (late >= 50) lates.push(Math.round(late)); }, 5);
  let peakHeap = 0; const mem = setInterval(() => { peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed); }, 20);

  const timed = async (fn) => { const t = performance.now(); const value = await fn(); return { value, ms: performance.now() - t }; };
  const enrich = () => service.getDetailEnrichment(`program:${programId}`);
  const list = (genre) => service.query(listParams(genre));
  const clearAll = () => { store.clear(); l1Cache.invalidatePrefix(''); };

  // Warm-up that does not belong to the measurement: connection + pool + model compile (no fixture reads that fill the caches).
  await TVReadAiringModel.findOne({ id: 'nope' }).lean().exec();
  if (scenario.endsWith('_warm_redis')) {
    // Fill the "Redis" layer, then drop only the in-process L1 (the day view never lives in L1 anyway).
    if (scenario === 'list_warm_redis') await list(); else await enrich();
    l1Cache.invalidatePrefix('');
  }
  Object.assign(cmd, { find: 0, count: 0, other: 0, docs: 0 });
  const cpu0 = process.cpuUsage(); const elu0 = performance.eventLoopUtilization(); const t0 = performance.now(); last = performance.now();
  const results = {};
  if (scenario === 'list_cold' || scenario === 'list_warm_redis') results.list = await timed(() => list());
  else if (scenario === 'enrich_cold' || scenario === 'enrich_warm_redis') results.enrich = await timed(enrich);
  else if (scenario === 'pair_cold') { const [a, b] = await Promise.all([timed(enrich), timed(() => list())]); results.enrich = a; results.list = b; }
  else if (scenario === 'pair_distinct_genres') {
    // A crawl over programme pages of different genres: every page fires the pair with its own genre filter (a new cache key).
    const rounds = [];
    for (const genre of genres) { const [a, b] = await Promise.all([timed(enrich), timed(() => list(genre))]); rounds.push({ genre, enrichMs: Math.round(a.ms), listMs: Math.round(b.ms) }); }
    results.rounds = rounds;
  } else if (scenario === 'list_movie_cold') results.list = await timed(() => service.query({ types: ['movie'], sort: 'airtime', limit: 8 }));
  const wallMs = performance.now() - t0; const cpu = process.cpuUsage(cpu0); const elu = performance.eventLoopUtilization(elu0);
  await new Promise((r) => setTimeout(r, 30));
  clearInterval(drift); clearInterval(mem); hist.disable(); gcObs.disconnect();
  const digest = createHash('sha256').update(JSON.stringify([results.list?.value ?? null, results.enrich?.value ?? null])).digest('hex');
  const slim = (r) => (r ? { ms: Math.round(r.ms) } : undefined);
  console.log(JSON.stringify({
    scenario, wallMs: Math.round(wallMs), cpuMs: Math.round((cpu.user + cpu.system) / 1000), elu: Math.round(elu.utilization * 100) / 100,
    maxStallMs: Math.round(maxLate), stalls50: lates, loopP99Ms: Math.round(hist.percentile(99) / 1e6), loopMaxMs: Math.round(hist.max / 1e6),
    gc: { count: gc.count, totalMs: Math.round(gc.totalMs), maxMs: Math.round(gc.maxMs), major: gc.major },
    peakHeapMb: Math.round(peakHeap / 1048576), mongo: cmd,
    listMs: slim(results.list)?.ms, enrichMs: slim(results.enrich)?.ms, rounds: results.rounds,
    listItems: results.list?.value?.items?.length, listTotal: results.list?.value?.meta?.total, enrichRelated: results.enrich?.value?.related?.length,
    digest,
    store: [...store].map(([k, v]) => { const t = performance.now(); JSON.parse(v); return { key: k.slice(0, 70), bytes: v.length, parseMs: Math.round((performance.now() - t) * 10) / 10 }; }).sort((a, b) => b.bytes - a.bytes).slice(0, 4),
    phases: catalogueDiagnosticsSnapshot(),
    steps: [...stepTimelineSnapshot().startup, ...stepTimelineSnapshot().recent].map((s) => ({ step: s.step, ms: Math.round(s.durationMs ?? 0) })).slice(0, 12),
  }));
  await mongoose.disconnect();
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------- parent
const backend = resolve(arg('backend', 'apps/backend'));
const rowSizes = arg('rows', '2600,20000').split(',').map(Number);
const runs = Number(arg('runs', '5'));
const port = Number(arg('port', '27119'));
const label = arg('label', 'run');
const frozenNow = new Date().toISOString();
const scenarios = (arg('scenarios', SCENARIOS.join(','))).split(',');
const out = arg('out', join(here, `bench-${label}.json`));
const sh = (args, opts = {}) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
try { sh(['rm', '-f', CONTAINER]); } catch { /* none */ }
sh(['run', '-d', '--name', CONTAINER, '-p', `127.0.0.1:${port}:27017`, 'mongo:8', '--quiet']);
const reqParent = createRequire(join(backend, 'package.json'));
const mongoose = reqParent('mongoose');
const uri = `mongodb://127.0.0.1:${port}`;
for (let i = 0; i < 60; i += 1) { try { await mongoose.connect(uri, { serverSelectionTimeoutMS: 1000 }); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
const report = { label, node: process.version, backend, startedAt: new Date().toISOString(), cache: 'in-memory JSON round-trip (Valkey stand-in)', sizes: {} };
try {
  const { DateUtils } = reqParent(join(backend, 'dist/shared/utils/dateUtils.js'));
  const { TVReadAiringModel } = reqParent(join(backend, 'dist/infrastructure/database/models/TVReadAiring.model.js'));
  for (const rows of rowSizes) {
    const dbName = `m13b5_${rows}`;
    await mongoose.connection.useDb(dbName).dropDatabase();
    await mongoose.disconnect(); await mongoose.connect(uri, { dbName });
    await TVReadAiringModel.syncIndexes();
    const date = DateUtils.getTodayYYYYMMDD();
    const docs = buildRows(rows, date);
    for (let i = 0; i < docs.length; i += 2000) await TVReadAiringModel.collection.insertMany(docs.slice(i, i + 2000));
    const channelCount = Number(arg('channels', '1500'));
    if (channelCount) {
      const { ChannelModel } = reqParent(join(backend, 'dist/infrastructure/database/models/Channel.model.js'));
      await ChannelModel.collection.insertMany(Array.from({ length: channelCount }, (_, i) => ({ id: `ch${i}`, name: `Canal ${i}`, normalizedName: `canal ${i}`, aliases: [`canal ${i}`, `ch${i}`, `Canal ${i} HD`, `C${i}`], sourceIds: [`src-${i}`, `epg-${i}`], logo: `/logos/ch${i}.webp`, type: 'TDT', country: 'España', countryCode: 'ES', region: i % 3 ? 'nacional' : 'Madrid', language: 'es', category: 'general', description: 'Canal sintético '.repeat(8), distribution: 'terrestrial', access: 'free', operator: 'x', providers: ['p1', 'p2'], contentFacets: ['general'], market: { country: 'España', countryCode: 'ES', region: 'nacional', scope: 'national' }, quality: { resolution: 'hd', timeshift: 'none' }, capabilities: { linear: 'yes', catchup: 'no', streaming: 'no' }, provenance: { classification: 'synthetic', sourceIds: [`src-${i}`] }, active: true, order: i, createdAt: new Date(), updatedAt: new Date() })));
    }
    report.channels = channelCount;
    const stats = await mongoose.connection.db.command({ collStats: 'tv_read_airings' });
    report.sizes[rows] = { avgObjSizeBytes: Math.round(stats.avgObjSize), scenarios: {} };
    for (const scenario of scenarios) {
      const list = [];
      for (let r = 0; r < runs; r += 1) {
        const text = await new Promise((resolveRun, reject) => {
          const child = spawn(process.execPath, [...(arg('prof') ? ['--cpu-prof', '--cpu-prof-dir', arg('prof'), '--cpu-prof-interval', '500'] : []), fileURLToPath(import.meta.url), '--child', backend, '--uri', uri, '--db', dbName, '--scenario', scenario], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, TZ: 'Europe/Madrid', CHANNELS: arg('channels', '1500'), ...(process.argv.includes('--frozen') ? { FROZEN_NOW: frozenNow } : {}) } });
          let buf = ''; child.stdout.on('data', (d) => { buf += d; }); child.on('exit', (code) => (code === 0 ? resolveRun(buf) : reject(new Error(`child ${scenario} exit ${code}`))));
        });
        list.push(JSON.parse(text.trim().split('\n').pop()));
      }
      report.sizes[rows].scenarios[scenario] = list;
      const med = (k) => list.map((x) => x[k]).sort((a, b) => a - b)[Math.floor(list.length / 2)];
      console.log(`${rows} rows ${scenario}: maxStall med ${med('maxStallMs')} ms, cpu med ${med('cpuMs')} ms, wall med ${med('wallMs')} ms, digest ${new Set(list.map((x) => x.digest)).size === 1 ? 'stable' : 'UNSTABLE'}`);
    }
  }
} finally {
  await mongoose.disconnect().catch(() => {});
  try { sh(['rm', '-f', CONTAINER]); } catch { /* ignore */ }
  writeFileSync(out, JSON.stringify(report, null, 1));
}
