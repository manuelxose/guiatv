import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { excludedAnalyticsIps } from './analyticsExclusions';

test('includes loopback and configured IPv4 and IPv6 addresses', () => {
  const previous = process.env.ANALYTICS_EXCLUDED_IPS;
  try {
    process.env.ANALYTICS_EXCLUDED_IPS = ' 203.0.113.8,2001:db8::1,,203.0.113.8 ';
    const ips = excludedAnalyticsIps();
    assert.ok(ips.includes('127.0.0.1'));
    assert.ok(ips.includes('::ffff:127.0.0.1'));
    assert.ok(ips.includes('203.0.113.8'));
    assert.ok(ips.includes('::ffff:203.0.113.8'));
    assert.ok(ips.includes('2001:db8::1'));
    assert.equal(ips.filter((ip) => ip === '203.0.113.8').length, 1);
  } finally {
    if (previous === undefined) delete process.env.ANALYTICS_EXCLUDED_IPS;
    else process.env.ANALYTICS_EXCLUDED_IPS = previous;
  }
});
