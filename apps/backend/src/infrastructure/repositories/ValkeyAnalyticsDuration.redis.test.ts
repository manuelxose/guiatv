import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from 'redis';
import { ValkeyAnalyticsRepository } from './ValkeyAnalyticsRepository';

test('Valkey: a session that ends several times counts once in the average duration', { skip: !process.env.TEST_REDIS_URL }, async () => {
  const url = new URL(process.env.TEST_REDIS_URL!);
  url.pathname = '/8'; // own logical database: other *.redis tests run in parallel on the same server
  const admin = createClient({ url: url.toString() });
  await admin.connect();
  await admin.flushDb();
  const repo = new ValkeyAnalyticsRepository(url.toString());
  try {
    await repo.connect();
    const start = new Date(Date.now() - 600_000);
    await repo.startSession({ sessionId: 's1', anonId: 'a1', startedAt: start, lastSeenAt: start, excluded: false });
    // Reload at 2 minutes, then close at 10: the old code summed 120 + 600 over two sessions (avg 360 s).
    await repo.endSession({ sessionId: 's1', endedAt: new Date(start.getTime() + 120_000), lastSeenAt: start });
    await repo.endSession({ sessionId: 's1', endedAt: new Date(start.getTime() + 600_000), lastSeenAt: start });
    const overview = await repo.getOverview(new Date(start.getTime() - 60_000), new Date(), 90);
    assert.equal(overview.avgSessionDurationSec, 600);
  } finally {
    await admin.flushDb();
    await admin.quit();
    await (repo as unknown as { client: { quit(): Promise<void> } }).client.quit();
  }
});
