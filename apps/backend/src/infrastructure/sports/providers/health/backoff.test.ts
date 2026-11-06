import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyProviderError,
  computeBackoff,
  parseRetryAfter,
} from './backoff';

test('full jitter stays within [0, capped] bounds', () => {
  const zero = computeBackoff({ attempt: 0, baseDelayMs: 500, maxDelayMs: 30_000, random: () => 0 });
  assert.equal(zero.delayMs, 0);
  const one = computeBackoff({ attempt: 0, baseDelayMs: 500, maxDelayMs: 30_000, random: () => 1 });
  assert.equal(one.delayMs, one.cappedExponentialMs);
  assert.equal(one.cappedExponentialMs, 500);
});

test('backoff is capped at maxDelayMs', () => {
  const result = computeBackoff({ attempt: 10, baseDelayMs: 1000, maxDelayMs: 30_000, random: () => 1 });
  assert.equal(result.cappedExponentialMs, 30_000);
  assert.equal(result.delayMs, 30_000);
});

test('Retry-After seconds wins over computed backoff', () => {
  const result = computeBackoff({ attempt: 10, baseDelayMs: 1000, maxDelayMs: 30_000, retryAfter: '5' });
  assert.equal(result.delayMs, 5000);
  assert.equal(result.usedRetryAfter, true);
});

test('Retry-After HTTP-date wins over computed backoff', () => {
  const now = Date.parse('2026-11-06T00:00:00Z');
  const result = computeBackoff({
    attempt: 0,
    retryAfter: 'Fri, 06 Nov 2026 00:00:30 GMT',
    now: () => now,
  });
  assert.equal(result.delayMs, 30_000);
  assert.equal(result.usedRetryAfter, true);
});

test('parseRetryAfter handles seconds and HTTP-dates', () => {
  assert.equal(parseRetryAfter('120'), 120_000);
  assert.equal(parseRetryAfter(''), null);
  assert.equal(parseRetryAfter(undefined), null);
});

test('429/401/403 are classified correctly', () => {
  assert.deepEqual(classifyProviderError({ status: 429 }), { kind: 'rate_limit', status: 429, retryable: true });
  assert.deepEqual(classifyProviderError({ status: 401 }), { kind: 'auth', status: 401, retryable: false });
  assert.deepEqual(classifyProviderError({ status: 403 }), { kind: 'forbidden', status: 403, retryable: false });
  assert.equal(classifyProviderError({ status: 500 }).retryable, true);
  assert.equal(classifyProviderError({ status: 404 }).retryable, false);
  assert.equal(classifyProviderError(new Error('network down')).retryable, true);
});
