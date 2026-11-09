import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FetchResponse,
  OpenLigaDbClient,
  OpenLigaDbError,
} from './OpenLigaDbClient';
import {
  classifyOpenLigaDbFetch,
  mapOpenLigaDbMatch,
  OpenLigaDbAdapter,
  OpenLigaDbGoalEvent,
  OPENLIGADB_COMPETITION_MAP,
  openLigaDbSeasonLabel,
  resolveCompetitionSlug,
  resolveOpenLigaDbCoverage,
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

test('every verified competition shortcut maps to its catalog slug', () => {
  const expected: Record<string, string> = {
    bl1: 'bundesliga',
    ucl: 'champions-league',
    uel2026: 'europa-league',
    uecl2026: 'conference-league',
    pl: 'premier-league',
    dfb: 'dfb-pokal',
    bl2: 'bundesliga-2',
    la1: 'laliga', // verified 2026-11-06: 380 real 2026/27 fixtures
    nla: 'nations-league', // verified 2026-11-09: Nations League A, 48 fixtures
  };
  assert.deepEqual({ ...OPENLIGADB_COMPETITION_MAP }, expected);
  for (const [shortcut, slug] of Object.entries(expected)) {
    assert.equal(resolveCompetitionSlug(shortcut), slug);
    const match = mapOpenLigaDbMatch(rawMatch({ leagueShortcut: shortcut }), NOW);
    assert.ok(match, `shortcut ${shortcut} should map`);
    assert.equal(match.competition.slug, slug);
  }
});

test('an unsupported shortcut never falls back to another competition', () => {
  // Real OpenLigaDB shortcuts that are NOT part of the verified map. Each must
  // resolve to null, never to a look-alike slug.
  // `la1` is NOT here any more: it was verified on 2026-11-06 (380 real
  // 2026/27 LaLiga fixtures) and is now part of the approved map.
  for (const shortcut of ['bl3', 'wm2026', 'pl1', 'esp']) {
    assert.equal(resolveCompetitionSlug(shortcut), null, `shortcut ${shortcut}`);
    assert.equal(mapOpenLigaDbMatch(rawMatch({ leagueShortcut: shortcut }), NOW), null);
  }
  // `ucl2026` is a DIFFERENT OpenLigaDB league (leagueId 5997) than the verified
  // `ucl` (leagueId 4946); it must not be guessed into champions-league.
  assert.equal(resolveCompetitionSlug('ucl2026'), null);
  assert.equal(mapOpenLigaDbMatch(rawMatch({ leagueShortcut: 'ucl2026' }), NOW), null);
});

test('unknown leagues are skipped, never guessed', () => {
  assert.equal(resolveCompetitionSlug(undefined), null);
  assert.equal(resolveCompetitionSlug(''), null);
  assert.equal(mapOpenLigaDbMatch(rawMatch({ leagueShortcut: 'nope' }), NOW), null);
});

test('absent provider fields stay absent — no referee, lineups, statistics, standings or live minute', () => {
  const match = mapOpenLigaDbMatch(rawMatch(), NOW)!;
  assert.equal('minute' in match, false);
  assert.equal(match.lineups, undefined);
  assert.equal('lineups' in match, false);
  // The only statistics entry is the real halftime result, never a team stat.
  assert.deepEqual(Object.keys(match.statistics ?? {}), ['halftime']);
  assert.equal('referee' in (match as any), false);
  assert.equal('standings' in (match as any), false);
});

test('no score or statistic is fabricated when the provider supplies no results', () => {
  const match = mapOpenLigaDbMatch(rawMatch({ matchResults: undefined, matchIsFinished: false }), NOW)!;
  assert.deepEqual(match.score, { home: null, away: null });
  assert.equal(match.statistics, undefined);
});

test('a side-less goal is preserved with teamId undefined, never guessed', () => {
  const match = mapOpenLigaDbMatch(rawMatch({
    goals: [{
      goalID: 70003,
      scoreTeam1: 1,
      scoreTeam2: 0,
      matchMinute: 30,
      goalGetterName: undefined,
      scoringTeamId: null,
      isPenalty: false,
      isOwnGoal: false,
      isOvertime: false,
    }],
  }), NOW)!;
  const events = match.events as OpenLigaDbGoalEvent[];
  assert.equal(events.length, 1);
  assert.equal(events[0].providerEventId, '70003');
  assert.equal(events[0].teamId, undefined);
});

test('a running-score/final-result disagreement is surfaced, not repaired', () => {
  // Final result says 3-0, but the last goal's running score says 2-0. Both must
  // be preserved verbatim so a consumer can detect the conflict.
  const match = mapOpenLigaDbMatch(rawMatch({
    matchResults: [{ resultTypeKind: 'After90Minutes', pointsTeam1: 3, pointsTeam2: 0 }],
    goals: [{
      goalID: 70010,
      scoreTeam1: 2,
      scoreTeam2: 0,
      matchMinute: 60,
      goalGetterName: 'X',
      scoringTeamId: 1,
      isPenalty: false,
      isOwnGoal: false,
      isOvertime: false,
    }],
  }), NOW)!;
  assert.deepEqual(match.score, { home: 3, away: 0 });
  const events = match.events as OpenLigaDbGoalEvent[];
  assert.deepEqual(events[0].scoreAfter, { home: 2, away: 0 });
});

test('openLigaDbSeasonLabel derives 2026/27 from a 2026 start year', () => {
  assert.equal(openLigaDbSeasonLabel(2026), '2026/27');
  assert.equal(openLigaDbSeasonLabel('2026'), '2026/27');
  assert.equal(openLigaDbSeasonLabel(2025), '2025/26');
  assert.equal(openLigaDbSeasonLabel(undefined), undefined);
  assert.equal(openLigaDbSeasonLabel('nope'), undefined);
});

test('resolveOpenLigaDbCoverage distinguishes covered from not-covered', () => {
  const ucl = resolveOpenLigaDbCoverage('ucl', 2026);
  assert.equal(ucl.state, 'provider_supported');
  assert.equal(ucl.competitionSlug, 'champions-league');
  assert.equal(ucl.seasonLabel, '2026/27');

  const uncovered = resolveOpenLigaDbCoverage('bl3', 2026);
  assert.equal(uncovered.state, 'competition_not_covered');
  assert.equal(uncovered.competitionSlug, undefined);
});

test('classifyOpenLigaDbFetch maps empty payload to no-fixtures and error to unavailable', () => {
  const supported = resolveOpenLigaDbCoverage('dfb', 2026);
  assert.equal(classifyOpenLigaDbFetch(supported, { matches: [] }).state, 'provider_supported_no_fixtures');
  assert.equal(
    classifyOpenLigaDbFetch(supported, { matches: [mapOpenLigaDbMatch(rawMatch(), NOW)!] }).state,
    'provider_supported'
  );
  assert.equal(
    classifyOpenLigaDbFetch(supported, { error: new OpenLigaDbError({ kind: 'timeout', message: 'x' }) }).state,
    'provider_unavailable'
  );
  assert.equal(classifyOpenLigaDbFetch(supported, { error: new Error('net') }).state, 'provider_unavailable');
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
    rawMatch({ matchID: 51001, leagueShortcut: 'bl3' }),
  ]));
  const adapter = new OpenLigaDbAdapter(client);
  const matches = await adapter.fetchMatches('bl1', '2026', NOW);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, '51000');
});

