import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { FootballSnapshotModel } from './models';
import { FootballIngestionRepository } from './FootballIngestionRepository';
import { createFootballIndexes } from './createFootballIndexes';

test(
  'a double snapshot write creates no duplicate document',
  { skip: !process.env.TEST_MONGO_URI },
  async () => {
    const dbName = `guiatv_test_football_ingestion_${process.pid}`;
    await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName });
    try {
      await createFootballIndexes();
      const repo = new FootballIngestionRepository();
      const now = new Date().toISOString();
      const snapshot = {
        canonicalKey: 'openligadb:1',
        providerId: 'openligadb',
        matchId: '1',
        competitionSlug: 'bundesliga',
        match: { id: '1', slug: 'a-b-2026-08-14' },
        sourceTimestamp: now,
        ingestedAt: now,
        contentHash: 'hash-a-b',
      } as any;

      await repo.upsertSnapshots([snapshot]);
      await repo.upsertSnapshots([snapshot]);

      assert.equal(await FootballSnapshotModel.countDocuments({ canonicalKey: 'openligadb:1' }).exec(), 1);
      assert.equal(await repo.countSnapshots('openligadb'), 1);
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  }
);

test(
  'F04: a legacy slug-keyed record collapses to the provider-anchored identity without a second document',
  { skip: !process.env.TEST_MONGO_URI },
  async () => {
    const dbName = `guiatv_di_f04_identity_${process.pid}`;
    await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName });
    try {
      await createFootballIndexes();
      const repo = new FootballIngestionRepository();
      const now = new Date().toISOString();

      // Simulate a record written by the OLD scheme: canonicalKey is the slug.
      await FootballSnapshotModel.create({
        canonicalKey: 'bayern-dortmund-2026-11-06',
        providerId: 'openligadb',
        matchId: '222',
        competitionSlug: 'bundesliga',
        match: { id: '222', slug: 'bayern-dortmund-2026-11-06', providerIds: { openligadb: '222' } },
        sourceTimestamp: new Date(now),
        ingestedAt: new Date(now),
        contentHash: 'legacy-hash-222',
      } as any);

      // Re-ingest the SAME match with the new provider-anchored identity.
      await repo.upsertSnapshots([
        {
          canonicalKey: 'openligadb:222',
          providerId: 'openligadb',
          matchId: '222',
          competitionSlug: 'bundesliga',
          match: { id: '222', slug: 'bayern-dortmund-2026-11-06', providerIds: { openligadb: '222' } },
          sourceTimestamp: now,
          ingestedAt: now,
          contentHash: 'new-hash-222',
        } as any,
      ]);

      // One logical match → one document, now under the stable identity.
      assert.equal(await repo.countSnapshots('openligadb'), 1);
      assert.equal(await FootballSnapshotModel.countDocuments({ providerId: 'openligadb', matchId: '222' }).exec(), 1);
      const doc = await FootballSnapshotModel.findOne({ providerId: 'openligadb', matchId: '222' }).lean().exec();
      assert.equal(doc?.canonicalKey, 'openligadb:222', 'legacy key transitions to the stable identity');
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  }
);

test(
  'F04: concurrent upserts of the same match never create a second document',
  { skip: !process.env.TEST_MONGO_URI },
  async () => {
    const dbName = `guiatv_di_f04_concurrent_${process.pid}`;
    await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName });
    try {
      await createFootballIndexes();
      const repo = new FootballIngestionRepository();
      const now = new Date().toISOString();
      const makeSnapshot = () => ({
        canonicalKey: 'openligadb:333',
        providerId: 'openligadb',
        matchId: '333',
        competitionSlug: 'bundesliga',
        match: { id: '333', slug: 'a-b-2026-11-06', providerIds: { openligadb: '333' } },
        sourceTimestamp: now,
        ingestedAt: now,
        contentHash: 'hash-333',
      } as any);

      await Promise.all([repo.upsertSnapshots([makeSnapshot()]), repo.upsertSnapshots([makeSnapshot()])]);

      assert.equal(await FootballSnapshotModel.countDocuments({ providerId: 'openligadb', matchId: '333' }).exec(), 1);
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  }
);
