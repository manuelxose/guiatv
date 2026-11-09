import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FootballDataIoAdapter,
  FOOTBALLDATA_IO_WINDOW,
  fixCrestUrl,
  mapFootballDataIoMatch,
  mapFootballDataIoStandings,
} from './FootballDataIoAdapter';
import { FootballDataIoClient, FootballDataIoError } from './FootballDataIoClient';
import { assertEligible } from '../eligibility/providerEligibilityRegistry';

const NOW = new Date('2026-11-09T10:00:00Z');

// Shape captured from GET /fixtures/results on 2026-11-09 (trimmed).
const finished = {
  match_id: 3714519137,
  match_date: '2026-11-08 20:00:00',
  date_unix: 1794168000,
  status: 'complete',
  game_week: 12,
  league: { league_id: 10, name: 'Spain La Liga', competition_name: 'La Liga', image: 'https://footballdata.io/img/league/spain-la-liga.png' },
  season: { season_id: 117065, year: 20262027 },
  home_team: { team_id: 109, team_name: 'Atlético Madrid', team_logo: 'https://footballdata.io/img/team/club-atletico-de-madrid.png' },
  away_team: { team_id: 77, team_name: 'FC Barcelona', team_logo: 'https://footballdata.io/img/team/fc-barcelona.png' },
  score: { home: 1, away: 2, total_goals: 3, winner: 'away' },
  stats: { corners: { home: 4, away: 2 }, cards: { yellow: { home: 3, away: 1 }, red: { home: 0, away: 0 } }, xg: { home: 1.09, away: 1.93 } },
  venue: { stadium_name: 'Riyadh Air Metropolitano', stadium_location: 'Madrid' },
  last_updated: '2026-11-09 10:15:37',
};

test('maps a provider-confirmed result with crests, logo, venue and statistics', () => {
  const m = mapFootballDataIoMatch(finished, NOW)!;
  assert.equal(m.kickoffAt, '2026-11-08T20:00:00.000Z');
  assert.equal(m.status, 'finished');
  assert.deepEqual(m.score, { home: 1, away: 2 });
  assert.equal(m.competition.slug, 'laliga');
  assert.equal(m.competition.type, 'league');
  assert.equal(m.competition.logo, 'https://footballdata.io/img/league/spain-la-liga.png');
  assert.equal(m.homeTeam.crest, 'https://footballdata.io/img/team/club-atletico-de-madrid.png');
  assert.equal(m.venue, 'Riyadh Air Metropolitano');
  assert.deepEqual(m.statistics?.['Córners'], { home: 4, away: 2 });
  assert.equal(m.providerIds['footballdata-io'], '3714519137');
  assert.equal(m.lastUpdatedAt, '2026-11-09T10:15:37Z');
});

test('crest paths lose the league-country prefix that 404s; national teams keep theirs', () => {
  const m = mapFootballDataIoMatch({ ...finished, league: { ...finished.league, country: 'England', league_id: 15 }, home_team: { team_id: 1, team_name: 'Arsenal', team_logo: 'https://footballdata.io/img/team/england-arsenal-fc.png' } }, NOW)!;
  assert.equal(m.homeTeam.crest, 'https://footballdata.io/img/team/arsenal-fc.png');
  assert.equal(fixCrestUrl('https://footballdata.io/img/team/spain-national-team.png', 'Spain'), 'https://footballdata.io/img/team/spain-national-team.png');
  assert.equal(fixCrestUrl('https://footballdata.io/img/team/fc-barcelona.png', 'Spain'), 'https://footballdata.io/img/team/fc-barcelona.png');
});

