import test from 'node:test';
import assert from 'node:assert/strict';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { TelemetryIngestQueue } from './TelemetryIngestQueue';
import { TelemetryIngestService, IngestContext } from './TelemetryIngestService';
import { validateCollectBatch, sanitizeAnalyticsPath, sanitizeReferrerHost, sanitizeEventData, clampTimestamp } from './telemetryValidation';
import { TelemetryFlagSource } from './telemetryFlags';
import { GeoIpService } from '../../../infrastructure/analytics/GeoIpService';
import { AnalyticsEventRecord, AnalyticsSessionRecord, IAnalyticsRepository } from '../../../domain/repositories/IAnalyticsRepository';

const opts = (over: Partial<ConstructorParameters<typeof TelemetryIngestQueue>[2]> = {}) => ({ maxItems: 100, maxEvents: 1_000, maxAttempts: 3, retryBaseMs: 5, unavailableDelayMs: 5, ...over });

test('validation: strips queries, personal segments, admin paths, forged server events and bad ids', () => {
  const now = Date.UTC(2026, 10, 4, 20);
  const result = validateCollectBatch({
    v: 1, sessionId: 'sess-1234-abcd', anonId: 'anon-1234-abcd',
    session: { startedAt: new Date(now).toISOString(), initialPath: '/buscar?q=me@mail.com', referrer: 'https://www.google.com/search?q=x', language: 'es-ES', timezone: 'Europe/Madrid', screen: { width: 407, height: 904 }, viewport: { width: 406, height: 724 }, device: { type: 'mobile', orientation: 'portrait', touch: true }, utm: { source: 'news', medium: 'a@b.co' } },
    events: [
      { eventId: 'e1-aaaaaaaa', type: 'page_view', path: '/perfil/64f0c2a9e1b2', occurredAt: new Date(now - 1000).toISOString() },
      { type: 'session_start', path: '/' },
      { type: 'Bad Type' },
      { type: 'page_view', path: '/admin/analytics' },
      { type: 'click', data: { email: 'x@y.zz', n: 3, deep: { a: { b: 1 } } }, occurredAt: '1999-01-01T00:00:00Z' },
    ],
  }, now);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { batch } = result;
  assert.equal(batch.session?.initialPath, '/buscar');
  assert.equal(batch.session?.referrer, 'www.google.com');
  assert.deepEqual(batch.session?.utm, { source: 'news' });
  assert.equal(batch.session?.device?.type, 'mobile');
  assert.deepEqual(batch.events.map((e) => e.path ?? null), ['/perfil/:usuario', null]);
  assert.equal(batch.rejected, 3);
  assert.deepEqual(batch.events[1].data, { email: '[redacted]', n: 3 });
  assert.equal(batch.events[1].data?.email, '[redacted]');
  assert.equal(batch.events[1].occurredAt.getTime(), now); // implausible timestamp clamped
  assert.equal(validateCollectBatch({ v: 1, sessionId: 'x', anonId: 'anon-1234-abcd' }).ok, false);
  assert.equal(validateCollectBatch({ v: 2, sessionId: 'sess-1234-abcd', anonId: 'anon-1234-abcd' }).ok, false);
  assert.equal(validateCollectBatch({ v: 1, sessionId: 'sess-1234-abcd', anonId: 'anon-1234-abcd', events: Array(51).fill({ type: 'click' }) }).ok, false);
});

test('validation helpers', () => {
  assert.equal(sanitizeAnalyticsPath('/x/abcdefghijklmnopqrstuvwxyzABCDEF0123'), '/x/:redacted');
  assert.equal(sanitizeAnalyticsPath('/embed/programacion'), undefined);
  assert.equal(sanitizeReferrerHost('https://guiaprogramaciontv.com/x'), undefined);
  assert.equal(sanitizeReferrerHost('t.co'), 't.co');
  assert.equal(sanitizeReferrerHost('javascript:alert(1)'), undefined);
  assert.equal(sanitizeEventData({ big: 'x'.repeat(5000) })?.big, 'x'.repeat(120));
  assert.equal(clampTimestamp('2026-11-04T20:10:00Z', Date.UTC(2026, 10, 4, 20)).getTime(), Date.UTC(2026, 10, 4, 20));
});

