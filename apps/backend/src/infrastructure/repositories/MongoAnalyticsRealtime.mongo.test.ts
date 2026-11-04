import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { AnalyticsEventModel } from '../database/models/AnalyticsEvent.model';
import { AnalyticsSessionModel } from '../database/models/AnalyticsSession.model';
import { MongoAnalyticsRepository } from './MongoAnalyticsRepository';

test('realtime pages counts distinct users, minutes and views with exclusions', { skip: !process.env.TEST_MONGO_URI }, async () => {
  const dbName = `guiatv_test_realtime_${process.pid}`;
  const previous = process.env.ANALYTICS_EXCLUDED_IPS;
  process.env.ANALYTICS_EXCLUDED_IPS = '203.0.113.9';
  await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName });
  const now = new Date();
  const at = (seconds: number) => new Date(now.getTime() - seconds * 1000);
  try {
    await AnalyticsSessionModel.create([
      { sessionId: 'admin', anonId: 'admin', startedAt: now, lastSeenAt: now, excluded: true },
      { sessionId: 'ip-session', anonId: 'ip-user', startedAt: now, lastSeenAt: now, ip: '203.0.113.9' },
    ]);
    const repo = new MongoAnalyticsRepository();
    await repo.startSession({ sessionId: 'geo', anonId: 'geo', startedAt: now, lastSeenAt: now, country: 'ES', region: 'MD', city: 'Madrid', latitude: 40.4, longitude: -3.7 });
    const geo = (await repo.getLiveSessions(90, 50)).find((session) => session.sessionId === 'geo');
    assert.deepEqual([geo?.country, geo?.region, geo?.city, geo?.latitude, geo?.longitude], ['ES', 'MD', 'Madrid', 40.4, -3.7]);
    const before = await repo.countLiveSessions(90);
    await repo.startSession({ sessionId: 'idle', anonId: 'idle', startedAt: now, lastSeenAt: now, metadata: { activity: { idleSec: 300 } } });
    assert.equal(await repo.countLiveSessions(90), before);
    assert.equal((await repo.getLiveSessions(90, 50)).some((s) => s.sessionId === 'idle'), false);
    await repo.heartbeatSession({ sessionId: 'idle', lastSeenAt: now, metadata: { activity: { idleSec: 0 } } });
    assert.equal(await repo.countLiveSessions(90), before + 1);
    await repo.heartbeatSession({ sessionId: 'idle', lastSeenAt: now, metadata: { activity: { idleSec: 300 } } });
    assert.equal(await repo.countLiveSessions(90), before);
    assert.ok(await AnalyticsSessionModel.findOne({ sessionId: 'idle' }));
    await AnalyticsEventModel.create([
      { eventId: '1', sessionId: 'a', anonId: 'one', type: 'page_view', path: '/a', occurredAt: at(10) },
      { eventId: '2', sessionId: 'a', anonId: 'one', type: 'click', path: '/a', occurredAt: at(20) },
      { eventId: '3', sessionId: 'b', anonId: 'two', type: 'page_view', path: '/a', occurredAt: at(80) },
      { eventId: '4', sessionId: 'a', anonId: 'one', type: 'page_view', path: '/b', occurredAt: at(80) },
      { eventId: '5', sessionId: 'admin', anonId: 'admin', type: 'page_view', path: '/a', occurredAt: at(10) },
      { eventId: '6', sessionId: 'ip-session', anonId: 'ip-user', type: 'page_view', path: '/a', occurredAt: at(10) },
      { eventId: '7', sessionId: 'c', anonId: 'old', type: 'page_view', path: '/a', occurredAt: at(1800) },
      { eventId: '8', sessionId: 'd', anonId: 'ip-event', ip: '127.0.0.1', type: 'page_view', path: '/a', occurredAt: at(10) },
    ]);
    const report = await repo.getRealtimePages(now);
    assert.equal(report.activeUsers, 2);
    assert.equal(report.pageViews, 3);
    assert.equal(report.minutes.length, 30);
    assert.equal(report.minutes[29].users, 1);
    assert.equal(report.minutes[28].users, 2);
    assert.deepEqual(report.pages, [{ path: '/a', users: 2, views: 2 }, { path: '/b', users: 1, views: 1 }]);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (previous === undefined) delete process.env.ANALYTICS_EXCLUDED_IPS;
    else process.env.ANALYTICS_EXCLUDED_IPS = previous;
  }
});
