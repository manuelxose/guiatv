/**
 * Mongo models for the central football ingestion (provider sync state,
 * snapshots, ingestion runs) — same Mongoose style as the existing
 * `infrastructure/sports/models/*` and `infrastructure/database/models/*`.
 *
 * Unique indexes are declared with explicit named `.index()` calls so
 * `createIndexes()` at boot and `createFootballIndexes()` agree on names and
 * options (never two conflicting index definitions for the same field).
 */

import * as mongoose from 'mongoose';
import { Schema } from 'mongoose';

export interface IFootballProviderSyncStateDocument {
  provider: string;
  lastSuccessAt?: Date;
  lastErrorAt?: Date;
  consecutiveFailures: number;
  quotaConsumedToday: number;
  quotaResetAt?: Date;
  circuitState: 'closed' | 'open' | 'half_open';
}

export interface IFootballSnapshotDocument {
  canonicalKey: string;
  providerId: string;
  matchId: string;
  competitionSlug: string;
  match: Record<string, unknown>;
  sourceTimestamp: Date;
  ingestedAt: Date;
  contentHash: string;
}

export interface IFootballIngestionRunDocument {
  runId: string;
  providerId: string;
  startedAt: Date;
  finishedAt?: Date;
  requestsUsed: number;
  outcome: 'success' | 'partial' | 'failed' | 'skipped';
  errors: string[];
}

const FootballProviderSyncStateSchema = new Schema<IFootballProviderSyncStateDocument>(
  {
    provider: { type: String, required: true },
    lastSuccessAt: { type: Date },
    lastErrorAt: { type: Date },
    consecutiveFailures: { type: Number, default: 0 },
    quotaConsumedToday: { type: Number, default: 0 },
    quotaResetAt: { type: Date },
    circuitState: { type: String, enum: ['closed', 'open', 'half_open'], default: 'closed' },
  },
  { collection: 'football_provider_sync_state' }
);
FootballProviderSyncStateSchema.index(
  { provider: 1 },
  { unique: true, name: 'idx_football_sync_provider' }
);

const FootballSnapshotSchema = new Schema<IFootballSnapshotDocument>(
  {
    canonicalKey: { type: String, required: true },
    providerId: { type: String, required: true },
    matchId: { type: String, required: true },
    competitionSlug: { type: String, required: true, index: true },
    match: { type: Schema.Types.Mixed as any, required: true },
    sourceTimestamp: { type: Date, required: true },
    ingestedAt: { type: Date, required: true },
    contentHash: { type: String, required: true },
  },
  { collection: 'football_snapshots' }
);
FootballSnapshotSchema.index(
  { canonicalKey: 1, providerId: 1 },
  { unique: true, name: 'idx_football_snapshot_key' }
);
FootballSnapshotSchema.index(
  { contentHash: 1 },
  { unique: true, name: 'idx_football_snapshot_contentHash' }
);

const FootballIngestionRunSchema = new Schema<IFootballIngestionRunDocument>(
  {
    runId: { type: String, required: true },
    providerId: { type: String, required: true, index: true },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date },
    requestsUsed: { type: Number, default: 0 },
    outcome: { type: String, enum: ['success', 'partial', 'failed', 'skipped'], required: true },
    errors: { type: [String], default: [] },
  },
  { collection: 'football_ingestion_runs' }
);
FootballIngestionRunSchema.index(
  { runId: 1 },
  { unique: true, name: 'idx_football_run_runId' }
);
FootballIngestionRunSchema.index(
  { providerId: 1, startedAt: -1 },
  { name: 'idx_football_runs_provider_started' }
);

export const FootballProviderSyncStateModel = mongoose.model<IFootballProviderSyncStateDocument>(
  'FootballProviderSyncState',
  FootballProviderSyncStateSchema
);
export const FootballSnapshotModel = mongoose.model<IFootballSnapshotDocument>(
  'FootballSnapshot',
  FootballSnapshotSchema
);
export const FootballIngestionRunModel = mongoose.model<IFootballIngestionRunDocument>(
  'FootballIngestionRun',
  FootballIngestionRunSchema
);