test('queue: bounded capacity is backpressure, FIFO order, retries then drops', async () => {
  const seen: number[] = [];
  let failFor = new Set<number>([2]);
  const queue = new TelemetryIngestQueue<number>(async (n) => {
    if (failFor.has(n)) throw new Error(`fail ${n}`);
    seen.push(n);
  }, () => true, opts({ maxItems: 5, maxAttempts: 2 }));
  for (let i = 1; i <= 5; i++) assert.equal(queue.offer(i, 1), true);
  assert.equal(queue.offer(6, 1), false);
  await queue.drain();
  assert.deepEqual(seen, [1, 3, 4, 5]);
  const m = queue.metrics();
  assert.equal(m.rejectedFull, 1);
  assert.equal(m.droppedAfterRetries, 1);
  assert.equal(m.failedAttempts, 2);
  assert.equal(m.depth, 0);
  failFor = new Set();
  assert.equal(queue.offer(7, 1), true);
  await queue.drain();
  assert.deepEqual(seen, [1, 3, 4, 5, 7]);
});

test('queue: event-count cap applies independently of batch count', () => {
  const queue = new TelemetryIngestQueue<number>(async () => new Promise(() => undefined), () => true, opts({ maxEvents: 10 }));
  assert.equal(queue.offer(1, 8), true);
  assert.equal(queue.offer(2, 3), false);
  assert.equal(queue.offer(3, 2), true);
});

test('queue: waits while storage is unavailable and recovers without loss (storage restart)', async () => {
  let available = false;
  const seen: number[] = [];
  const queue = new TelemetryIngestQueue<number>(async (n) => { seen.push(n); }, () => available, opts());
  for (let i = 0; i < 20; i++) queue.offer(i, 1);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(seen.length, 0);
  assert.ok(queue.metrics().storageUnavailableWaits >= 1);
  available = true;
  await queue.drain();
  assert.deepEqual(seen, Array.from({ length: 20 }, (_, i) => i));
});

test('queue: a 20 000-batch burst never blocks the event loop for long (yields between items)', async () => {
  const queue = new TelemetryIngestQueue<number>(async () => undefined, () => true, opts({ maxItems: 25_000, maxEvents: 250_000 }));
  const histogram = monitorEventLoopDelay({ resolution: 5 });
  histogram.enable();
  const start = Date.now();
  for (let i = 0; i < 20_000; i++) queue.offer(i, 5);
  const offerMs = Date.now() - start;
  await queue.drain(30_000);
  histogram.disable();
  assert.equal(queue.metrics().processed, 20_000);
  assert.ok(offerMs < 500, `offer loop took ${offerMs} ms`);
  assert.ok(histogram.max / 1e6 < 200, `max event-loop delay ${histogram.max / 1e6} ms`);
});

class MemoryRepo implements IAnalyticsRepository {
  sessions = new Map<string, AnalyticsSessionRecord>();
  events: AnalyticsEventRecord[] = [];
  calls: string[] = [];
  available = true;
  isAvailable() { return this.available; }
  async markExcludedSession() {}
  async startSession(s: AnalyticsSessionRecord) { this.calls.push(`start:${s.sessionId}`); if (!this.sessions.has(s.sessionId)) this.sessions.set(s.sessionId, s); }
  async heartbeatSession(p: { sessionId: string; lastSeenAt: Date; activity?: unknown; resume?: boolean }) {
    this.calls.push(`hb:${p.sessionId}${p.resume ? ':resume' : ''}`);
    const s = this.sessions.get(p.sessionId);
    if (s) { s.lastSeenAt = p.lastSeenAt; if (p.resume) s.endedAt = undefined; }
    return s || null;
  }
  async endSession(p: { sessionId: string; endedAt: Date }) { this.calls.push(`end:${p.sessionId}`); const s = this.sessions.get(p.sessionId); if (s) s.endedAt = p.endedAt; return s || null; }
  async createEvent(e: AnalyticsEventRecord) { await this.createEvents([e]); }
  async createEvents(es: AnalyticsEventRecord[]) { for (const e of es) { this.calls.push(`ev:${e.type}`); if (!this.events.some((x) => x.eventId === e.eventId)) this.events.push(e); } }
  async getLiveSessions() { return []; }
  async countLiveSessions() { return 0; }
  async getOverview() { return {} as never; }
  async getRecentEvents() { return []; }
  async getRealtimePages() { return null; }
}

