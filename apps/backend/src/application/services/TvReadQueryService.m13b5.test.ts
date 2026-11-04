import test from 'node:test';
import assert from 'node:assert/strict';
import { TvReadQueryService } from './TvReadQueryService';
import { CatalogService } from './CatalogService';
import { TVReadAiringModel } from '@/infrastructure/database/models/TVReadAiring.model';
import { l1Cache } from '@/infrastructure/cache/L1Cache';
import type { TvReadItemDTO } from '../dto/TvReadDTO';
import { withRequestTiming, type RequestTimingContext } from '@/shared/utils/performanceTiming';

// M13-B5b: `includeChannels: false` must return exactly the same `items` as the default, while no longer building the
// channel summaries (a second full sort of the page plus per-channel scans) that those callers discard.
const NAMES = ['Álamo TV', 'alamo tv', 'Ñandú', 'Nandu', 'Zeta', 'ábaco', 'Canal 10', 'Canal 2', 'La 1', 'La 2'];

function row(n: number): TvReadItemDTO {
  const channelName = NAMES[n % NAMES.length]!;
  const start = new Date(Date.UTC(2026, 10, 4, 6, 0) + (n % 7) * 3_600_000).toISOString();
  const end = new Date(new Date(start).getTime() + 3_600_000).toISOString();
  return {
    id: `a${n}`,
    channel: { id: `ch${n % NAMES.length}`, name: channelName, normalizedName: channelName.toLowerCase(), aliases: ['x'], sourceIds: ['s'], type: 'TDT', group: n % 3 ? 'tdt' : 'pay', subgroups: [], sortOrder: n % 4 },
    program: { brandKey: `b${n}`, title: `Programa ${n}`, normalizedTitle: `programa ${n}`, titleAliases: ['a'], editorialCategory: n % 2 ? 'Cine' : 'Series', tmdbId: n % 5 ? undefined : n, description: 'd'.repeat(500), titleResolutionState: 'resolved' },
    airing: { id: `a${n}`, date: '20261104', start, end, durationMinutes: 60, liveNow: false, partOfDay: 'manana', timeSlotKey: '06:00' },
    assets: { primary: undefined, poster: { kind: 'poster', role: 'primary', source: 'tmdb_poster', url: `https://img/${n}.jpg` }, fallbackChain: [{}, {}, {}] },
    availability: { live: true, catchup: false, streaming: false },
    sourceProvenance: { schedule: ['epg'], metadata: [], assets: [] },
    timingContext: { start, end, liveNow: false, window: 'today' },
    relevance: { score: n % 9, reason: 'synthetic' },
    trustDecision: { confidence: 'high', sourceAgreement: 'single_source', featuredSuppressed: false, reasons: [] },
  } as unknown as TvReadItemDTO;
}

function withStubbedModel<T>(rows: TvReadItemDTO[], run: () => Promise<T>): Promise<T> {
  const model = TVReadAiringModel as any;
  const originalFind = model.find;
  const originalCount = model.countDocuments;
  model.find = () => {
    const chain: any = { sort: () => chain, skip: () => chain, limit: () => chain, select: () => chain, lean: () => chain, exec: async () => rows.map((r) => structuredClone(r)) };
    return chain;
  };
  model.countDocuments = () => ({ exec: async () => rows.length });
  return run().finally(() => { model.find = originalFind; model.countDocuments = originalCount; });
}

const memoryCache = () => {
  const store = new Map<string, unknown>();
  return { get: async (k: string) => (store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null), set: async (k: string, v: unknown) => { store.set(k, v); }, clear: async () => undefined } as any;
};

test('includeChannels:false returns byte-identical items to the default and skips the channel summaries', async () => {
  const rows = Array.from({ length: 60 }, (_, n) => row(n));
  await withStubbedModel(rows, async () => {
    const service = new TvReadQueryService(memoryCache());
    let summaryBuilds = 0;
    const original = (service as any).buildChannelSummaries.bind(service);
    (service as any).buildChannelSummaries = (...args: unknown[]) => { summaryBuilds += 1; return original(...args); };

    l1Cache.invalidatePrefix('');
    const full = await service.query({ view: 'day', date: '20261104', limit: 2400 });
    assert.equal(summaryBuilds, 1);
    assert.ok(full.channels.length > 0);

    l1Cache.invalidatePrefix('');
    const lean = await service.query({ view: 'day', date: '20261104', limit: 2400, includeChannels: false });
    assert.equal(summaryBuilds, 1, 'includeChannels:false must not build the summaries');
    assert.deepEqual(lean.channels, []);
    assert.equal(JSON.stringify(lean.items), JSON.stringify(full.items));
    assert.deepEqual(lean.meta.total, full.meta.total);
  });
});

