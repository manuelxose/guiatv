/**
 * Central ingestion bounded-context contracts.
 *
 * These types are the ingestion module's surface: scheduling buckets, the
 * persistence port (implemented by the Mongo repository), snapshot/sync/run
 * records, and the diagnostics report the admin endpoint serves.
 *
 * Design rules (mirroring the shared M05 rules):
 *  - A field the provider does not supply stays absent/undefined — never 0,
 *    never '', never a guess.
 *  - The live minute is never derived from kickoff. `FootballMatch.minute`
 *    stays undefined for OpenLigaDB (it supplies no live minute).
 */

import { FootballMatch } from '@/domain/sports/football/types';

export type IngestionBucket =
  | 'historical'
  | 'future'
  | 'today'
  | 'approaching_kickoff'
  | 'live'
  | 'halftime'
  | 'completed'
  | 'standings'
  | 'team_metadata'
  | 'lineup_event_enrichment';

export interface FootballSnapshotWrite {
  canonicalKey: string;
  providerId: string;
  matchId: string;
  competitionSlug: string;
  /** Provider payload mapped to the domain shape. */
  match: FootballMatch;
  sourceTimestamp: string;
  ingestedAt: string;
  contentHash: string;
}

export interface ProviderSyncState {
  provider: string;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  consecutiveFailures: number;
  quotaConsumedToday: number;
  quotaResetAt?: string;
  circuitState: 'closed' | 'open' | 'half_open';
}

export type IngestionRunOutcome = 'success' | 'partial' | 'failed' | 'skipped';

export interface IngestionRunRecord {
  runId: string;
  providerId: string;
  startedAt: string;
  finishedAt?: string;
  requestsUsed: number;
  outcome: IngestionRunOutcome;
  errors: string[];
}

/** Persistence port: the ingestion service depends only on this abstraction. */
export interface FootballPersistencePort {
  upsertSnapshots(snapshots: FootballSnapshotWrite[]): Promise<number>;
  countSnapshots(providerId?: string): Promise<number>;
  getSyncState(provider: string): Promise<ProviderSyncState | null>;
  updateSyncState(provider: string, patch: Partial<ProviderSyncState>): Promise<void>;
  recordRun(run: IngestionRunRecord): Promise<void>;
  getLastSuccessfulRun(provider: string): Promise<IngestionRunRecord | null>;
}

export interface TickResult {
  outcome: IngestionRunOutcome;
  reason?: string;
  requestsUsed: number;
  snapshotsWritten: number;
  /** Minimum poll interval (ms) the scheduler computed for the matches just ingested. */
  nextPollIntervalMs?: number;
  buckets?: Partial<Record<IngestionBucket, number>>;
}

export type ProviderHealth = 'ok' | 'degraded' | 'down' | 'disabled';

export interface ProviderDiagnostics {
  provider: string;
  health: ProviderHealth;
  quotaRemaining: number;
  quotaReserveRemaining: number;
  quotaResetAt?: string;
  throttledUntil?: string;
  lastSyncAt?: string;
  lastErrorAt?: string;
  lastLatencyMs?: number;
  consecutiveFailures: number;
  fieldCoverage: number;
  errors: Array<{ at: string; kind: string; message: string }>;
  activeMatches: number;
  staleCount: number;
  identityConflicts: number;
  queueSize: number;
  lastSuccessAt?: string;
}

export interface FootballDiagnosticsReport {
  generatedAt: string;
  providers: ProviderDiagnostics[];
  summary: {
    activeMatches: number;
    staleSnapshots: number;
    queueSize: number;
    identityConflicts: number;
    lastSuccessAt?: string;
    lastRunAt?: string;
  };
}
