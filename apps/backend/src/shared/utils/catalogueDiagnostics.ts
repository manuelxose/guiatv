import { performance } from 'node:perf_hooks';
import { envNumber, LogBudget, percentileOf, pushBounded, round1 } from './diagnosticsCommon';
import { logger } from './logger';
import type { PhaseStat } from './phaseTimer';

/**
 * M13-B1: process-level aggregate of `CatalogService.query` timing, so the cold-miss cost can be read from
 * `/v2/health/metrics` and from one log line without database or journal access.
 *
 * Phases are recorded only for real computations ("miss"); cache hits add a counter and a total. Parallel phases report
 * their wall-clock union (see `PhaseRecorder`), so the values must not be summed to the total. Keys are fixed phase
 * literals; the stored query "shape" is a whitelist of enumerations and counts: no search text, user id or URL.
 */
export type CatalogueOutcome = 'l1_hit' | 'cache_hit' | 'miss' | 'error';

export interface CatalogueShape {
  types: string;
  availability: string;
  sort: string;
  page: number;
  limit: number;
  platforms: number;
  genres: number;
  hasQuery: boolean;
  authenticated: boolean;
}

interface SlowQuery {
  at: string;
  uptimeMs: number;
  outcome: CatalogueOutcome;
  totalMs: number;
  phases: Record<string, PhaseStat>;
  shape: CatalogueShape;
}

const MAX_PHASE_SAMPLES = 200;
const MAX_PHASES = 24;
const MAX_SLOW = 20;
// Read once: process.env access is slow and this runs on every query.
const SLOW_MS = envNumber(process.env, 'DIAG_CATALOGUE_SLOW_MS', 1_000, 100, 60_000);
const log = logger.child('Catalogue');
const counts: Record<CatalogueOutcome, number> = { l1_hit: 0, cache_hit: 0, miss: 0, error: 0 };
const totals: Record<CatalogueOutcome, number[]> = { l1_hit: [], cache_hit: [], miss: [], error: [] };
const phaseWall = new Map<string, number[]>();
const phaseMax = new Map<string, number>();
const slow: SlowQuery[] = [];
let logBudget = new LogBudget(6);

export function recordCatalogueQuery(input: {
  outcome: CatalogueOutcome;
  totalMs: number;
  phases: Record<string, PhaseStat>;
  shape: CatalogueShape;
  slowMs?: number;
}): void {
  try {
    const { outcome, totalMs } = input;
    if (!(outcome in counts)) return;
    counts[outcome] += 1;
    pushBounded(totals[outcome], totalMs, MAX_PHASE_SAMPLES);
    if (outcome === 'miss') {
      for (const [name, stat] of Object.entries(input.phases)) {
        let samples = phaseWall.get(name);
        if (!samples) {
          if (phaseWall.size >= MAX_PHASES) continue;
          samples = [];
          phaseWall.set(name, samples);
        }
        pushBounded(samples, stat.wallMs, MAX_PHASE_SAMPLES);
        if (stat.maxMs > (phaseMax.get(name) ?? 0)) phaseMax.set(name, stat.maxMs);
      }
    }
    const threshold = input.slowMs ?? SLOW_MS;
    if (totalMs >= threshold) {
      const record: SlowQuery = {
        at: new Date().toISOString(),
        uptimeMs: Math.round(performance.now()),
        outcome,
        totalMs: round1(totalMs),
        phases: input.phases,
        shape: input.shape,
      };
      pushBounded(slow, record, MAX_SLOW);
      if (logBudget.take()) log.warn('Slow catalogue query', { ...record });
    }
  } catch {
    // Diagnostics must never affect the query they observe.
  }
}

function stats(values: number[]) {
  return { count: values.length, p50: percentileOf(values, 0.5), p95: percentileOf(values, 0.95), max: values.length ? round1(Math.max(...values)) : 0 };
}

export function catalogueDiagnosticsSnapshot(): Record<string, unknown> {
  const phases: Record<string, unknown> = {};
  for (const [name, samples] of phaseWall) phases[name] = { ...stats(samples), maxSpanMs: phaseMax.get(name) ?? 0 };
  return {
    queries: { ...counts },
    totalMs: { l1_hit: stats(totals.l1_hit), cache_hit: stats(totals.cache_hit), miss: stats(totals.miss), error: stats(totals.error) },
    // Wall-clock per phase over the last misses. Parallel phases overlap: do not add them up.
    missPhasesWallMs: phases,
    slow: slow.map((s) => ({ ...s })),
    suppressedLogs: logBudget.suppressed,
  };
}

/** Tests only. */
export function resetCatalogueDiagnostics(): void {
  for (const key of Object.keys(counts) as CatalogueOutcome[]) {
    counts[key] = 0;
    totals[key].length = 0;
  }
  phaseWall.clear();
  phaseMax.clear();
  slow.length = 0;
  logBudget = new LogBudget(6);
}

const SAFE = /[^a-z0-9_,-]/gi;

/** Builds the stored shape from a normalised query, keeping enumerations and counts only. */
export function catalogueShape(q: {
  types?: readonly string[];
  availability?: readonly string[];
  sort?: string;
  page?: number;
  limit?: number;
  platforms?: readonly string[];
  genres?: readonly string[];
  q?: string;
  userId?: string;
}): CatalogueShape {
  return {
    types: (q.types ?? []).join(',').replace(SAFE, '').slice(0, 60),
    availability: (q.availability ?? []).join(',').replace(SAFE, '').slice(0, 60),
    sort: String(q.sort ?? '').replace(SAFE, '').slice(0, 20),
    page: Number(q.page) || 1,
    limit: Number(q.limit) || 0,
    platforms: q.platforms?.length ?? 0,
    genres: q.genres?.length ?? 0,
    hasQuery: Boolean(q.q),
    authenticated: Boolean(q.userId),
  };
}
