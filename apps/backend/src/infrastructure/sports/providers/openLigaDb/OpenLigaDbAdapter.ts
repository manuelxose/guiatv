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
 *  - `leagueShortcut`              -> catalog slug (bl1 -> bundesliga)
 *
 * **Live minute is always undefined**: OpenLigaDB supplies no live minute, and
 * it must never be derived from kickoff. The goal event's `minute` is the
 * provider's `matchMinute` for that *goal*, not the live match clock.
 *
 * The mapping functions are exported standalone (like `FootballNormalizer.ts`
 * and `FootballDataOrgAdapter.ts`) so they're unit-testable against captured
 * payloads without HTTP mocking. No `Date.now()` inside mapping — pass `now`.
 */

import { FootballMatch, FootballScore, FootballTeam } from '@/domain/sports/football/types';
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
 * Only `bl1 -> bundesliga` is verified (captain probe). Other OpenLigaDB
 * leagues would need a catalog entry + a documented mapping here.
 */
export const OPENLIGADB_COMPETITION_MAP: Readonly<Record<string, string>> = {
  bl1: 'bundesliga',
};

export function resolveCompetitionSlug(leagueShortcut: unknown): string | null {
  const key = String(leagueShortcut ?? '').trim().toLowerCase();
  return OPENLIGADB_COMPETITION_MAP[key] ?? null;
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
    competition: {
      id: `catalog:${catalogEntry.slug}`,
      slug: catalogEntry.slug,
      name: catalogEntry.name,
      shortName: catalogEntry.shortName,
    },
    season: record.leagueSeason != null ? String(record.leagueSeason) : undefined,
    round: typeof record.group?.groupName === 'string' ? record.group.groupName : undefined,
    kickoffAt: record.matchDateTimeUTC,
    status: record.matchIsFinished === true ? 'finished' : 'scheduled',
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
    const raw = await this.client.getMatchdata(leagueShortcut, season);
    validateOpenLigaDbPayload(raw);
    const matches: FootballMatch[] = [];
    for (const item of raw) {
      const mapped = mapOpenLigaDbMatch(item, now);
      if (mapped) matches.push(mapped);
    }
    return matches;
  }
}
