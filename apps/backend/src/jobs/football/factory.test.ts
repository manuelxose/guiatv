import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFootballIngestionService } from './factory';

test('factory builds a service whose diagnostics report the openligadb provider', () => {
  const service = buildFootballIngestionService({
    fetch: async () => ({ ok: true, status: 200, json: async () => [] }),
  });
  const report = service.diagnostics();
  assert.equal(report.providers[0].provider, 'openligadb');
  assert.ok(report.providers[0].quotaRemaining > 0);
});

test('emergency disable switch prevents any upstream request', async () => {
  const previous = process.env.OPENLIGADB_EMERGENCY_DISABLED;
  process.env.OPENLIGADB_EMERGENCY_DISABLED = '1';
  try {
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
  } finally {
    if (previous === undefined) delete process.env.OPENLIGADB_EMERGENCY_DISABLED;
    else process.env.OPENLIGADB_EMERGENCY_DISABLED = previous;
  }
});
