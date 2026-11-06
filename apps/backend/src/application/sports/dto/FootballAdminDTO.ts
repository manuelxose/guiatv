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

// ---- Response DTOs (the shape the admin UI consumes) ----

export interface FootballDashboardDTO {
  generatedAt: string;
  competitions: number;
  teams: number;
  snapshots: number;
  providers: number;
  broadcastMappings: number;
  staleSnapshots: number;
  lastSyncAt?: string;
  lastSyncOutcome?: string;
  openQualityIssues: number;
}

export interface FootballProviderSummaryDTO {
  provider: string;
  health: string;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  consecutiveFailures: number;
  quotaConsumedToday: number;
  circuitState: string;
}

export interface FootballProviderDetailDTO extends FootballProviderSummaryDTO {
  quotaResetAt?: string;
  lastRuns: Array<{ runId: string; startedAt: string; outcome: string; requestsUsed: number }>;
}

export interface FootballCoverageRowDTO {
  competitionSlug: string;
  name: string;
  type: string;
  coverageState: 'competition_not_covered' | 'provider_supported' | 'provider_supported_no_fixtures' | 'provider_unavailable';
  snapshotCount: number;
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
  status?: string;
  homeTeam?: string;
  awayTeam?: string;
  score?: { home: number | null; away: number | null };
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
  lastRun?: { startedAt: string; finishedAt?: string; outcome: string; requestsUsed: number };
  quota: { consumed: number; disabled: boolean; throttleUntil?: number; resetAt?: string };
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