const ctx = (over: Partial<IngestContext> = {}): IngestContext => ({ ip: '203.0.113.77', userAgent: 'UA', language: 'es-ES', admin: false, receivedAt: Date.now(), ...over });

test('ingest service: session before events, anonymised address, admin/IP exclusion, end and BFCache resume', async () => {
  const previous = process.env.ANALYTICS_EXCLUDED_IPS;
  process.env.ANALYTICS_EXCLUDED_IPS = '198.51.100.9';
  try {
    const repo = new MemoryRepo();
    const service = new TelemetryIngestService(repo, new GeoIpService({ enabled: false }), opts());
    const parsed = validateCollectBatch({ v: 1, sessionId: 'sess-aaaa-0001', anonId: 'anon-aaaa-0001', session: { initialPath: '/' }, events: [{ eventId: 'ev-00000001', type: 'page_view', path: '/' }] });
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    service.accept(parsed.batch, ctx({ ip: '::ffff:203.0.113.77' }));
    // Retried delivery of the same batch (client retry): idempotent.
    service.accept({ ...parsed.batch, session: undefined }, ctx());
    const end = validateCollectBatch({ v: 1, sessionId: 'sess-aaaa-0001', anonId: 'anon-aaaa-0001', end: { reason: 'bfcache' } });
    const resume = validateCollectBatch({ v: 1, sessionId: 'sess-aaaa-0001', anonId: 'anon-aaaa-0001', resume: true });
    if (!end.ok || !resume.ok) throw new Error('invalid fixtures');
    service.accept(end.batch, ctx());
    service.accept(resume.batch, ctx());
    await service.queue.drain();
    assert.deepEqual(repo.calls.slice(0, 3), ['start:sess-aaaa-0001', 'ev:session_start', 'ev:page_view']);
    assert.ok(repo.calls.includes('end:sess-aaaa-0001'));
    assert.equal(repo.calls[repo.calls.length - 1], 'hb:sess-aaaa-0001:resume');
    assert.equal(repo.events.filter((e) => e.type === 'page_view').length, 1);
    const session = repo.sessions.get('sess-aaaa-0001')!;
    assert.equal(session.ip, '203.0.113.0');
    assert.equal(session.excluded, false);
    assert.ok(repo.events.every((e) => !e.ip || e.ip === '203.0.113.0'));
    assert.equal(JSON.stringify([...repo.sessions.values(), ...repo.events]).includes('203.0.113.77'), false);

    const excludedRepo = new MemoryRepo();
    const excludedService = new TelemetryIngestService(excludedRepo, new GeoIpService({ enabled: false }), opts());
    excludedService.accept(parsed.batch, ctx({ ip: '198.51.100.9' }));
    const admin = validateCollectBatch({ v: 1, sessionId: 'sess-admin-0001', anonId: 'anon-admin-0001', session: {}, events: [{ type: 'page_view', path: '/' }] });
    if (!admin.ok) throw new Error('invalid fixture');
    excludedService.accept(admin.batch, ctx({ admin: true }));
    await excludedService.queue.drain();
    assert.equal(excludedRepo.sessions.get('sess-aaaa-0001')?.excluded, true);
    assert.equal(excludedRepo.sessions.get('sess-admin-0001')?.excluded, true);
    assert.ok(excludedRepo.events.every((e) => e.excluded === true));
  } finally {
    if (previous === undefined) delete process.env.ANALYTICS_EXCLUDED_IPS;
    else process.env.ANALYTICS_EXCLUDED_IPS = previous;
  }
});

