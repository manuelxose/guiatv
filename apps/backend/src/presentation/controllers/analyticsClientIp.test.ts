import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { analyticsClientIp } from './analyticsClientIp';

test('only follows forwarded addresses through explicitly trusted proxies', () => {
  assert.equal(analyticsClientIp('203.0.113.9', '127.0.0.1', ''), '203.0.113.9');
  assert.equal(analyticsClientIp('::ffff:10.0.0.2', '198.51.100.1, 10.0.0.1', '10.0.0.1,10.0.0.2'), '198.51.100.1');
  assert.equal(analyticsClientIp('::ffff:a00:2', '198.51.100.1', '10.0.0.2'), '198.51.100.1');
  assert.equal(analyticsClientIp('10.0.0.2', '127.0.0.1, 198.51.100.1', '10.0.0.2'), '198.51.100.1');
  assert.equal(analyticsClientIp('10.0.0.2', 'invalid', '10.0.0.2'), '10.0.0.2');
});
