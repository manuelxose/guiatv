/**
 * In-memory ingestion metrics. The ingestion tick updates this record each run;
 * the diagnostics endpoint reads it. Bounded error history keeps memory flat.
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
  };
}

export function pushError(metrics: IngestionMetrics, kind: string, message: string, max: number, at: number): void {
  metrics.errors.push({ at, kind, message });
  if (metrics.errors.length > max) {
    metrics.errors = metrics.errors.slice(-max);
  }
}
