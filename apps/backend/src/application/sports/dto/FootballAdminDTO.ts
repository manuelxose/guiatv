/**
 * Football admin API — typed DTOs and hand-rolled query validators.
 *
 * Query validation is hand-rolled on purpose: `zod` is only present as a
 * transitive dependency and must not be imported from backend source (an
 * undeclared-dependency defect). Every parser bounds integers, whitelists enums
 * and caps page sizes. A malformed value yields `{ ok: false }` so the
 * controller can answer 400 without reaching the database.
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

export const ok = <T>(value: T): ParseResult<T> => ({ ok: true, value });
export const fail = (message: string): ParseResult<never> => ({ ok: false, message });

/** Bounds for every paginated read (shared, documented in the runbook). */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

/** Parses a positive page number; absent → 1, non-integer → fail. */
export function parsePage(value: unknown): ParseResult<number> {
  if (value === undefined || value === null || value === '') return ok(1);
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return fail(`page must be a positive integer (got "${String(value)}")`);
  return ok(n);
}

/** Parses a bounded page size; absent → default, capped at MAX_PAGE_SIZE. */
export function parseLimit(value: unknown): ParseResult<number> {
  if (value === undefined || value === null || value === '') return ok(DEFAULT_PAGE_SIZE);
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return fail(`limit must be a positive integer (got "${String(value)}")`);
  return ok(Math.min(MAX_PAGE_SIZE, n));
}

/** Whitelist enum parser; rejects any value outside the allowed set. */
export function parseEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): ParseResult<T | undefined> {
  if (value === undefined || value === null || value === '') return ok(undefined);
  const s = String(value);
  if (!(allowed as readonly string[]).includes(s)) {
    return fail(`${field} must be one of ${allowed.join(', ')} (got "${s}")`);
  }
  return ok(s as T);
}

/** Optional free-text search, bounded in length to keep the query cheap. */
export function parseSearch(value: unknown, field = 'q'): ParseResult<string | undefined> {
  if (value === undefined || value === null || value === '') return ok(undefined);
  const s = String(value).trim();
  if (s.length > 120) return fail(`${field} must be at most 120 characters`);
  return ok(s);
}

export interface PageQuery {
  page: number;
  limit: number;
}

export function parsePageQuery(query: Record<string, unknown>): ParseResult<PageQuery> {
  const page = parsePage(query.page);
  if (!page.ok) return page;
  const limit = parseLimit(query.limit);
  if (!limit.ok) return limit;
  return ok({ page: page.value, limit: limit.value });
}

const MATCH_STATUSES = ['scheduled', 'live', 'halftime', 'finished', 'postponed', 'suspended', 'cancelled'] as const;

export interface MatchListQuery extends PageQuery {
  competitionSlug?: string;
  status?: (typeof MATCH_STATUSES)[number];
  q?: string;
}

export function parseMatchListQuery(query: Record<string, unknown>): ParseResult<MatchListQuery> {
  const base = parsePageQuery(query);
  if (!base.ok) return base;
  const competitionSlug = parseSearch(query.competitionSlug, 'competitionSlug');
  if (!competitionSlug.ok) return competitionSlug;
  const status = parseEnum(query.status, MATCH_STATUSES, 'status');
  if (!status.ok) return status;
  const q = parseSearch(query.q, 'q');
  if (!q.ok) return q;
  return ok({ ...base.value, competitionSlug: competitionSlug.value, status: status.value, q: q.value });
}

const SEVERITIES = ['info', 'warning', 'critical'] as const;

export interface AuditQuery extends PageQuery {
  severity?: (typeof SEVERITIES)[number];
  subsystem?: string;
}

export function parseAuditQuery(query: Record<string, unknown>): ParseResult<AuditQuery> {
  const base = parsePageQuery(query);
  if (!base.ok) return base;
  const severity = parseEnum(query.severity, SEVERITIES, 'severity');
  if (!severity.ok) return severity;
  const subsystem = parseSearch(query.subsystem, 'subsystem');
  if (!subsystem.ok) return subsystem;
  return ok({ ...base.value, severity: severity.value, subsystem: subsystem.value });
}

// ---- Entity mappings (F08): bounded pagination, sort allow-list, kind filter ----

const ENTITY_KINDS = ['team', 'competition'] as const;
const ENTITY_SORT_FIELDS = ['lastUpdatedAt', 'name', 'slug'] as const;
const SORT_ORDERS = ['asc', 'desc'] as const;

/**
 * Query for `/entity-mappings`. `sort` is an explicit allow-list; any other
 * field is rejected with a 400 before the database is touched. The default
 * order is `lastUpdatedAt` desc; the service appends deterministic tiebreakers
 * (`slug`, then `_id`) so pages are stable across page boundaries.
 */
export interface EntityMappingQuery extends PageQuery {
  q?: string;
  kind?: (typeof ENTITY_KINDS)[number];
  sort: (typeof ENTITY_SORT_FIELDS)[number];
  order: (typeof SORT_ORDERS)[number];
}

