import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { validateCollectBatch, sanitizeAnalyticsPath, isOpaqueSegment } from './telemetryValidation';
import { TelemetryIngestService } from './TelemetryIngestService';
import { TelemetryFlagSource } from './telemetryFlags';
import { GeoIpService } from '../../../infrastructure/analytics/GeoIpService';
import { AnalyticsController } from '../../../presentation/controllers/AnalyticsController';
import { createAnalyticsRoutes } from '../../../presentation/routes/analytics.routes';
import { publicCachePolicy } from '../../../presentation/middlewares/publicCachePolicy';
import { analyticsClientIp } from '../../../presentation/controllers/analyticsClientIp';
import { MongoAnalyticsRepository } from '../../../infrastructure/repositories/MongoAnalyticsRepository';
import { AnalyticsEventModel } from '../../../infrastructure/database/models/AnalyticsEvent.model';

test('review C1: validation is linear — 60 kB adversarial strings cost milliseconds, not seconds', () => {
  const evil = 'a'.repeat(60_000);
  const start = process.hrtime.bigint();
  const result = validateCollectBatch({ v: 1, sessionId: 'sess-aaaa-0001', anonId: 'anon-aaaa-0001', session: { initialPath: `/${evil}` }, events: Array.from({ length: 50 }, () => ({ type: 'click', title: evil, name: `${evil}@${evil}`, path: `/${'b'.repeat(60_000)}@x`, data: { a: evil, b: [evil, evil] } })) });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(result.ok, true);
  assert.ok(ms < 250, `validation took ${ms.toFixed(1)} ms`);
});

test('review m10: readable long slugs are kept, opaque ids redacted', () => {
  assert.equal(sanitizeAnalyticsPath('/series/la-casa-de-papel-temporada-5-capitulo-final'), '/series/la-casa-de-papel-temporada-5-capitulo-final');
  assert.equal(sanitizeAnalyticsPath('/x/64f0c2a9e1b2c3d4e5f60718'), '/x/:redacted');
  assert.equal(isOpaqueSegment('3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c'), true);
  assert.equal(isOpaqueSegment('programacion_de_la_television_espanola'), false);
});

test('review m9: garbage in X-Forwarded-For cannot hide or redirect the client address', () => {
  assert.equal(analyticsClientIp('127.0.0.1', 'garbage, 81.2.69.142', '127.0.0.1,::1'), '81.2.69.142');
  assert.equal(analyticsClientIp('127.0.0.1', '6.6.6.6, not-ip, 81.2.69.142', '127.0.0.1'), '81.2.69.142');
});

test('review M3/M4: admin role resolved off the request path; beacon batches of an admin session stay excluded', async () => {
  const sessions = new Map<string, any>();
  const events: any[] = [];
  const marked: string[] = [];
  const repo = {
    isAvailable: () => true,
    markExcludedSession: async (id: string) => { marked.push(id); },
    startSession: async (s: any) => { sessions.set(s.sessionId, s); },
    createEvents: async (es: any[]) => { events.push(...es); },
    createEvent: async () => {},
    heartbeatSession: async () => null,
    endSession: async () => null,
  };
  let lookups = 0;
  const ingest = new TelemetryIngestService(repo as never, new GeoIpService({ enabled: false }), undefined, async (token) => { lookups++; return token === 'admin-token' ? 'admin' : 'user'; });
  const batch = (session: boolean) => {
    const r = validateCollectBatch({ v: 1, sessionId: 'sess-admin-9999', anonId: 'anon-admin-9999', session: session ? {} : undefined, events: [{ type: 'page_view', path: session ? '/' : '/canales' }] });
    if (!r.ok) throw new Error('fixture');
    return r.batch;
  };
  ingest.accept(batch(true), { ip: '81.2.69.142', admin: false, authToken: 'admin-token', receivedAt: Date.now() });
  ingest.accept(batch(false), { ip: '81.2.69.142', admin: false, receivedAt: Date.now() }); // beacon: no token
  ingest.accept(batch(false), { ip: '81.2.69.142', admin: false, authToken: 'admin-token', receivedAt: Date.now() });
  await ingest.queue.drain();
  assert.equal(sessions.get('sess-admin-9999').excluded, true);
  assert.ok(events.every((e) => e.excluded === true));
  assert.equal(lookups, 1, 'role cached');
});

