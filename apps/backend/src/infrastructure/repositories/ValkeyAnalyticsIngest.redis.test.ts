import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from 'redis';
import { ValkeyAnalyticsRepository } from './ValkeyAnalyticsRepository';

test('Valkey: per-session events beyond the global log cap, idempotent eventIds, anonymised IPs, excluded traffic out of aggregates', { skip: !process.env.TEST_REDIS_URL }, async () => {
  // A separate logical database: other *.redis tests run in parallel processes on the same server.
  const url = new URL(process.env.TEST_REDIS_URL!);
  url.pathname = '/7';
  const redisUrl = url.toString();
  const previousMax = process.env.ANALYTICS_EVENT_LOG_MAX;
  const admin = createClient({ url: redisUrl });
  await admin.connect();
  await admin.flushDb();
  const repo = new ValkeyAnalyticsRepository(redisUrl);
  try {
    await repo.connect();
    const now = new Date();
    await repo.startSession({ sessionId: 'old-session', anonId: 'anon-old', startedAt: now, lastSeenAt: now, ip: '2001:db8:85a3::8a2e:370:7334', excluded: false });
    await repo.createEvents([{ eventId: 'old-1', sessionId: 'old-session', anonId: 'anon-old', type: 'page_view', path: '/canales', occurredAt: now, ip: '203.0.113.77' }]);
    // 6 000 events from other sessions push the old session out of the global log (cap 5 000).
    for (let chunk = 0; chunk < 60; chunk++) {
      await repo.createEvents(Array.from({ length: 100 }, (_, i) => ({ eventId: `n-${chunk}-${i}`, sessionId: `s-${chunk}`, anonId: `a-${chunk}`, type: 'click', occurredAt: now })));
    }
    const sessionEvents = await repo.getRecentEvents({ sessionId: 'old-session', limit: 50 });
    assert.equal(sessionEvents.length, 1);
    assert.equal(sessionEvents[0].eventId, 'old-1');
    assert.equal(sessionEvents[0].ip, '203.0.113.0');
    const isolated = await repo.getRecentEvents({ sessionId: 's-3', limit: 500 });
    assert.equal(isolated.length, 100);
    assert.ok(isolated.every((event) => event.sessionId === 's-3'));

    // Retried delivery: same eventId is not double counted.
    await repo.createEvents([{ eventId: 'pv-1', sessionId: 'old-session', anonId: 'anon-old', type: 'page_view', path: '/deportes', occurredAt: now }]);
    await repo.createEvents([{ eventId: 'pv-1', sessionId: 'old-session', anonId: 'anon-old', type: 'page_view', path: '/deportes', occurredAt: now }]);
    const overview = await repo.getOverview(new Date(now.getTime() - 60_000), now, 90);
    assert.equal(overview.topPages.find((page) => page.path === '/deportes')?.count, 1);

    // Excluded (admin) traffic is stored for the drill-down but not counted.
    await repo.startSession({ sessionId: 'admin-session', anonId: 'anon-admin', startedAt: now, lastSeenAt: now, excluded: true });
    await repo.createEvents([{ eventId: 'adm-1', sessionId: 'admin-session', anonId: 'anon-admin', type: 'page_view', path: '/solo-admin', occurredAt: now, excluded: true }]);
    const after = await repo.getOverview(new Date(now.getTime() - 60_000), now, 90);
    assert.equal(after.topPages.some((page) => page.path === '/solo-admin'), false);
    assert.equal(after.totalSessions, overview.totalSessions);

    const live = await repo.getLiveSessions(90, 50);
    assert.equal(live.find((session) => session.sessionId === 'old-session')?.ip, '2001:db8:85a3::');

    // Activity-only heartbeat keeps the start metadata; resume reopens an ended session.
    await repo.startSession({ sessionId: 'meta', anonId: 'anon-meta', startedAt: now, lastSeenAt: now, metadata: { device: { type: 'mobile' } } });
    await repo.endSession({ sessionId: 'meta', endedAt: now, lastSeenAt: now, endReason: 'bfcache' });
    const resumed = await repo.heartbeatSession({ sessionId: 'meta', lastSeenAt: new Date(), activity: { idleSec: 3, isIdle: false, lastActivityAt: now.toISOString() }, resume: true });
    assert.equal(resumed?.metadata?.device?.type, 'mobile');
    assert.equal(resumed?.metadata?.activity?.idleSec, 3);
    assert.equal(resumed?.endedAt, undefined);
    assert.equal(repo.isAvailable(), true);
  } finally {
    if (previousMax === undefined) delete process.env.ANALYTICS_EVENT_LOG_MAX;
    await admin.flushDb();
    await admin.quit();
    await (repo as unknown as { client: { quit(): Promise<void> } }).client.quit();
  }
});

test('Valkey review M5: a write failure after deduplication does not lose the events on retry', { skip: !process.env.TEST_REDIS_URL }, async () => {
  const url = new URL(process.env.TEST_REDIS_URL!);
  url.pathname = '/8';
  const repo = new ValkeyAnalyticsRepository(url.toString());
  const client = (repo as unknown as { client: any }).client;
  try {
    await repo.connect();
    await client.flushDb();
    const originalMulti = client.multi.bind(client);
    let calls = 0;
    client.multi = () => {
      const pipeline = originalMulti();
      calls++;
      if (calls === 2) pipeline.exec = async () => { throw new Error('connection dropped'); };
      return pipeline;
    };
    const event = { eventId: 'retry-1', sessionId: 'retry-session', anonId: 'a', type: 'page_view', path: '/retry', occurredAt: new Date(), excluded: false };
    await assert.rejects(repo.createEvents([event]), /connection dropped/);
    client.multi = originalMulti;
    await repo.createEvents([event]);
    const stored = await repo.getRecentEvents({ sessionId: 'retry-session', limit: 10 });
    assert.equal(stored.length, 1);
  } finally {
    await client.flushDb();
    await client.quit();
  }
});
