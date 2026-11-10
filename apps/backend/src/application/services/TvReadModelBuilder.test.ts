import test from 'node:test';
import assert from 'node:assert/strict';
import { attachStandaloneProgrammePaths, consolidateChannelTimelines, scopeResolvedProgramsToCoreSources, TvReadModelBuilder } from './TvReadModelBuilder';
import { getConfiguredEpgSourceUrls, PRIMARY_EPG_SOURCE_URL, SECONDARY_EPG_SOURCE_URL, TDTCHANNELS_EPG_SOURCE_URL } from '@/shared/config/epgSources';

const builder = new TvReadModelBuilder({} as any, {} as any);

test('fallback EPG programmes cannot introduce secondary-only channels', () => {
  const entries = [
    { program: { id: 'primary', sourceFeed: PRIMARY_EPG_SOURCE_URL }, resolvedChannelId: 'la_1' },
    { program: { id: 'tdt', sourceFeed: TDTCHANNELS_EPG_SOURCE_URL }, resolvedChannelId: 'tv3' },
    { program: { id: 'secondary-merge', sourceFeed: SECONDARY_EPG_SOURCE_URL }, resolvedChannelId: 'la_1' },
    { program: { id: 'secondary-only', sourceFeed: SECONDARY_EPG_SOURCE_URL }, resolvedChannelId: 'foreign_only' },
  ];

  assert.deepEqual(
    scopeResolvedProgramsToCoreSources(entries, PRIMARY_EPG_SOURCE_URL).map((entry) => entry.program.id),
    ['primary', 'tdt', 'secondary-merge']
  );
});

test('one channel keeps a single non-overlapping timeline, primary feed first', () => {
  const airing = (id: string, channelId: string, start: string, end: string, sources: string[]) => ({
    id,
    channel: { id: channelId },
    airing: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    sourceProvenance: { schedule: sources },
  });
  const consolidated = consolidateChannelTimelines(
    [
      // The same broadcast carried by two feeds, five minutes apart.
      airing('primary-trivial', 'la_2', '2026-11-10T20:40:00.000Z', '2026-11-10T21:25:00.000Z', [PRIMARY_EPG_SOURCE_URL]),
      airing('tdt-trivial', 'la_2', '2026-11-10T20:45:00.000Z', '2026-11-10T21:30:00.000Z', [TDTCHANNELS_EPG_SOURCE_URL]),
      // Only the fallback feed has this slot, so it fills the gap instead of being dropped.
      airing('tdt-gap', 'la_2', '2026-11-10T23:00:00.000Z', '2026-11-10T23:30:00.000Z', [TDTCHANNELS_EPG_SOURCE_URL]),
      // Another channel is its own timeline.
      airing('other-channel', 'la_1', '2026-11-10T20:45:00.000Z', '2026-11-10T21:30:00.000Z', [TDTCHANNELS_EPG_SOURCE_URL]),
      airing('other-channel-side', 'la_1', '2026-11-10T20:41:00.000Z', '2026-11-10T21:26:00.000Z', [PRIMARY_EPG_SOURCE_URL]),
    ],
    getConfiguredEpgSourceUrls()
  );

  assert.deepEqual(
    consolidated.map((item) => item.id),
    ['primary-trivial', 'tdt-gap', 'other-channel-side']
  );
});

test('a standalone programme links its own /programas page instead of the airing id', () => {
  const synopsis =
    'Egoitz Txurruka presenta esta versión televisiva del popular juego de mesa, que consta de tres rondas y una gran final entre los mejores concursantes de cada programa.';
  const airing = (title: string, program: Record<string, unknown> = {}): any => ({
    channel: { id: 'la_2' },
    airing: { start: '2026-11-10T20:40:00.000Z', end: '2026-11-10T21:25:00.000Z' },
    program: { title, description: synopsis, ...program },
  });
  const airings = [
    airing('Trivial Pursuit'),
    airing('Saber y ganar'),
    airing('Corto', { description: 'Apenas dos palabras' }),
    airing('Con ficha TMDB', { tmdbId: 1234 }),
    airing('Malas lenguas T3 E496'),
    airing('Aída'),
    airing('AIDA'),
  ];

  attachStandaloneProgrammePaths(airings);

  assert.deepEqual(
    airings.map((item) => [item.program.title, item.program.programmePath] as const),
    [
      ['Trivial Pursuit', '/programas/trivial-pursuit'],
      ['Saber y ganar', '/programas/saber-y-ganar'],
      ['Corto', undefined],
      ['Con ficha TMDB', undefined],
      ['Malas lenguas T3 E496', undefined],
      ['Aída', undefined],
      ['AIDA', undefined],
    ]
  );
});

