import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TvReadQueryService,
  buildTvReadChannelDirectoryPipeline,
  buildTvReadChannelGroupClause,
  buildTvReadSchedulePipeline,
  applyTvReadTemporalBounds,
  airingsNotEnded,
  hydrateTvReadItemRuntime,
  isConsumerVisibleTvReadItem,
  isFeaturedTvReadItem,
  normalizeTvReadView,
  resolveTvReadLimit,
  resolveTvReadItemsPerChannel,
  scopeChannelSummariesToPage,
  selectPrimeTimeTvItems,
} from './TvReadQueryService';
import { TvReadItemDTO } from '../dto/TvReadDTO';

test('normalizeTvReadView falls back to day for invalid input', () => {
  assert.equal(normalizeTvReadView('invalid'), 'day');
  assert.equal(normalizeTvReadView(undefined), 'day');
});

test('channel schedule pipeline bounds each channel instead of truncating the global guide', () => {
  const pipeline = buildTvReadSchedulePipeline({
    date: '20260326',
    group: 'movistar',
    category: 'Deportes',
    itemsPerChannel: 32,
  });

  assert.deepEqual(pipeline[0], {
    $match: {
      date: '20260326',
      'channel.id': { $type: 'string', $ne: '' },
      'trustDecision.consumerSuppressed': { $ne: true },
      'program.titleResolutionState': {
        $nin: ['generic_unresolved', 'generic_suppressed'],
      },
      'program.editorialCategory': 'Deportes',
      $and: [buildTvReadChannelGroupClause('movistar')],
    },
  });
  assert.equal(pipeline.some((stage) => '$limit' in stage), false);
  assert.deepEqual(pipeline.at(-1), {
    $project: {
      _id: 0,
      channel: 1,
      total: 1,
      items: { $slice: ['$items', 32] },
    },
  });
});

test('channel schedule supports complete high-frequency linear channels', () => {
  assert.equal(resolveTvReadItemsPerChannel(144), 144);
  assert.equal(resolveTvReadItemsPerChannel(999), 192);
});

test('resolveTvReadLimit keeps the canonical day feed complete enough for all groups', () => {
  assert.equal(resolveTvReadLimit('day', undefined), 240);
  assert.equal(resolveTvReadLimit('day', 5000), 5000);
  assert.equal(resolveTvReadLimit('day', 99999), 5000);
});

test('resolveTvReadLimit keeps hot paths bounded', () => {
  assert.equal(resolveTvReadLimit('now', 99999), 500);
  assert.equal(resolveTvReadLimit('search', undefined), 60);
  assert.equal(resolveTvReadLimit('night', 1200), 1200);
});

test('channel directory is independently aggregated and remains complete beyond 5000 mixed rows', async () => {
  const rows = Array.from({ length: 5002 }, (_, index) => ({
    channel: {
      id: `channel_${index}`,
      name: `Channel ${index}`,
      normalizedName: `channel_${index}`,
      aliases: [],
      sourceIds: [`source_${index}`],
      type: index % 2 ? 'Cable' : 'Movistar',
      group: index % 2 ? 'cable' : 'movistar',
      subgroups: [],
      sortOrder: index,
      distribution: index % 2 ? 'cable' : 'operator',
      access: 'pay',
      operator: index % 2 ? 'unknown' : 'Movistar Plus+',
      providers: index % 2 ? [] : ['Movistar Plus+'],
      contentFacets: ['general'],
      market: {
        country: 'España',
        countryCode: 'ES',
        region: 'España',
        scope: 'national',
      },
      quality: { resolution: 'unknown', timeshift: 'unknown' },
      capabilities: { linear: true, catchup: 'unknown', streaming: 'unknown' },
      provenance: { classification: 'registry', sourceIds: [`source_${index}`] },
    },
    total: 12,
    live: 1,
    tonight: 2,
  }));
  let capturedPipeline: Record<string, any>[] = [];
  const fakeModel = {
    aggregate: (pipeline: Record<string, any>[]) => {
      capturedPipeline = pipeline;
      return { exec: async () => rows };
    },
  };
  const service = new TvReadQueryService(
    {
      get: async () => null,
      set: async () => undefined,
      clear: async () => undefined,
    } as any,
    fakeModel as any
  );

  const result = await service.getChannels('20260326');

  assert.equal(result.channels.length, 5002);
  assert.equal(result.meta.total, 5002);
  assert.equal(result.channels.some((entry) => entry.channel.group === 'cable'), true);
  assert.equal(result.channels.some((entry) => entry.channel.group === 'movistar'), true);
  assert.equal(capturedPipeline.some((stage) => '$limit' in stage), false);
  assert.equal(JSON.stringify(capturedPipeline).includes('currentItems'), true);
  assert.equal(JSON.stringify(capturedPipeline).includes('nextItems'), true);
  assert.deepEqual(buildTvReadChannelDirectoryPipeline('20260326', 'movistar')[0], {
    $match: {
      date: '20260326',
      'channel.id': { $type: 'string', $ne: '' },
      'trustDecision.consumerSuppressed': { $ne: true },
      'program.titleResolutionState': {
        $nin: ['generic_unresolved', 'generic_suppressed'],
      },
      $and: [buildTvReadChannelGroupClause('movistar')],
    },
  });
});

