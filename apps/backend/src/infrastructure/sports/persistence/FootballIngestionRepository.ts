/**
 * Mongo persistence for the football ingestion — idempotent, safe to run twice.
 *
 * Snapshot upserts pre-dedupe the batch by `(providerId, canonicalKey)` and rely
 * on the unique `{providerId, matchId}` index for cross-run idempotency; a
 * duplicate-key error from a concurrent writer is swallowed (same pattern as
 * `MongoAnalyticsRepository.createEvents`). Runs and sync state use `$setOnInsert`
 * upserts keyed by their own unique ids.
 *
 * F04 identity + additive reconciliation:
 *  - The stable snapshot identity is `(providerId, matchId)`. The upsert is keyed
 *    on that pair (NOT on the mutable display slug), and it `$set`s `canonicalKey`
 *    to the provider-anchored value (`${providerId}:${matchId}`).
 *  - Records written by the OLD scheme (slug-keyed `canonicalKey`) are NOT deleted
 *    and NOT batch-rewritten. On the next ingestion of the same match, the upsert
 *    finds the legacy document by its already-stored `(providerId, matchId)` and
 *    transitions it to the new identity in place (a lossless field update). Until
 *    then the legacy document keeps working for public reads: lookups resolve by
 *    `matchId`, by `canonicalKey` (which equals the display slug for legacy
 *    records), and by the display `match.slug`.
 *  - The new unique `{providerId, matchId}` index (created at boot in
 *    `createFootballIndexes.ts` and declared on the schema in `models.ts`) is the
 *    additive guarantee that one logical match never becomes two documents across
 *    the two schemes.
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

/** `$literal` keeps `undefined` keys as null; drop them so an absent field stays absent. */
function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value));
}

export class FootballIngestionRepository implements FootballPersistencePort {
  async upsertSnapshots(snapshots: FootballSnapshotWrite[]): Promise<number> {
    if (!snapshots.length) return 0;
    const deduped = dedupeSnapshots(snapshots);
    const ops = deduped.map((s) => {
      const fields = {
        canonicalKey: s.canonicalKey,
        matchId: s.matchId,
        competitionSlug: s.competitionSlug,
        sourceTimestamp: new Date(s.sourceTimestamp),
        ingestedAt: new Date(s.ingestedAt),
        contentHash: s.contentHash,
      };
      const match = s.match as unknown as Record<string, unknown>;
      // M07: a provider endpoint without statistics (footballdata.io /matches) must not
      // erase the statistics another endpoint of the SAME provider stored (/fixtures/results).
      const keepStatistics = match.statistics == null;
      return {
        updateOne: {
          // Stable identity, independent of the mutable display slug. A re-sent
          // match (legacy slug-keyed or already provider-anchored) collapses to ONE
          // document; `canonicalKey` is transitioned to the new identity below.
          filter: { providerId: s.providerId, matchId: s.matchId },
          update: keepStatistics
            ? [{ $set: { ...fields, match: { $mergeObjects: [{ statistics: '$match.statistics' }, { $literal: stripUndefined(match) }] } } }]
            : { $set: { ...fields, match } },
          upsert: true,
        },
      };
    });

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
