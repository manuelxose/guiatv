import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNewsQuery, FootballQueryService, mergeCompetitionsWithCatalogue, prioritizeSpanishLeague, settle } from './FootballQueryService';
import { FootballDataProvider } from '../../../domain/sports/football/types';

// Regression coverage for a real production bug: getCompetition()/getTeam()/
// getMatch() used to await several provider calls together (Promise.all or
// plain sequential awaits), so ONE secondary lookup failing (standings, in
// practice — a real 400 from the provider, see FootballDataOrgAdapter's
// getStandings fix) rejected the whole endpoint even though the primary
// data (competition/team/match) was already in hand. `settle()` is the
// extracted mechanism behind the fix — tested directly here since the
// methods that use it also touch Mongo (via getNews) with no DB available
// in this test run, which would hang rather than fail fast.

test('settle() returns the resolved value on success', async () => {
  const result = await settle(Promise.resolve(['a', 'b']), []);
  assert.deepEqual(result, ['a', 'b']);
});

test('settle() returns the fallback when the promise rejects', async () => {
  const result = await settle(Promise.reject(new Error('provider 400')), []);
  assert.deepEqual(result, []);
});

test('settle() returns the fallback for a synchronously-thrown rejection', async () => {
  const rejecting = (async () => {
    throw new Error('boom');
  })();
  const result = await settle(rejecting, 'fallback');
  assert.equal(result, 'fallback');
});

test('settle() preserves a falsy-but-valid resolved value (does not treat it as failure)', async () => {
  const result = await settle(Promise.resolve(0), -1);
  assert.equal(result, 0);
});

test('settle() supports non-array fallbacks (e.g. a single match object)', async () => {
  const original = { id: 'm1' };
  const result = await settle(Promise.reject(new Error('reconciliation down')), original);
  assert.equal(result, original);
});

test('prioritizeSpanishLeague puts the Spanish league first without reordering the other competitions', () => {
  const competitions = [
    { slug: 'premier-league', name: 'Premier League', country: 'England' },
    { slug: 'champions', name: 'Champions League', country: 'Europe' },
    { slug: 'primera-division', name: 'Primera Division', country: 'Spain', type: 'league' },
    { slug: 'serie-a', name: 'Serie A', country: 'Italy' },
  ];

  assert.deepEqual(prioritizeSpanishLeague(competitions).map((competition) => competition.slug), [
    'primera-division',
    'premier-league',
    'champions',
    'serie-a',
  ]);
  assert.equal(competitions[0].slug, 'premier-league');
});

test('getHome uses the Spanish league for the first competition and standings snapshot', async () => {
  let standingsSlug = '';
  const provider = fakeProvider({
    getCompetitions: async () => [
      { id: 'br', slug: 'brasileirao', name: 'Brasileirão', country: 'Brazil', type: 'league', providerIds: {}, lastUpdatedAt: '' },
      { id: 'es', slug: 'primera-division', name: 'Primera Division', country: 'Spain', type: 'league', providerIds: {}, lastUpdatedAt: '' },
    ],
    getStandings: async (slug) => {
      standingsSlug = slug;
      return [{ position: 1 }] as any;
    },
  });
  const service = new FootballQueryService(provider, fakeReconciliation);
  service.getNews = async () => [];

  const result = await service.getHome();

  assert.equal(result.featuredCompetitions[0].slug, 'primera-division');
  assert.equal(result.standingsSnapshot?.competition.slug, 'primera-division');
  assert.equal(standingsSlug, 'primera-division');
});

// Regression coverage for a real, verified-live production bug: getNews()
// with no filters (the home feed, the news list page) returned the site's
// entire general blog feed — streaming/movie guides with zero football
// relevance — relabeled as "football news", because nothing scoped the
// query to football at all. buildNewsQuery() is the fix.

test('buildNewsQuery() scopes a bare listing to genuine football signals', () => {
  const query = buildNewsQuery({});
  assert.equal(query.status, 'publish');
  assert.ok(Array.isArray(query.$and), 'expected a football-relevance $and clause on an unscoped listing');
  const scopeClause = query.$and[0];
  assert.deepEqual(
    scopeClause.$or.map((c: any) => Object.keys(c)[0]),
    ['categories.slug', 'sportsRelations.teamIds.0', 'sportsRelations.competitionIds.0', 'sportsRelations.matchIds.0']
  );
});

