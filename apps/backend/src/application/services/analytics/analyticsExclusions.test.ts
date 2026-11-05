import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { parseIpRule, ipMatchesRule } from '../../../infrastructure/analytics/ipPrivacy';
import { AnalyticsExclusionService, ExclusionStore } from './AnalyticsExclusionService';
import { TelemetryIngestService } from './TelemetryIngestService';
import { validateCollectBatch } from './telemetryValidation';
import { GeoIpService } from '../../../infrastructure/analytics/GeoIpService';
import { AnalyticsController } from '../../../presentation/controllers/AnalyticsController';
import { createAnalyticsRoutes } from '../../../presentation/routes/analytics.routes';

function memoryStore(): ExclusionStore & { rows: Array<{ id: string; value: string; label?: string }>; fail: boolean } {
  let next = 1;
  const store = {
    rows: [] as Array<{ id: string; value: string; label?: string }>,
    fail: false,
    async list() { if (store.fail) throw new Error('db down'); return store.rows.map((r) => ({ ...r })); },
    async add(entry: { value: string; label?: string }) { const id = String(next++).padStart(24, 'a'); store.rows.push({ id, ...entry }); return { id }; },
    async remove(id: string) { const before = store.rows.length; store.rows = store.rows.filter((r) => r.id !== id); return store.rows.length < before; },
  };
  return store;
}

const ifaces = () => ({ eth0: [{ address: '203.0.113.50', family: 'IPv4', internal: false }, { address: '2001:db8:50::1', family: 'IPv6', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }], lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] }) as never;

test('IP rules: exact and CIDR, IPv4/IPv6/mapped, canonical form, invalid input', () => {
  const v4 = parseIpRule('198.51.100.77/24')!;
  assert.equal(v4.value, '198.51.100.0/24');
  assert.ok(ipMatchesRule('198.51.100.3', v4));
  assert.ok(ipMatchesRule('::ffff:198.51.100.200', v4));
  assert.ok(!ipMatchesRule('198.51.101.3', v4));
  const v6 = parseIpRule('2001:DB8:abcd::/48')!;
  assert.equal(v6.value, '2001:db8:abcd::/48');
  assert.ok(ipMatchesRule('2001:db8:abcd:1::5', v6));
  assert.ok(!ipMatchesRule('2001:db8:abce::5', v6));
  assert.ok(!ipMatchesRule('198.51.100.3', v6));
  assert.equal(parseIpRule('203.0.113.7')!.value, '203.0.113.7');
  for (const bad of ['', 'abc', '300.1.1.1', '1.2.3.4/33', '1.2.3.4/x', '1.2.3.4/8/9', '2001:db8::/129']) assert.equal(parseIpRule(bad), null, bad);
});

test('exclusions: loopback, this server\'s addresses and env are built in; manual rules add, match and remove', async () => {
  const store = memoryStore();
  const service = new AnalyticsExclusionService(store, { ANALYTICS_EXCLUDED_IPS: '192.0.2.10, 100.64.0.0/10' }, ifaces);
  assert.ok(service.isExcluded('127.0.0.1'));
  assert.ok(service.isExcluded('203.0.113.50'), 'server public IPv4');
  assert.ok(service.isExcluded('2001:db8:50::1'), 'server public IPv6');
  assert.ok(!service.isExcluded('fe80::1'), 'link-local addresses are not server identities');
  assert.ok(service.isExcluded('192.0.2.10'));
  assert.ok(service.isExcluded('100.100.1.1'));
  assert.ok(!service.isExcluded('81.2.69.142'));
  const entry = await service.add('81.2.69.0/24', 'Oficina', 'admin@example.test');
  assert.equal(entry.value, '81.2.69.0/24');
  assert.ok(service.isExcluded('81.2.69.142'));
  await assert.rejects(service.add('81.2.69.5/24', undefined, 'x'), /ya está excluida/);
  await assert.rejects(service.add('10.0.0.0/4', undefined, 'x'), /demasiado amplio/);
  await assert.rejects(service.add('nope', undefined, 'x'), /no válido/);
  const list = await service.list();
  assert.deepEqual(new Set(list.map((e) => e.source)), new Set(['loopback', 'server', 'env', 'manual']));
  assert.equal(service.matching('81.2.69.142')[0].label, 'Oficina');
  assert.ok(await service.remove(entry.id!));
  assert.ok(!service.isExcluded('81.2.69.142'));
});