test('never reports a score or a result the provider did not give', () => {
  const upcoming = mapFootballDataIoMatch({ ...finished, status: 'incomplete', date_unix: 1794600000, score: { home: 0, away: 0 }, stats: finished.stats }, NOW)!;
  assert.equal(upcoming.status, 'scheduled');
  assert.deepEqual(upcoming.score, { home: null, away: null });
  assert.equal(upcoming.statistics, undefined);
  // Open, kicked off long ago, no minute: not live and not finished.
  const stale = mapFootballDataIoMatch({ ...finished, status: 'incomplete' }, NOW)!;
  assert.equal(stale.status, 'scheduled');
});

test('a provider minute makes a match live; "HT" is halftime', () => {
  const live = mapFootballDataIoMatch({ ...finished, status: 'incomplete', minute: '72', date_unix: NOW.getTime() / 1000 - 4000 }, NOW)!;
  assert.equal(live.status, 'live');
  assert.equal(live.minute, 72);
  const ht = mapFootballDataIoMatch({ ...finished, status: 'incomplete', minute: 'HT', date_unix: NOW.getTime() / 1000 - 3000 }, NOW)!;
  assert.equal(ht.status, 'halftime');
});

test('unknown leagues and malformed rows are dropped, HTML entities decoded', () => {
  assert.equal(mapFootballDataIoMatch({ ...finished, league: { league_id: 999 } }, NOW), null);
  assert.equal(mapFootballDataIoMatch({ ...finished, home_team: {} }, NOW), null);
  const b = mapFootballDataIoMatch({ ...finished, home_team: { team_id: 1, team_name: 'Brighton &amp; Hove Albion' } }, NOW)!;
  assert.equal(b.homeTeam.name, 'Brighton & Hove Albion');
});

test('maps the provider table with its own played counts', () => {
  const rows = mapFootballDataIoStandings({
    success: true,
    data: { standings: [
      { position: 2, team: { team_id: 2, team_name: 'B FC', team_logo: 'https://x/b.png' }, record: { matches_played: 10, wins: 6, draws: 2, losses: 2, points: 20 }, goals: { for: 12, against: 8, difference: 4 } },
      { position: 1, team: { team_id: 1, team_name: 'Arsenal FC', team_name_clean: 'Arsenal' }, record: { matches_played: 10, wins: 9, draws: 0, losses: 1, points: 27 }, goals: { for: 15, against: 5, difference: 10 } },
    ] },
  });
  assert.equal(rows[0].team.name, 'Arsenal');
  assert.equal(rows[0].played, 10);
  assert.equal(rows[0].points, 27);
  assert.equal(rows[1].team.crest, 'https://x/b.png');
});

test('one window request per tick; the key travels only as a Bearer header', async () => {
  const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
  const fetch = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers });
    return { ok: true, status: 200, json: async () => ({ success: true, data: { matches: [finished] } }) };
  };
  const adapter = new FootballDataIoAdapter(new FootballDataIoClient(fetch, { apiKey: 'k' }));
  const matches = await adapter.fetchMatches(FOOTBALLDATA_IO_WINDOW, 'current', NOW);
  assert.equal(matches.length, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/matches\?from=2026-11-07&to=2026-11-14&limit=100$/);
  assert.equal(calls[0].url.includes('k&') || calls[0].url.endsWith('=k'), false);
  assert.equal(calls[0].headers?.Authorization, 'Bearer k');
  assert.deepEqual(await adapter.fetchMatches('la1', 'current', NOW), [], 'non-window entries cost nothing');
  assert.equal(calls.length, 1);
});

test('a 429 is a typed rate_limited failure and the provider is admitted by the registry', async () => {
  assert.equal(assertEligible('footballdata-io').freeQuota.kind, 'monthly');
  const client = new FootballDataIoClient(async () => ({ ok: false, status: 429, json: async () => ({}) }), { apiKey: 'k' });
  await assert.rejects(client.getMatches('2026-11-01', '2026-11-02'), (e: unknown) => e instanceof FootballDataIoError && e.kind === 'rate_limited');
  assert.throws(() => new FootballDataIoClient(async () => ({ ok: true, status: 200, json: async () => ({}) }), { apiKey: '' }));
});
