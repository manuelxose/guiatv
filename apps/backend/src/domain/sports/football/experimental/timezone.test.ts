import test from 'node:test';
import assert from 'node:assert/strict';
import { kickoffFromMatchDateTimeUtc, zonedTimeToUtc } from './timezone';

test('naive German local time converts to UTC via Europe/Berlin (CEST +2)', () => {
  assert.equal(zonedTimeToUtc('2026-08-14T18:30:00'), '2026-08-14T16:30:00.000Z');
});

test('naive German local time converts to UTC via Europe/Berlin (CET +1)', () => {
  assert.equal(zonedTimeToUtc('2026-12-01T15:30:00'), '2026-12-01T14:30:00.000Z');
});

test('accepts a space separator and a minutes-only time', () => {
  assert.equal(zonedTimeToUtc('2026-08-14 18:30'), '2026-08-14T16:30:00.000Z');
});

test('kickoff is taken from the provider UTC field as-is', () => {
  assert.equal(kickoffFromMatchDateTimeUtc('2026-08-14T16:30:00Z'), '2026-08-14T16:30:00.000Z');
});

test('invalid inputs throw rather than fabricate a time', () => {
  assert.throws(() => zonedTimeToUtc('not-a-time'));
  assert.throws(() => kickoffFromMatchDateTimeUtc('garbage'));
});