test('ingest service: ANALYTICS_PII=none stores no address, user agent or location', async () => {
  process.env.ANALYTICS_PII = 'none';
  try {
    const repo = new MemoryRepo();
    const service = new TelemetryIngestService(repo, new GeoIpService({ enabled: false }), opts());
    const parsed = validateCollectBatch({ v: 1, sessionId: 'sess-none-0001', anonId: 'anon-none-0001', session: {}, events: [{ type: 'page_view', path: '/' }] });
    if (!parsed.ok) throw new Error('invalid fixture');
    service.accept(parsed.batch, ctx({ proxyGeo: { country: 'ES', city: 'Madrid' } }));
    await service.queue.drain();
    const session = repo.sessions.get('sess-none-0001')!;
    assert.equal(session.ip, undefined);
    assert.equal(session.userAgent, undefined);
    assert.equal(session.country, undefined);
    assert.equal(session.city, undefined);
  } finally {
    delete process.env.ANALYTICS_PII;
  }
});

test('session isolation under concurrent sessions: each session keeps its own ordered events', async () => {
  const repo = new MemoryRepo();
  const service = new TelemetryIngestService(repo, new GeoIpService({ enabled: false }), opts({ maxItems: 5_000, maxEvents: 50_000 }));
  for (let round = 0; round < 10; round++) {
    for (let s = 0; s < 50; s++) {
      const parsed = validateCollectBatch({ v: 1, sessionId: `sess-${String(s).padStart(4, '0')}-xx`, anonId: `anon-${s}-xxxxx`, session: round === 0 ? {} : undefined, events: [{ eventId: `ev-${s}-${round}-xxxx`, type: 'page_view', path: `/canales/c${round}` }] });
      if (!parsed.ok) throw new Error('fixture');
      assert.equal(service.accept(parsed.batch, ctx()), true);
    }
  }
  await service.queue.drain(20_000);
  for (let s = 0; s < 50; s++) {
    const own = repo.events.filter((e) => e.sessionId === `sess-${String(s).padStart(4, '0')}-xx` && e.type === 'page_view');
    assert.deepEqual(own.map((e) => e.path), Array.from({ length: 10 }, (_, r) => `/canales/c${r}`));
  }
});

test('flags: emergency switch by env or kill file, GA4 off by default, re-read after 5 s', () => {
  let now = 0;
  let killFile = false;
  const env: NodeJS.ProcessEnv = { ANALYTICS_KILL_FILE: '/run/kill', ANALYTICS_GA4_ENABLED: 'true', ANALYTICS_GA4_MEASUREMENT_ID: 'G-P6Z3BY2DVW' };
  const flags = new TelemetryFlagSource(env, () => killFile, () => now);
  assert.deepEqual([flags.get().ingestEnabled, flags.get().ga4Enabled, flags.get().ga4MeasurementId], [true, true, 'G-P6Z3BY2DVW']);
  killFile = true;
  assert.equal(flags.get().ingestEnabled, true); // cached
  now = 6_000;
  assert.deepEqual([flags.get().ingestEnabled, flags.get().ga4Enabled], [false, false]);
  assert.equal(new TelemetryFlagSource({}, () => false).get().ga4Enabled, false);
  assert.equal(new TelemetryFlagSource({ ANALYTICS_INGEST_ENABLED: 'false' }, () => false).get().killed, true);
  assert.equal(new TelemetryFlagSource({ ANALYTICS_GA4_MEASUREMENT_ID: 'not-an-id' }, () => false).get().ga4MeasurementId, undefined);
});
