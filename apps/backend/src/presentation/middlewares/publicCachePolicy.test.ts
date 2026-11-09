import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePolicy } from './publicCachePolicy';

test('uses short shared caching for live football and TV', () => {
  assert.deepEqual(resolvePolicy('/v2/tv/read', { view: 'now' }), {
    browserSeconds: 5, sharedSeconds: 30, staleSeconds: 60,
  });
  assert.deepEqual(resolvePolicy('/v2/sports/football/matches/live', {}), {
    browserSeconds: 3, sharedSeconds: 8, staleSeconds: 30,
  });
});

test('uses long metadata caching and does not cache unknown routes', () => {
  assert.equal(resolvePolicy('/v2/sports/football/competitions', {})?.sharedSeconds, 900);
  assert.equal(resolvePolicy('/v2/user/profile', {}), null);
});

test('distinguishes editorial list and detail freshness', () => {
  assert.equal(resolvePolicy('/v2/blog', {})?.sharedSeconds, 300);
  assert.equal(resolvePolicy('/v2/blog', { slug: 'article' })?.sharedSeconds, 900);
});
