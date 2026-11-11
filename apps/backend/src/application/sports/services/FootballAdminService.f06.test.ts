/**
 * F06 — truthful operation lifecycle + atomic idempotency.
 *
 * The Mongo tests (skipped without TEST_MONGO_URI) drive the REAL
 * FootballAdminService.enqueueSync against a throwaway database, with a fake
 * ingestion service seam, and assert:
 *  - a queued 202 is never reported as success;
 *  - every tick outcome maps to a distinct terminal status;
 *  - two concurrent identical idempotency keys collapse to ONE operation
 *    (enforced by the unique index, not read-then-create).
 * The throwaway dbName always contains "adminapi".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { FootballAdminService } from './FootballAdminService';
import { AdminOperationModel } from '@/infrastructure/database/models/AdminOperation.model';
import { setFootballIngestionServiceForTests } from '../ingestion/footballIngestionContainer';
import type { TickResult } from '../ingestion/types';

const TERMINAL = ['succeeded', 'empty', 'skipped', 'throttled', 'failed'];

async function waitForTerminal(id: string): Promise<Record<string, any>> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const op = await AdminOperationModel.findById(id).lean().exec();
    if (op && TERMINAL.includes(op.status)) return op;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`operation ${id} did not reach a terminal status`);
}

test(
  'F06: every tick outcome maps to a truthful terminal status (202 is never success)',
  { skip: !process.env.TEST_MONGO_URI },
  async () => {
    const dbName = `guiatv_adminapi_f06_${process.pid}`;
    await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName });
    await AdminOperationModel.createIndexes();
    const service = new FootballAdminService();
    const cases: Array<{ tick: TickResult; expected: string }> = [
      { tick: { outcome: 'success', requestsUsed: 1, snapshotsWritten: 3, buckets: { future: 3 } }, expected: 'succeeded' },
      { tick: { outcome: 'partial', requestsUsed: 2, snapshotsWritten: 2, buckets: { future: 2 } }, expected: 'succeeded' },
      { tick: { outcome: 'empty', requestsUsed: 1, snapshotsWritten: 0 }, expected: 'empty' },
      { tick: { outcome: 'skipped', reason: 'circuit_open', requestsUsed: 0, snapshotsWritten: 0 }, expected: 'skipped' },
      { tick: { outcome: 'skipped', reason: 'budget_exhausted', requestsUsed: 0, snapshotsWritten: 0 }, expected: 'throttled' },
      { tick: { outcome: 'failed', reason: 'boom', requestsUsed: 1, snapshotsWritten: 0 }, expected: 'failed' },
    ];
    try {
      for (const c of cases) {
        setFootballIngestionServiceForTests({ runTick: async () => c.tick } as never);
        const enqueued = await service.enqueueSync('admin', `key-${c.expected}-${Date.now()}-${Math.random()}`);
        assert.equal(enqueued.status, 'queued', 'the POST response must be queued, never a terminal success');
        const op = await waitForTerminal(enqueued.id);
        assert.equal(op.status, c.expected, `tick outcome ${c.tick.outcome} must map to ${c.expected}`);
        assert.equal(op.recordsPersisted, c.tick.snapshotsWritten, 'records persisted must reflect snapshotsWritten');
      }

      // All-empty must be recorded as `empty`, never `succeeded`/`completed`.
      setFootballIngestionServiceForTests({
        runTick: async () => ({ outcome: 'empty', requestsUsed: 1, snapshotsWritten: 0 }),
      } as never);
      const emptyEnqueued = await service.enqueueSync('admin', `key-empty-${Date.now()}`);
      const emptyOp = await waitForTerminal(emptyEnqueued.id);
      assert.equal(emptyOp.status, 'empty');
      assert.notEqual(emptyOp.status, 'succeeded');
      assert.notEqual(emptyOp.status, 'completed');
    } finally {
      setFootballIngestionServiceForTests(null);
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  }
);

test(
  'F06: concurrent identical idempotency keys create ONE operation (database-enforced)',
  { skip: !process.env.TEST_MONGO_URI },
  async () => {
    const dbName = `guiatv_adminapi_f06idem_${process.pid}`;
    await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName });
    await AdminOperationModel.createIndexes();
    const service = new FootballAdminService();
    const key = `idem-${Date.now()}`;
    try {
      setFootballIngestionServiceForTests({
        runTick: async () => ({ outcome: 'success', requestsUsed: 1, snapshotsWritten: 1, buckets: { future: 1 } }),
      } as never);
      const [a, b] = await Promise.all([
        service.enqueueSync('admin', key),
        service.enqueueSync('admin', key),
      ]);
      assert.equal(a.id, b.id, 'both calls must return the SAME operation');
      const count = await AdminOperationModel.countDocuments({ type: 'football.sync', idempotencyKey: key }).exec();
      assert.equal(count, 1, 'the unique index must collapse concurrent identical requests to one row');
      // The winner fired a background executeSync; let it finish before disconnect() or
      // the close interrupts its in-flight write (MongoClientClosedError, flaky in CI).
      await waitForTerminal(a.id);
    } finally {
      setFootballIngestionServiceForTests(null);
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  }
);