test('channel directory can be bounded for compact discovery surfaces without changing the complete default', () => {
  const reference = new Date('2026-03-26T11:00:00.000Z');
  const bounded = buildTvReadChannelDirectoryPipeline('20260326', 'tdt', reference, 6);
  const complete = buildTvReadChannelDirectoryPipeline('20260326', 'tdt', reference);

  assert.deepEqual(bounded.at(-1), { $limit: 6 });
  assert.equal(complete.some((stage) => '$limit' in stage), false);
});

test('Movistar and sports filters use orthogonal provider and content facets', () => {
  assert.deepEqual(buildTvReadChannelGroupClause('movistar'), {
    $or: [
      { 'channel.group': 'movistar' },
      { 'channel.operator': 'Movistar Plus+' },
      { 'channel.providers': 'Movistar Plus+' },
    ],
  });
  assert.deepEqual(buildTvReadChannelGroupClause('deporte'), {
    $or: [
      { 'channel.group': 'deporte' },
      { 'channel.contentFacets': 'sports' },
    ],
  });
});

test('applyTvReadTemporalBounds restricts now reads to active airings in Mongo', () => {
  const reference = new Date('2026-03-26T11:00:00.000Z');
  assert.deepEqual(applyTvReadTemporalBounds({ date: '20260326' }, 'now', reference), {
    date: '20260326',
    'airing.start': { $lte: '2026-03-26T11:00:00.000Z' },
    'airing.end': { $gt: '2026-03-26T11:00:00.000Z' },
  });
  assert.deepEqual(applyTvReadTemporalBounds({ date: '20260326' }, 'day', reference), {
    date: '20260326',
  });
});

test('scopeChannelSummariesToPage keeps hot-view payloads aligned with paged items', () => {
  const item = { channel: { id: 'la_1' } } as TvReadItemDTO;
  const summaries = [
    { channel: { id: 'la_1' } },
    { channel: { id: 'la_2' } },
  ] as any;
  assert.deepEqual(scopeChannelSummariesToPage('now', summaries, [item]), [summaries[0]]);
  assert.equal(scopeChannelSummariesToPage('day', summaries, [item]).length, 2);
});

test('hydrateTvReadItemRuntime derives liveNow from request time instead of persisted value', () => {
  const item: TvReadItemDTO = {
    id: '20260326_la_1_20260326113000',
    channel: {
      id: 'la_1',
      name: 'LA 1',
      normalizedName: 'la_1',
      aliases: ['la_1'],
      sourceIds: ['LA1.es'],
      type: 'TDT',
      group: 'tdt',
      subgroups: ['tdt'],
      sortOrder: 0,
    },
    program: {
      brandKey: 'telediario_matinal',
      title: 'Telediario Matinal',
      normalizedTitle: 'telediario matinal',
      titleAliases: ['telediario matinal'],
      editorialCategory: 'Noticias',
    },
    airing: {
      id: '20260326_la_1_20260326113000',
      date: '20260326',
      start: '2026-03-26T10:00:00.000Z',
      end: '2026-03-26T11:00:00.000Z',
      durationMinutes: 60,
      liveNow: false,
      partOfDay: 'manana',
      timeSlotKey: '11:00',
    },
    assets: { fallbackChain: [] },
    availability: {
      live: true,
      catchup: false,
      streaming: false,
    },
    sourceProvenance: {
      schedule: ['primary'],
      metadata: [],
      assets: [],
    },
    timingContext: {
      liveNow: false,
      window: 'today',
      start: '2026-03-26T10:00:00.000Z',
      end: '2026-03-26T11:00:00.000Z',
    },
    relevance: {
      score: 10,
      reason: 'channel_priority',
    },
  };

  const hydrated = hydrateTvReadItemRuntime(item, new Date('2026-03-26T10:30:00.000Z'));
  assert.equal(hydrated.airing.liveNow, true);
  assert.equal(hydrated.timingContext.liveNow, true);
});