test('buildNewsQuery() does NOT scope-narrow a request already filtered by team/competition/match', () => {
  const byTeam = buildNewsQuery({ teamId: 't1' });
  assert.equal(byTeam['sportsRelations.teamIds'], 't1');
  assert.equal(byTeam.$and, undefined, 'a teamId filter is already football-relevant on its own');
});

test('buildNewsQuery() still scopes a slug lookup — a guessed URL must not surface unrelated content', () => {
  const query = buildNewsQuery({ slug: 'estrenos-en-streaming-esta-semana' });
  assert.equal(query.slug, 'estrenos-en-streaming-esta-semana');
  assert.ok(Array.isArray(query.$and), 'slug alone is not proof of football relevance');
});

test('buildNewsQuery() combines a text search with the football scope via $and, not $or', () => {
  const query = buildNewsQuery({ q: 'champions' });
  assert.equal(query.$and.length, 2);
  const [searchClause, scopeClause] = query.$and;
  assert.ok(searchClause.$or.some((c: any) => 'title' in c));
  assert.ok(scopeClause.$or.some((c: any) => 'categories.slug' in c));
});

test('buildNewsQuery() escapes regex special characters in a text query', () => {
  const query = buildNewsQuery({ q: 'a.b*c' });
  const titleClause = query.$and[0].$or.find((c: any) => 'title' in c);
  assert.equal(titleClause.title.$regex, 'a\\.b\\*c');
});

// Regression coverage for a real, production-observed bug: getCompetitions()
// had neither a cache nor any error handling — unlike every other football
// endpoint. Found via actual E2E test runs against the real backend: enough
// cumulative requests (normal testing traffic — every uncached page view
// hits this) triggered a real 429 from football-data.org's rate limit,
// which propagated straight to an unhandled 500 (confirmed in production
// logs). Competitions are near-static reference data, so caching also
// meaningfully cuts the upstream call volume that caused the 429.

function fakeProvider(overrides: Partial<FootballDataProvider> = {}): FootballDataProvider {
  return {
    key: 'fake',
    name: 'fake',
    getMatches: async () => [],
    getLiveMatches: async () => [],
    getMatch: async () => null,
    getCompetitions: async () => [],
    getCompetition: async () => null,
    getStandings: async () => [],
    getTeams: async () => [],
    getTeam: async () => null,
    supportsLiveScores: () => false,
    ...overrides,
  };
}

const fakeReconciliation = { reconcile: async (matches: unknown[]) => matches } as any;

function fakeCache() {
  const store = new Map<string, unknown>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    store,
  };
}

test('mergeCompetitionsWithCatalogue keeps the catalogue type/country over a provider taxonomy', () => {
  const ingested = { id: '1', slug: 'copa-libertadores', name: 'Copa Libertadores', type: 'league', country: 'South America', logo: 'https://x/y.png', providerIds: { p: '1' }, lastUpdatedAt: '' } as any;
  const merged = mergeCompetitionsWithCatalogue([ingested]);
  const lib = merged.find((c) => c.slug === 'copa-libertadores')!;
  assert.equal(lib.type, 'cup');
  assert.equal(lib.country, 'Sudamérica');
  assert.equal(lib.id, '1', 'ingested identity and data still win');
  assert.equal(merged.filter((c) => c.slug === 'copa-libertadores').length, 1, 'no duplicates');
  assert.equal(merged.find((c) => c.slug === 'copa-del-rey')!.id, 'catalog:copa-del-rey', 'catalogue-only entry kept');
  // Data/table flags and logos: explicit, not inferred from the id (ingested ids are also `catalog:`).
  assert.equal(lib.hasData, true);
  assert.equal(lib.hasTable, false, 'knockout competition never offers a table');
  const bl = mergeCompetitionsWithCatalogue([{ id: 'catalog:bundesliga', slug: 'bundesliga', name: 'Bundesliga', type: 'league', logo: null, providerIds: {}, lastUpdatedAt: '' } as any]).find((c) => c.slug === 'bundesliga')!;
  assert.equal(bl.hasData, true);
  assert.equal(bl.hasTable, true);
  assert.match(String(bl.logo), /germany-bundesliga\.png$/, 'a provider without a logo keeps the catalogue logo');
  const serieA = merged.find((c) => c.slug === 'serie-a')!;
  assert.equal(serieA.hasData, false);
});

