import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import {
  catalogueDiagnosticsSnapshot,
  catalogueShape,
  recordCatalogueQuery,
  resetCatalogueDiagnostics,
} from './catalogueDiagnostics';
import { addPhaseReport, formatServerTiming, withRequestTiming, type RequestTimingContext } from './performanceTiming';

beforeEach(() => resetCatalogueDiagnostics());

const stat = (wallMs: number, count = 1, sumMs = wallMs) => ({ count, wallMs, sumMs, maxMs: wallMs });
const shape = catalogueShape({ types: ['movie', 'series'], availability: ['streaming'], sort: 'popular', page: 1, limit: 12 });

test('only misses feed the per-phase aggregates; hits are counted with their own totals', () => {
  recordCatalogueQuery({ outcome: 'miss', totalMs: 400, phases: { providers: stat(300, 16, 2_400), cache_lookup: stat(2) }, shape });
  recordCatalogueQuery({ outcome: 'cache_hit', totalMs: 3, phases: { cache_lookup: stat(3) }, shape });
  recordCatalogueQuery({ outcome: 'l1_hit', totalMs: 0.1, phases: {}, shape });
  const snap = catalogueDiagnosticsSnapshot() as any;
  assert.deepEqual(snap.queries, { l1_hit: 1, cache_hit: 1, miss: 1, error: 0 });
  assert.deepEqual(Object.keys(snap.missPhasesWallMs).sort(), ['cache_lookup', 'providers']);
  assert.equal(snap.missPhasesWallMs.providers.p50, 300);
  assert.equal(snap.totalMs.cache_hit.max, 3);
});

test('percentiles are computed over a bounded sample (the oldest samples leave the window)', () => {
  for (let i = 1; i <= 250; i += 1) recordCatalogueQuery({ outcome: 'miss', totalMs: i, phases: { tmdb_discover: stat(i) }, shape, slowMs: 1e9 });
  const snap = catalogueDiagnosticsSnapshot() as any;
  assert.equal(snap.queries.miss, 250, 'the counter is monotonic');
  assert.equal(snap.totalMs.miss.count, 200, 'the sample is capped');
  assert.equal(snap.totalMs.miss.p50, 150);
  assert.equal(snap.totalMs.miss.max, 250);
});

test('slow queries are kept in a bounded list and their log lines are rate limited', () => {
  for (let i = 0; i < 30; i += 1) recordCatalogueQuery({ outcome: 'miss', totalMs: 5_000 + i, phases: { providers: stat(4_000) }, shape });
  const snap = catalogueDiagnosticsSnapshot() as any;
  assert.equal(snap.slow.length, 20);
  assert.equal(snap.slow.at(-1).totalMs, 5_029);
  // 6 lines per minute are logged; the rest are only counted (up to 6 more if the minute rolls over mid-test).
  assert.ok(snap.suppressedLogs >= 18 && snap.suppressedLogs <= 24, String(snap.suppressedLogs));
});

test('the stored shape never holds search text, user ids or raw values (redaction)', () => {
  const dirty = catalogueShape({ types: ['movie', "x'; drop"], availability: ['streaming'], sort: 'popular<script>', q: 'secret title', userId: 'user-123', platforms: ['netflix'], genres: [] });
  const json = JSON.stringify(dirty);
  assert.ok(!json.includes('secret') && !json.includes('user-123') && !json.includes('<script>') && !json.includes("'"));
  assert.equal(dirty.hasQuery, true);
  assert.equal(dirty.authenticated, true);
  recordCatalogueQuery({ outcome: 'miss', totalMs: 9_000, phases: {}, shape: dirty });
  assert.ok(!JSON.stringify(catalogueDiagnosticsSnapshot()).includes('user-123'));
});

test('malformed input never throws into the caller (safe failure)', () => {
  assert.doesNotThrow(() => recordCatalogueQuery({ outcome: 'miss', totalMs: 5_000, phases: null as any, shape }));
  assert.doesNotThrow(() => recordCatalogueQuery({ outcome: 'bogus' as any, totalMs: 1, phases: {}, shape }));
});

test('phase keys are capped so a bug cannot create unbounded metric cardinality', () => {
  const phases = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`p${i}`, stat(1)]));
  recordCatalogueQuery({ outcome: 'miss', totalMs: 1, phases, shape, slowMs: 1e9 });
  assert.equal(Object.keys((catalogueDiagnosticsSnapshot() as any).missPhasesWallMs).length, 24);
});

test('addPhaseReport feeds Server-Timing: wall as dur, parallel work in desc, existing entries untouched', () => {
  const ctx: RequestTimingContext = { phases: new Map([['db', 12.5]]) };
  withRequestTiming(ctx, () => {
    addPhaseReport('cat_', { providers: stat(210, 16, 2_900), parallel: stat(400), total: stat(450) });
  });
  const header = formatServerTiming(ctx, 460);
  assert.ok(header.startsWith('db;dur=12.5, '), header);
  assert.match(header, /cat_providers;dur=210\.0;desc="n=16 sum=2900\.0"/);
  assert.match(header, /cat_parallel;dur=400\.0(,|$)/);
  assert.match(header, /total;dur=460\.0$/);
});

test('Server-Timing is byte-identical to before when no phase report was added', () => {
  const ctx: RequestTimingContext = { phases: new Map([['db', 1.25], ['epg', 3]]), cache: 'miss' };
  assert.equal(formatServerTiming(ctx, 9.04), 'db;dur=1.3, epg;dur=3.0, cache-miss;dur=0, total;dur=9.0');
});

test('addPhaseReport outside a request is a no-op', () => {
  assert.doesNotThrow(() => addPhaseReport('cat_', { x: stat(1) }));
});
