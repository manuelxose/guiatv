import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FootballDataOrgClient,
  FootballDataOrgError,
  FootballDataOrgIngestionAdapter,
  FOOTBALL_DATA_ORG_WINDOW,
  parseFootballDataOrgMatches,
  parseFootballDataOrgStandings,
} from './FootballDataOrgIngestion';

// v4 shapes as returned on 2026-11-09 (trimmed).
const team = (id: number, name: string) => ({ id, name, shortName: name, tla: name.slice(0, 3).toUpperCase(), crest: `https://crests.football-data.org/${id}.png` });
const match = (over: Record<string, unknown> = {}) => ({
  id: 555,
  utcDate: '2026-11-06T19:45:00Z',
  status: 'FINISHED',
  matchday: 11,
  competition: { id: 2019, code: 'SA', name: 'Serie A', emblem: 'https://crests.football-data.org/SA.png' },
  season: { id: 2500 },
  homeTeam: team(454, 'Venezia FC'),
  awayTeam: team(115, 'Udinese'),
  score: { fullTime: { home: 2, away: 1 } },
  lastUpdated: '2026-11-09T00:20:31Z',
  ...over,
});

test('maps a Serie A result onto the catalogue competition with crests and logo', () => {
  const [m] = parseFootballDataOrgMatches({ matches: [match()] });
  assert.equal(m.competition.slug, 'serie-a');
  assert.equal(m.competition.type, 'league');
  assert.equal(m.competition.country, 'Italia');
  assert.equal(m.competition.logo, 'https://crests.football-data.org/SA.png');
  assert.equal(m.status, 'finished');
  assert.deepEqual(m.score, { home: 2, away: 1 });
  assert.equal(m.homeTeam.crest, 'https://crests.football-data.org/454.png');
  assert.equal(m.sourceProvenance.source, 'football-data-org');
  assert.equal(m.minute, undefined, 'no live minute is invented');
});

test('drops competitions we do not map and keeps scheduled matches scoreless', () => {
  assert.equal(parseFootballDataOrgMatches({ matches: [match({ competition: { code: 'XYZ', name: 'Other' } })] }).length, 0);
  const [s] = parseFootballDataOrgMatches({ matches: [match({ status: 'TIMED', score: { fullTime: { home: null, away: null } } })] });
  assert.equal(s.status, 'scheduled');
  assert.deepEqual(s.score, { home: null, away: null });
  assert.throws(() => parseFootballDataOrgMatches({}), FootballDataOrgError);
});

test('reads only the provider TOTAL table, with its own played counts', () => {
  const rows = parseFootballDataOrgStandings({
    standings: [
      { type: 'HOME', table: [{ position: 1, team: team(1, 'X'), playedGames: 5, points: 15 }] },
      { type: 'TOTAL', table: [
        { position: 1, team: team(110, 'Lazio'), playedGames: 11, won: 9, draw: 2, lost: 0, goalsFor: 20, goalsAgainst: 6, goalDifference: 14, points: 29 },
        { position: 2, team: team(108, 'Inter'), playedGames: 11, won: 9, draw: 1, lost: 1, goalsFor: 25, goalsAgainst: 9, goalDifference: 16, points: 28 },
      ] },
    ],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].team.name, 'Lazio');
  assert.equal(rows[0].played, 11);
  assert.equal(rows[0].points, 29);
  assert.deepEqual(parseFootballDataOrgStandings({ standings: [] }), []);
});

test('one window request per tick, key only in the X-Auth-Token header, 429 typed', async () => {
  const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
  const ok = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers });
    return { ok: true, status: 200, json: async () => ({ matches: [match()] }) };
  };
  const adapter = new FootballDataOrgIngestionAdapter(new FootballDataOrgClient(ok, { apiKey: 'k', spacingMs: 0 }));
  const got = await adapter.fetchMatches(FOOTBALL_DATA_ORG_WINDOW, 'current', new Date('2026-11-09T10:00:00Z'));
  assert.equal(got.length, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/matches\?dateFrom=2026-11-07&dateTo=2026-11-14$/);
  assert.equal(calls[0].url.includes('k'), calls[0].url.includes('k'));
  assert.equal(calls[0].headers?.['X-Auth-Token'], 'k');
  assert.deepEqual(await adapter.fetchMatches('SA', 'current'), [], 'non-window entries cost nothing');
  const limited = new FootballDataOrgClient(async () => ({ ok: false, status: 429, json: async () => ({}) }), { apiKey: 'k', spacingMs: 0 });
  await assert.rejects(limited.getStandings('SA'), (e: unknown) => e instanceof FootballDataOrgError && e.kind === 'rate_limited');
});

test('a rate limit waits for the minute window and retries once; other errors and a second 429 propagate', async () => {
  const { retryOnRateLimit } = await import('./FootballDataOrgIngestion');
  const waits: number[] = [];
  const wait = async (ms: number) => { waits.push(ms); };
  const limited = () => new FootballDataOrgError('rate_limited', 'HTTP 429', 429);

  let calls = 0;
  const ok = await retryOnRateLimit(async () => { calls += 1; if (calls === 1) throw limited(); return 'table'; }, wait);
  assert.equal(ok, 'table');
  assert.equal(calls, 2);
  assert.deepEqual(waits, [61_000], 'waits for the provider minute window to reset');

  await assert.rejects(retryOnRateLimit(async () => { throw limited(); }, wait), (e: unknown) => e instanceof FootballDataOrgError && e.kind === 'rate_limited');
  let authCalls = 0;
  await assert.rejects(
    retryOnRateLimit(async () => { authCalls += 1; throw new FootballDataOrgError('auth', 'HTTP 403', 403); }, wait),
    (e: unknown) => e instanceof FootballDataOrgError && e.kind === 'auth'
  );
  assert.equal(authCalls, 1, 'non rate-limit failures are not retried');
});
