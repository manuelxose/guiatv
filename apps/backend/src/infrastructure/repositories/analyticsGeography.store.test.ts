import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createClient } from 'redis';
import { MongoAnalyticsRepository } from './MongoAnalyticsRepository';
import { ValkeyAnalyticsRepository } from './ValkeyAnalyticsRepository';
import { AnalyticsSessionRecord, IAnalyticsRepository } from '../../domain/repositories/IAnalyticsRepository';

/** The same sessions must produce the same geography report in both stores. */
async function seedAndRead(repo: IAnalyticsRepository) {
  const now = new Date();
  const session = (id: string, over: Partial<AnalyticsSessionRecord>): AnalyticsSessionRecord => ({ sessionId: id, anonId: id, startedAt: now, lastSeenAt: now, excluded: false, ...over });
  await repo.startSession(session('geo-1', { country: 'ES', region: 'MD', city: 'Madrid', geo: { status: 'located', regionName: 'Comunidad de Madrid', accuracyRadiusKm: 10 } }));
  await repo.startSession(session('geo-2', { country: 'ES', region: 'MD', city: 'Madrid', geo: { status: 'located', regionName: 'Comunidad de Madrid' } }));
  await repo.startSession(session('geo-3', { country: 'ES', region: 'CT', city: 'Barcelona', geo: { status: 'located', regionName: 'Cataluña' } }));
  await repo.startSession(session('geo-4', { country: 'MX', geo: { status: 'country_only' } }));
  await repo.startSession(session('geo-5', { geo: { status: 'private' } }));
  await repo.startSession(session('geo-6', {}));
  await repo.startSession(session('geo-admin', { country: 'FR', city: 'Paris', excluded: true, geo: { status: 'located' } }));
  return repo.getOverview(new Date(now.getTime() - 60_000), new Date(now.getTime() + 60_000), 90);
}

function assertReport(overview: Awaited<ReturnType<IAnalyticsRepository['getOverview']>>) {
  const madrid = overview.geographyDetail?.find((b) => b.city === 'Madrid');
  assert.deepEqual(madrid, { country: 'ES', region: 'MD', regionName: 'Comunidad de Madrid', city: 'Madrid', count: 2 });
  assert.equal(overview.geographyDetail?.find((b) => b.city === 'Barcelona')?.regionName, 'Cataluña');
  assert.deepEqual(overview.geographyDetail?.find((b) => b.country === 'MX'), { country: 'MX', count: 1 });
  assert.equal(overview.geographyDetail?.some((b) => b.country === 'FR'), false, 'excluded traffic is not counted');
  const status = Object.fromEntries((overview.geographyStatus || []).map((s) => [s.status, s.count]));
  assert.deepEqual([status.located, status.country_only, status.private, status.none], [3, 1, 1, 1]);
  const esMd = overview.geography?.find((g) => g.country === 'ES' && g.region === 'MD');
  assert.equal(esMd?.count, 2);
  assert.equal(overview.geography?.find((g) => g.country === 'Desconocido')?.count, 2);
}

test('geography report: Mongo', { skip: !process.env.TEST_MONGO_URI }, async () => {
  await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName: `guiatv_test_geo_${process.pid}` });
  try {
    assertReport(await seedAndRead(new MongoAnalyticsRepository()));
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test('geography report: Valkey', { skip: !process.env.TEST_REDIS_URL }, async () => {
  const url = new URL(process.env.TEST_REDIS_URL!);
  url.pathname = '/9';
  const admin = createClient({ url: url.toString() });
  await admin.connect();
  await admin.flushDb();
  const repo = new ValkeyAnalyticsRepository(url.toString());
  try {
    await repo.connect();
    assertReport(await seedAndRead(repo));
  } finally {
    await admin.flushDb();
    await admin.quit();
    await (repo as unknown as { client: { quit(): Promise<void> } }).client.quit();
  }
});
