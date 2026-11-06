import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FetchResponse,
  OpenLigaDbClient,
  OpenLigaDbError,
} from './OpenLigaDbClient';
import {
  mapOpenLigaDbMatch,
  OpenLigaDbAdapter,
  OpenLigaDbGoalEvent,
  OPENLIGADB_COMPETITION_MAP,
  resolveCompetitionSlug,
  validateOpenLigaDbPayload,
} from './OpenLigaDbAdapter';

const NOW = new Date('2026-11-06T00:00:00Z');

const response = (status: number, body?: unknown): FetchResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function rawMatch(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    matchID: 51000,
    matchDateTimeUTC: '2026-08-14T19:30:00Z',
    leagueShortcut: 'bl1',
    leagueSeason: 2026,
    team1: { teamId: 1, teamName: 'FC Bayern München', shortName: 'FCB', teamIconUrl: 'https://cdn/fcb.png' },
    team2: { teamId: 2, teamName: 'Borussia Dortmund', shortName: 'BVB', teamIconUrl: 'https://cdn/bvb.png' },
    group: { groupName: '1. Spieltag' },
    location: { locationStadium: 'Allianz Arena', locationCity: 'München' },
    matchIsFinished: true,
    lastUpdateDateTime: '2026-08-14T21:30:00Z',
    matchResults: [
      { resultTypeKind: 'HalfTime', pointsTeam1: 1, pointsTeam2: 0 },
      { resultTypeKind: 'After90Minutes', pointsTeam1: 2, pointsTeam2: 1 },
    ],
    goals: [
      {
        goalID: 70001,
        scoreTeam1: 1,
        scoreTeam2: 0,
        matchMinute: 12,
        goalGetterName: 'Harry Kane',
        scoringTeamId: 1,
        isPenalty: false,
        isOwnGoal: false,
        isOvertime: false,
      },
      {
        goalID: 70002,
        scoreTeam1: 2,
        scoreTeam2: 1,
        matchMinute: 88,
        goalGetterName: 'Marco Reus',
        scoringTeamId: 2,
        isPenalty: true,
        isOwnGoal: false,
        isOvertime: false,
      },
    ],
    ...overrides,
  };
}

test('maps a captured OpenLigaDB payload to the domain shape', () => {
  const match = mapOpenLigaDbMatch(rawMatch(), NOW);
  assert.ok(match);
  assert.equal(match.id, '51000');
  assert.equal(match.competition.slug, 'bundesliga');
  assert.equal(match.kickoffAt, '2026-08-14T19:30:00Z');
  assert.equal(match.status, 'finished');
  assert.deepEqual(match.score, { home: 2, away: 1 });
  const halftime = match.statistics?.halftime as { home: number | null; away: number | null };
  assert.equal(halftime.home, 1);
  assert.equal(halftime.away, 0);
  assert.equal(match.venue, 'Allianz Arena');
  assert.equal(match.round, '1. Spieltag');
  assert.equal(match.season, '2026');
  assert.equal(match.homeTeam.providerIds.openligadb, '1');
  assert.equal(match.homeTeam.name, 'FC Bayern München');
  assert.equal(match.awayTeam.name, 'Borussia Dortmund');
  assert.equal(match.sourceProvenance.source, 'openligadb');
  assert.equal(match.providerIds.openligadb, '51000');
});

test('maps goals to typed events with providerEventId, minute, scorer, flags and scoreAfter', () => {
  const match = mapOpenLigaDbMatch(rawMatch(), NOW);
  assert.ok(match);
  const events = match.events as OpenLigaDbGoalEvent[];
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    providerEventId: '70001',
    minute: 12,
    scorer: 'Harry Kane',
    teamId: '1',
    penalty: false,
    ownGoal: false,
    overtime: false,
    scoreAfter: { home: 1, away: 0 },
  });
  assert.equal(events[1].penalty, true);
  assert.deepEqual(events[1].scoreAfter, { home: 2, away: 1 });
});

test('live minute is always undefined — never derived from kickoff', () => {
  const match = mapOpenLigaDbMatch(rawMatch({ matchIsFinished: false }), NOW);
  assert.ok(match);
  assert.equal(match.minute, undefined);
  assert.equal('minute' in match, false);
});

test('unknown leagues are skipped, never guessed', () => {
  assert.equal(resolveCompetitionSlug('bl2'), null);
  assert.equal(resolveCompetitionSlug(undefined), null);
  assert.deepEqual(OPENLIGADB_COMPETITION_MAP, { bl1: 'bundesliga' });
  assert.equal(mapOpenLigaDbMatch(rawMatch({ leagueShortcut: 'bl2' }), NOW), null);
});

test('malformed individual records are skipped, not thrown', () => {
  assert.equal(mapOpenLigaDbMatch(null, NOW), null);
  assert.equal(mapOpenLigaDbMatch({}, NOW), null);
  assert.equal(mapOpenLigaDbMatch(rawMatch({ team1: undefined }), NOW), null);
  assert.equal(mapOpenLigaDbMatch(rawMatch({ team1: { teamName: 'A' }, team2: undefined }), NOW), null);
});

test('validateOpenLigaDbPayload rejects non-arrays with a typed malformed error', () => {
  assert.throws(() => validateOpenLigaDbPayload({}), (error: unknown) => {
    assert.ok(error instanceof OpenLigaDbError);
    assert.equal((error as OpenLigaDbError).kind, 'malformed');
    return true;
  });
  assert.doesNotThrow(() => validateOpenLigaDbPayload([]));
});

test('adapter.fetchMatches maps, skips malformed, and never throws raw parse errors', async () => {
  const client = new OpenLigaDbClient(async () => response(200, [
    rawMatch(),
    null,
    rawMatch({ matchID: 51001, leagueShortcut: 'bl2' }),
  ]));
  const adapter = new OpenLigaDbAdapter(client);
  const matches = await adapter.fetchMatches('bl1', '2026', NOW);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, '51000');
});

test('client classifies 429 as rate_limited, 403 as auth, 500 as http', async () => {
  const cases: Array<[number, string]> = [
    [429, 'rate_limited'],
    [403, 'auth'],
    [401, 'auth'],
    [500, 'http'],
  ];
  for (const [status, kind] of cases) {
    const client = new OpenLigaDbClient(async () => response(status));
    await assert.rejects(
      () => client.getMatchdata('bl1', '2026'),
      (error: unknown) => error instanceof OpenLigaDbError && error.kind === kind && error.status === status
    );
  }
});

test('client classifies a non-JSON body as malformed', async () => {
  const client = new OpenLigaDbClient(async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error('Unexpected token');
    },
  }));
  await assert.rejects(
    () => client.getMatchdata('bl1', '2026'),
    (error: unknown) => error instanceof OpenLigaDbError && error.kind === 'malformed'
  );
});

test('client classifies an aborted request as timeout', async () => {
  const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const client = new OpenLigaDbClient(async () => {
    throw abortError;
  });
  await assert.rejects(
    () => client.getMatchdata('bl1', '2026'),
    (error: unknown) => error instanceof OpenLigaDbError && error.kind === 'timeout'
  );
});

test('client enforces the timeout via AbortSignal', async () => {
  const hangingFetch = (_url: string, init?: { signal?: AbortSignal }) =>
    new Promise<never>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      );
    });
  const client = new OpenLigaDbClient(hangingFetch, { timeoutMs: 20 });
  await assert.rejects(
    () => client.getMatchdata('bl1', '2026'),
    (error: unknown) => error instanceof OpenLigaDbError && error.kind === 'timeout'
  );
});