test('adapter.fetchMatches skips an unknown shortcut without issuing a request', async () => {
  let calls = 0;
  const client = new OpenLigaDbClient(async () => {
    calls += 1;
    return response(200, []);
  });
  const adapter = new OpenLigaDbAdapter(client);
  const matches = await adapter.fetchMatches('bl3', '2026', NOW);
  assert.equal(matches.length, 0);
  assert.equal(calls, 0);
});

test('adapter.fetchMatchesWithCoverage folds provider errors into the descriptor', async () => {
  const client = new OpenLigaDbClient(async () => response(500));
  const adapter = new OpenLigaDbAdapter(client);
  const result = await adapter.fetchMatchesWithCoverage('pl', '2026', NOW);
  assert.equal(result.coverage.state, 'provider_unavailable');
  assert.deepEqual(result.matches, []);
});

test('adapter.fetchMatchesWithCoverage reports no-fixtures for an empty season', async () => {
  const client = new OpenLigaDbClient(async () => response(200, []));
  const adapter = new OpenLigaDbAdapter(client);
  const result = await adapter.fetchMatchesWithCoverage('dfb', '2026', NOW);
  assert.equal(result.coverage.state, 'provider_supported_no_fixtures');
  assert.deepEqual(result.matches, []);
});

test('adapter.fetchMatchesWithCoverage reports competition_not_covered without a request', async () => {
  let calls = 0;
  const client = new OpenLigaDbClient(async () => {
    calls += 1;
    return response(200, []);
  });
  const adapter = new OpenLigaDbAdapter(client);
  const result = await adapter.fetchMatchesWithCoverage('bl3', '2026', NOW);
  assert.equal(result.coverage.state, 'competition_not_covered');
  assert.deepEqual(result.matches, []);
  assert.equal(calls, 0);
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

test('M07: national teams and groups are shown in Spanish; club names are untouched', () => {
  const m = mapOpenLigaDbMatch(rawMatch({ leagueShortcut: 'nla', group: { groupName: 'Gruppe A' }, team1: { teamId: 1, teamName: 'Spanien' }, team2: { teamId: 2, teamName: 'Deutschland' } }), NOW)!;
  assert.equal(m.homeTeam.name, 'España');
  assert.equal(m.awayTeam.name, 'Alemania');
  assert.equal(m.round, 'Grupo A');
  const club = mapOpenLigaDbMatch(rawMatch({ leagueShortcut: 'bl1', team1: { teamId: 3, teamName: 'FC Bayern München' } }), NOW)!;
  assert.equal(club.homeTeam.name, 'FC Bayern München');
});