test('exclusions: a failing store keeps the last known rules', async () => {
  let now = 0;
  const store = memoryStore();
  const service = new AnalyticsExclusionService(store, {}, () => ({}) as never, () => now);
  await service.add('81.2.69.0/24', undefined, 'x');
  store.fail = true;
  now = 120_000;
  assert.ok(service.isExcluded('81.2.69.1'));
  await new Promise((r) => setImmediate(r));
  assert.ok(service.isExcluded('81.2.69.1'));
});

test('ingestion: traffic from a manually excluded range is stored as excluded', async () => {
  const sessions: any[] = [];
  const repo = { isAvailable: () => true, markExcludedSession: async () => {}, startSession: async (s: any) => { sessions.push(s); }, createEvents: async () => {}, createEvent: async () => {}, heartbeatSession: async () => null, endSession: async () => null };
  const exclusions = new AnalyticsExclusionService(memoryStore(), {}, () => ({}) as never);
  await exclusions.add('81.2.69.0/24', 'Oficina', 'x');
  const ingest = new TelemetryIngestService(repo as never, new GeoIpService({ enabled: false }), undefined, undefined, exclusions);
  for (const [id, ip] of [['sess-off-0001', '81.2.69.142'], ['sess-pub-0001', '198.51.100.9']]) {
    const r = validateCollectBatch({ v: 1, sessionId: id, anonId: `anon-${id}`, session: {} });
    if (!r.ok) throw new Error('fixture');
    ingest.accept(r.batch, { ip, admin: false, receivedAt: Date.now() });
  }
  await ingest.queue.drain();
  assert.equal(sessions.find((s) => s.sessionId === 'sess-off-0001').excluded, true);
  assert.equal(sessions.find((s) => s.sessionId === 'sess-pub-0001').excluded, false);
});

test('exclusion endpoints: admin only, "mine" uses the requester address, validation errors are 400', async () => {
  const exclusions = new AnalyticsExclusionService(memoryStore(), {}, () => ({}) as never);
  const controller = new AnalyticsController({ isAvailable: () => true } as never, undefined, undefined, undefined, 'mongo', undefined, exclusions);
  const auth = { getSession: async (token: string) => ({ id: token, email: `${token}@example.test`, role: token === 'admin' ? 'admin' : 'user' }) };
  const app = express();
  app.use(express.json());
  app.use('/analytics', createAnalyticsRoutes(controller, auth as never));
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode || 500).json({ message: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/analytics/exclusions`;
  const call = (token: string, method = 'GET', body?: unknown, path = '') => fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-forwarded-for': '81.2.69.142' }, body: body ? JSON.stringify(body) : undefined });
  try {
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await call('user')).status, 403);
    const mine = await call('admin', 'POST', { mine: true });
    assert.equal(mine.status, 201);
    assert.equal(((await mine.json()) as any).data.entry.value, '81.2.69.142');
    const listed = (await (await call('admin')).json()) as any;
    assert.equal(listed.data.you.ip, '81.2.69.142');
    assert.equal(listed.data.you.excludedBy[0].label, 'Mi IP (administración)');
    assert.equal((await call('admin', 'POST', { value: 'garbage' })).status, 400);
    const id = listed.data.entries.find((e: any) => e.source === 'manual').id;
    assert.equal((await call('admin', 'DELETE', undefined, `/${id}`)).status, 200);
    assert.equal((await call('admin', 'DELETE', undefined, '/not-an-id')).status, 400);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
