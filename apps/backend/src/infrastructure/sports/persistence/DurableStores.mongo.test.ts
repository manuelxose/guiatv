import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoDurableQuotaStore } from './DurableQuotaStore';
import { MongoJobIdempotencyStore } from './JobIdempotencyStore';
import { MongoLock } from '@/application/sports/ingestion/Lock';
import { createFootballIndexes } from './createFootballIndexes';

const WS = Date.parse('2026-11-06T00:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

test(
  'durable stores are cluster-safe against a real MongoDB',
  { skip: !process.env.TEST_MONGO_URI },
  async () => {
    const dbName = `guiatv_m06_ops_test_${process.pid}_${Date.now()}`;
    await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName });
    try {
      await createFootballIndexes();
      const db = mongoose.connection.db!;
      const quota = db.collection('football_quota');
      const control = db.collection('football_ingestion_control');
      const jobs = db.collection('football_ingestion_jobs');
      const locks = db.collection('football_ingestion_locks');

      // 1) Two independent instances against one store never exceed the budget.
      const storeA = new MongoDurableQuotaStore(quota as any, control as any);
      const storeB = new MongoDurableQuotaStore(quota as any, control as any);
      await storeA.ensureWindow('openligadb', WS, WS + DAY_MS);
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? storeA : storeB).reserve('openligadb', WS, 10))
      );
      assert.equal(results.filter(Boolean).length, 10);
      assert.equal(await storeA.consumedInWindow('openligadb', WS), 10);

      // 2) Emergency disable is durable across instances.
      await storeA.setDisabled('openligadb', true);
      assert.equal(await storeB.isDisabled('openligadb'), true);
      await storeA.setDisabled('openligadb', false);
      assert.equal(await storeB.isDisabled('openligadb'), false);

      // 3) A restart cannot duplicate a job (idempotency key).
      const jobsA = new MongoJobIdempotencyStore(jobs as any);
      const jobsB = new MongoJobIdempotencyStore(jobs as any);
      const jobKey = `football:ingestion:run:openligadb:${Date.now()}`;
      const claimA = await jobsA.claim(jobKey, 'openligadb', 'worker-a');
      const claimB = await jobsB.claim(jobKey, 'openligadb', 'worker-b');
      assert.equal(claimA.claimed, true);
      assert.equal(claimB.claimed, false);
      await jobsA.complete(jobKey, 'worker-a');
      assert.equal((await jobsB.claim(jobKey, 'openligadb', 'worker-b')).status, 'completed');

      // 4) An expired lease is recovered.
      const ownerA = `worker-${process.pid}-a`;
      const ownerB = `worker-${process.pid}-b`;
      const lockA = new MongoLock(locks as any, ownerA);
      const lockB = new MongoLock(locks as any, ownerB);
      const first = await lockA.acquireReport('football:ingestion:realmongo', 40);
      assert.deepEqual(first, { acquired: true, recovered: false });
      await new Promise((resolve) => setTimeout(resolve, 80)); // ttl elapses, holder A "crashes"
      const second = await lockB.acquireReport('football:ingestion:realmongo', 40);
      assert.deepEqual(second, { acquired: true, recovered: true });
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  }
);
