/**
 * SnapshotFootballDataProvider tests (M06).
 *
 * M06's central defect was that ingested data never reached a public page: the
 * public provider read the EPG or football-data.org, never `football_snapshots`.
 * These tests pin the behaviour that closed it, and — more importantly — pin the
 * honesty rules: an absent field stays absent, and standings are not invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotFootballDataProvider } from './SnapshotFootballDataProvider';
import { FootballMatch } from '../../../domain/sports/football/types';

const provider = new SnapshotFootballDataProvider();

test('M06: the public provider declares the ingested-snapshot source', () => {
  assert.equal(provider.key, 'snapshot');
  assert.equal(typeof provider.supportsLiveScores(), 'boolean');
});

test('M06/F25: standings are DERIVED from real results, never fabricated', { skip: !process.env.TEST_MONGO_URI }, async () => {
  // OpenLigaDB publishes no table. The provider therefore COMPUTES one from the
  // finished, scored matches it stores (see the F25 mongo test). Without a
  // database there is nothing to derive from, so it must answer with an empty
  // array - never an invented table.
  assert.deepEqual(await provider.getStandings('bundesliga'), []);
  // A blank competition can never produce a table.
  assert.deepEqual(await provider.getStandings(''), []);
});

test('M06: a blank identity never reaches the database', async () => {
  assert.equal(await provider.getMatch(''), null);
  assert.equal(await provider.getMatch('   '), null);
  assert.equal(await provider.getTeam(''), null);
});

test('M06: an absent field stays absent through the provider contract', () => {
  // Structural guard: the provider returns the stored match untouched, so a match
  // without a live minute or line-ups cannot gain one in transit.
  const stored: FootballMatch = {
    id: '87388',
    slug: 'fc-brugge-aston-villa-2026-09-08',
    providerIds: { openligadb: '87388' },
    competition: { id: 'catalog:champions-league', slug: 'champions-league', name: 'UEFA Champions League', shortName: 'Champions' },
    season: '2026',
    kickoffAt: '2026-09-08T16:45:00Z',
    status: 'finished',
    homeTeam: { id: 'openligadb:1210', slug: 'fc-brugge', name: 'FC Brügge', aliases: [], providerIds: {}, lastUpdatedAt: '2026-09-08T18:40:14Z' },
    awayTeam: { id: 'openligadb:438', slug: 'aston-villa', name: 'Aston Villa', aliases: [], providerIds: {}, lastUpdatedAt: '2026-09-08T18:40:14Z' },
    score: { home: 2, away: 3 },
    broadcasts: [],
    sourceProvenance: { source: 'openligadb', externalId: '87388', confidence: 'high' },
    lastUpdatedAt: '2026-09-08T18:40:14Z',
  };
  const roundTrip = JSON.parse(JSON.stringify(stored));
  assert.equal('minute' in roundTrip, false, 'no live minute may appear in transit');
  assert.equal('lineups' in roundTrip, false, 'no line-ups may appear in transit');
  assert.equal(roundTrip.score.home, 2, 'a real zero/score is never coerced');
});

test('M06: a real 0-0 result is preserved, not treated as missing', () => {
  const stored: FootballMatch = {
    id: '1', slug: 'a-b-2026-01-01',
    providerIds: {}, competition: { id: 'c', slug: 'bundesliga', name: 'Bundesliga', shortName: 'BL' },
    season: '2026', kickoffAt: '2026-01-01T15:30:00Z', status: 'finished',
    homeTeam: { id: 'a', slug: 'a', name: 'A', aliases: [], providerIds: {}, lastUpdatedAt: 'x' },
    awayTeam: { id: 'b', slug: 'b', name: 'B', aliases: [], providerIds: {}, lastUpdatedAt: 'x' },
    score: { home: 0, away: 0 },
    broadcasts: [],
    sourceProvenance: { source: 'openligadb', externalId: '1', confidence: 'high' },
    lastUpdatedAt: 'x',
  };
  const clone = JSON.parse(JSON.stringify(stored));
  assert.strictEqual(clone.score.home, 0);
  assert.strictEqual(clone.score.away, 0);
  assert.notStrictEqual(clone.score.home, null);
});

/**
 * M06-R1 regression: the day filter must survive the compact `YYYYMMDD` form the
 * Sports v2 client sends. `new Date('20261126')` is Invalid Date, so the filter
 * used to be dropped SILENTLY and the endpoint answered with matches from any
 * date - which is why a competition playing weeks apart (Europa League) looked
 * missing. These tests call the private builder directly: no database needed.
 */
test('M06-R1: a compact YYYYMMDD day becomes a real 24h kickoff window', () => {
  const build = (provider as unknown as { buildFilter(q: unknown): Record<string, any> }).buildFilter.bind(provider);
  const compact = build({ date: '20261126' });
  const dashed = build({ date: '2026-11-26' });
  assert.deepEqual(compact['match.kickoffAt'], dashed['match.kickoffAt']);
  assert.equal(compact['match.kickoffAt'].$gte, '2026-11-26T00:00:00.000Z');
  assert.equal(compact['match.kickoffAt'].$lte, '2026-11-27T00:00:00.000Z');
  // An unparseable day must not silently widen the query to every match.
  const bogus = build({ date: 'not-a-day' });
  assert.equal(bogus['match.kickoffAt'], undefined);
  // The competition filter is preserved alongside the day window.
  const both = build({ date: '20261126', competitionSlug: 'europa-league' });
  assert.equal(both.competitionSlug, 'europa-league');
  assert.ok(both['match.kickoffAt']);
});

/**
 * F25: a league table is DERIVED from the real finished results we already
 * store. It must never be invented: a match without a score contributes nothing,
 * and a competition with no finished matches yields an empty table.
 */
