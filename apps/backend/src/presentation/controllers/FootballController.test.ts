import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDateRange } from './FootballController';

test('parseDateRange: no range requested returns nothing', () => {
  assert.deepEqual(parseDateRange(undefined, undefined), {});
});

test('parseDateRange: accepts an ordered range of at most 10 days', () => {
  assert.deepEqual(parseDateRange('2026-11-01', '2026-11-10'), { dateFrom: '2026-11-01', dateTo: '2026-11-10' });
});

test('parseDateRange: rejects half ranges, reversed, too wide, impossible and malformed dates', () => {
  const bad: Array<[unknown, unknown]> = [
    ['2026-11-01', undefined],
    ['2026-11-10', '2026-11-01'],
    ['2026-11-01', '2026-11-12'],
    ['2026-02-31', '2026-03-02'],
    ['x', 'y'],
  ];
  for (const [a, b] of bad) assert.throws(() => parseDateRange(a, b), Error);
});
