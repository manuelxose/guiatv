/**
 * OpenLigaDB provider adapter.
 *
 * Validates the payload before mapping (reject malformed input with a typed
 * `OpenLigaDbError`, never a raw parse error), then maps the documented match
 * JSON into the domain `FootballMatch` shape:
 *
 *  - `matchDateTimeUTC`            -> kickoffAt
 *  - `matchIsFinished`             -> finished/scheduled
 *  - `matchResults` (After90Minutes / HalfTime) -> score + halftime score
 *  - `goals[]`                     -> typed goal events (minute from `matchMinute`,
 *                                     goalID as providerEventId, scorer, penalty,
 *                                     ownGoal, overtime, scoreAfter)
 *  - `team1`/`team2`               -> teams with `providerIds.openligadb`
 *  - `location.locationStadium`    -> venue
 *  - `group.groupName`             -> round
 *  - `leagueShortcut`              -> catalog slug via OPENLIGADB_COMPETITION_MAP
 *
 * **Absent fields stay absent** (captain probe, 2026-11-06): OpenLigaDB has NO
 * referee, NO lineups, NO team statistics, NO standings and NO live minute, so
 * none of those may be emitted. The only `statistics` entry is the halftime
 * score, which is a real `matchResults[resultTypeKind=HalfTime]` result — never
 * a fabricated team statistic. **Live minute is always undefined** and must
 * never be derived from kickoff; a goal event's `minute` is the provider's
 * `matchMinute` for that *goal*, not the live match clock.
 *
 * Goal events carry the provider's `goalID` as a stable `providerEventId`
 * (independent of kickoff date, so a reschedule cannot change a goal's identity),
 * plus penalty/own-goal/overtime flags. A goal whose `scoringTeamId` is absent
 * is preserved side-less (`teamId` undefined) — the adapter never guesses a side.
 *
 * The mapping functions are exported standalone (like `FootballNormalizer.ts`
 * and `FootballDataOrgAdapter.ts`) so they're unit-testable against captured
 * payloads without HTTP mocking. No `Date.now()` inside mapping — pass `now`.
 */

import { FootballMatch, FootballScore, FootballTeam, FootballStandingRow } from '@/domain/sports/football/types';
import { buildMatchSlug, slugify } from '@/application/sports/services/FootballNormalizer';
import { getCompetitionCatalogBySlug } from '@/application/sports/services/FootballCompetitionCatalog';
import { OpenLigaDbClient, OpenLigaDbError } from './OpenLigaDbClient';

export interface OpenLigaDbGoalEvent {
  providerEventId: string;
  /** The goal's own minute (`matchMinute`), not the live match clock. */
  minute: number | null;
  /** Scorer name, absent when the provider did not report one (never an empty string). */
  scorer?: string;
  /** Scoring team's provider id, absent when the provider did not report it. */
  teamId?: string;
  penalty: boolean;
  ownGoal: boolean;
  overtime: boolean;
  scoreAfter: FootballScore;
}

/**
 * Explicit league mapping; unknown shortcuts are skipped, never guessed.
 *
 * Every entry is backed by captain probe evidence under `artifacts/m06/probes/`
 * (openligadb-leagues-2026.json maps each shortcut to a real 2026/27 league;
 * openligadb-quality-2026.json reports the observed fixture/goal counts). The
 * shortcuts mapped here are exactly the verified set; anything else (e.g. `bl3`,
 * `wm2026`, `pl1`, `la1`, `esp`) resolves to `null` and is never fetched.
 */
export const OPENLIGADB_COMPETITION_MAP: Readonly<Record<string, string>> = {
  bl1: 'bundesliga',
  ucl: 'champions-league',
  uel2026: 'europa-league',
  uecl2026: 'conference-league',
  pl: 'premier-league',
  dfb: 'dfb-pokal',
  bl2: 'bundesliga-2',
  // Verified by probe 2026-11-06: 380 real 2026/27 fixtures since 2026-08-15.
  la1: 'laliga',
};

export function resolveCompetitionSlug(leagueShortcut: unknown): string | null {
  const key = String(leagueShortcut ?? '').trim().toLowerCase();
  return OPENLIGADB_COMPETITION_MAP[key] ?? null;
}

/**
 * OpenLigaDB's `leagueSeason` is the calendar year the season STARTS in, so
 * `2026` means the 2026/27 season. The raw value is preserved for provenance;
 * this helper derives the human label without fabricating a value.
 */
