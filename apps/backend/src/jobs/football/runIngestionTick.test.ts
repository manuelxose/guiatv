import test from 'node:test';
import assert from 'node:assert/strict';
import { runFootballIngestionTick } from './runIngestionTick';

test('the job entry runs exactly one ingestion tick', async () => {
  let calls = 0;
  const result = await runFootballIngestionTick({
    runTick: async () => {
      calls += 1;
      return { outcome: 'success', requestsUsed: 1, snapshotsWritten: 2 };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.outcome, 'success');
  assert.equal(result.snapshotsWritten, 2);
});