test('TvReadModelBuilder resolves Discovery Max aliases to canonical DMAX channel', () => {
  const channels = [
    {
      id: 'discovery_max',
      name: 'Discovery Max',
      type: 'Cable',
      order: 400,
      aliases: ['discovery_max'],
      sourceIds: ['DiscoveryMax.es'],
      country: 'España',
      countryCode: 'ES',
    },
    {
      id: 'dmax',
      name: 'DMAX',
      type: 'TDT',
      order: 10,
      aliases: ['dmax'],
      sourceIds: ['DMAX'],
      country: 'España',
      countryCode: 'ES',
    },
  ];

  const { canonicalChannelById, channelByAlias } = (builder as any).buildCanonicalChannelMaps(channels);
  const channelById = new Map(channels.map((channel) => [channel.id, channel] as const));
  const resolved = (builder as any).resolveChannelDocument(
    ['DiscoveryMax.es', 'discovery_max'],
    canonicalChannelById,
    channelByAlias,
    channelById
  );

  assert.equal(resolved?.id, 'dmax');
  assert.equal(resolved?.order, 10);
});

test('TvReadModelBuilder upgrades unresolved TMDB movie airings to Cine', () => {
  const category = (builder as any).resolveEditorialCategory({
    title: 'Le llamaban Calamidad',
    description:
      'Después de haber robado una cantidad de dinero que transportaba un tren...',
    duration: 95,
    tmdbId: 95998,
    trustFlags: { tmdbKind: 'movie' },
  });

  assert.equal(category, 'Cine');
});

test('TvReadModelBuilder suppresses generic TDT movie blocks when TDTChannels provides a specific title', () => {
  const map = (builder as any).buildTitleResolutionMap([
    {
      program: {
        id: 'primary-generic',
        title: 'Cine',
        genre: 'Cine',
        description: 'Película del oeste',
        sourceFeed: PRIMARY_EPG_SOURCE_URL,
        startTime: new Date('2026-03-27T10:05:00.000Z'),
        endTime: new Date('2026-03-27T11:30:00.000Z'),
        duration: 85,
      },
      resolvedChannelId: 'la_2',
      channelGroup: 'tdt',
      channelDoc: { id: 'la_2' },
    },
    {
      program: {
        id: 'tdtchannels-specific',
        title: 'Repoker de bribones',
        genre: 'Cine',
        description: 'Western',
        sourceFeed: TDTCHANNELS_EPG_SOURCE_URL,
        startTime: new Date('2026-03-27T10:07:00.000Z'),
        endTime: new Date('2026-03-27T11:31:00.000Z'),
        duration: 84,
      },
      resolvedChannelId: 'la_2',
      channelGroup: 'tdt',
      channelDoc: { id: 'la_2' },
    },
  ]);

  assert.deepEqual(map.get('primary-generic'), {
    state: 'generic_suppressed',
    isResolvedTitle: false,
    consumerSuppressed: true,
    suppressionReason: 'generic_replaced_by_specific_source',
    winnerProgramId: 'tdtchannels-specific',
    winnerSourceFeed: TDTCHANNELS_EPG_SOURCE_URL,
  });
  assert.deepEqual(map.get('tdtchannels-specific'), {
    state: 'specific_source_title',
    isResolvedTitle: true,
    consumerSuppressed: false,
  });
});

test('TvReadModelBuilder suppresses unresolved generic TDT movie blocks from consumer surfaces', () => {
  const map = (builder as any).buildTitleResolutionMap([
    {
      program: {
        id: 'primary-generic',
        title: 'Cine',
        genre: 'Cine',
        sourceFeed: PRIMARY_EPG_SOURCE_URL,
        startTime: new Date('2026-03-28T21:45:00.000Z'),
        endTime: new Date('2026-03-28T23:30:00.000Z'),
        duration: 105,
      },
      resolvedChannelId: 'cuatro',
      channelGroup: 'tdt',
      channelDoc: { id: 'cuatro' },
    },
  ]);

  assert.deepEqual(map.get('primary-generic'), {
    state: 'generic_unresolved',
    isResolvedTitle: false,
    consumerSuppressed: true,
    suppressionReason: 'generic_unresolved',
  });
});
