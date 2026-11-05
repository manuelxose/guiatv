import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalyticsController } from './AnalyticsController';
import { TelemetryIngestService } from '../../application/services/analytics/TelemetryIngestService';
import { TelemetryFlagSource } from '../../application/services/analytics/telemetryFlags';
import { GeoIpService } from '../../infrastructure/analytics/GeoIpService';

test('geography accepts headers only from a configured socket and rejects unknown countries', async () => {
  const previous = process.env.ANALYTICS_GEO_TRUSTED_PROXIES;
  const previousDetail = process.env.ANALYTICS_GEO_DETAIL_TRUSTED_PROXIES;
  const sessions: any[] = [];
  // Geography from proxy headers now reaches sessions through the ingestion queue (`POST /collect`); the trust rules
  // under test are unchanged. Local GeoIP is disabled so only the header path is exercised.
  const repository = {
    startSession: async (session: unknown) => { sessions.push(session); },
    createEvents: async () => {},
    createEvent: async () => {},
    heartbeatSession: async () => null,
    endSession: async () => null,
  };
  const ingest = new TelemetryIngestService(repository as never, new GeoIpService({ enabled: false }));
  const controller = new AnalyticsController({} as never, ingest, new TelemetryFlagSource({}, () => false));
  const response = { set() { return this; }, status() { return this; }, json() { return this; }, end() { return this; } };
  let n = 0;
  const request = (remote: string, country: string, latitude = '40.4168', longitude = '-3.7038') => ({
    body: { v: 1, sessionId: `session-${++n}-xxxx`, anonId: 'anon-xxxx-1', session: {} }, socket: { remoteAddress: remote }, headers: {},
    get: (header: string) => ({ 'CF-IPCountry': country, 'CF-Region-Code': 'MD', 'CF-IPCity': 'Madrid', 'CF-IPLatitude': latitude, 'CF-IPLongitude': longitude } as Record<string, string>)[header],
  });
  try {
    process.env.ANALYTICS_GEO_TRUSTED_PROXIES = '10.0.0.1';
    process.env.ANALYTICS_GEO_DETAIL_TRUSTED_PROXIES = '10.0.0.1';
    await controller.collect(request('203.0.113.1', 'ES') as never, response as never);
    await controller.collect(request('::ffff:10.0.0.1', 'ES') as never, response as never);
    await controller.collect(request('10.0.0.1', 'XX') as never, response as never);
    await controller.collect(request('10.0.0.1', 'ES', '91', '-3.7') as never, response as never);
    process.env.ANALYTICS_GEO_DETAIL_TRUSTED_PROXIES = '';
    await controller.collect(request('10.0.0.1', 'ES') as never, response as never);
    await ingest.queue.drain();
    assert.equal(sessions.length, 5);
    assert.equal(sessions[0].country, undefined);
    assert.equal(sessions[0].region, undefined);
    assert.equal(sessions[0].latitude, undefined);
    assert.equal(sessions[1].country, 'ES');
    assert.equal(sessions[1].region, 'MD');
    assert.equal(sessions[1].city, 'Madrid');
    assert.equal(sessions[1].latitude, 40.4);
    assert.equal(sessions[1].longitude, -3.7);
    assert.equal(sessions[1].geo.source, 'proxy_header');
    assert.equal(sessions[2].country, undefined);
    assert.equal(sessions[2].region, undefined);
    assert.equal(sessions[2].city, undefined);
    assert.equal(sessions[3].latitude, undefined);
    assert.equal(sessions[3].longitude, undefined);
    assert.equal(sessions[4].country, 'ES');
    assert.equal(sessions[4].city, undefined);
    assert.equal(sessions[4].latitude, undefined);
  } finally {
    if (previous === undefined) delete process.env.ANALYTICS_GEO_TRUSTED_PROXIES;
    else process.env.ANALYTICS_GEO_TRUSTED_PROXIES = previous;
    if (previousDetail === undefined) delete process.env.ANALYTICS_GEO_DETAIL_TRUSTED_PROXIES;
    else process.env.ANALYTICS_GEO_DETAIL_TRUSTED_PROXIES = previousDetail;
  }
});

test('geography: the Cloudflare country header is believed only when the request came through a Cloudflare edge', async () => {
  const sessions: any[] = [];
  const repository = {
    startSession: async (session: unknown) => { sessions.push(session); },
    createEvents: async () => {}, createEvent: async () => {}, heartbeatSession: async () => null, endSession: async () => null,
  };
  const ingest = new TelemetryIngestService(repository as never, new GeoIpService({ enabled: false }));
  const controller = new AnalyticsController({} as never, ingest, new TelemetryFlagSource({}, () => false));
  const response = { set() { return this; }, status() { return this; }, json() { return this; }, end() { return this; } };
  let n = 0;
  const request = (forwarded: string) => ({
    body: { v: 1, sessionId: `cf-session-${++n}-xxxx`, anonId: 'anon-xxxx-1', session: {} }, socket: { remoteAddress: '127.0.0.1' }, headers: {},
    get: (header: string) => ({ 'X-Forwarded-For': forwarded, 'CF-IPCountry': 'ES', 'CF-IPCity': 'Vigo' } as Record<string, string>)[header],
  });
  await controller.collect(request('83.40.1.1, 172.68.10.20') as never, response as never);
  await controller.collect(request('172.68.10.20, 198.51.100.9') as never, response as never);
  await ingest.queue.drain();
  assert.equal(sessions[0].country, 'ES');
  assert.equal(sessions[0].city, undefined, 'city needs the detail setting');
  assert.equal(sessions[0].ip, '83.40.1.0', 'the visitor prefix, not the edge');
  assert.equal(sessions[1].country, undefined, 'forged header sent straight to the origin');
});