export function openLigaDbSeasonLabel(leagueSeason: unknown): string | undefined {
  const parsed =
    typeof leagueSeason === 'number'
      ? leagueSeason
      : Number(String(leagueSeason ?? '').trim());
  if (!Number.isInteger(parsed) || parsed < 1990 || parsed > 2100) return undefined;
  return `${parsed}/${String(parsed + 1).slice(2)}`;
}

/**
 * Competition coverage for one OpenLigaDB shortcut. Callers can tell apart:
 *  - `competition_not_covered`        shortcut not in the verified map (never guessed);
 *  - `provider_supported`             shortcut mapped and catalog entry present;
 *  - `provider_supported_no_fixtures` supported, but the season returned no fixtures;
 *  - `provider_unavailable`           provider errored before fixtures were observed.
 */
export type OpenLigaDbCoverageState =
  | 'competition_not_covered'
  | 'provider_supported'
  | 'provider_supported_no_fixtures'
  | 'provider_unavailable';

export interface OpenLigaDbCoverageDescriptor {
  state: OpenLigaDbCoverageState;
  leagueShortcut: string;
  season: string;
  /** Human season label (e.g. "2026/27") when the raw season is a real start year. */
  seasonLabel?: string;
  /** Catalog slug the shortcut resolves to (present only when supported). */
  competitionSlug?: string;
  /** Human-readable reason for the non-supported / unavailable states. */
  reason?: string;
}

/** Classifies a shortcut WITHOUT issuing a request (pure, budget-free). */
export function resolveOpenLigaDbCoverage(
  leagueShortcut: unknown,
  season: string | number
): OpenLigaDbCoverageDescriptor {
  const shortcut = String(leagueShortcut ?? '').trim().toLowerCase();
  const competitionSlug = resolveCompetitionSlug(shortcut);
  if (!competitionSlug || !getCompetitionCatalogBySlug(competitionSlug)) {
    return {
      state: 'competition_not_covered',
      leagueShortcut: shortcut,
      season: String(season),
      seasonLabel: openLigaDbSeasonLabel(season),
      reason: `OpenLigaDB shortcut "${shortcut}" has no verified competition mapping`,
    };
  }
  return {
    state: 'provider_supported',
    leagueShortcut: shortcut,
    season: String(season),
    seasonLabel: openLigaDbSeasonLabel(season),
    competitionSlug,
  };
}

/**
 * Folds a fetch outcome into a coverage descriptor. `provider_supported`
 * stays supported when fixtures exist, becomes `provider_supported_no_fixtures`
 * for an empty payload, and `provider_unavailable` on a provider error.
 */
export function classifyOpenLigaDbFetch(
  coverage: OpenLigaDbCoverageDescriptor,
  outcome: { matches: FootballMatch[] } | { error: unknown }
): OpenLigaDbCoverageDescriptor {
  if (coverage.state !== 'provider_supported') return coverage;
  if ('error' in outcome) {
    const kind = outcome.error instanceof OpenLigaDbError ? outcome.error.kind : 'http';
    return {
      ...coverage,
      state: 'provider_unavailable',
      reason: `OpenLigaDB request failed (${kind})`,
    };
  }
  if (outcome.matches.length === 0) {
    return {
      ...coverage,
      state: 'provider_supported_no_fixtures',
      reason: 'OpenLigaDB returned an empty fixture list for this season',
    };
  }
  return coverage;
}


export function validateOpenLigaDbPayload(raw: unknown): asserts raw is unknown[] {
  if (!Array.isArray(raw)) {
    throw new OpenLigaDbError({ kind: 'malformed', message: 'OpenLigaDB payload is not an array of matches' });
  }
}

function asRecord(raw: unknown): Record<string, any> | null {
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, any>) : null;
}

