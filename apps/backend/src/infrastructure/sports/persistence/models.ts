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

/**
 * Snapshot retention TTL. MUST stay equal to `FOOTBALL_SNAPSHOT_TTL_SECONDS` in
 * `createFootballIndexes.ts` so the schema-declared index and the boot index
 * creator agree on name + options (never two conflicting index definitions).
 */
const FOOTBALL_SNAPSHOT_TTL_SECONDS = 45 * 24 * 60 * 60;

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
  /** F03: `empty` is a truthful first-class outcome for a run that fetched nothing useful. */
  outcome: 'success' | 'partial' | 'failed' | 'skipped' | 'empty';
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
/**
 * F27: the provider's OWN league table (OpenLigaDB getbltable), stored per
 * competition. Kept separately from the snapshots so the public provider can
 * prefer the OFFICIAL table over one we derive from the matches we happen to
 * have fetched.
 */
const FootballStandingsTableSchema = new Schema(
  {
    competitionSlug: { type: String, required: true },
    providerId: { type: String, required: true },
    season: { type: String },
    rows: { type: [Schema.Types.Mixed], default: [] },
    fetchedAt: { type: Date, required: true },
  },
  { collection: 'football_standings' }
);
FootballStandingsTableSchema.index(
  { competitionSlug: 1, providerId: 1, season: 1 },
  { unique: true, name: 'idx_football_standings_competition' }
);
export const FootballStandingsTableModel = mongoose.models.FootballStandingsTable
  ?? mongoose.model('FootballStandingsTable', FootballStandingsTableSchema);

FootballProviderSyncStateSchema.index(
  { provider: 1 },
  { unique: true, name: 'idx_football_sync_provider' }
);

const FootballSnapshotSchema = new Schema<IFootballSnapshotDocument>(
  {
    canonicalKey: { type: String, required: true },
    providerId: { type: String, required: true },
    matchId: { type: String, required: true },
    competitionSlug: { type: String, required: true },
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
// F04: the stable identity is (providerId, matchId). This unique index is the
// additive, backward-compatible guarantee that a re-sent match collapses to ONE
// record across the old (slug-keyed) and new (provider-anchored) key schemes.
FootballSnapshotSchema.index(
  { providerId: 1, matchId: 1 },
  { unique: true, name: 'idx_football_snapshot_provider_match' }
);
FootballSnapshotSchema.index(
  { contentHash: 1 },
  { unique: true, name: 'idx_football_snapshot_contentHash' }
);
FootballSnapshotSchema.index(
  { competitionSlug: 1, ingestedAt: -1 },
  { name: 'idx_football_snapshot_competition_ingested' }
);
FootballSnapshotSchema.index(
  { ingestedAt: 1 },
  { expireAfterSeconds: FOOTBALL_SNAPSHOT_TTL_SECONDS, name: 'idx_football_snapshot_ttl' }
);
FootballSnapshotSchema.index(
  { competitionSlug: 1, sourceTimestamp: -1 },
  { name: 'idx_football_snapshot_competition_source' }
);
FootballSnapshotSchema.index(
  { sourceTimestamp: 1 },
  { name: 'idx_football_snapshot_source' }
);

const FootballIngestionRunSchema = new Schema<IFootballIngestionRunDocument>(
  {
    runId: { type: String, required: true },
    providerId: { type: String, required: true, index: true },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date },
    requestsUsed: { type: Number, default: 0 },
    outcome: { type: String, enum: ['success', 'partial', 'failed', 'skipped', 'empty'], required: true },
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