test('isFeaturedTvReadItem excludes low-trust suppressed entries from guide surfaces', () => {
  const item = {
    trustDecision: {
      confidence: 'low',
      sourceAgreement: 'primary_only',
      featuredSuppressed: true,
      reasons: ['generic_title'],
    },
  } as TvReadItemDTO;

  assert.equal(isFeaturedTvReadItem(item), false);
});

test('isConsumerVisibleTvReadItem hides generic unresolved movie slots from consumer surfaces', () => {
  const suppressed = {
    program: {
      titleResolutionState: 'generic_unresolved',
    },
    trustDecision: {
      consumerSuppressed: true,
    },
  } as TvReadItemDTO;

  const visible = {
    program: {
      titleResolutionState: 'specific_source_title',
    },
    trustDecision: {
      consumerSuppressed: false,
    },
  } as TvReadItemDTO;

  assert.equal(isConsumerVisibleTvReadItem(suppressed), false);
  assert.equal(isConsumerVisibleTvReadItem(visible), true);
});

test('program sitemap rows exclude slugs that the indexed resolver cannot search', async () => {
  const rows = [
    {
      program: { title: 'The Gentlemen: Los señores de la mafia' },
      airing: { start: '2026-08-31T22:00:00.000Z' },
      searchTokens: ['gentlemen', 'senores', 'mafia'],
    },
    {
      program: { title: 'Tándem T4 E6' },
      airing: { start: '2026-09-01T18:20:00.000Z' },
      searchTokens: ['tandem', 't4', 'e6'],
    },
    {
      program: { title: '55' },
      airing: { start: '2026-08-31T06:22:00.000Z' },
      searchTokens: ['55'],
    },
  ];
  const fakeModel = {
    find: () => ({
      select: () => ({
        sort: () => ({ lean: () => ({ exec: async () => rows }) }),
      }),
    }),
  };
  const service = new TvReadQueryService({} as any, fakeModel as any);

  const result = await service.getIndexableProgramSitemapRows(['20260831', '20260901']);

  // M09-B: the folded slug "tandem-t4-e6" is searchable (token "tandem"); the legacy "tndem-t4-e6" was not.
  assert.deepEqual(result.map((row) => row.title), [
    'The Gentlemen: Los señores de la mafia',
    'Tándem T4 E6',
  ]);
});

test('query now collapses overlapping live rows into one featured item per channel', async () => {
  const tvReadQueryService = new TvReadQueryService({
    get: async () => null,
    set: async () => undefined,
    clear: async () => undefined,
  } as any);

  const baseItem = (title: string, start: string, score: number, withPoster = false): TvReadItemDTO => ({
    id: `id-${title}`,
    channel: {
      id: 'mega',
      name: 'Mega',
      normalizedName: 'mega',
      aliases: ['mega'],
      sourceIds: ['mega'],
      type: 'TDT',
      group: 'tdt',
      subgroups: ['tdt'],
      sortOrder: 8,
    },
    program: {
      brandKey: title.toLowerCase(),
      title,
      normalizedTitle: title.toLowerCase(),
      titleAliases: [title.toLowerCase()],
      editorialCategory: 'Otros',
    },
    airing: {
      id: `id-${title}`,
      date: '20260326',
      start,
      end: '2026-03-26T12:30:00.000Z',
      durationMinutes: 90,
      liveNow: true,
      partOfDay: 'manana',
      timeSlotKey: '11:00',
    },
    assets: withPoster
      ? {
          poster: {
            kind: 'poster',
            role: 'primary',
            source: 'epg_program_image',
            url: 'https://img/poster.jpg',
          },
          fallbackChain: [],
        }
      : { fallbackChain: [] },
    availability: { live: true, catchup: false, streaming: false },
    sourceProvenance: { schedule: ['primary'], metadata: [], assets: [] },
    timingContext: {
      liveNow: true,
      window: 'now',
      start,
      end: '2026-03-26T12:30:00.000Z',
    },
    relevance: { score, reason: 'test' },
  });

  const transformed = tvReadQueryService['applyViewTransform'](
    'now',
    [
      baseItem('Vida bajo cero', '2026-03-26T10:00:00.000Z', 12),
      baseItem('Mountain Men', '2026-03-26T09:30:00.000Z', 18, true),
    ],
    new Date('2026-03-26T11:00:00.000Z'),
    '20260326'
  );

  assert.equal(transformed.length, 1);
  assert.equal(transformed[0]?.program.title, 'Mountain Men');
});

