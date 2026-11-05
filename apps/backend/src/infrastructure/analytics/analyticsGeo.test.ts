import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GeoIpService, geoipEnabledFromEnv } from './GeoIpService';
import { anonymizeIp, canonicalIp, isPrivateOrLocalIp, excludedIpSet } from './ipPrivacy';
import { analyticsClientIp, resolveAnalyticsClient } from '../../presentation/controllers/analyticsClientIp';
import { cloudflareRanges, isCloudflareIp } from './cloudflareIps';
import { Ga4ReportingService, parseBreakdown } from './Ga4ReportingService';

// MaxMind's official test databases (MaxMind-DB repository, test-data/, MIT licence; see test-fixtures/geoip).
const FIXTURES = resolve(__dirname, '../../../test-fixtures/geoip');
const CITY = join(FIXTURES, 'GeoIP2-City-Test.mmdb');
const ASN = join(FIXTURES, 'GeoLite2-ASN-Test.mmdb');

test('ip privacy: canonical forms, IPv4-mapped IPv6, truncation for IPv4 and IPv6', () => {
  assert.equal(canonicalIp('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(canonicalIp('::ffff:cb00:7107'), '203.0.113.7');
  assert.equal(canonicalIp('[2001:DB8::1]'), '2001:db8::1');
  assert.equal(canonicalIp('fe80::1%eth0'), 'fe80::1');
  assert.equal(canonicalIp('not-an-ip'), '');
  assert.equal(anonymizeIp('203.0.113.77'), '203.0.113.0');
  assert.equal(anonymizeIp('::ffff:203.0.113.77'), '203.0.113.0');
  assert.equal(anonymizeIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334'), '2001:db8:85a3::');
  assert.equal(anonymizeIp('2001:db8::1'), '2001:db8:0::');
  assert.equal(anonymizeIp('garbage'), undefined);
  assert.equal(isPrivateOrLocalIp('10.1.2.3'), true);
  assert.equal(isPrivateOrLocalIp('100.64.0.1'), true);
  assert.equal(isPrivateOrLocalIp('fd00::1'), true);
  assert.equal(isPrivateOrLocalIp('81.2.69.142'), false);
  assert.ok(excludedIpSet({ ANALYTICS_EXCLUDED_IPS: '::ffff:198.51.100.9, 2001:DB8::5' }).has('198.51.100.9'));
  assert.ok(excludedIpSet({ ANALYTICS_EXCLUDED_IPS: '2001:DB8::5' }).has('2001:db8::5'));
});

test('client IP: forwarded chain is trusted only from configured proxies (nginx appends $remote_addr)', () => {
  // A client forging X-Forwarded-For through nginx: nginx appends the real peer; the forged left part is ignored.
  assert.equal(analyticsClientIp('127.0.0.1', '6.6.6.6, 81.2.69.142', '127.0.0.1'), '81.2.69.142');
  // Direct connection (no trusted proxy configured): the header is ignored entirely.
  assert.equal(analyticsClientIp('81.2.69.142', '6.6.6.6', ''), '81.2.69.142');
  // Not from the proxy: header ignored.
  assert.equal(analyticsClientIp('198.51.100.2', '6.6.6.6', '127.0.0.1'), '198.51.100.2');
  // Malformed chain: falls back to the socket address.
  assert.equal(analyticsClientIp('127.0.0.1', 'evil, <script>', '127.0.0.1'), '127.0.0.1');
  // IPv6 client through the proxy.
  assert.equal(analyticsClientIp('::ffff:127.0.0.1', '2001:218::1', '127.0.0.1'), '2001:218::1');
});

test('client IP behind Cloudflare: the edge hop is skipped only behind nginx, never trusted as the socket peer', () => {
  const cf = cloudflareRanges({});
  assert.ok(isCloudflareIp('172.68.10.20', cf));
  assert.ok(isCloudflareIp('2606:4700:10::ac43:1', cf));
  assert.ok(!isCloudflareIp('83.40.1.1', cf));
  // visitor, Cloudflare edge (appended by nginx) -> visitor
  assert.deepEqual(resolveAnalyticsClient('127.0.0.1', '83.40.1.1, 172.68.10.20', '127.0.0.1', cf), { ip: '83.40.1.1', viaRange: true });
  // forged left part is still never reached past the visitor Cloudflare wrote
  assert.equal(analyticsClientIp('127.0.0.1', '6.6.6.6, 83.40.1.1, 172.68.10.20', '127.0.0.1', cf), '83.40.1.1');
  // straight to the origin with a forged header: nginx appends the real peer, which is not Cloudflare
  assert.deepEqual(resolveAnalyticsClient('127.0.0.1', '172.68.10.20, 198.51.100.9', '127.0.0.1', cf), { ip: '198.51.100.9', viaRange: false });
  // a Cloudflare address as the socket peer is not trusted (only nginx is)
  assert.equal(analyticsClientIp('172.68.10.20', '83.40.1.1', '127.0.0.1', cf), '172.68.10.20');
  // switch
  assert.deepEqual(cloudflareRanges({ ANALYTICS_TRUST_CLOUDFLARE: 'false' }), []);
  assert.equal(analyticsClientIp('127.0.0.1', '83.40.1.1, 172.68.10.20', '127.0.0.1', cloudflareRanges({ ANALYTICS_TRUST_CLOUDFLARE: 'false' })), '172.68.10.20');
});

test('GeoIP: IPv4/IPv6 city + ASN, explicit uncertainty, private/malformed/unknown addresses', async () => {
  const geo = new GeoIpService({ enabled: true, cityPath: CITY, asnPath: ASN });
  await geo.init();
  geo.stop();
  const london = geo.lookup('81.2.69.142');
  assert.equal(london.geoStatus, 'located');
  assert.equal(london.country, 'GB');
  assert.equal(london.city, 'Londres'); // Spanish name when the database has one
  assert.equal(london.latitude, 51.5);
  assert.equal(london.longitude, -0.1);
  assert.equal(london.accuracyRadiusKm, 10);
  assert.match(london.geoDb || '', /GeoIP2-City \d{4}-\d{2}-\d{2} \+ GeoLite2-ASN/);
  const japan = geo.lookup('2001:218::1');
  assert.equal(japan.geoStatus, 'country_only');
  assert.equal(japan.country, 'JP');
  assert.equal(japan.city, undefined);
  assert.equal(japan.accuracyRadiusKm, 100);
  const mapped = geo.lookup('::ffff:81.2.69.142');
  assert.equal(mapped.country, 'GB');
  const asnOnly = geo.lookup('1.128.0.1');
  assert.equal(asnOnly.geoStatus, 'unknown');
  assert.equal(asnOnly.asn, 1221);
  assert.equal(asnOnly.asOrg, 'Telstra Pty Ltd');
  assert.equal(geo.lookup('2600:6000::1').asn, 237);
  assert.equal(geo.lookup('8.8.8.8').geoStatus, 'unknown');
  assert.equal(geo.lookup('192.168.1.10').geoStatus, 'private');
  assert.equal(geo.lookup('::1').geoStatus, 'private');
  assert.equal(geo.lookup('999.1.1.1').geoStatus, 'invalid');
  assert.equal(geo.lookup(undefined).geoStatus, 'invalid');
  const status = geo.status() as { city: { loaded: boolean }; asn: { loaded: boolean } };
  assert.equal(status.city.loaded, true);
  assert.equal(status.asn.loaded, true);
});

test('GeoIP: disabled, missing database, corrupt refresh keeps the previous reader, changed file is reloaded', async () => {
  assert.equal(new GeoIpService({ enabled: false }).lookup('81.2.69.142').geoStatus, 'disabled');
  const missing = new GeoIpService({ enabled: true, cityPath: '/nonexistent/City.mmdb', asnPath: '/nonexistent/ASN.mmdb' });
  await missing.init();
  missing.stop();
  assert.equal(missing.lookup('81.2.69.142').geoStatus, 'unavailable');
  assert.match(String((missing.status() as { city: { error: string } }).city.error), /ENOENT/);

  const dir = mkdtempSync(join(tmpdir(), 'geoip-'));
  try {
    const city = join(dir, 'City.mmdb');
    copyFileSync(CITY, city);
    const geo = new GeoIpService({ enabled: true, cityPath: city, asnPath: '' });
    await geo.init();
    geo.stop();
    assert.equal(geo.lookup('81.2.69.142').country, 'GB');
    writeFileSync(city, 'not an mmdb');
    utimesSync(city, new Date(), new Date(Date.now() + 5_000));
    await geo.reloadIfChanged();
    assert.equal(geo.lookup('81.2.69.142').country, 'GB'); // previous reader kept
    assert.ok((geo.status() as { city: { error: string | null } }).city.error);
    copyFileSync(CITY, city);
    utimesSync(city, new Date(), new Date(Date.now() + 10_000));
    await geo.reloadIfChanged();
    assert.equal((geo.status() as { city: { error: string | null } }).city.error, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GeoIP: on by default, MaxMind preferred over DB-IP Lite, DB-IP records (no region code, no radius) understood', async () => {
  assert.equal(geoipEnabledFromEnv({}), true);
  assert.equal(geoipEnabledFromEnv({ ANALYTICS_GEOIP_ENABLED: 'false' }), false);
  // First candidate missing: the next one is used, and the source follows the database type.
  const fallback = new GeoIpService({ enabled: true, cityPath: ['/nonexistent/GeoLite2-City.mmdb', CITY], asnPath: [] });
  await fallback.init();
  fallback.stop();
  assert.equal(fallback.available(), true);
  assert.equal(fallback.lookup('81.2.69.142').geoSource, 'maxmind');

  const dir = mkdtempSync(join(tmpdir(), 'geoip-dbip-'));
  try {
    const city = join(dir, 'dbip-city-lite.mmdb');
    writeFileSync(city, 'stub');
    const dbipReader = {
      metadata: { databaseType: 'DBIP-City-Lite', buildEpoch: new Date('2026-11-01T00:00:00Z') },
      get: (ip: string) => (ip === '83.40.1.1' ? { country: { iso_code: 'ES' }, subdivisions: [{ names: { en: 'Galicia' } }], city: { names: { en: 'Vigo' } }, location: { latitude: 42.2406, longitude: -8.7207 } } : null),
    };
    const geo = new GeoIpService({ enabled: true, cityPath: ['/nonexistent/GeoLite2-City.mmdb', city], asnPath: [] }, (() => dbipReader) as never);
    await geo.init();
    geo.stop();
    const vigo = geo.lookup('83.40.1.1');
    assert.equal(vigo.geoStatus, 'located');
    assert.equal(vigo.geoSource, 'dbip');
    assert.equal(vigo.city, 'Vigo');
    assert.equal(vigo.region, undefined);
    assert.equal(vigo.regionName, 'Galicia');
    assert.equal(vigo.accuracyRadiusKm, undefined);
    assert.equal(vigo.latitude, 42.2);
    assert.match(vigo.geoDb || '', /^DBIP-City-Lite 2026-11-01$/);
    assert.equal((geo.status() as { city: { source: string } }).city.source, 'dbip');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const off = new GeoIpService({ enabled: false });
  assert.equal(off.available(), false);
});

test('GeoIP lookups are cheap enough for the ingestion loop (no per-event I/O)', async () => {
  const geo = new GeoIpService({ enabled: true, cityPath: CITY, asnPath: ASN });
  await geo.init();
  geo.stop();
  const ips = ['81.2.69.142', '2001:218::1', '216.160.83.56', '1.128.0.1', '8.8.8.8'];
  const start = process.hrtime.bigint();
  for (let i = 0; i < 50_000; i++) geo.lookup(ips[i % ips.length]);
  const perLookupUs = Number(process.hrtime.bigint() - start) / 1e3 / 50_000;
  assert.ok(perLookupUs < 100, `${perLookupUs.toFixed(2)} µs per lookup`);
});

test('GA4 reporting: not configured, thresholded data, API error and caching (no fabricated values)', async () => {
  assert.deepEqual((await new Ga4ReportingService(undefined, undefined).demographics()).available, false);
  let calls = 0;
  const fakeFetch = async (_url: string, init: { body: string }) => {
    calls++;
    const dimension = JSON.parse(init.body).dimensions[0].name;
    const rows = dimension === 'userGender'
      ? [{ dimensionValues: [{ value: 'unknown' }], metricValues: [{ value: '40' }] }]
      : [{ dimensionValues: [{ value: '25-34' }], metricValues: [{ value: '12' }] }];
    return { ok: true, status: 200, json: async () => ({ rows, metadata: { subjectToThresholding: dimension === 'brandingInterest' } }) };
  };
  const service = new Ga4ReportingService('123456789', undefined, async () => 'token', fakeFetch as never);
  const first = await service.demographics(28);
  assert.equal(first.available, true);
  if (!first.available) return;
  const byDim = Object.fromEntries(first.breakdowns.map((b) => [b.dimension, b]));
  assert.deepEqual(byDim.userAgeBracket.rows, [{ value: '25-34', activeUsers: 12 }]);
  assert.equal(byDim.userAgeBracket.thresholded, false);
  assert.equal(byDim.userGender.thresholded, true); // only "unknown"
  assert.equal(byDim.brandingInterest.thresholded, true);
  const second = await service.demographics(28);
  assert.equal(calls, 3);
  assert.equal(second.available && second.cached, true);

  const failing = new Ga4ReportingService('123456789', undefined, async () => 'token', (async () => ({ ok: false, status: 403, json: async () => ({}) })) as never);
  const failed = await failing.demographics();
  assert.equal(failed.available, false);
  assert.equal(!failed.available && failed.reason, 'api_error');
  const noCreds = new Ga4ReportingService('123456789', undefined, async () => { throw new Error('no key'); });
  const credsResult = await noCreds.demographics();
  assert.equal(!credsResult.available && credsResult.reason, 'credentials_error');
  assert.deepEqual(parseBreakdown('country', {}), { dimension: 'country', rows: [], totalUsers: 0, thresholded: false });
});
