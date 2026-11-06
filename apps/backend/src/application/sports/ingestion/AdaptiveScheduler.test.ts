import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AdaptiveScheduler,
  classifyBucket,
  DEFAULT_SCHEDULER_CONFIG,
  minimumIntervalMs,
  nextIntervalMs,
} from './AdaptiveScheduler';
import { IngestionBucket } from './types';

const ALL_BUCKETS: IngestionBucket[] = [
  'historical',
  'future',
  'today',
  'approaching_kickoff',
  'live',
  'halftime',
  'completed',
  'standings',
  'team_metadata',
  'lineup_event_enrichment',
];

const NOW = Date.parse('2026-11-06T12:00:00Z');

test('every bucket has a distinct documented interval', () => {
  const intervals = ALL_BUCKETS.map((bucket) => nextIntervalMs(bucket, DEFAULT_SCHEDULER_CONFIG));
  const distinct = new Set(intervals);
  assert.equal(distinct.size, ALL_BUCKETS.length);
});

test('live is fastest, future/historical are long, and there is never a fixed 10s loop', () => {
  const live = nextIntervalMs('live');
  const future = nextIntervalMs('future');
  const historical = nextIntervalMs('historical');
  assert.equal(live, 30_000);
  assert.equal(future, 6 * 60 * 60 * 1000);
  assert.equal(historical, 12 * 60 * 60 * 1000);
  for (const bucket of ALL_BUCKETS) {
    assert.notEqual(nextIntervalMs(bucket), 10_000);
  }
});

test('completed stops polling (interval 0) after full-time confirmation', () => {
  assert.equal(nextIntervalMs('completed'), 0);
  assert.equal(classifyBucket({ kickoffAt: '2026-11-06T10:00:00Z', status: 'finished' }, NOW), 'completed');
  assert.equal(classifyBucket({ kickoffAt: '2026-11-06T10:00:00Z', status: 'cancelled' }, NOW), 'completed');
});

test('classifies approaching kickoff within the 2h threshold', () => {
  const oneHourAhead = new Date(NOW + 60 * 60 * 1000).toISOString();
  assert.equal(classifyBucket({ kickoffAt: oneHourAhead, status: 'scheduled' }, NOW), 'approaching_kickoff');
});

test('classifies future (more than 2h ahead on another day) and today (same day)', () => {
  const tomorrow = new Date(NOW + 24 * 60 * 60 * 1000).toISOString();
  assert.equal(classifyBucket({ kickoffAt: tomorrow, status: 'scheduled' }, NOW), 'future');
  // Same UTC day, more than 2h ahead: today.
  const laterToday = new Date(Date.parse('2026-11-06T20:00:00Z')).toISOString();
  assert.equal(classifyBucket({ kickoffAt: laterToday, status: 'scheduled' }, NOW), 'today');
});

test('classifies historical when kickoff is far in the past without a finished status', () => {
  const old = new Date(NOW - 8 * 60 * 60 * 1000).toISOString();
  assert.equal(classifyBucket({ kickoffAt: old, status: 'scheduled' }, NOW), 'historical');
});

test('minimumIntervalMs picks the most urgent (live) cadence and falls back long when empty', () => {
  const live = new Date(NOW - 10 * 60 * 1000).toISOString();
  const future = new Date(NOW + 24 * 60 * 60 * 1000).toISOString();
  assert.equal(
    minimumIntervalMs(
      [
        { kickoffAt: future, status: 'scheduled' },
        { kickoffAt: live, status: 'live' },
      ],
      NOW
    ),
    30_000
  );
  assert.equal(minimumIntervalMs([{ kickoffAt: future, status: 'scheduled' }], NOW), 6 * 60 * 60 * 1000);
  assert.equal(minimumIntervalMs([], NOW), 6 * 60 * 60 * 1000);
});

test('AdaptiveScheduler.isDue compares against the bucket interval', () => {
  const scheduler = new AdaptiveScheduler();
  const now = Date.parse('2026-11-06T12:00:00Z');
  assert.equal(scheduler.isDue(undefined, 'live', now), true);
  assert.equal(scheduler.isDue(now - 30_000, 'live', now), true);
  assert.equal(scheduler.isDue(now - 29_000, 'live', now), false);
  assert.equal(scheduler.isDue(now - 60_000, 'completed', now), false); // completed never due
});
