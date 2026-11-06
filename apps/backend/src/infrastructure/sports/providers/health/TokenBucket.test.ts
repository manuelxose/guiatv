import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket } from './TokenBucket';

test('rolling-window quota allows up to the limit then denies with retryAfterMs', () => {
  let t = 1_000_000;
  const bucket = new TokenBucket(() => t);
  bucket.configure('openligadb', { limit: 2, windowSeconds: 60 });

  assert.equal(bucket.take('openligadb').allowed, true);
  assert.equal(bucket.take('openligadb').allowed, true);
  const denied = bucket.take('openligadb');
  assert.equal(denied.allowed, false);
  assert.ok((denied.retryAfterMs ?? 0) > 0);
  assert.equal(denied.remaining, 0);
});

test('bucket survives a quota reset once the window rolls over', () => {
  let t = 0;
  const bucket = new TokenBucket(() => t);
  bucket.configure('openligadb', { limit: 1, windowSeconds: 60 });

  assert.equal(bucket.take('openligadb').allowed, true);
  assert.equal(bucket.take('openligadb').allowed, false);

  t += 61_000; // one second past the window
  const after = bucket.take('openligadb');
  assert.equal(after.allowed, true);
});

test('unconfigured providers are unlimited', () => {
  const bucket = new TokenBucket(() => 0);
  assert.equal(bucket.take('unknown').allowed, true);
  assert.equal(bucket.take('unknown').remaining, Number.POSITIVE_INFINITY);
});

test('resetAt reports when the window fully resets', () => {
  let t = 10_000;
  const bucket = new TokenBucket(() => t);
  bucket.configure('openligadb', { limit: 5, windowSeconds: 30 });
  bucket.take('openligadb', 1);
  assert.equal(bucket.resetAt('openligadb'), 10_000 + 30_000);
});
