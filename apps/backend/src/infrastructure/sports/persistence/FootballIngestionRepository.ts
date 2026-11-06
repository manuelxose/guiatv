/**
 * Mongo persistence for the football ingestion — idempotent, safe to run twice.
 *
 * Snapshot upserts pre-dedupe the batch by `(providerId, canonicalKey)` and
 * rely on the unique `{canonicalKey, providerId}` index for cross-run
 * idempotency; a duplicate-key error from a concurrent writer is swallowed
 * (same pattern as `MongoAnalyticsRepository.createEvents`). Runs and sync
 * state use `$setOnInsert` upserts keyed by their own unique ids.
 */

import {
  FootballPersistencePort,
  FootballSnapshotWrite,
  IngestionRunRecord,
  ProviderSyncState,
} from '@/application/sports/ingestion/types';
import { dedupeSnapshots } from '@/application/sports/ingestion/snapshots';
import { isDuplicateKeyError } from '@/application/sports/ingestion/util';
import {
  FootballIngestionRunModel,
  FootballProviderSyncStateModel,
  FootballSnapshotModel,
} from './models';

export class FootballIngestionRepository implements FootballPersistencePort {
  async upsertSnapshots(snapshots: FootballSnapshotWrite[]): Promise<number> {
    if (!snapshots.length) return 0;
    const deduped = dedupeSnapshots(snapshots);
    const ops = deduped.map((s) => ({
      updateOne: {
        filter: { canonicalKey: s.canonicalKey, providerId: s.providerId },
        update: {
          $set: {
            matchId: s.matchId,
            competitionSlug: s.competitionSlug,
            match: s.match as unknown as Record<string, unknown>,
            sourceTimestamp: new Date(s.sourceTimestamp),
            ingestedAt: new Date(s.ingestedAt),
            contentHash: s.contentHash,
          },
        },
        upsert: true,
      },
    }));

    try {
      const result = await FootballSnapshotModel.bulkWrite(ops, { ordered: false });
      return result.upsertedCount + result.modifiedCount;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        // A concurrent run already wrote the same keys — idempotent no-op.
        return deduped.length;
      }
      throw error;
    }
  }

  async countSnapshots(providerId?: string): Promise<number> {
    const filter = providerId ? { providerId } : {};
    return FootballSnapshotModel.countDocuments(filter).exec();
  }

  async getSyncState(provider: string): Promise<ProviderSyncState | null> {
    const doc = await FootballProviderSyncStateModel.findOne({ provider }).lean().exec();
    if (!doc) return null;
    return {
      provider: doc.provider,
      lastSuccessAt: doc.lastSuccessAt ? doc.lastSuccessAt.toISOString() : undefined,
      lastErrorAt: doc.lastErrorAt ? doc.lastErrorAt.toISOString() : undefined,
      consecutiveFailures: doc.consecutiveFailures ?? 0,
      quotaConsumedToday: doc.quotaConsumedToday ?? 0,
      quotaResetAt: doc.quotaResetAt ? doc.quotaResetAt.toISOString() : undefined,
      circuitState: doc.circuitState ?? 'closed',
    };
  }

  async updateSyncState(provider: string, patch: Partial<ProviderSyncState>): Promise<void> {
    const set = withoutUndefined({
      lastSuccessAt: patch.lastSuccessAt ? new Date(patch.lastSuccessAt) : undefined,
      lastErrorAt: patch.lastErrorAt ? new Date(patch.lastErrorAt) : undefined,
      consecutiveFailures: patch.consecutiveFailures,
      quotaConsumedToday: patch.quotaConsumedToday,
      quotaResetAt: patch.quotaResetAt ? new Date(patch.quotaResetAt) : undefined,
      circuitState: patch.circuitState,
    });
    await FootballProviderSyncStateModel.updateOne(
      { provider },
      { $setOnInsert: { provider }, $set: set },
      { upsert: true }
    ).exec();
  }

  async recordRun(run: IngestionRunRecord): Promise<void> {
    await FootballIngestionRunModel.updateOne(
      { runId: run.runId },
      {
        $setOnInsert: { runId: run.runId },
        $set: withoutUndefined({
          providerId: run.providerId,
          startedAt: new Date(run.startedAt),
          finishedAt: run.finishedAt ? new Date(run.finishedAt) : undefined,
          requestsUsed: run.requestsUsed,
          outcome: run.outcome,
          errors: run.errors,
        }),
      },
      { upsert: true }
    ).exec();
  }

  async getLastSuccessfulRun(provider: string): Promise<IngestionRunRecord | null> {
    const doc = await FootballIngestionRunModel.findOne({ providerId: provider, outcome: 'success' })
      .sort({ startedAt: -1 })
      .lean()
      .exec();
    if (!doc) return null;
    return {
      runId: doc.runId,
      providerId: doc.providerId,
      startedAt: doc.startedAt.toISOString(),
      finishedAt: doc.finishedAt ? doc.finishedAt.toISOString() : undefined,
      requestsUsed: doc.requestsUsed ?? 0,
      outcome: doc.outcome,
      errors: doc.errors ?? [],
    };
  }
}

function withoutUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
