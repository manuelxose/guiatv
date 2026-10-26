import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMatchSlug,
  matchHasSlug,
  inferStatus,
  isFootballAiring,
  normalizeEpgAiringToMatch,
  resolveCompetition,
  splitMatchup,
  slugify,
  toNormalizedAiringInput,
} from './FootballNormalizer';
import { normalizeMatchStatus } from '../../../domain/sports/football/types';

const airing = (overrides: Partial<Parameters<typeof normalizeEpgAiringToMatch>[0]> = {}) => ({
  id: 'airing-1',
  date: '20260814',
  start: '2026-08-14T19:00:00+02:00',
  end: '2026-08-14T21:00:00+02:00',
  title: 'Fútbol LaLiga · Real Madrid - Barcelona',
  sportFacet: 'Fútbol',
  editorialCategory: 'Deportes',
  channelId: 'movistar_laliga',
  channelName: 'Movistar LaLiga',
  ...overrides,
});

test('slugify normalizes accents and separators', () => {
  assert.equal(slugify('Atlético de Madrid'), 'atletico-de-madrid');
  assert.equal(slugify('Real Madrid CF'), 'real-madrid-cf');
});

test('isFootballAiring rejects motor racing titles', () => {
  assert.equal(isFootballAiring(airing({ title: 'Mundial F1 - GP de Hungría', sportFacet: 'F1' })), false);
  assert.equal(isFootballAiring(airing({ title: 'MotoGP - Gran Premio' })), false);
});

test('isFootballAiring accepts football matchups inside the sports vertical', () => {
  assert.equal(isFootballAiring(airing()), true);
});

test('splitMatchup splits " - " and " vs " separators', () => {
  assert.deepEqual(splitMatchup('Real Madrid - Barcelona'), { homeTeam: 'Real Madrid', awayTeam: 'Barcelona' });
  assert.deepEqual(splitMatchup('Atlético de Madrid vs Sevilla'), { homeTeam: 'Atlético de Madrid', awayTeam: 'Sevilla' });
});

test('resolveCompetition resolves against the catalog, not raw title lead', () => {
  const comp = resolveCompetition(airing({ title: 'Champions League · Real Madrid - PSG' }));
  assert.equal(comp.slug, 'champions-league');
  assert.equal(comp.name, 'UEFA Champions League');
});

test('inferStatus maps time windows to domain status', () => {
  const ref = new Date('2026-08-14T20:00:00+02:00');
  assert.equal(inferStatus('2026-08-14T19:00:00+02:00', '2026-08-14T21:00:00+02:00', ref), 'live');
  assert.equal(inferStatus('2026-08-14T21:30:00+02:00', '2026-08-14T23:00:00+02:00', ref), 'scheduled');
  assert.equal(inferStatus('2026-08-14T18:00:00+02:00', '2026-08-14T19:00:00+02:00', ref), 'finished');
});

test('normalizeMatchStatus maps provider enums into the domain', () => {
  assert.equal(normalizeMatchStatus('IN_PLAY'), 'live');
  assert.equal(normalizeMatchStatus('PAUSED'), 'suspended');
  assert.equal(normalizeMatchStatus('FINISHED'), 'finished');
  assert.equal(normalizeMatchStatus('POSTPONED'), 'postponed');
  assert.equal(normalizeMatchStatus('SCHEDULED'), 'scheduled');
  assert.equal(normalizeMatchStatus('UNKNOWN'), 'scheduled');
});

test('normalizeEpgAiringToMatch never fabricates scores or minutes', () => {
  const match = normalizeEpgAiringToMatch(airing(), new Date('2026-08-14T20:00:00+02:00'));
  assert.ok(match);
  assert.equal(match.homeTeam.name, 'Real Madrid');
  assert.equal(match.awayTeam.name, 'Barcelona');
  assert.equal(match.score.home, null);
  assert.equal(match.score.away, null);
  assert.equal(match.minute, null);
  assert.equal(match.broadcasts[0].channelName, 'Movistar LaLiga');
});

test('normalizeEpgAiringToMatch rejects non-matchup sports programs', () => {
  const match = normalizeEpgAiringToMatch(airing({ title: 'ElDesmarque' }));
  assert.equal(match, null);
});

test('buildMatchSlug dates the slug by the Europe/Madrid kickoff day, across midnight and DST', () => {
  // 23:00Z on 19 Oct (CEST, UTC+2) is 01:00 on 20 Oct in Madrid: listed under the 20th, so dated the 20th.
  assert.equal(buildMatchSlug('SC Corinthians Paulista', 'EC Vitória', '2026-10-19T23:00:00Z'), 'sc-corinthians-paulista-ec-vitoria-2026-10-20');
  assert.equal(buildMatchSlug('A', 'B', '2026-10-19T21:59:00Z'), 'a-b-2026-10-19'); // 23:59 Madrid
  assert.equal(buildMatchSlug('A', 'B', '2026-10-19T22:00:00Z'), 'a-b-2026-10-20'); // 00:00 Madrid
  // Winter time (CET, UTC+1): the day turns at 23:00Z.
  assert.equal(buildMatchSlug('A', 'B', '2026-12-01T22:59:00Z'), 'a-b-2026-12-01');
  assert.equal(buildMatchSlug('A', 'B', '2026-12-01T23:00:00Z'), 'a-b-2026-12-02');
  // An offset-bearing ISO string is read as the instant it names, not by its leading characters.
  assert.equal(buildMatchSlug('A', 'B', '2026-10-20T01:00:00+02:00'), 'a-b-2026-10-20');
});

test('matchHasSlug accepts the current slug and the legacy UTC-dated one, nothing else', () => {
  const match = { slug: buildMatchSlug('A', 'B', '2026-10-19T23:00:00Z'), kickoffAt: '2026-10-19T23:00:00Z' };
  assert.equal(matchHasSlug(match, 'a-b-2026-10-20'), true);
  assert.equal(matchHasSlug(match, 'a-b-2026-10-19'), true); // links built before the fix keep resolving
  assert.equal(matchHasSlug(match, 'a-b-2026-10-21'), false);
  assert.equal(matchHasSlug(match, 'a-c-2026-10-20'), false);
});

test('buildMatchSlug is collision-safe with date suffix', () => {
  assert.equal(
    buildMatchSlug('Real Madrid', 'Barcelona', '2026-10-25T19:00:00Z'),
    'real-madrid-barcelona-2026-10-25'
  );
});

// M10: "Dónde verlo" linked /canales/movistar-laliga while that page declares /canales/m-laliga-uhd canonical.
test('football broadcasts link the channel by its canonical name, falling back to the id', () => {
  const canonical = normalizeEpgAiringToMatch(airing({ channelNormalizedName: 'm_laliga_uhd' }));
  assert.equal(canonical?.broadcasts[0].channelPath, '/canales/m-laliga-uhd');
  assert.equal(normalizeEpgAiringToMatch(airing())?.broadcasts[0].channelPath, '/canales/movistar-laliga');
  const doc = { id: 'a', date: '20260814', channel: { id: 'movistar_laliga', name: 'Movistar LaLiga', normalizedName: 'm_laliga_uhd' }, program: { title: 'x' }, airing: {} };
  assert.equal(toNormalizedAiringInput(doc as any).channelNormalizedName, 'm_laliga_uhd');
});