test('getCompetitions() degrades to an empty list instead of a 500 when the provider rejects', async () => {
  const provider = fakeProvider({
    getCompetitions: async () => {
      throw Object.assign(new Error('Request failed with status code 429'), { status: 429 });
    },
  });
  const service = new FootballQueryService(provider, fakeReconciliation);
  const result = await service.getCompetitions();
  // F21: the public list is the FULL catalogue, so a provider rejection returns
  // the catalogue (with no ingested overlay) instead of a bare empty list. It
  // must never be a 500, and never an empty page.
  assert.ok(result.competitions.length > 0, 'the catalogue must still be listed');
  assert.equal(result.meta.total, result.competitions.length);
  assert.ok(
    result.competitions.some((x) => x.slug === 'serie-a'),
    'a competition with no ingested data stays listed',
  );
});

test('getCompetitions() caches a successful result so a later rate-limit hit still serves real data', async () => {
  let callCount = 0;
  const provider = fakeProvider({
    getCompetitions: async () => {
      callCount++;
      if (callCount === 1) return [{ id: 'c1', slug: 'laliga', name: 'LaLiga', type: 'league', providerIds: {}, lastUpdatedAt: '' }];
      throw new Error('429 — should never reach here, first result should be cached');
    },
  });
  const cache = fakeCache();
  const service = new FootballQueryService(provider, fakeReconciliation, cache as any);

  const first = await service.getCompetitions();
  const catalogueSize = first.competitions.length;
  assert.ok(catalogueSize > 1, 'the full catalogue is listed');
  assert.ok(first.competitions.some((x) => x.slug === 'laliga'), 'the ingested competition is merged in');

  const second = await service.getCompetitions();
  assert.equal(second.competitions.length, catalogueSize, 'the cached result is served again');
  assert.equal(callCount, 1, 'the provider is not hit twice');
  assert.equal(callCount, 1, 'the second call should be served from cache, not hit the provider again');
});

test('getCompetitions() never caches an empty/failed result — a transient 429 must not poison the cache for its full TTL', async () => {
  let callCount = 0;
  const provider = fakeProvider({
    getCompetitions: async () => {
      callCount++;
      if (callCount === 1) throw new Error('429');
      return [{ id: 'c1', slug: 'laliga', name: 'LaLiga', type: 'league', providerIds: {}, lastUpdatedAt: '' }];
    },
  });
  const cache = fakeCache();
  const service = new FootballQueryService(provider, fakeReconciliation, cache as any);

  const first = await service.getCompetitions();
  // F21: the catalogue is always listed, so a provider failure degrades to the
  // catalogue rather than to an empty page - and the failed result is not cached.
  const catalogueSize = first.competitions.length;
  assert.ok(catalogueSize > 1);

  const second = await service.getCompetitions();
  assert.equal(second.competitions.length, catalogueSize, 'a real result on the next call was not blocked by a cached failure');
  assert.equal(callCount, 2, 'a failed result must not be cached, so the provider is retried');
  assert.equal(callCount, 2);
});

test('getLiveMatches() only exposes live or halftime matches after reconciliation', async () => {
  const provider = fakeProvider({
    getLiveMatches: async () => [
      { id: 'in-play', status: 'live' },
      { id: 'half-time', status: 'halftime' },
      { id: 'final', status: 'finished' },
      { id: 'scheduled', status: 'scheduled' },
    ] as any,
  });
  const service = new FootballQueryService(provider, fakeReconciliation);

  const result = await service.getLiveMatches();

  assert.deepEqual(result.matches.map((match) => match.id), ['in-play', 'half-time']);
  assert.equal(result.meta.total, 2);
});