export function mapOpenLigaDbMatch(raw: unknown, now: Date): FootballMatch | null {
  const record = asRecord(raw);
  if (!record) return null;
  if (record.matchID == null) return null;
  if (typeof record.matchDateTimeUTC !== 'string') return null;
  const team1 = asRecord(record.team1);
  const team2 = asRecord(record.team2);
  if (!team1 || !team2) return null;
  if (team1.teamId == null || team2.teamId == null) return null;
  if (typeof team1.teamName !== 'string' || typeof team2.teamName !== 'string') return null;

  const competitionSlug = resolveCompetitionSlug(record.leagueShortcut);
  if (!competitionSlug) return null;
  const catalogEntry = getCompetitionCatalogBySlug(competitionSlug);
  if (!catalogEntry) return null;

  const homeTeam = mapTeam(team1, now);
  const awayTeam = mapTeam(team2, now);
  const score = mapResultScore(record.matchResults, 'After90Minutes') ?? { home: null, away: null };
  const halftimeScore = mapResultScore(record.matchResults, 'HalfTime');
  const events = mapGoalEvents(record.goals);

  return {
    id: String(record.matchID),
    slug: buildMatchSlug(homeTeam.name, awayTeam.name, record.matchDateTimeUTC),
    providerIds: { openligadb: String(record.matchID) },
    // Keep the catalogue's type and country: the public competitions list is
    // built FROM these stored snapshots, so dropping them here made every
    // competition render as an untyped "Copa" with no country.
    competition: {
      id: `catalog:${catalogEntry.slug}`,
      slug: catalogEntry.slug,
      name: catalogEntry.name,
      shortName: catalogEntry.shortName,
      country: catalogEntry.country,
      type: catalogEntry.type,
    },
    season: record.leagueSeason != null ? String(record.leagueSeason) : undefined,
    round: typeof record.group?.groupName === 'string' ? record.group.groupName : undefined,
    kickoffAt: record.matchDateTimeUTC,
    // OpenLigaDB only tells us "finished or not" (no live minute), so a match is
    // LIVE when it has not finished AND its kickoff already passed. That is a
    // statement about the clock, never an invented scoreline: the score shown is
    // whatever real result the provider currently has, which may still be empty.
    status: record.matchIsFinished === true ? 'finished' : isKickoffPassed(record.matchDateTimeUTC, now) ? 'live' : 'scheduled',
    homeTeam,
    awayTeam,
    score,
    // `minute` is intentionally omitted: OpenLigaDB has no live minute.
    venue:
      typeof record.location?.locationStadium === 'string'
        ? record.location.locationStadium
        : typeof record.location?.locationCity === 'string'
          ? record.location.locationCity
          : undefined,
    broadcasts: [],
    events,
    statistics: halftimeScore ? { halftime: halftimeScore } : undefined,
    sourceProvenance: {
      source: 'openligadb',
      externalId: String(record.matchID),
      confidence: 'high',
    },
    lastUpdatedAt:
      typeof record.lastUpdateDateTime === 'string' ? record.lastUpdateDateTime : now.toISOString(),
  };
}

/** True once the kickoff instant has passed (a live match the provider has not closed). */
function isKickoffPassed(kickoffAt: string, now: Date): boolean {
  const t = Date.parse(kickoffAt);
  return !Number.isNaN(t) && t <= now.getTime();
}

function mapTeam(raw: Record<string, any>, now: Date): FootballTeam {
  const name = String(raw.teamName);
  const providerId = String(raw.teamId);
  return {
    id: `openligadb:${providerId}`,
    slug: slugify(name),
    name,
    shortName: typeof raw.shortName === 'string' ? raw.shortName : undefined,
    crest: typeof raw.teamIconUrl === 'string' ? raw.teamIconUrl : null,
    aliases: [name, typeof raw.shortName === 'string' ? raw.shortName : undefined].filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    ),
    providerIds: { openligadb: providerId },
    lastUpdatedAt: now.toISOString(),
  };
}

function findResult(matchResults: unknown, kind: string): Record<string, any> | null {
  if (!Array.isArray(matchResults)) return null;
  for (const item of matchResults) {
    const record = asRecord(item);
    if (record?.resultTypeKind === kind) return record;
  }
  return null;
}

function mapResultScore(matchResults: unknown, kind: string): FootballScore | null {
  const result = findResult(matchResults, kind);
  if (!result) return null;
  const home = isFinite(result.pointsTeam1) ? result.pointsTeam1 : null;
  const away = isFinite(result.pointsTeam2) ? result.pointsTeam2 : null;
  if (home === null && away === null) return null;
  return { home, away };
}

function isFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Maps goal events verbatim. `providerEventId` is the provider's `goalID`
 * (stable across a kickoff reschedule), `teamId` is left `undefined` for a
 * side-less goal, and `scoreAfter` is the provider's running score — it is
 * never rewritten to match the final result. A running-score/final-result
 * disagreement (captain quality probe: pl 1, uel 2, wm2026 4, dfb 5) is
 * therefore surfaced, never silently repaired.
 */
