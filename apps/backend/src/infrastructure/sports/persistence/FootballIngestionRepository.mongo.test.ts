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
        canonicalKey: 'a-b-2026-08-14',
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

      assert.equal(await FootballSnapshotModel.countDocuments({ canonicalKey: 'a-b-2026-08-14' }).exec(), 1);
      assert.equal(await repo.countSnapshots('openligadb'), 1);
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  }
);
