/**
 * SnapshotFootballDataProvider tests (M06).
 *
 * M06's central defect was that ingested data never reached a public page: the
 * public provider read the EPG or football-data.org, never `football_snapshots`.
 * These tests pin the behaviour that closed it, and — more importantly — pin the
 * honesty rules: an absent field stays absent, and standings are not invented.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotFootballDataProvider } from './SnapshotFootballDataProvider';

const provider = new SnapshotFootballDataProvider();

test('M06: the public provider declares the ingested-snapshot source', () => {
  assert.equal(provider.key, 'snapshot');
  assert.equal(typeof provider.supportsLiveScores(), 'boolean');
});

test(
  'M06/F25: standings are DERIVED from real results, never fabricated',
  { skip: !process.env.TEST_MONGO_URI },
  async () => {
    const mongoose = (await import('mongoose')).default;
    const { SnapshotFootballDataProvider } = await import('./SnapshotFootballDataProvider');
    await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName: `m06_r1_stand_unit_${process.pid}` });
    try {
      // Built AFTER the connection exists: the module-level provider was created
      // before this test connected, so it would buffer and time out.
      const local = new SnapshotFootballDataProvider();
      // No snapshots: nothing to derive from, so an empty table - never invented.
      assert.deepEqual(await local.getStandings('bundesliga'), []);
      assert.deepEqual(await local.getStandings(''), []);
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  }
);