function mapGoalEvents(goals: unknown): OpenLigaDbGoalEvent[] {
  if (!Array.isArray(goals)) return [];
  const events: OpenLigaDbGoalEvent[] = [];
  for (const goal of goals) {
    const record = asRecord(goal);
    if (!record || record.goalID == null) continue;
    events.push({
      providerEventId: String(record.goalID),
      minute: isFinite(record.matchMinute) ? record.matchMinute : null,
      scorer: typeof record.goalGetterName === 'string' && record.goalGetterName.trim() ? record.goalGetterName : undefined,
      teamId: record.scoringTeamId != null ? String(record.scoringTeamId) : undefined,
      penalty: record.isPenalty === true,
      ownGoal: record.isOwnGoal === true,
      overtime: record.isOvertime === true,
      scoreAfter: {
        home: isFinite(record.scoreTeam1) ? record.scoreTeam1 : null,
        away: isFinite(record.scoreTeam2) ? record.scoreTeam2 : null,
      },
    });
  }
  return events;
}

export class OpenLigaDbAdapter {
  readonly key = 'openligadb';
  readonly name = 'OpenLigaDB';

  constructor(private readonly client: OpenLigaDbClient) {}

  async fetchMatches(
    leagueShortcut: string,
    season: string | number,
    now: Date = new Date()
  ): Promise<FootballMatch[]> {
    // Unknown shortcuts never fall back to another competition and are never
    // fetched — skip before spending a request (respects the RequestBudget).
    if (resolveOpenLigaDbCoverage(leagueShortcut, season).state === 'competition_not_covered') {
      return [];
    }
    const raw = await this.client.getMatchdata(leagueShortcut, season);
    validateOpenLigaDbPayload(raw);
    const matches: FootballMatch[] = [];
    for (const item of raw) {
      const mapped = mapOpenLigaDbMatch(item, now);
      if (mapped) matches.push(mapped);
    }
    return matches;
  }

  /**
   * Fetch with a coverage descriptor so callers can distinguish
   * `competition_not_covered` / `provider_supported_no_fixtures` /
   * `provider_unavailable`. Never throws: a provider error is folded into the
   * descriptor and the match list is empty.
   */
  async fetchMatchesWithCoverage(
    leagueShortcut: string,
    season: string | number,
    now: Date = new Date()
  ): Promise<{ coverage: OpenLigaDbCoverageDescriptor; matches: FootballMatch[] }> {
    const base = resolveOpenLigaDbCoverage(leagueShortcut, season);
    if (base.state === 'competition_not_covered') {
      return { coverage: base, matches: [] };
    }
    try {
      const raw = await this.client.getMatchdata(leagueShortcut, season);
      validateOpenLigaDbPayload(raw);
      const matches: FootballMatch[] = [];
      for (const item of raw) {
        const mapped = mapOpenLigaDbMatch(item, now);
        if (mapped) matches.push(mapped);
      }
      return { coverage: classifyOpenLigaDbFetch(base, { matches }), matches };
    } catch (error) {
      return { coverage: classifyOpenLigaDbFetch(base, { error }), matches: [] };
    }
  }
}

/**
 * F27: maps the provider's own league table (getbltable) into our standing rows.
 * These are OFFICIAL season numbers, so played/points may exceed what our own
 * finished-match arithmetic produced (we only hold the fixtures we fetched).
 */
export function mapBlTable(raw: unknown): FootballStandingRow[] {
  const rows = Array.isArray(raw) ? raw : [];
  const mapped = rows
    .filter((r: any) => r && (r.teamName || r.teamInfoId))
    .map((r: any) => ({
      position: Number(r.rank ?? 0) || 0,
      team: {
        id: `openligadb:${String(r.teamInfoId ?? r.teamId)}`,
        slug: slugify(String(r.teamName)),
        name: String(r.teamName),
        shortName: typeof r.shortName === 'string' ? r.shortName : undefined,
        crest: typeof r.teamIconUrl === 'string' ? r.teamIconUrl : null,
        aliases: [],
        providerIds: { openligadb: String(r.teamInfoId ?? r.teamId) },
        lastUpdatedAt: new Date().toISOString(),
      } as FootballTeam,
      played: Number(r.matches ?? 0),
      won: Number(r.won ?? 0),
      drawn: Number(r.draw ?? 0),
      lost: Number(r.lost ?? 0),
      goalsFor: Number(r.goals ?? 0),
      goalsAgainst: Number(r.opponentGoals ?? 0),
      goalDifference: Number(r.goalDiff ?? 0),
      points: Number(r.points ?? 0),
    }))
    .sort((x, y) => y.points - x.points || y.goalDifference - x.goalDifference || y.goalsFor - x.goalsFor);
  mapped.forEach((r, i) => { if (!r.position) r.position = i + 1; });
  return mapped as FootballStandingRow[];
}