test('the day ordering is unchanged by the shared collator (accents, case, ties)', async () => {
  const rows = Array.from({ length: 80 }, (_, n) => row(n));
  await withStubbedModel(rows, async () => {
    const service = new TvReadQueryService(memoryCache());
    l1Cache.invalidatePrefix('');
    const { items } = await service.query({ view: 'day', date: '20261104', limit: 2400, includeChannels: false });
    // Reference: the comparator exactly as it was before M13-B5b (a collator per comparison through localeCompare).
    const groupOrder = (g: string) => (g === 'tdt' ? 0 : 1);
    const reference = rows
      .map((r) => structuredClone(r))
      .sort((l, r) =>
        groupOrder(l.channel.group) - groupOrder(r.channel.group) ||
        l.channel.sortOrder - r.channel.sortOrder ||
        String(l.channel.name || '').localeCompare(String(r.channel.name || ''), 'es', { sensitivity: 'base' }) ||
        new Date(l.airing.start).getTime() - new Date(r.airing.start).getTime())
      .map((r) => r.id);
    // Same relative order as the reference whenever the group order matches the service's (tdt before pay).
    const actualIds = items.map((i) => i.id);
    assert.equal(actualIds.length, reference.length);
    const sameSet = new Set(actualIds);
    assert.equal(sameSet.size, reference.length);
    const channelNameOrder = (ids: string[]) => ids.map((id) => rows.find((r) => r.id === id)!.channel.name);
    assert.deepEqual(channelNameOrder(actualIds), channelNameOrder(reference));
  });
});

test('the catalogue reads only `items`: every tvread call of CatalogService opts out of the channel summaries', async () => {
  const calls: any[] = [];
  const tvRead = {
    query: async (params: any) => { calls.push(params); return { items: [], channels: [], meta: {} }; },
    getItem: async () => { throw new Error('unused'); },
  } as any;
  const service = new CatalogService({ findAll: async () => [] } as any, memoryCache(), {} as any, {} as any, {} as any, tvRead);
  l1Cache.invalidatePrefix('');
  await service.query({ types: ['program'], sort: 'airtime', limit: 7 });
  await (service as any).loadRelatedForTvReadItem(row(1));
  assert.ok(calls.length >= 2);
  for (const call of calls) assert.equal(call.includeChannels, false, JSON.stringify(call));
});

test('M13-B5a: a day read reports its synchronous phases to Server-Timing and a failure of them changes nothing', async () => {
  const rows = Array.from({ length: 20 }, (_, n) => row(n));
  await withStubbedModel(rows, async () => {
    const service = new TvReadQueryService(memoryCache());
    l1Cache.invalidatePrefix('');
    const ctx: RequestTimingContext = { phases: new Map() };
    const response = await new Promise<Awaited<ReturnType<TvReadQueryService['query']>>>((resolve, reject) =>
      withRequestTiming(ctx, () => { service.query({ view: 'day', date: '20261104', limit: 2400, includeChannels: false }).then(resolve, reject); }));
    assert.equal(response.items.length, 20);
    for (const phase of ['transform', 'tv_cache_set', 'epg']) assert.ok(ctx.phases.has(phase), `missing ${phase}: ${[...ctx.phases.keys()]}`);
    // The cached hit path is timed as well and returns the same items.
    l1Cache.invalidatePrefix('');
    const again = await service.query({ view: 'day', date: '20261104', limit: 2400, includeChannels: false });
    assert.equal(JSON.stringify(again.items), JSON.stringify(response.items));
  });
});

test('M13-B5c: the channel map is read only when an item has airings but no channel, and then yields the same result', async () => {
  let findAllCalls = 0;
  const channels = { findAll: async () => { findAllCalls += 1; return [{ id: 'ch1', toJSON: () => ({ id: 'ch1', icon: '/logos/ch1.webp' }) }]; } } as any;
  const tvItem = { ...row(1), program: { ...row(1).program, tmdbId: undefined, editorialCategory: 'Otros' } } as TvReadItemDTO;
  const tvRead = { query: async () => ({ items: [tvItem], channels: [], meta: {} }) } as any;
  const build = () => new CatalogService(channels, memoryCache(), {} as any, {} as any, {} as any, tvRead);

  // Program items carry their channel: no read at all.
  l1Cache.invalidatePrefix('');
  const normal = await build().query({ types: ['program'], sort: 'airtime', limit: 5 });
  assert.equal(normal.items.length, 1);
  assert.equal(findAllCalls, 0);

  // An item with airings and no channel still takes its icon from the map, as before.
  l1Cache.invalidatePrefix('');
  const service = build();
  const original = service.mapTvReadItemToCatalogItem.bind(service);
  (service as any).mapTvReadItemToCatalogItem = (item: TvReadItemDTO) => ({ ...original(item), channel: undefined });
  const withMap = await service.query({ types: ['program'], sort: 'airtime', limit: 6 });
  assert.equal(findAllCalls, 1);
  assert.equal(withMap.items[0]?.channel?.id, 'ch1');
});
