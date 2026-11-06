/**
 * Football admin bounded context — frontend contracts for the Futbol control
 * center. Mirrors the backend `/v2/admin/football/*` payloads and derives the
 * coverage/availability states that the admin sections render. Nothing here is
 * fabricated: every field comes from a backend payload or is derived from one.
 */

import { FootballBroadcastDTO } from '../football.models';

export type FootballProviderState = 'healthy' | 'degraded' | 'unconfigured';

/**
 * Provider rights/eligibility verdicts (subset of the classification vocabulary
 * in M06-PROVIDER-ELIGIBILITY.md). A provider whose verdict is
 * `blocked` or `legal-review-required` must render `legally-blocked`, never
 * `available` — even when it is technically `configured`.
 */
export type ProviderEligibility =
  | 'approved-verified'
  | 'approved-limited'
  | 'legal-review-required'
  | 'blocked'
  | 'not-measured';

export interface FootballAdminProvider {
  configured: boolean;
  state: FootballProviderState;
  lastError?: string | null;
  eligibility: ProviderEligibility;
}

export interface FootballAdminOverview {
  generatedAt: string | null;
  provider: FootballAdminProvider;
  activeCompetitions: number;
  totalTeams: number;
  upcomingFixtures: number;
  fixturesMissingBroadcast: number;
  broadcastMappings: number;
  staleCompetitions: number;
  staleTeams: number;
  unmappedCompetitions: number;
  unmappedTeams: number;
  lastSuccessfulSync: string | null;
  lastFailedSync: string | null;
}

/**
 * The full nine-value coverage vocabulary. `not-covered` is "this competition
 * has no approved provider" ("Competicion sin cobertura") and must never be
 * rendered like an empty match list ("no hay partidos hoy"). `not-yet-measured`
 * is the honest pre-probe default and can never read as `available`.
 */
export type CompetitionCoverageState =
  | 'available'
  | 'partial'
  | 'missing'
  | 'not-supported'
  | 'not-covered'
  | 'stale'
  | 'temporarily-unavailable'
  | 'legally-blocked'
  | 'not-yet-measured';

export interface FootballCompetitionCoverage {
  id: string;
  name: string;
  country?: string | null;
  currentSeason?: string | null;
  providerIds: Record<string, string>;
  lastUpdatedAt: string;
  /** Derived from eligibility AND a non-empty provider mapping. Never hardcoded. */
  hasApprovedProvider: boolean;
  state: CompetitionCoverageState;
}

export interface FootballCoverageReport {
  provider: FootballAdminProvider;
  competitions: FootballCompetitionCoverage[];
  matrix: CoverageMatrixEntry[];
}

export type FootballAdminEntityKind = 'competition' | 'team';

export interface FootballAdminEntity {
  id: string;
  name: string;
  kind: FootballAdminEntityKind;
  mapped: boolean;
  stale: boolean;
  lastUpdatedAt: string;
  providerIds: Record<string, string>;
}

export interface FootballAdminJob {
  id: string;
  type: string;
  status: string;
  queuedAt: string | null;
  completedAt: string | null;
  errorSummary: string | null;
}

export interface FootballAdminSyncState {
  provider: FootballAdminProvider;
  lastSuccessfulSync: string | null;
  lastFailedSync: string | null;
  jobs: FootballAdminJob[];
}

export interface FootballAdminQualityReport {
  overview: FootballAdminOverview;
  staleEntities: FootballAdminEntity[];
  unmappedEntities: FootballAdminEntity[];
}

/** Broadcast availability state, surfaced verbatim from a match's broadcasts. */
export type BroadcastAvailability = FootballBroadcastDTO['availability'];

/** Same stale window the backend uses for its overview counts. */
export const COVERAGE_STALE_MS = 6 * 60 * 60 * 1000;

export const COVERAGE_LABELS: Record<CompetitionCoverageState, string> = {
  available: 'Disponible',
  partial: 'Cobertura parcial',
  missing: 'Faltante',
  'not-supported': 'No soportado',
  'not-covered': 'Competicion sin cobertura',
  stale: 'Desactualizado',
  'temporarily-unavailable': 'No disponible temporalmente',
  'legally-blocked': 'Bloqueado legalmente',
  'not-yet-measured': 'Aún no medido',
};

