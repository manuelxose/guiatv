import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestBudget } from './RequestBudget';

const config = { dailyBudget: 10, liveReserve: 3, perRunCap: 100, throttleBackoffMs: 60_000 };
const T0 = Date.parse('2026-11-06T10:00:00Z');

test('normal requests cannot consume the reserve; live/approaching can', () => {
  const budget = new RequestBudget(config, { clock: () => T0, resetAt: T0 + 24 * 60 * 60 * 1000 });
  budget.beginRun(T0);
  for (let i = 0; i < 7; i += 1) assert.equal(budget.tryAcquire('normal', T0), true);
  // 7 normal consumed; only the 3-reserve remains.
  assert.equal(budget.tryAcquire('normal', T0), false);
  // A denied normal request starts a throttle backoff (correct), so advance the clock
  // past it: the live reserve, not the throttle, is what the last assertion verifies.
  const afterThrottle = T0 + config.throttleBackoffMs + 1;
  // The reserve stays available for important matches.
  for (let i = 0; i < 3; i += 1) assert.equal(budget.tryAcquire('live', afterThrottle), true);
  assert.equal(budget.tryAcquire('live', afterThrottle), false);
  // After the failed live attempt the budget is exhausted and throttles again.
  assert.equal(budget.tryAcquire('live', afterThrottle + config.throttleBackoffMs + 1), false);
});

test('denies requests beyond the daily budget and throttles', () => {
  const budget = new RequestBudget({ dailyBudget: 2, liveReserve: 0, perRunCap: 100, throttleBackoffMs: 1000 }, { clock: () => T0, resetAt: T0 + 24 * 60 * 60 * 1000 });
  budget.beginRun(T0);
  assert.equal(budget.tryAcquire('normal', T0), true);
  assert.equal(budget.tryAcquire('normal', T0), true);
  assert.equal(budget.tryAcquire('normal', T0), false);
  assert.equal(budget.snapshot(T0).throttleUntil, T0 + 1000);
  // Still throttled shortly after.
  assert.equal(budget.tryAcquire('normal', T0 + 500), false);
  // Throttle expires.
  assert.equal(budget.tryAcquire('normal', T0 + 1001), false); // daily budget still exhausted
});

test('emergency disable switch denies every request', () => {
  const budget = new RequestBudget(config, { clock: () => T0, resetAt: T0 + 24 * 60 * 60 * 1000 });
  budget.beginRun(T0);
  assert.equal(budget.tryAcquire('live', T0), true);
  budget.disable();
  assert.equal(budget.isDisabled(), true);
  assert.equal(budget.tryAcquire('live', T0), false);
  assert.equal(budget.tryAcquire('normal', T0), false);
  budget.enable();
  assert.equal(budget.tryAcquire('live', T0), true);
});

test('per-run cap bounds a single tick', () => {
  const budget = new RequestBudget({ dailyBudget: 10, liveReserve: 0, perRunCap: 2, throttleBackoffMs: 0 }, { clock: () => T0, resetAt: T0 + 24 * 60 * 60 * 1000 });
  budget.beginRun(T0);
  assert.equal(budget.tryAcquire('normal', T0), true);
  assert.equal(budget.tryAcquire('normal', T0), true);
  assert.equal(budget.tryAcquire('normal', T0), false);
  budget.beginRun(T0); // next run resets the per-run counter
  assert.equal(budget.tryAcquire('normal', T0), true);
});

test('rolls the budget over at the reset time', () => {
  const resetAt = T0 + 24 * 60 * 60 * 1000;
  const budget = new RequestBudget({ dailyBudget: 3, liveReserve: 0, perRunCap: 100, throttleBackoffMs: 0 }, { clock: () => T0, resetAt });
  budget.beginRun(T0);
  budget.tryAcquire('normal', T0);
  budget.tryAcquire('normal', T0);
  assert.equal(budget.snapshot(T0).remaining, 1);
  assert.equal(budget.snapshot(resetAt).remaining, 3);
});
