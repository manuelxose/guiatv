/**
 * In-memory ingestion metrics. The ingestion tick updates this record each run;
 * the diagnostics endpoint reads it. Bounded error history keeps memory flat.
 *
 * The counters below are REAL accumulators: they only move through the
 * `record*` helpers, called at the point where the event is actually observed
 * (a cycle that finished, an upstream call that was issued, a dedupe hit, a
 * reservation that succeeded, a persistence write that failed, a lease that was
 * recovered). They are never estimated or derived from a formula.
 */

import { ProviderHealth } from './types';

export interface ProviderErrorRecord {
  at: number;
  kind: string;
  message: string;
}

export interface IngestionMetrics {
  lastRunAt?: number;
  lastSuccessAt?: number;
  lastErrorAt?: number;
  lastLatencyMs?: number;
  activeMatches: number;
  staleSnapshots: number;
  fieldCoverage: number;
  identityConflicts: number;
  queueSize: number;
  errors: ProviderErrorRecord[];
  health: ProviderHealth;
  // Operational counters (measured, never estimated).
  cyclesSuccess: number;
  cyclesFailed: number;
  upstreamRequests: number;
  cacheSavings: number;
  quotaConsumed: number;
  persistenceFailures: number;
  recoveredJobs: number;
  /** Last measured delay (ms) between the scheduled tick and its actual start. */
  schedulerDelayMs: number;
}

export function createIngestionMetrics(): IngestionMetrics {
  return {
    activeMatches: 0,
    staleSnapshots: 0,
    fieldCoverage: 0,
    identityConflicts: 0,
    queueSize: 0,
    errors: [],
    health: 'ok',
    cyclesSuccess: 0,
    cyclesFailed: 0,
    upstreamRequests: 0,
    cacheSavings: 0,
    quotaConsumed: 0,
    persistenceFailures: 0,
    recoveredJobs: 0,
    schedulerDelayMs: 0,
  };
}

export function pushError(metrics: IngestionMetrics, kind: string, message: string, max: number, at: number): void {
  metrics.errors.push({ at, kind, message });
  if (metrics.errors.length > max) {
    metrics.errors = metrics.errors.slice(-max);
  }
}

/** Record the outcome of one ingestion cycle (a completed tick). */
export function recordCycle(metrics: IngestionMetrics, outcome: 'success' | 'failed'): void {
  if (outcome === 'success') metrics.cyclesSuccess += 1;
  else metrics.cyclesFailed += 1;
}

/** Record one upstream request actually issued to the provider. */
export function recordUpstreamRequest(metrics: IngestionMetrics, count = 1): void {
  metrics.upstreamRequests += count;
}

/** Record one upstream request avoided by the single-flight / cache dedupe. */
export function recordCacheSaving(metrics: IngestionMetrics, count = 1): void {
  metrics.cacheSavings += count;
}

/** Record the number of requests this cycle actually reserved against the quota. */
export function recordQuotaConsumed(metrics: IngestionMetrics, count: number): void {
  metrics.quotaConsumed += count;
}

/** Record one persistence write failure. */
export function recordPersistenceFailure(metrics: IngestionMetrics): void {
  metrics.persistenceFailures += 1;
}

/** Record one job recovered from an expired lease. */
export function recordRecoveredJob(metrics: IngestionMetrics): void {
  metrics.recoveredJobs += 1;
}

/** Record the measured scheduler delay (ms) for the latest tick. */
export function recordSchedulerDelay(metrics: IngestionMetrics, delayMs: number): void {
  metrics.schedulerDelayMs = delayMs;
}
