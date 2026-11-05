/** Sports v2 domain model. Pure types: no Angular, no HTTP, no legacy imports. */

export type MatchStatus = 'live' | 'finished' | 'scheduled' | 'postponed';

export interface Team {
  readonly slug: string;
  readonly name: string;
  readonly shortName: string; // 3 letters, used for the monogram badge
  readonly hue: number; // 0-359, deterministic badge colour (no licensed crests yet)
  readonly city?: string;
  readonly founded?: number;
}

/** A band of table positions with a verified meaning (only supplied when the rules are known). */
export interface StandingZone {
  readonly from: number; // first position, 1-based, inclusive
  readonly to: number; // last position, inclusive
  readonly kind: 'promotion' | 'qualification' | 'relegation';
  readonly label: string;
}

export interface Competition {
  readonly slug: string;
  readonly name: string;
  readonly country: string;
  readonly kind: 'league' | 'cup' | 'international';
  readonly hue: number;
  readonly teamSlugs: readonly string[];
  readonly season?: string;
  readonly description?: string;
  /** Absent when the competition has no verified qualification/relegation rules. */
  readonly zones?: readonly StandingZone[];
}

export interface StandingRow {
  readonly teamSlug: string;
  readonly played: number;
  readonly won: number;
  readonly drawn: number;
  readonly lost: number;
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  readonly points: number;
}

export interface Standings {
  readonly competitionSlug: string;
  /** Already ordered by position. */
  readonly rows: readonly StandingRow[];
}

export interface Broadcast {
  readonly channel: string;
  readonly kind: 'tv' | 'streaming';
}

export interface MatchEvent {
  readonly minute: number;
  readonly type: 'goal' | 'yellow' | 'red' | 'sub';
  readonly side: 'home' | 'away';
  readonly player: string;
}

export interface MatchStat {
  readonly label: string;
  readonly home: number;
  readonly away: number;
  readonly unit?: '%';
}

export interface Lineup {
  readonly formation: string;
  readonly players: readonly string[];
}

export interface Match {
  readonly slug: string;
  readonly competitionSlug: string;
  readonly homeSlug: string;
  readonly awaySlug: string;
  readonly status: MatchStatus;
  readonly kickoff: string; // ISO 8601
  readonly round?: string;
  readonly minute?: number;
  readonly homeScore?: number;
  readonly awayScore?: number;
  readonly events: readonly MatchEvent[];
  readonly stats: readonly MatchStat[];
  readonly lineups?: { readonly home: Lineup; readonly away: Lineup };
  readonly broadcasts: readonly Broadcast[];
}

export interface NewsItem {
  readonly slug: string;
  readonly title: string;
  readonly kicker: string;
  readonly summary: string;
  readonly author: string;
  readonly publishedAt: string;
  readonly body: readonly string[]; // paragraphs
  readonly featured?: boolean;
  readonly competitionSlug?: string;
  readonly teamSlugs?: readonly string[];
  readonly matchSlug?: string;
  /** Licensed editorial image. Absent: the UI draws a neutral gradient from `hue`. */
  readonly image?: { readonly url: string; readonly alt: string };
  readonly hue?: number;
}

export interface SportsSnapshot {
  readonly teams: readonly Team[];
  readonly competitions: readonly Competition[];
  readonly matches: readonly Match[];
  readonly standings: readonly Standings[];
  readonly news: readonly NewsItem[];
}
