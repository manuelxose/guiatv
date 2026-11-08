/**
 * M06-R1 — regression tests for the independent reviewer's R1 findings.
 *
 * Each test pins a defect the reviewer found AFTER the first repair pass, so it
 * cannot silently come back. A failing expectation here is a real regression.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { FootballIngestionService } from '@/application/sports/ingestion/FootballIngestionService';
import { InMemoryLock } from '@/application/sports/ingestion/Lock';
import { RequestBudget, RequestBudgetConfig } from '@/application/sports/ingestion/RequestBudget';

const CONFIG: RequestBudgetConfig = {
  dailyBudget: 100,
  liveReserve: 0,
  perRunCap: 10,
  throttleBackoffMs: 1000,
};

function persistence() {
  return {
    async upsertSnapshots(): Promise<number> {
      return 0;
    },
    async updateSyncState(): Promise<void> {},
    async recordRun(): Promise<void> {},
    async countSnapshots(): Promise<number> {
      return 0;
    },
  } as never;
}

// ───────────────────────────────────────────────────────── R1-3 (Low)

test('R1-3: "empty + skipped(budget)" with NO provider failure is not reported as failed', async () => {
  // One competition returns no matches; the second is refused by the budget.
  // Nothing ever threw, so calling this a failure would claim an error that did
  // not happen and would count toward opening the provider circuit breaker.
  let calls = 0;
  const budget = new RequestBudget(
    { ...CONFIG, dailyBudget: 1, liveReserve: 0 },
    { initiallyDisabled: false },
  );
  const service = new FootballIngestionService({
    providerId: 'openligadb',
    competitions: [
      { shortcuts: ['bl1'], season: '2026' },
      { shortcuts: ['ucl'], season: '2026' },
    ],
    adapter: {
      fetchMatches: async () => {
        calls += 1;
        return [];
      },
    },
    persistence: persistence(),
    lock: new InMemoryLock(),
    budget,
    clock: () => Date.parse('2026-11-06T12:00:00.000Z'),
  } as never);

  const result = await service.runTick();
  assert.ok(calls >= 1, 'the first competition must actually be fetched');
  assert.notEqual(
    result.outcome,
    'failed',
    'a run with no provider failure must not be labelled failed',
  );
  // And it must still not pretend useful data was acquired.
  const provider = service.diagnostics().providers[0] as unknown as Record<string, unknown>;
  assert.equal(provider['lastSuccessAt'], undefined, 'no useful record was acquired; lastSuccessAt must stay unset');
});

// ───────────────────────────────────────────────────────── R1-6 (Low)

test('R1-6: provider health is never "ok" when the failure counter was not measured', async () => {
  const { FootballAdminService } = await import('@/application/sports/services/FootballAdminService');
  const { FootballProviderSyncStateModel } = await import('@/infrastructure/sports/persistence/models');
  const mongoose = (await import('mongoose')).default;

  // Only run when a real database is available (the model needs a connection).
  if (!process.env.TEST_MONGO_URI) return;
  const dbName = `m06_r1_r16_${process.pid}`;
  await mongoose.connect(process.env.TEST_MONGO_URI, { dbName });
  try {
    await FootballProviderSyncStateModel.collection.insertOne({
      provider: 'openligadb',
      // consecutiveFailures deliberately absent (legacy/partial document)
      circuitState: 'closed',
    } as never);
    const providers = await new FootballAdminService().listProviders();
    const row = providers.find((p) => p.provider === 'openligadb');
    assert.ok(row, 'the inserted provider must be listed');
    assert.notEqual(row!.health, 'ok', 'health must not be "ok" when the counter was not measured');
    assert.equal(row!.consecutiveFailures, null);
    assert.equal(row!.consecutiveFailuresState, 'missing');
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});


