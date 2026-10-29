import test from 'node:test';
import assert from 'node:assert/strict';
import { TvSurfaceService } from './TvSurfaceService';
import { TvReadItemDTO } from '../dto/TvReadDTO';

function buildItem(
  id: string,
  channelId: string,
  sortOrder: number,
  title: string,
  options: {
    liveNow?: boolean;
    poster?: string;
    tmdbId?: number;
    score?: number;
    start?: string;
    end?: string;
  } = {}
): TvReadItemDTO {
  return {
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
      sortOrder,
      icon: `/logos/${channelId}.webp`,
    },
    program: {
      brandKey: title.toLowerCase().replace(/\s+/g, '_'),
      title,
      normalizedTitle: title.toLowerCase(),
      titleAliases: [title.toLowerCase()],
      editorialCategory: 'Otros',
      genre: undefined,
      subgenre: undefined,
      tmdbId: options.tmdbId,
      description: undefined,
    },
    airing: {
      id,
      date: '20260326',
      start: options.start || '2026-03-26T10:00:00.000Z',
      end: options.end || '2026-03-26T11:00:00.000Z',
      durationMinutes: 60,
      liveNow: options.liveNow ?? true,
      partOfDay: 'manana',
      timeSlotKey: '10:00',
    },
    assets: {
      primary: options.poster
        ? { kind: 'poster', role: 'primary', source: 'tmdb_poster', url: options.poster }
        : undefined,
      poster: options.poster
        ? { kind: 'poster', role: 'primary', source: 'tmdb_poster', url: options.poster }
        : undefined,
      backdrop: undefined,
      channelLogo: {
        kind: 'channelLogo',
        role: 'fallback',
        source: 'channel_icon',
        url: `/logos/${channelId}.webp`,
      },
      platformLogo: undefined,
      fallbackChain: [],
    },
    availability: {
      live: true,
      catchup: false,
      streaming: false,
    },
    sourceProvenance: {
      schedule: ['epg'],
      metadata: options.tmdbId ? ['tmdb'] : [],
      assets: options.poster ? ['tmdb_poster'] : ['channel_icon'],
    },
    timingContext: {
      start: options.start || '2026-03-26T10:00:00.000Z',
      end: options.end || '2026-03-26T11:00:00.000Z',
      liveNow: options.liveNow ?? true,
      window: 'today',
    },
    relevance: {
      score: options.score ?? 0,
      reason: 'test',
    },
    trustDecision: {
      confidence: 'high',
      sourceAgreement: 'single_source',
      featuredSuppressed: false,
      reasons: [],
    },
  };
}

test('TvSurfaceService guide surface deduplicates current items per channel', async () => {
  const duplicateWithoutPoster = buildItem('dmax-a', 'dmax', 10, 'Alienígenas', {
    liveNow: true,
    score: 5,
  });
  const duplicateWithPoster = buildItem('dmax-b', 'dmax', 10, 'La fiebre del oro', {
    liveNow: true,
    poster: 'https://img/poster.jpg',
    tmdbId: 1,
    score: 10,
  });
  const otherChannel = buildItem('la2-a', 'la_2', 1, 'Le llamaban Calamidad', {
    liveNow: true,
    poster: 'https://img/movie.jpg',
    tmdbId: 2,
    score: 20,
  });

  let queryCalls = 0;
  const tvReadQueryService = {
    query: async () => {
      queryCalls += 1;
      return ({
      date: '20260326',
      view: 'day',
      items: [otherChannel, duplicateWithoutPoster, duplicateWithPoster],
      channels: [
        { channel: otherChannel.channel, current: otherChannel, next: undefined, tonight: [], counts: { total: 1, live: 1, tonight: 0 } },
        { channel: duplicateWithPoster.channel, current: duplicateWithPoster, next: undefined, tonight: [], counts: { total: 2, live: 1, tonight: 0 } },
      ],
      filters: { group: 'tdt' },
      meta: { total: 3, limit: 5000, generatedAt: new Date().toISOString() },
      });
    },
    getGroupChannelCounts: async () => ({ tdt: 2, cable: 4 }),
    getChannels: async () => ({ channels: [] }),
    getChannelDetail: async () => ({
      date: '20260326',
      view: 'day',
      items: [duplicateWithoutPoster, duplicateWithPoster],
      channels: [],
      filters: {},
      meta: { total: 2, limit: 1000, generatedAt: new Date().toISOString() },
    }),
  } as any;

  const cacheRepository = {
    get: async () => null,
    set: async () => undefined,
  } as any;

  const service = new TvSurfaceService(tvReadQueryService, cacheRepository);
  const surface = await service.getGuideSurface({ date: 'today', group: 'tdt' });

  assert.equal(surface.nowItems.length, 2);
  assert.equal(surface.nowItems.find((item) => item.channel.id === 'dmax')?.program.title, 'La fiebre del oro');
  assert.equal(queryCalls, 1);
  assert.deepEqual(surface.meta.groupCounts, { tdt: 2, cable: 4 });
});

