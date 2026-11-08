/**
 * Provider-core contracts for the football bounded context (M05-A).
 *
 * These types deliberately replace the single monolithic `FootballDataProvider`
 * interface with capability-based contracts: an adapter implements ONLY the
 * sources its provider really supplies, and every merged field on the platform
 * record carries `FieldProvenance | undefined` so absent data stays absent
 * instead of being invented as 0 / '' / a guess.
 *
 * `raw` provider payloads are never stored on these records.
 */

import { FootballMatchStatus, FootballScore } from './types';

/** Known provider ids, kept open so new providers can be added without a breaking change. */
export type ProviderId =
  | 'openligadb'
  | 'football-data-org'
  | 'epg'
  | 'google-search'
  | 'flashscore'
  | (string & {});

export type FootballProviderCapability =
  | 'fixtures'
  | 'results'
  | 'live_score'
  | 'live_minute'
  | 'events'
  | 'lineups'
  | 'statistics'
  | 'standings'
  | 'team_metadata'
  | 'venue'
  | 'referee';

export type ProviderEligibilityState = 'approved' | 'prototype' | 'blocked';

/**
 * The literal `'approved'` may only be used by a registry entry that carries
 * user/owner approval. Every other entry is `'prototype'` (implemented and
 * tested but never selected in production fallback) or `'blocked'`
 * (documented, no adapter, never called).
 */
export interface ProviderEligibility {
  state: ProviderEligibilityState;
  reason: string;
  evidenceRef: string;
  approvedBy?: 'user' | 'owner';
}

export type FieldVerification = 'verified' | 'inferred' | 'derived' | 'single_source';

export interface FieldProvenance {
  provider: ProviderId;
  sourceTimestamp?: string;
  ingestedAt: string;
  verification: FieldVerification;
  /** 0..1 — how much we trust this particular value. */
  confidence: number;
  /** True when another source disagreed and the disagreement was kept for audit. */
  conflict: boolean;
}

export interface ProvenancedValue<T> {
  value: T;
  provenance: FieldProvenance;
}

export interface ProviderTeamRef {
  providerTeamId?: string;
  name: string;
  shortName?: string;
  wikidataId?: string;
}

export interface ProviderMatchEvent {
  id?: string;
  /** e.g. 'goal' | 'card' | 'substitution' | 'var'. */
  type: string;
  /** Only present when the provider explicitly reports it. */
  minute?: number;
  player?: string;
  team?: string;
  scoreHome?: number;
  scoreAway?: number;
  penalty?: boolean;
  ownGoal?: boolean;
  disallowed?: boolean;
  phase?: 'regular' | 'extra_time' | 'penalties';
  sourceTimestamp?: string;
}

/** One provider's view of a single match. `raw` is deliberately NOT stored. */
export interface ProviderMatchRecord {
  providerId: ProviderId;
  providerMatchId: string;
  competitionSlug: string;
  competitionName?: string;
  season?: string;
  round?: string;
  /** ISO timestamp. */
  kickoff: string;
  home: ProviderTeamRef;
  away: ProviderTeamRef;
  status?: FootballMatchStatus;
  /** Only when the provider supplies it; never derived from kickoff. */
  minute?: number | null;
  score?: FootballScore;
  /** Penalty shootout score, kept separate from the regulation score. */
  penaltyScore?: FootballScore;
  events?: ProviderMatchEvent[];
  statistics?: Record<string, unknown>;
  lineups?: unknown;
  venue?: string;
  referee?: string;
  /** When the provider last reported this record. */
  sourceTimestamp?: string;
  capabilities: FootballProviderCapability[];
}

export interface ProviderFixtureQuery {
  competitionSlug?: string;
  season?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface ProviderFixtureSource {
  getFixtures(query: ProviderFixtureQuery): Promise<ProviderMatchRecord[]>;
}

export interface ProviderLiveSource {
  getLiveMatches(query?: ProviderFixtureQuery): Promise<ProviderMatchRecord[]>;
}

export interface ProviderEventSource {
  getMatchEvents(providerMatchId: string): Promise<ProviderMatchEvent[]>;
}

export interface ProviderStandingRecord {
  position: number;
  team: ProviderTeamRef;
  played?: number;
  won?: number;
  drawn?: number;
  lost?: number;
  goalsFor?: number;
  goalsAgainst?: number;
  points?: number;
}

export interface ProviderStandingSource {
  getStandings(competitionSlug: string, season?: string): Promise<ProviderStandingRecord[]>;
}

export interface ProviderTeamRecord {
  providerTeamId?: string;
  name: string;
  shortName?: string;
  wikidataId?: string;
  competitionSlugs?: string[];
}

export interface ProviderTeamSource {
  getTeams(competitionSlug?: string): Promise<ProviderTeamRecord[]>;
}

export interface ConflictRecord {
  field: string;
  chosen: unknown;
  rejected: { value: unknown; provenance: FieldProvenance }[];
  reason: string;
}

export interface AuditRecord {
  kind:
    | 'score_correction'
    | 'removed_event'
    | 'rescheduled'
    | 'status_change'
    | 'deduplicated_event';
  field?: string;
  detail: string;
  at: string;
  provider?: ProviderId;
  before?: unknown;
  after?: unknown;
}

/**
 * The merged platform record: every critical field carries
 * `FieldProvenance | undefined` — absent when no provider supplied it.
 */
export interface PlatformMatchRecord {
  identityKey: string;
  competition?: ProvenancedValue<string>;
  season?: ProvenancedValue<string>;
  kickoff?: ProvenancedValue<string>;
  status?: ProvenancedValue<FootballMatchStatus>;
  homeTeam?: ProvenancedValue<string>;
  awayTeam?: ProvenancedValue<string>;
  score?: ProvenancedValue<FootballScore>;
  penaltyScore?: ProvenancedValue<FootballScore>;
  minute?: ProvenancedValue<number | null>;
  venue?: ProvenancedValue<string>;
  referee?: ProvenancedValue<string>;
  events?: ProvenancedValue<ProviderMatchEvent[]>;
  statistics?: ProvenancedValue<Record<string, unknown>>;
  lineups?: ProvenancedValue<unknown>;
  conflicts: ConflictRecord[];
  audit: AuditRecord[];
  lastUpdatedAt: string;
}

export interface EnrichedMatch extends PlatformMatchRecord {
  matchId: string;
  providerIds: ProviderId[];
  quarantined: boolean;
  quarantineReason?: string;
}
