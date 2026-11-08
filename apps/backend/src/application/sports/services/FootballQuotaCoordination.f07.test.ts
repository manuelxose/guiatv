/**
 * F07 — durable quota fail-closed coordination (re-verification).
 *
 * Proves:
 *  - the factory fails closed (no silent downgrade to a process-local budget)
 *    whenever the durable authority cannot be built;
 *  - only the EXPLICIT `FOOTBALL_DURABLE_QUOTA=0` opts into local mode — every
 *    other value (or unset) still requests the durable authority;
 *  - against real MongoDB, two workers contending over one durable quota never
 *    both believe they own the budget (the atomic reservation caps it exactly).
 * The throwaway dbName always contains "adminapi".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { buildFootballIngestionService } from '@/jobs/football/factory';
import { MongoDurableQuotaStore } from '@/infrastructure/sports/persistence/DurableQuotaStore';
import { DurableRequestBudget, RequestBudgetConfig } from '@/application/sports/ingestion/RequestBudget';

const fakeFetch = async () => ({ ok: true, status: 200, json: async () => [] }) as unknown as Response;

function withEnv(key: string, value: string | undefined, run: () => void): void {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

test('F07: only FOOTBALL_DURABLE_QUOTA=0 opts into local mode; every other value (or unset) requests durable', () => {
  // No Mongo connection in this process, so "durable requested" must throw (fail closed).
  for (const value of [undefined, '1', 'true', 'false', '', 'no']) {
    withEnv('FOOTBALL_DURABLE_QUOTA', value, () => {
      assert.throws(
        () => buildFootballIngestionService({ fetch: fakeFetch }),
        /durable quota authority requires a ready MongoDB connection/,
        `value ${JSON.stringify(value)} must request durable and fail closed without Mongo`
      );
    });
  }

  // The explicit opt-in builds with a process-local budget (single-worker only).
  withEnv('FOOTBALL_DURABLE_QUOTA', '0', () => {
    assert.doesNotThrow(() => buildFootballIngestionService({ fetch: fakeFetch }));
  });
});

test(
  'F07: two workers contending over a durable quota never both believe they own it',
  { skip: !process.env.TEST_MONGO_URI },
  async () => {
    const dbName = `guiatv_adminapi_f07_${process.pid}`;
    await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName });
    try {
      const db = mongoose.connection.db!;
      const quota = db.collection('football_quota');
      const control = db.collection('football_ingestion_control');
      // The production unique index makes concurrent ensureWindow upserts collapse.
      await quota.createIndex(
        { provider: 1, windowStart: 1 },
        { unique: true, name: 'idx_football_quota_provider_window' }
      );

      const store = new MongoDurableQuotaStore(quota as any, control as any);
      const config: RequestBudgetConfig = { dailyBudget: 10, liveReserve: 0, perRunCap: 100, throttleBackoffMs: 1000 };
      const T0 = Date.parse('2026-11-06T00:00:00Z');
      const workerA = new DurableRequestBudget(config, store, 'openligadb', () => T0);
      const workerB = new DurableRequestBudget(config, store, 'openligadb', () => T0);

      // 20 reservation attempts (10 per worker) may only win the budget once.
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? workerA : workerB).tryAcquire('normal', T0))
      );
      assert.equal(results.filter(Boolean).length, 10, 'exactly dailyBudget-liveReserve reservations may succeed');
      assert.equal(await store.consumedInWindow('openligadb', T0), 10, 'the durable counter must never exceed the budget');
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  }
);
