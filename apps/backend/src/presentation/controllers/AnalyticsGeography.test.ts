import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalyticsController } from './AnalyticsController';

test('geography accepts headers only from a configured socket and rejects unknown countries', async () => {
  const previous = process.env.ANALYTICS_GEO_TRUSTED_PROXIES;
  const previousDetail = process.env.ANALYTICS_GEO_DETAIL_TRUSTED_PROXIES;
  const sessions: any[] = [];
  const controller = new AnalyticsController({
    startSession: async (session: unknown) => { sessions.push(session); },
    trackEvent: async () => {},
  } as never);
  const response = { status() { return this; }, json() { return this; } };
  const request = (remote: string, country: string, latitude = '40.4168', longitude = '-3.7038') => ({
    body: { sessionId: 's', anonId: 'a' }, socket: { remoteAddress: remote }, headers: {},
    get: (header: string) => ({ 'CF-IPCountry': country, 'CF-Region-Code': 'MD', 'CF-IPCity': 'Madrid', 'CF-IPLatitude': latitude, 'CF-IPLongitude': longitude } as Record<string, string>)[header],
  });
  try {
    process.env.ANALYTICS_GEO_TRUSTED_PROXIES = '10.0.0.1';
    process.env.ANALYTICS_GEO_DETAIL_TRUSTED_PROXIES = '10.0.0.1';
    await controller.startSession(request('203.0.113.1', 'ES') as never, response as never);
    await controller.startSession(request('::ffff:10.0.0.1', 'ES') as never, response as never);
    await controller.startSession(request('10.0.0.1', 'XX') as never, response as never);
    await controller.startSession(request('10.0.0.1', 'ES', '91', '-3.7') as never, response as never);
    process.env.ANALYTICS_GEO_DETAIL_TRUSTED_PROXIES = '';
    await controller.startSession(request('10.0.0.1', 'ES') as never, response as never);
    assert.equal(sessions[0].country, undefined);
    assert.equal(sessions[0].region, undefined);
    assert.equal(sessions[0].latitude, undefined);
    assert.equal(sessions[1].country, 'ES');
    assert.equal(sessions[1].region, 'MD');
    assert.equal(sessions[1].city, 'Madrid');
    assert.equal(sessions[1].latitude, 40.4);
    assert.equal(sessions[1].longitude, -3.7);
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