test('selectPrimeTimeTvItems keeps one prime-time featured item per channel', () => {
  const buildItem = (id: string, channelId: string, title: string, start: string, end: string, options: {
    poster?: boolean;
    tmdbId?: number;
    score?: number;
  } = {}): TvReadItemDTO => ({
    id,
    channel: {
      id: channelId,
      name: channelId.toUpperCase(),
      normalizedName: channelId,
      aliases: [channelId],
      sourceIds: [channelId],
      type: 'TDT',
      group: 'tdt',
      subgroups: ['tdt'],
      sortOrder: channelId === 'la_1' ? 0 : 1,
    },
    program: {
      brandKey: title.toLowerCase(),
      title,
      normalizedTitle: title.toLowerCase(),
      titleAliases: [title.toLowerCase()],
      editorialCategory: 'Otros',
      tmdbId: options.tmdbId,
    },
    airing: {
      id,
      date: '20260326',
      start,
      end,
      durationMinutes: 60,
      liveNow: false,
      partOfDay: 'noche',
      timeSlotKey: '22:00',
    },
    assets: options.poster
      ? {
          primary: {
            kind: 'poster',
            role: 'primary',
            source: 'epg_program_image',
            url: 'https://img/poster.jpg',
          },
          poster: {
            kind: 'poster',
            role: 'primary',
            source: 'epg_program_image',
            url: 'https://img/poster.jpg',
          },
          fallbackChain: [],
        }
      : { fallbackChain: [] },
    availability: { live: true, catchup: false, streaming: false },
    sourceProvenance: { schedule: ['primary'], metadata: [], assets: [] },
    timingContext: { liveNow: false, window: 'tonight', start, end },
    relevance: { score: options.score ?? 0, reason: 'test' },
    trustDecision: {
      confidence: 'high',
      sourceAgreement: 'single_source',
      featuredSuppressed: false,
      reasons: [],
    },
  });

  const items = [
    buildItem('a', 'la_1', 'Telediario 2', '2026-03-26T20:55:00.000+01:00', '2026-03-26T21:40:00.000+01:00'),
    buildItem('b', 'la_1', 'La revuelta', '2026-03-26T21:45:00.000+01:00', '2026-03-26T23:00:00.000+01:00', { poster: true, tmdbId: 1, score: 10 }),
    buildItem('c', 'la_2', 'Cifras y letras', '2026-03-26T21:45:00.000+01:00', '2026-03-26T22:20:00.000+01:00', { score: 5 }),
    buildItem('d', 'la_2', 'Todo a la vez en todas partes', '2026-03-26T22:15:00.000+01:00', '2026-03-27T00:35:00.000+01:00', { poster: true, tmdbId: 2, score: 20 }),
  ];

  const selected = selectPrimeTimeTvItems(items, '20260326');

  assert.equal(selected.length, 2);
  assert.deepEqual(
    selected.map((item) => item.program.title),
    ['La revuelta', 'Todo a la vez en todas partes']
  );
});

