/**
 * Football bounded context — domain contracts.
 *
 * These types are the canonical internal model. Nothing in the presentation or
 * application layers should depend on a provider-specific enum or on the EPG
 * `TvReadItemDTO` shape. Provider adapters translate their own payloads into
 * these types; the rest of the product only ever speaks this language.
 */

export type FootballMatchStatus =
  | 'scheduled'
  | 'live'
  | 'halftime'
  | 'finished'
  | 'postponed'
  | 'suspended'
  | 'cancelled';

export type FootballCompetitionType = 'league' | 'cup' | 'international' | 'national_team' | 'other';

export type BroadcastAvailabilityType = 'tv' | 'streaming' | 'both';

export type BroadcastConfidence = 'high' | 'medium' | 'low';

export interface FootballTeam {
  id: string;
  slug: string;
  name: string;
  shortName?: string;
  country?: string;
  crest?: string | null;
  aliases: string[];
  providerIds: Record<string, string>;
  lastUpdatedAt: string;
}

export interface FootballCompetition {
  id: string;
  slug: string;
  name: string;
  shortName?: string;
  country?: string;
  logo?: string | null;
  type: FootballCompetitionType;
  currentSeason?: string;
  providerIds: Record<string, string>;
  lastUpdatedAt: string;
}

export interface FootballScore {
  home: number | null;
  away: number | null;
}

export interface FootballBroadcast {
  channelId: string;
  channelName: string;
  availability: BroadcastAvailabilityType;
  /** Where the association came from: direct EPG airing, reconciliation, or admin override. */
  provenance: 'airing' | 'reconciliation' | 'override';
  confidence: BroadcastConfidence;
  /** Link to the internal channel page when a stable channel id exists. */
  channelPath?: string;
}

export interface FootballMatch {
  id: string;
  /** Stable, collision-safe public slug (e.g. "real-madrid-barcelona-2026-10-25"). */
  slug: string;
  providerIds: Record<string, string>;
  /**
   * `type` and `country` are carried here because the public competitions list is
   * derived from the stored snapshots: without them every competition rendered
   * as an untyped "Copa" with no country.
   */
  competition: Pick<FootballCompetition, 'id' | 'slug' | 'name' | 'shortName' | 'logo'> &
    Partial<Pick<FootballCompetition, 'type' | 'country'>>;
  season?: string;
  round?: string;
  /** ISO timestamp in Europe/Madrid (stored as UTC internally). */
  kickoffAt: string;
  status: FootballMatchStatus;
  homeTeam: FootballTeam;
  awayTeam: FootballTeam;
  score: FootballScore;
  /** Live minute — only present when a real source reports it. */
  minute?: number | null;
  venue?: string;
  broadcasts: FootballBroadcast[];
  events?: unknown[];
  statistics?: Record<string, unknown>;
  lineups?: unknown;
  sourceProvenance: {
    source: string;
    externalId?: string;
    confidence: BroadcastConfidence;
  };
  lastUpdatedAt: string;
}

export interface FootballStandingRow {
  position: number;
  team: FootballTeam;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form?: string;
}

export type FootballContentType =
  | 'news'
  | 'analysis'
  | 'preview'
  | 'match-report'
  | 'guide'
  | 'ranking'
  | 'trend';

export interface FootballNewsItem {
  id: string;
  slug: string;
  title: string;
  excerpt?: string;
  contentType: FootballContentType;
  author?: { name?: string; id?: string };
  coverImage?: string | null;
  publishedAt: string;
  updatedAt?: string;
  /** Structured relations — never inferred from title keywords alone. */
  sportsRelations: {
    teamIds: string[];
    competitionIds: string[];
    matchIds: string[];
  };
  /** Present only for externally sourced headlines (license-safe). */
  externalSource?: {
    name: string;
    url: string;
  };
  /** Full article HTML — only populated for a single-article (slug) lookup,
   *  never on list surfaces (home, news list), per this file's no-overfetch rule. */
  content?: string;
}

/**
 * Normalization/quality invariants. `issues` is empty for a healthy match.
 */
export interface FootballDataQualityCheck {
  ok: boolean;
  issues: string[];
}

/** Query filters shared by the provider abstraction. */
export interface FootballMatchQuery {
  date?: string; // 'yesterday' | 'today' | 'tomorrow' | YYYYMMDD
  dateFrom?: string;
  dateTo?: string;
  status?: FootballMatchStatus | 'live';
  competitionSlug?: string;
  teamSlug?: string;
  q?: string;
  limit?: number;
}

/**
 * Provider abstraction. The product talks ONLY to this interface; concrete
 * adapters (EPG, football-data.org, …) implement it.
 */
export interface FootballDataProvider {
  readonly key: string;
  readonly name: string;

  getMatches(query: FootballMatchQuery): Promise<FootballMatch[]>;
  getLiveMatches(): Promise<FootballMatch[]>;
  getMatch(idOrSlug: string): Promise<FootballMatch | null>;
  getCompetitions(): Promise<FootballCompetition[]>;
  getCompetition(slug: string): Promise<FootballCompetition | null>;
  getStandings(competitionSlug: string): Promise<FootballStandingRow[]>;
  getTeams(): Promise<FootballTeam[]>;
  getTeam(slug: string): Promise<FootballTeam | null>;
  /** Whether this provider can actually supply live score/minute data. */
  supportsLiveScores(): boolean;
}

/** Status mapping helper: provider status strings → internal domain status. */
export const FOOTBALL_STATUS_MAP: Record<string, FootballMatchStatus> = {
  scheduled: 'scheduled',
  tim: 'scheduled',
  upcoming: 'scheduled',
  live: 'live',
  in_play: 'live',
  playing: 'live',
  first_half: 'live',
  second_half: 'live',
  paused: 'suspended',
  halftime: 'halftime',
  half_time: 'halftime',
  break: 'halftime',
  finished: 'finished',
  ended: 'finished',
  full_time: 'finished',
  after_extra_time: 'finished',
  after_penalties: 'finished',
  postponed: 'postponed',
  delayed: 'postponed',
  suspended: 'suspended',
  interrupted: 'suspended',
  cancelled: 'cancelled',
  canceled: 'cancelled',
};

export function normalizeMatchStatus(raw: unknown): FootballMatchStatus {
  const key = String(raw ?? '').trim().toLowerCase();
  return FOOTBALL_STATUS_MAP[key] ?? 'scheduled';
}

/** States that represent a match currently being played. */
export function isLiveMatchStatus(status: FootballMatchStatus): boolean {
  return status === 'live' || status === 'halftime';
}