test('review M7: events always carry an explicit excluded boolean (PII=none keeps realtime reports usable)', async () => {
  process.env.ANALYTICS_PII = 'none';
  try {
    const events: any[] = [];
    const repo = { isAvailable: () => true, markExcludedSession: async () => {}, startSession: async () => {}, createEvents: async (es: any[]) => { events.push(...es); }, createEvent: async () => {}, heartbeatSession: async () => null, endSession: async () => null };
    const ingest = new TelemetryIngestService(repo as never, new GeoIpService({ enabled: false }));
    const r = validateCollectBatch({ v: 1, sessionId: 'sess-none-7777', anonId: 'anon-none-7777', events: [{ type: 'page_view', path: '/' }] });
    if (!r.ok) throw new Error('fixture');
    ingest.accept(r.batch, { ip: '81.2.69.142', admin: false, receivedAt: Date.now() });
    await ingest.queue.drain();
    assert.equal(events[0].excluded, false);
    assert.equal(events[0].ip, undefined);
  } finally {
    delete process.env.ANALYTICS_PII;
  }
});

test('review M8: Mongo ignores pure duplicate batches but surfaces mixed write failures', async () => {
  const repo = new MongoAnalyticsRepository();
  const original = AnalyticsEventModel.insertMany;
  try {
    (AnalyticsEventModel as any).insertMany = async () => { const e: any = new Error('dup'); e.code = 11000; e.writeErrors = [{ code: 11000 }, { err: { code: 11000 } }]; throw e; };
    await repo.createEvents([{ eventId: 'e-1', sessionId: 's', anonId: 'a', type: 'click', occurredAt: new Date() }]);
    (AnalyticsEventModel as any).insertMany = async () => { const e: any = new Error('mixed'); e.code = 11000; e.writeErrors = [{ code: 11000 }, { code: 2 }]; throw e; };
    await assert.rejects(repo.createEvents([{ eventId: 'e-2', sessionId: 's', anonId: 'a', type: 'click', occurredAt: new Date() }]), /mixed/);
    let stored: any[] = [];
    (AnalyticsEventModel as any).insertMany = async (docs: any[]) => { stored = docs; };
    await repo.createEvents([{ eventId: 'e-3', sessionId: 's', anonId: 'a', type: 'click', occurredAt: new Date(), ip: '81.2.69.142', userAgent: undefined }]);
    assert.equal(stored[0].ip, '81.2.69.0');
    assert.equal('userAgent' in stored[0], false, 'undefined fields are not stored as null');
  } finally {
    (AnalyticsEventModel as any).insertMany = original;
  }
});

test('review route: /collect 202, text/plain beacon, 400, 413, kill switch; /config cacheable', async () => {
  const accepted: any[] = [];
  const ingest = { accept: (b: any) => { accepted.push(b); return true; }, countInvalid() {}, countDisabled() {}, queue: { metrics: () => ({}) }, diagnostics: () => ({}) };
  let killed = false;
  const flags = new TelemetryFlagSource({}, () => killed);
  (flags as any).get = () => ({ ingestEnabled: !killed, killed, ga4Enabled: false, geoipEnabled: false });
  const controller = new AnalyticsController({ isAvailable: () => true } as never, ingest as never, flags);
  const app = express();
  app.use(publicCachePolicy);
  app.use('/v2/telemetry', createAnalyticsRoutes(controller, { getSession: async () => { throw new Error('x'); } } as never));
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode || err.status || 500).json({ message: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const port = (server.address() as any).port;
  const url = `http://127.0.0.1:${port}/v2/telemetry`;
  const body = JSON.stringify({ v: 1, sessionId: 'sess-route-0001', anonId: 'anon-route-0001', events: [{ type: 'page_view', path: '/?q=x' }] });
  try {
    assert.equal((await fetch(`${url}/collect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 202);
    assert.equal((await fetch(`${url}/collect`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body })).status, 202);
    assert.equal(accepted.length, 2);
    assert.equal(accepted[0].events[0].path, '/');
    assert.equal((await fetch(`${url}/collect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"v":1}' })).status, 400);
    const big = JSON.stringify({ v: 1, sessionId: 'sess-route-0001', anonId: 'anon-route-0001', events: [{ type: 'click', title: 'x'.repeat(70_000) }] });
    assert.equal((await fetch(`${url}/collect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: big })).status, 413);
    const config = await fetch(`${url}/config`);
    assert.match(config.headers.get('cache-control') || '', /public, max-age=60/);
    killed = true;
    const off = await fetch(`${url}/collect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(off.status, 204);
    assert.equal(off.headers.get('x-telemetry-disabled'), '1');
    assert.equal(((await (await fetch(`${url}/config`)).json()) as any).data.enabled, false);
    assert.equal(accepted.length, 2);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
