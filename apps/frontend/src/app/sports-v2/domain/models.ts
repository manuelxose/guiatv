/** Sports v2 domain model. Pure types: no Angular, no HTTP, no legacy imports. */

export type MatchStatus = 'live' | 'finished' | 'scheduled' | 'postponed';

/** Finer-grained phase within a status. Only reported when the provider reports it (or status makes it unambiguous). */
export type MatchPhase =
  | 'scheduled'
  | 'first_half'
  | 'halftime'
  | 'second_half'
  | 'extra_time'
  | 'penalties'
  | 'finished';

export interface Team {
  readonly slug: string;
  readonly name: string;
  readonly shortName: string; // 3 letters, used for the monogram badge
  readonly hue: number; // 0-359, deterministic badge colour (fallback when no crest)
  /** Provider-supplied crest (validated https URL). Absent: the UI draws a monogram. */
  readonly crestUrl?: string;
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
  /** Provider-supplied competition logo (validated https URL). Absent: neutral trophy icon. */
  readonly logoUrl?: string;
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

/** A broadcaster that passed verification (EPG airing, high-confidence reconciliation or editorial override). */
export interface Broadcast {
  readonly channel: string;
  readonly kind: 'tv' | 'streaming';
  /** Internal GuíaTV channel page, when a stable one exists. */
  readonly channelPath?: string;
  readonly evidence?: 'airing' | 'reconciliation' | 'override';
  /** Medium-confidence EPG reconciliation: likely, not confirmed. */
  readonly probable?: boolean;
}

/** Widened event vocabulary. `sub` is kept as a legacy alias for `substitution` (demo fixtures). */
export type MatchEventType =
  | 'goal'
  | 'own_goal'
  | 'penalty'
  | 'penalty_missed'
  | 'goal_disallowed'
  | 'var'
  | 'yellow'
  | 'second_yellow'
  | 'red'
  | 'substitution'
  | 'assist'
  | 'sub';

export interface ScoreLine {
  readonly home: number;
  readonly away: number;
}

export interface MatchEvent {
  readonly minute: number;
  /** Stoppage-time minute shown as `+N` after `minute`. Absent when the provider did not report it. */
  readonly addedMinute?: number;
  readonly type: MatchEventType;
  /** Home or away, for layout and legacy fixtures. Absent when the provider did not identify a side. */
  readonly side?: 'home' | 'away';
  /** Slug of the scoring/booking team, when the provider reports it (more precise than `side`). */
  readonly teamSlug?: string;
  /** Player name (legacy single field). */
  readonly player?: string;
  readonly playerName?: string;
  readonly assistName?: string;
  /** Score line immediately after the event. Supplied by the provider; never inferred. */
  readonly scoreAfter?: ScoreLine;
  /** Free-form provider detail (e.g. "Own Goal", "Penalty", "VAR overturn"). */
  readonly detail?: string;
}

export interface MatchStat {
  readonly label: string;
  /** Real value supplied by the provider. Absent (undefined) is never rendered as 0. */
  readonly home?: number;
  readonly away?: number;
  readonly unit?: '%';
}

export interface LineupPlayer {
  readonly number?: number;
  readonly name: string;
  readonly position?: string;
  /** True when the provider reports the player left the pitch (substituted off). */
  readonly substitutedOut?: boolean;
}

export interface Lineup {
  readonly formation?: string;
  readonly coach?: string;
  /** Legacy flat list of names (demo data); providers use `starters`/`bench`. */
  readonly players?: readonly string[];
  readonly starters?: readonly LineupPlayer[];
  readonly bench?: readonly LineupPlayer[];
}

export interface MatchLineups {
  readonly home?: Lineup;
  readonly away?: Lineup;
}

export interface Match {
  readonly slug: string;
  readonly competitionSlug: string;
  readonly homeSlug: string;
  readonly awaySlug: string;
  readonly status: MatchStatus;
  readonly phase?: MatchPhase;
  readonly kickoff: string; // ISO 8601
  readonly round?: string;
  readonly minute?: number;
  /** Stoppage time announced for the live minute. Absent when the provider does not report it. */
  readonly injuryTime?: number;
  readonly venue?: string;
  readonly referee?: string;
  readonly homeScore?: number;
  readonly awayScore?: number;
  /** Real events, sorted by minute and deduped. Absent when the provider supplied none. */
  readonly events?: readonly MatchEvent[];
  /** Real statistics. Absent when the provider supplied none. */
  readonly stats?: readonly MatchStat[];
  readonly lineups?: MatchLineups;
  readonly broadcasts: readonly Broadcast[];
  /** When the provider last changed this fixture (ISO). Absent for demo data. */
  readonly updatedAt?: string;
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
  /** Canonical public URL of the editorial article (the CMS owns it; v2 never republishes it). */
  readonly canonicalPath?: string;
}

export interface SportsSnapshot {
  readonly teams: readonly Team[];
  readonly competitions: readonly Competition[];
  readonly matches: readonly Match[];
  readonly standings: readonly Standings[];
  readonly news: readonly NewsItem[];
}

/** A result from the rest of Guía TV (programmes, films, series) found by the site-wide search. */
export interface SiteResult {
  readonly title: string;
  readonly meta: string;
  /** Absolute in-app path (never an external URL). */
  readonly path: string;
}
