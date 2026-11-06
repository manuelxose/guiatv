import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFootballIngestionService, resolveCompetitionPlan } from './factory';

/**
 * These tests run without a MongoDB connection, so they exercise the explicitly
 * opted-in single-process mode (FOOTBALL_DURABLE_QUOTA=0). The durable
 * cluster-shared authority fails closed without a connection - see the dedicated
 * test below - so a test must never rely on a silent fallback.
 */
function withLocalQuota<T>(run: () => T): T {
  const previous = process.env.FOOTBALL_DURABLE_QUOTA;
  process.env.FOOTBALL_DURABLE_QUOTA = '0';
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.FOOTBALL_DURABLE_QUOTA;
    else process.env.FOOTBALL_DURABLE_QUOTA = previous;
  }
}

test('factory builds a service whose diagnostics report the openligadb provider', () => {
  withLocalQuota(() => {
    const service = buildFootballIngestionService({
      fetch: async () => ({ ok: true, status: 200, json: async () => [] }),
    });
    const report = service.diagnostics();
    assert.equal(report.providers[0].provider, 'openligadb');
    assert.ok(report.providers[0].quotaRemaining > 0);
  });
});

test('emergency disable switch prevents any upstream request', async () => {
  const previous = process.env.OPENLIGADB_EMERGENCY_DISABLED;
  process.env.OPENLIGADB_EMERGENCY_DISABLED = '1';
  try {
    await withLocalQuota(async () => {
      let called = false;
      const service = buildFootballIngestionService({
        fetch: async () => {
          called = true;
          throw new Error('must not be called');
        },
      });
      const result = await service.runTick();
      assert.equal(result.outcome, 'skipped');
      assert.equal(result.reason, 'emergency_disabled');
      assert.equal(called, false);
    });
  } finally {
    if (previous === undefined) delete process.env.OPENLIGADB_EMERGENCY_DISABLED;
    else process.env.OPENLIGADB_EMERGENCY_DISABLED = previous;
  }
});

/**
 * F07 (independent review): without a MongoDB connection the durable authority
 * cannot be built. Silently using a process-local budget would let two workers each
 * believe they own the quota, so construction must fail closed instead.
 */
test('M06 F07: the factory fails closed when the durable authority cannot be built', () => {
  const previous = process.env.FOOTBALL_DURABLE_QUOTA;
  delete process.env.FOOTBALL_DURABLE_QUOTA; // default = durable requested
  try {
    assert.throws(
      () =>
        buildFootballIngestionService({
          fetch: async () => ({ ok: true, status: 200, json: async () => [] }),
        }),
      /durable quota authority requires a ready MongoDB connection/,
      'a disconnected process must not silently fall back to a process-local budget'
    );
  } finally {
    if (previous !== undefined) process.env.FOOTBALL_DURABLE_QUOTA = previous;
  }
});

/**
 * M06: the competition plan is the eight competitions verified by probe. An unknown
 * code must be ignored rather than forwarded to the provider, and the plan can only
 * ever narrow.
 */
test('M06: the competition plan never widens beyond the verified competitions', () => {
  const all = resolveCompetitionPlan(undefined);
  assert.equal(all.length, 8);
  const narrowed = resolveCompetitionPlan('bl1,ucl');
  assert.equal(narrowed.length, 2);
  const unknown = resolveCompetitionPlan('la1,nope');
  assert.equal(unknown.length, 0, 'an unknown code must never reach the provider');
});
