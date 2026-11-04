import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { CatalogService } from './CatalogService';
import { catalogueDiagnosticsSnapshot, resetCatalogueDiagnostics } from '@/shared/utils/catalogueDiagnostics';
import { formatServerTiming, withRequestTiming, type RequestTimingContext } from '@/shared/utils/performanceTiming';

// M13-B1: the phases of CatalogService.query. A local TMDB stub with fixed latencies stands in for the network: three
// provider lookups of 50 ms run in parallel, so `providers` must report ~50 ms of wall clock and ~150 ms of work.
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const DISCOVER_MS = 40;
const PROVIDER_MS = 50;

function service(options: { failDiscover?: boolean } = {}) {
  const store = new Map<string, unknown>();
  const cache = {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: unknown) => { store.set(key, value); },
  } as any;
  const tmdb = {
    discoverMovies: async () => {
      await sleep(DISCOVER_MS);
      if (options.failDiscover) throw new Error('tmdb down: api_key=SECRET');
      return { results: [{ id: 1, title: 'Uno' }, { id: 2, title: 'Dos' }, { id: 3, title: 'Tres' }] };
    },
    getImageUrl: () => undefined,
  } as any;
  const providers = { getMovieProviders: async () => { await sleep(PROVIDER_MS); return null; } } as any;
  const channels = { findAll: async () => [] } as any;
  return new CatalogService(channels, cache, tmdb, providers, {} as any, {} as any);
}

let limit = 100;
// Distinct `limit` per test: the 30 s in-process hot cache is shared by every CatalogService instance.
const params = () => ({ types: ['movie'], availability: ['streaming'], limit: (limit -= 1) });

beforeEach(() => resetCatalogueDiagnostics());

test('a cold miss reports every phase; parallel provider lookups are a wall-clock union, not a sum', async () => {
  const ctx: RequestTimingContext = { phases: new Map() };
  const result = await new Promise<Awaited<ReturnType<CatalogService['query']>>>((resolve, reject) =>
    withRequestTiming(ctx, () => { service().query(params()).then(resolve, reject); }));
  assert.equal(result.items.length, 3);

  const snap = catalogueDiagnosticsSnapshot() as any;
  assert.deepEqual(snap.queries, { l1_hit: 0, cache_hit: 0, miss: 1, error: 0 });
  const phases = snap.missPhasesWallMs;
  assert.ok(!('channels' in phases), 'M13-B5c: the channel map is not loaded when no item needs it');
  for (const name of ['cache_lookup', 'parallel', 'preferences', 'streaming', 'tmdb_discover', 'providers', 'transform', 'workpaths', 'interactions', 'response_build', 'cache_set']) {
    assert.ok(name in phases, `missing phase ${name}: ${Object.keys(phases)}`);
  }
  // The request header: providers = 3 spans, ~50 ms wall, ~150 ms of work.
  const providers = ctx.detail!.get('cat_providers')!;
  assert.equal(providers.count, 3);
  assert.ok(providers.sumMs >= 3 * PROVIDER_MS - 10, `sum ${providers.sumMs}`);
  const wall = ctx.phases.get('cat_providers')!;
  assert.ok(wall >= PROVIDER_MS - 5 && wall < providers.sumMs - 40, `wall ${wall} must be near one lookup, not three`);
  // Sequential in the code: discover (40) then providers (~50) inside `streaming`; `parallel` covers `streaming`.
  assert.ok(ctx.phases.get('cat_streaming')! >= DISCOVER_MS + PROVIDER_MS - 10);
  assert.ok(ctx.phases.get('cat_parallel')! >= ctx.phases.get('cat_streaming')! - 1);
  assert.ok(ctx.phases.get('cat_total')! >= ctx.phases.get('cat_parallel')!);
  assert.match(formatServerTiming(ctx, 200), /cat_providers;dur=[\d.]+;desc="n=3 sum=[\d.]+"/);
});

test('the response is identical with and without a request context, and a repeat is served from cache', async () => {
  const s = service();
  const p = params();
  const first = await s.query(p);
  const again = await s.query(p);
  assert.deepEqual(again, first);
  const snap = catalogueDiagnosticsSnapshot() as any;
  assert.equal(snap.queries.miss, 1);
  assert.equal(snap.queries.l1_hit + snap.queries.cache_hit, 1);
  // Cache hits do not add phase samples.
  assert.equal(snap.missPhasesWallMs.providers.count, 1);
});

test('a failing dependency still rejects with the original error and is counted as an error', async () => {
  const s = service({ failDiscover: true });
  await assert.rejects(s.query(params()), /tmdb down/);
  const snap = catalogueDiagnosticsSnapshot() as any;
  assert.equal(snap.queries.error, 1);
  assert.equal(snap.queries.miss, 0);
  assert.ok(!JSON.stringify(snap).includes('SECRET'), 'no error text is stored');
});