test('TvSurfaceService channel surface uses canonical directory metadata', async () => {
  const item = buildItem('amc-a', 'amc', 200, 'Cine AMC');
  const canonicalChannel = {
    ...item.channel,
    distribution: 'cable' as const,
    access: 'pay' as const,
    operator: 'AMC Networks',
    providers: ['AMC Networks'],
    contentFacets: ['movies' as const],
    quality: { resolution: 'hd' as const, timeshift: false },
    capabilities: { linear: true, catchup: true, streaming: false },
    provenance: { classification: 'registry' as const, sourceIds: ['amc'] },
  };
  const tvReadQueryService = {
    getChannelDetail: async () => ({
      date: '20260326',
      view: 'day',
      items: [item],
      channels: [{ channel: item.channel, counts: { total: 1, live: 1, tonight: 0 } }],
      filters: {},
      meta: { total: 1, limit: 1000, generatedAt: new Date().toISOString() },
    }),
    getChannels: async () => ({
      channels: [
        { channel: canonicalChannel, current: item, counts: { total: 1, live: 1, tonight: 0 } },
      ],
    }),
  } as any;
  const cacheRepository = {
    get: async () => null,
    set: async () => undefined,
  } as any;

  const service = new TvSurfaceService(tvReadQueryService, cacheRepository);
  const surface = await service.getChannelSurface('amc', 'today');

  assert.equal(surface.channel?.access, 'pay');
  assert.equal(surface.channel?.operator, 'AMC Networks');
  assert.equal(surface.channel?.quality?.resolution, 'hd');
});

test('cached channel surface refreshes both live flags without queries or changing verified destinations', async () => {
  const now = Date.now();
  const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
  const ended = buildItem('ended', 'amc', 1, 'Finalizado', { start: at(-90), end: at(-30), liveNow: true });
  const current = { ...buildItem('current', 'amc', 1, 'En emisión', { start: at(-30), end: at(30), liveNow: false }), detailPath: '/programas/verified-programme' };
  const next = buildItem('next', 'amc', 1, 'Después', { start: at(30), end: at(90), liveNow: false });
  const cached = { date: '20261023', channel: current.channel, current: ended, next: current, scheduleItems: [ended, current, next], tonightItems: [], relatedChannels: [], meta: { totalItems: 3, generatedAt: at(-60) } };
  const service = new TvSurfaceService({
    getChannelDetail: async () => assert.fail('cached surface must not query the schedule'),
    getChannels: async () => assert.fail('cached surface must not query channels'),
  } as any, { get: async () => cached } as any);

  const surface = await service.getChannelSurface('amc', 'today');
  assert.equal(surface.meta.cached, true);
  assert.equal(surface.current?.id, 'current');
  assert.equal(surface.next?.id, 'next');
  assert.equal(surface.scheduleItems[0].airing.liveNow, false);
  assert.equal(surface.scheduleItems[0].timingContext.liveNow, false);
  assert.equal(surface.scheduleItems[1].airing.liveNow, true);
  assert.equal(surface.scheduleItems[1].timingContext.liveNow, true);
  assert.equal(surface.current?.detailPath, '/programas/verified-programme');
  assert.equal(cached.scheduleItems[0].airing.liveNow, true, 'do not mutate the cached snapshot');
});

test('M10-C: an alias channel surface names its channel; related channels and the guide never list a verified alias', async () => {
  const alias = buildItem('a1', 'telemadrid_tv', 1, 'Yo soy de aquí');
  const own = buildItem('o1', 'telemadrid', 1, 'Yo soy de aquí');
  const other = buildItem('x1', 'la_1', 1, 'Telediario');
  const summary = (item: TvReadItemDTO) => ({ channel: item.channel, current: item, counts: { total: 1, live: 0, tonight: 0 } });
  const reader = {
    getChannelDetail: async (id: string) => ({ date: '20261029', items: id === 'telemadrid' ? [own] : [alias], channels: [] }),
    getChannels: async () => ({ channels: [summary(own), summary(alias), summary(other)] }),
    query: async () => ({ date: '20261029', items: [own, alias, other], channels: [summary(own), summary(alias), summary(other)] }),
    getGroupChannelCounts: async () => ({}),
  } as any;
  const cache = { get: async () => null, set: async () => undefined } as any;
  const aliases = { resolve: async () => new Map([['telemadrid_tv', { id: 'telemadrid', name: 'Telemadrid', normalizedName: 'telemadrid' }]]) };
  const service = new TvSurfaceService(reader, cache, aliases);

  const aliasSurface = await service.getChannelSurface('telemadrid_tv', 'today');
  assert.deepEqual(aliasSurface.canonicalChannel, { id: 'telemadrid', name: 'Telemadrid', normalizedName: 'telemadrid' });
  assert.equal(aliasSurface.scheduleItems.length, 1, 'the alias schedule is still served by the API');

  const ownSurface = await service.getChannelSurface('telemadrid', 'today');
  assert.equal(ownSurface.canonicalChannel, undefined);
  assert.deepEqual(ownSurface.relatedChannels.map((e) => e.channel.id), ['la_1']);

  const guide = await service.getGuideSurface({});
  assert.ok(!guide.channels.some((e) => e.channel.id === 'telemadrid_tv'));
  assert.ok(![...guide.nowItems, ...guide.nextItems, ...guide.nightItems].some((i) => i.channel.id === 'telemadrid_tv'));

  // Alias list unavailable: every channel is served as itself, as before.
  const degraded = new TvSurfaceService(reader, cache, { resolve: async () => { throw new Error('down'); } });
  assert.equal((await degraded.getChannelSurface('telemadrid_tv', 'today')).canonicalChannel, undefined);
});
