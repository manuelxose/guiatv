import test from 'node:test';
import assert from 'node:assert/strict';
import { closedDays } from './archiveBroadcastHistory.cli';

test('closedDays steps Madrid calendar days', () => {
  assert.deepEqual(closedDays(new Date('2026-11-04T02:30:00Z'), 3), ['20261101', '20261102', '20261103']);
});

test('closedDays does not skip a day shortly after midnight on a 23h DST day (2026-03-29)', () => {
  assert.deepEqual(closedDays(new Date('2026-03-29T22:30:00Z'), 3), ['20260327', '20260328', '20260329']);
});

test('closedDays does not repeat a day on the 25h day (2026-10-25)', () => {
  assert.deepEqual(closedDays(new Date('2026-10-25T23:30:00Z'), 3), ['20261023', '20261024', '20261025']);
});
