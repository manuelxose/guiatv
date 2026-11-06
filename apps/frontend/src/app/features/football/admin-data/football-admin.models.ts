/**
 * Football admin bounded context — frontend contracts for the Futbol control
 * center. These DTOs mirror the t7 admin API (`/v2/sports/football/admin/*`)
 * exactly (see docs/sports-v2/M06-R1-F01-F09-BACKEND.md and
 * apps/backend/src/application/sports/dto/FootballAdminDTO.ts).
 *
 * Every measurement that can be unknown carries an explicit `AvailabilityState`
 * companion field; the value field is `null`/`undefined` when it is not a real
 * measured value — never a fabricated zero.
 */

/** Explicit availability state for every read-model value that could otherwise be mistaken for a number. */
export type AvailabilityState =
  | 'observed'      // real measured value; 0 is a real observed zero
  | 'empty'         // the read/run succeeded but produced no rows/records
  | 'missing'       // the field is absent from the stored model (unsupported)
  | 'unavailable'   // could not be measured: no database or provider unreachable
  | 'not_covered'   // no eligible provider covers this competition/entity
  | 'not_measured'  // the measurement has not been performed yet
  | 'stale';        // measured, but older than the freshness threshold

/** Spanish labels for the availability states (never color-only in the UI). */
export const AVAILABILITY_LABELS: Record<AvailabilityState, string> = {
  observed: 'Observado',
  empty: 'Sin datos',
  missing: 'No disponible',
  unavailable: 'No disponible',
  not_covered: 'Sin cobertura',
  not_measured: 'Aún no medido',
  stale: 'Desactualizado',
};

/** Maps an availability state to the admin badge vocabulary (tone via text + dot, never color alone). */
export function availabilityBadgeStatus(state: AvailabilityState): string {
  switch (state) {
    case 'observed':
      return 'current';
    case 'empty':
      return 'info';
    case 'missing':
      return 'unknown';
    case 'unavailable':
      return 'unavailable';
    case 'not_covered':
      return 'unconfigured';
    case 'not_measured':
      return 'unknown';
    case 'stale':
      return 'stale';
  }
}

/** Coverage verdicts the t7 `/coverage` endpoint returns per competition. */
export type FootballCoverageState =
  | 'competition_not_covered'
  | 'provider_supported'
  | 'provider_supported_no_fixtures'
  | 'provider_unavailable';

export const COVERAGE_STATE_LABELS: Record<FootballCoverageState, string> = {
  competition_not_covered: 'Competición sin cobertura',
  provider_supported: 'Cubierta',
  provider_supported_no_fixtures: 'Cubierta sin partidos',
  provider_unavailable: 'Proveedor no disponible',
};

export function coverageStateBadgeStatus(state: FootballCoverageState): string {
  switch (state) {
    case 'competition_not_covered':
      return 'unconfigured';
    case 'provider_supported':
      return 'configured';
    case 'provider_supported_no_fixtures':
      return 'info';
    case 'provider_unavailable':
      return 'unavailable';
  }
}

export type FootballIngestionRunOutcome = 'success' | 'partial' | 'failed' | 'skipped' | 'empty';

export const INGESTION_OUTCOME_LABELS: Record<FootballIngestionRunOutcome, string> = {
  success: 'Correcta',
  partial: 'Parcial',
  failed: 'Fallida',
  skipped: 'Omitida',
  empty: 'Sin datos',
};

// ---- Response DTOs (mirror of FootballAdminDTO.ts) ----

export interface FootballDashboardDTO {
  generatedAt: string;
  competitions: number;
  teams: number;
  snapshots: number;
  providers: number;
  broadcastMappings: number;
  staleSnapshots: number;
  lastSyncAt?: string;
  lastSyncOutcome?: FootballIngestionRunOutcome;
  openQualityIssues: number;
  countsState: AvailabilityState;
  lastSyncState: AvailabilityState;
}

export interface FootballProviderSummaryDTO {
  provider: string;
  health: 'ok' | 'degraded' | 'down';
  lastSuccessAt?: string;
  lastErrorAt?: string;
  consecutiveFailures: number | null;
  consecutiveFailuresState: AvailabilityState;
  quotaConsumedToday: number | null;
  quotaConsumedTodayState: AvailabilityState;
  circuitState: string;
}

export interface FootballProviderRunDTO {
  runId: string;
  startedAt: string;
  outcome: string;
  requestsUsed: number | null;
  requestsUsedState: AvailabilityState;
}

export interface FootballProviderDetailDTO extends FootballProviderSummaryDTO {
  quotaResetAt?: string;
  lastRuns: FootballProviderRunDTO[];
}

export interface FootballCoverageRowDTO {
  competitionSlug: string;
  name: string;
  type: string;
  coverageState: FootballCoverageState;
  snapshotCount: number | null;
  snapshotCountState: AvailabilityState;
  seasonLabel?: string;
}

