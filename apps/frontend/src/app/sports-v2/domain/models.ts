/** Sports v2 domain model. Pure types: no Angular, no HTTP, no legacy imports. */

export type MatchStatus = 'live' | 'finished' | 'scheduled' | 'postponed';

export interface Team {
  readonly slug: string;
  readonly name: string;
  readonly shortName: string; // 3 letters, used for the monogram badge
  readonly hue: number; // 0-359, deterministic badge colour (no licensed crests in M01)
}

export interface Competition {
  readonly slug: string;
  readonly name: string;
  readonly country: string;
  readonly kind: 'league' | 'cup' | 'international';
  readonly hue: number;
  readonly teamSlugs: readonly string[];
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
  readonly publishedAt: string;
  readonly competitionSlug?: string;
}

export interface SportsSnapshot {
  readonly teams: readonly Team[];
  readonly competitions: readonly Competition[];
  readonly matches: readonly Match[];
  readonly news: readonly NewsItem[];
}