export function isApprovedEligibility(eligibility: ProviderEligibility): boolean {
  return eligibility === 'approved-verified' || eligibility === 'approved-limited';
}

/** Approved = configured AND a documented, non-blocked rights verdict. */
export function isProviderApproved(
  provider: Pick<FootballAdminProvider, 'configured' | 'eligibility'> | null | undefined
): boolean {
  return provider?.configured === true && isApprovedEligibility(provider.eligibility);
}

/**
 * Rights/eligibility gates run before any technical signal: a configured
 * provider that is blocked or under legal review is `legally-blocked`, and an
 * unmeasured provider is `not-yet-measured` — never `available`. Only an
 * approved provider with a non-empty mapping can reach `available`/`partial`.
 */
export function deriveCoverageState(
  competition: Pick<FootballCompetitionCoverage, 'providerIds' | 'lastUpdatedAt'>,
  context: { providerConfigured: boolean; eligibility: ProviderEligibility },
  now: number = Date.now()
): CompetitionCoverageState {
  if (context.eligibility === 'blocked' || context.eligibility === 'legal-review-required') {
    return 'legally-blocked';
  }
  if (context.eligibility === 'not-measured') {
    return 'not-yet-measured';
  }
  const mapped = Object.keys(competition.providerIds ?? {}).length > 0;
  if (!mapped) return 'not-covered';
  if (!context.providerConfigured) return 'temporarily-unavailable';
  const updated = Date.parse(competition.lastUpdatedAt);
  if (!Number.isFinite(updated) || updated < now - COVERAGE_STALE_MS) return 'stale';
  return context.eligibility === 'approved-limited' ? 'partial' : 'available';
}

/** The twelve data aspects the coverage matrix reports, one state per cell. */
export type FootballDataAspect =
  | 'fixtures'
  | 'scores'
  | 'live-minute'
  | 'goal-events'
  | 'cards'
  | 'substitutions'
  | 'lineups'
  | 'statistics'
  | 'standings'
  | 'venues'
  | 'referees'
  | 'broadcasts';

export const FOOTBALL_DATA_ASPECT_LABELS: Record<FootballDataAspect, string> = {
  fixtures: 'Partidos',
  scores: 'Marcadores',
  'live-minute': 'Minuto en directo',
  'goal-events': 'Goles',
  cards: 'Tarjetas',
  substitutions: 'Cambios',
  lineups: 'Alineaciones',
  statistics: 'Estadísticas',
  standings: 'Clasificación',
  venues: 'Estadios',
  referees: 'Árbitros',
  broadcasts: 'Retransmisiones',
};

export interface CoverageMatrixEntry {
  aspect: FootballDataAspect;
  state: CompetitionCoverageState;
}

/**
 * OpenLigaDB capability matrix, sourced from M06-PROVIDER-ELIGIBILITY.md
 * (APPROVED_LIMITED_COVERAGE) and the M06-B adapter contract. Aspects the
 * adapter does not emit are `not-supported`; aspects not yet probed are
 * `not-yet-measured` — never `available` without evidence.
 */
export const OPENLIGADB_COVERAGE_MATRIX: CoverageMatrixEntry[] = [
  { aspect: 'fixtures', state: 'available' },
  { aspect: 'scores', state: 'available' },
  { aspect: 'live-minute', state: 'not-supported' },
  { aspect: 'goal-events', state: 'available' },
  { aspect: 'cards', state: 'not-yet-measured' },
  { aspect: 'substitutions', state: 'not-yet-measured' },
  { aspect: 'lineups', state: 'not-supported' },
  { aspect: 'statistics', state: 'not-supported' },
  { aspect: 'standings', state: 'not-supported' },
  { aspect: 'venues', state: 'partial' },
  { aspect: 'referees', state: 'not-supported' },
  { aspect: 'broadcasts', state: 'available' },
];

export function broadcastAvailabilityLabel(availability: BroadcastAvailability): string {
  switch (availability) {
    case 'tv':
      return 'TV';
    case 'streaming':
      return 'Streaming';
    case 'both':
      return 'TV y streaming';
    default:
      return 'Desconocida';
  }
}