export function parseEntityMappingQuery(query: Record<string, unknown>): ParseResult<EntityMappingQuery> {
  const base = parsePageQuery(query);
  if (!base.ok) return base;
  const q = parseSearch(query.q, 'q');
  if (!q.ok) return q;
  const kind = parseEnum(query.kind, ENTITY_KINDS, 'kind');
  if (!kind.ok) return kind;
  const sort = parseEnum(query.sort, ENTITY_SORT_FIELDS, 'sort');
  if (!sort.ok) return sort;
  const order = parseEnum(query.order, SORT_ORDERS, 'order');
  if (!order.ok) return order;
  return ok({
    ...base.value,
    q: q.value,
    kind: kind.value,
    sort: sort.value ?? 'lastUpdatedAt',
    order: order.value ?? 'desc',
  });
}

// ---- Availability contract (F09) ----

/**
 * Explicit availability state for every admin read-model value that could
 * otherwise be mistaken for a measured number (see M06-R1-F01-F09-BACKEND.md).
 *
 * Semantics:
 *  - `observed`      a real measured value; `0` is a real observed zero.
 *  - `empty`         the read/run succeeded but produced no rows/records.
 *  - `missing`       the field is absent from the stored model (unsupported).
 *  - `unavailable`   could not be measured: no database or provider unreachable.
 *  - `not_covered`   no eligible provider covers this competition/entity.
 *  - `not_measured`  the measurement has not been performed yet.
 *  - `stale`         measured, but older than the freshness threshold.
 *
 * A value field is `null`/`undefined` whenever its state is anything other than
 * `observed` or `empty` — never a fabricated zero.
 */
export type AvailabilityState =
  | 'observed'
  | 'empty'
  | 'missing'
  | 'unavailable'
  | 'not_covered'
  | 'not_measured'
  | 'stale';

// ---- Response DTOs (the shape the admin UI consumes) ----

export type FootballIngestionRunOutcome = 'success' | 'partial' | 'failed' | 'skipped' | 'empty';

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
  /**
   * Availability of the counter block (`competitions`, `teams`, `snapshots`,
   * `providers`, `broadcastMappings`, `staleSnapshots`, `openQualityIssues`).
   * All counters share one database read: they are `observed` together, or the
   * endpoint errors (never a fabricated zero).
   */
  countsState: AvailabilityState;
  /** Availability of `lastSyncAt` / `lastSyncOutcome`. */
  lastSyncState: AvailabilityState;
}

export interface FootballProviderSummaryDTO {
  provider: string;
  health: 'ok' | 'degraded' | 'down';
  lastSuccessAt?: string;
  lastErrorAt?: string;
  consecutiveFailures: number | null;
  /** `observed` when the stored model carries the counter; `missing` otherwise. */
  consecutiveFailuresState: AvailabilityState;
  quotaConsumedToday: number | null;
  /** `observed` when the stored model carries the counter; `missing` otherwise. */
  quotaConsumedTodayState: AvailabilityState;
  circuitState: string;
}

export interface FootballProviderDetailDTO extends FootballProviderSummaryDTO {
  quotaResetAt?: string;
  lastRuns: Array<{
    runId: string;
    startedAt: string;
    outcome: string;
    requestsUsed: number | null;
    /** `observed` when the run record carries the counter; `missing` otherwise. */
    requestsUsedState: AvailabilityState;
  }>;
}

export interface FootballCoverageRowDTO {
  competitionSlug: string;
  name: string;
  type: string;
  coverageState: 'competition_not_covered' | 'provider_supported' | 'provider_supported_no_fixtures' | 'provider_unavailable';
  snapshotCount: number | null;
  /** Derives from `coverageState`: not_covered / unavailable / empty / observed. */
  snapshotCountState: AvailabilityState;
  seasonLabel?: string;
}

export interface FootballCoverageMatrixDTO {
  generatedAt: string;
  rows: FootballCoverageRowDTO[];
}

export interface FootballAdminMatchDTO {
  matchId: string;
  canonicalKey: string;
  competitionSlug: string;
  kickoffAt?: string;
  /** `observed` when the snapshot carries a kickoff; `missing` otherwise. */
  kickoffState: AvailabilityState;
  status?: string;
  /** `observed` when the snapshot carries a status; `missing` otherwise. */
  statusState: AvailabilityState;
  homeTeam?: string;
  /** `observed` when the snapshot carries a home team name; `missing` otherwise. */
  homeTeamState: AvailabilityState;
  awayTeam?: string;
  /** `observed` when the snapshot carries an away team name; `missing` otherwise. */
  awayTeamState: AvailabilityState;
  score?: { home: number | null; away: number | null };
  /** `observed` when the snapshot carries a score object (0-0 included); `missing` otherwise. */
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
  /** Boolean flag (not a measurement): `false` means ingestion is disabled. */
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
    /** `observed` when the durable quota authority answered; `unavailable` when there is no database. */
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

export interface FootballSyncResultDTO {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  correlationId: string;
}
