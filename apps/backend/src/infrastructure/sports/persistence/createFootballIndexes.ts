/**
 * Football ingestion indexes + retention/TTL — in the repo's `create-indexes`
 * style (native collection `createIndex`, named, background, never dropped).
 *
 * Retention/TTL policy (documented storage budget):
 *  - snapshots: kept 45 days (`idx_football_snapshot_ttl`), then expired. One
 *    season is ~306 matches; a mapped match document is a few KB, so a season
 *    plus its daily rewrites stays well under a few MB.
 *  - ingestion runs: kept 14 days (`idx_football_runs_ttl`).
 *
 * The lock collection's unique `key` index is what makes `MongoLock` atomic.
 */

import mongoose from 'mongoose';

export const FOOTBALL_SNAPSHOT_TTL_SECONDS = 45 * 24 * 60 * 60;
export const FOOTBALL_RUN_TTL_SECONDS = 14 * 24 * 60 * 60;

export async function createFootballIndexes(db = mongoose.connection.db): Promise<void> {
  if (!db) {
    throw new Error('MongoDB connection is not available');
  }

  const snapshots = db.collection('football_snapshots');
  await snapshots.createIndex(
    { canonicalKey: 1, providerId: 1 },
    { unique: true, name: 'idx_football_snapshot_key', background: true }
  );
  await snapshots.createIndex(
    { contentHash: 1 },
    { unique: true, name: 'idx_football_snapshot_contentHash', background: true }
  );
  await snapshots.createIndex(
    { competitionSlug: 1, ingestedAt: -1 },
    { name: 'idx_football_snapshot_competition_ingested', background: true }
  );
  await snapshots.createIndex(
    { ingestedAt: 1 },
    { expireAfterSeconds: FOOTBALL_SNAPSHOT_TTL_SECONDS, name: 'idx_football_snapshot_ttl', background: true }
  );

  const syncState = db.collection('football_provider_sync_state');
  await syncState.createIndex(
    { provider: 1 },
    { unique: true, name: 'idx_football_sync_provider', background: true }
  );

  const runs = db.collection('football_ingestion_runs');
  await runs.createIndex(
    { providerId: 1, startedAt: -1 },
    { name: 'idx_football_runs_provider_started', background: true }
  );
  await runs.createIndex(
    { startedAt: 1 },
    { expireAfterSeconds: FOOTBALL_RUN_TTL_SECONDS, name: 'idx_football_runs_ttl', background: true }
  );

  const locks = db.collection('football_ingestion_locks');
  await locks.createIndex({ key: 1 }, { unique: true, name: 'idx_football_lock_key', background: true });
}