export interface FootballCoverageMatrixDTO {
  generatedAt: string;
  rows: FootballCoverageRowDTO[];
}

export type FootballAdminMatchStatus =
  | 'scheduled'
  | 'live'
  | 'halftime'
  | 'finished'
  | 'postponed'
  | 'suspended'
  | 'cancelled';

export interface FootballAdminMatchDTO {
  matchId: string;
  canonicalKey: string;
  competitionSlug: string;
  kickoffAt?: string;
  kickoffState: AvailabilityState;
  status?: FootballAdminMatchStatus;
  statusState: AvailabilityState;
  homeTeam?: string;
  homeTeamState: AvailabilityState;
  awayTeam?: string;
  awayTeamState: AvailabilityState;
  score?: { home: number | null; away: number | null };
  scoreState: AvailabilityState;
  ingestedAt: string;
  contentHash: string;
}

export interface FootballAdminMatchesDTO {
  page: number;
  limit: number;
  total: number;
  items: FootballAdminMatchDTO[];
}

export interface FootballEntityMappingDTO {
  kind: 'team' | 'competition';
  id: string;
  slug: string;
  name: string;
  providerIds: Record<string, string>;
  lastUpdatedAt?: string;
}

export interface FootballEntityMappingsDTO {
  page: number;
  limit: number;
  total: number;
  items: FootballEntityMappingDTO[];
}

export interface FootballBroadcastDTO {
  matchId: string;
  matchSlug: string;
  channelId: string;
  channelName: string;
  availability: string;
  provenance: string;
  confidence: string;
}

export interface FootballBroadcastsDTO {
  page: number;
  limit: number;
  total: number;
  items: FootballBroadcastDTO[];
}

export interface FootballIngestionStatusDTO {
  generatedAt: string;
  enabled: boolean;
  providers: FootballProviderDetailDTO[];
  lastRun?: {
    startedAt: string;
    finishedAt?: string;
    outcome: string;
    requestsUsed: number | null;
    requestsUsedState: AvailabilityState;
  };
  quota: {
    consumed: number | null;
    disabled: boolean | null;
    throttleUntil?: number;
    resetAt?: string;
    state: AvailabilityState;
  };
}

export interface FootballQualityIssueDTO {
  id: string;
  kind: string;
  competitionSlug?: string;
  message: string;
}

export interface FootballQualityIssuesDTO {
  page: number;
  limit: number;
  total: number;
  items: FootballQualityIssueDTO[];
}

export interface FootballAuditEntryDTO {
  timestamp: string;
  severity: string;
  subsystem: string;
  message: string;
  correlationId?: string;
}

export interface FootballAuditDTO {
  page: number;
  limit: number;
  total: number;
  items: FootballAuditEntryDTO[];
}

export type FootballSyncStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface FootballSyncResultDTO {
  id: string;
  status: FootballSyncStatus;
  correlationId: string;
}

export const SYNC_STATUS_LABELS: Record<FootballSyncStatus, string> = {
  queued: 'Encolada',
  running: 'En ejecución',
  completed: 'Completada',
  failed: 'Fallida',
};

// ---- Query parameters (server-side filters / pagination) ----

export interface PagedQuery {
  page?: number;
  limit?: number;
}

export interface FootballMatchListQuery extends PagedQuery {
  competitionSlug?: string;
  status?: FootballAdminMatchStatus;
  q?: string;
}

export interface FootballAuditQuery extends PagedQuery {
  severity?: 'info' | 'warning' | 'critical';
  subsystem?: string;
}

// ---- Client error contract ----

export type AdminApiErrorKind =
  | 'unauthorized' // 401 / 403 — the admin boundary rejected the request
  | 'validation'   // 400 — a malformed filter/pagination value
  | 'not_found'    // 404 — detail lookup found nothing
  | 'unavailable'  // 5xx or unknown — the API could not answer
  | 'network';     // 0 — the browser could not reach the API

export class AdminApiError extends Error {
  constructor(
    readonly kind: AdminApiErrorKind,
    readonly status: number,
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

/** Spanish copy for a load failure, per error kind (surfaces validation text, never swallows it). */
export function adminApiErrorMessage(error: AdminApiError): string {
  switch (error.kind) {
    case 'unauthorized':
      return 'No tienes permisos para ver estos datos. Vuelve a iniciar sesión como administrador.';
    case 'validation':
      return `La consulta no es válida: ${error.message}`;
    case 'not_found':
      return 'No se encontró el elemento solicitado.';
    case 'network':
      return 'No se pudo conectar con el servidor. Comprueba tu conexión.';
    case 'unavailable':
    default:
      return 'El servicio no está disponible en este momento. Inténtalo de nuevo.';
  }
}

/** Broadcast availability → Spanish label (admin broadcast rows carry a string, not the public enum). */
export function broadcastAvailabilityLabel(availability: string): string {
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