test('selectPrimeTimeTvItems can require shows to start inside the prime-time window', () => {
  const buildItem = (id: string, title: string, start: string, end: string): TvReadItemDTO => ({
    id,
    channel: {
      id: 'la_sexta',
      name: 'La Sexta',
      normalizedName: 'la_sexta',
      aliases: ['la_sexta'],
      sourceIds: ['la_sexta'],
      type: 'TDT',
      group: 'tdt',
      subgroups: ['tdt'],
      sortOrder: 5,
    },
    program: {
      brandKey: title.toLowerCase().replace(/\s+/g, '_'),
      title,
      normalizedTitle: title.toLowerCase(),
      titleAliases: [title.toLowerCase()],
      editorialCategory: 'Otros',
    },
    airing: {
      id,
      date: '20260326',
      start,
      end,
      durationMinutes: 60,
      liveNow: false,
      partOfDay: 'noche',
      timeSlotKey: '22:00',
    },
    assets: { fallbackChain: [] },
    availability: { live: true, catchup: false, streaming: false },
    sourceProvenance: { schedule: ['primary'], metadata: [], assets: [] },
    timingContext: { liveNow: false, window: 'tonight', start, end },
    relevance: { score: 0, reason: 'test' },
    trustDecision: {
      confidence: 'high',
      sourceAgreement: 'single_source',
      featuredSuppressed: false,
      reasons: [],
    },
  });

  const selected = selectPrimeTimeTvItems(
    [
      buildItem(
        'a',
        'El intermedio',
        '2026-03-26T21:30:00.000+01:00',
        '2026-03-26T23:00:00.000+01:00'
      ),
      buildItem(
        'b',
        'El Objetivo',
        '2026-03-26T23:00:00.000+01:00',
        '2026-03-27T01:00:00.000+01:00'
      ),
    ],
    '20260326',
    { requireStartInsideWindow: true }
  );

  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.program.title, 'El Objetivo');
});

test('concurrent identical channel reads on a cache miss share one aggregation', async () => {
  let aggregations = 0;
  const fakeModel = {
    aggregate: () => ({
      exec: async () => {
        aggregations += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return [];
      },
    }),
  };
  const service = new TvReadQueryService(
    { get: async () => null, set: async () => undefined, clear: async () => undefined } as any,
    fakeModel as any
  );

  await Promise.all(Array.from({ length: 10 }, () => service.getChannels('20260326', 'cable')));
  assert.equal(aggregations, 1, 'ten simultaneous misses must not run ten aggregations');

  await service.getChannels('20260326', 'cable');
  assert.equal(aggregations, 2, 'a later call loads again: the in-flight entry is released');
});

// Phase 1 TS-15: a programme page listed last night's 23:00-02:15 airing under "A continuación" at 12:40.
test('airingsNotEnded keeps on-air and future airings, drops finished ones, across midnight', () => {
  const airing = (id: string, start: string, end: string) => ({ id, airing: { start, end } }) as unknown as TvReadItemDTO;
  const items = [
    airing('overnight-finished', '2026-10-19T21:00:00.000Z', '2026-10-20T00:15:00.000Z'), // 23:00-02:15 Madrid
    airing('morning-finished', '2026-10-20T06:00:00.000Z', '2026-10-20T08:00:00.000Z'),
    airing('on-air', '2026-10-20T10:00:00.000Z', '2026-10-20T11:00:00.000Z'),
    airing('ends-exactly-now', '2026-10-20T09:40:00.000Z', '2026-10-20T10:40:00.000Z'),
    airing('tonight-past-midnight', '2026-10-20T21:30:00.000Z', '2026-10-21T00:30:00.000Z'),
  ];
  const kept = airingsNotEnded(items, new Date('2026-10-20T10:40:00.000Z')).map((item) => item.id); // 12:40 Madrid
  assert.deepEqual(kept, ['on-air', 'tonight-past-midnight']);
});

// 2D-2C.1: expired legacy `/contenido/program:*` ids answered 500, which the SSR served to crawlers as 503.
test('getItem: a missing airing is a 404 NotFoundError; a database failure is not', async () => {
  const cache = { get: async () => null, set: async () => undefined } as any;
  const missing = { findOne: () => ({ lean: () => ({ exec: async () => null }) }) };
  await assert.rejects(new TvReadQueryService(cache, missing as any).getItem('20260901_la_1_20260901150000'), (error: any) => {
    assert.equal(error.name, 'NotFoundError');
    assert.equal(error.statusCode, 404);
    return true;
  });

  const down = { findOne: () => ({ lean: () => ({ exec: async () => Promise.reject(new Error('MongoWaitQueueTimeoutError')) }) }) };
  await assert.rejects(new TvReadQueryService(cache, down as any).getItem('20260902_la_1_20260902150000'), (error: any) => {
    assert.notEqual(error.statusCode, 404, 'a database failure must never become a 404');
    return true;
  });
});
