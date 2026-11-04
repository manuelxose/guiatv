import assert from 'node:assert/strict';
import test from 'node:test';
import { LogBudget, errorKind, pushBounded } from './diagnosticsCommon';
import { PhaseRecorder } from './phaseTimer';

function clock(): { now: () => number; set: (value: number) => void } {
  let t = 0;
  return { now: () => t, set: (value) => { t = value; } };
}

test('sequential spans of one name add up: wall equals sum', async () => {
  const c = clock();
  const r = new PhaseRecorder(c.now);
  await r.span('db', async () => { c.set(c.now() + 30); });
  c.set(c.now() + 100); // idle gap is not part of any span
  await r.span('db', async () => { c.set(c.now() + 20); });
  assert.deepEqual(r.report().db, { count: 2, wallMs: 50, sumMs: 50, maxMs: 30 });
});

test('parallel spans of one name report the wall-clock union, not the sum', async () => {
  const c = clock();
  const r = new PhaseRecorder(c.now);
  // Three lookups start together and finish at 200, 100 and 150 ms: the phase took 200 ms of wall clock, 450 ms of work.
  const gates = [200, 100, 150].map((end) => ({ end, release: undefined as undefined | (() => void) }));
  const running = gates.map((g) => r.span('providers', () => new Promise<void>((resolve) => { g.release = resolve; })));
  for (const g of [...gates].sort((a, b) => a.end - b.end)) {
    c.set(g.end);
    g.release!();
    await Promise.resolve();
  }
  await Promise.all(running);
  assert.deepEqual(r.report().providers, { count: 3, wallMs: 200, sumMs: 450, maxMs: 200 });
});

test('overlapping spans with a gap count only the covered time', async () => {
  const c = clock();
  const r = new PhaseRecorder(c.now);
  let a!: () => void;
  let b!: () => void;
  const first = r.span('x', () => new Promise<void>((res) => { a = res; })); // 0 -> 40
  c.set(30);
  const second = r.span('x', () => new Promise<void>((res) => { b = res; })); // 30 -> 60
  c.set(40); a(); await first;
  c.set(60); b(); await second;
  assert.equal(r.report().x.wallMs, 60);
  assert.equal(r.report().x.sumMs, 70);
});

test('a span that throws is still recorded and the error propagates untouched', async () => {
  const c = clock();
  const r = new PhaseRecorder(c.now);
  const boom = new Error('boom');
  await assert.rejects(r.span('tmdb', async () => { c.set(12); throw boom; }), boom);
  assert.equal(r.report().tmdb.wallMs, 12);
  assert.throws(() => r.sync('transform', () => { throw boom; }), boom);
  assert.equal(r.report().transform.count, 1);
});

test('a span still running at report time is counted up to now', () => {
  const c = clock();
  const r = new PhaseRecorder(c.now);
  void r.span('slow', () => new Promise<void>(() => undefined));
  c.set(75);
  assert.equal(r.report().slow.wallMs, 75);
});

test('different phase names are independent and may nest: their walls are not additive', async () => {
  const c = clock();
  const r = new PhaseRecorder(c.now);
  await r.span('parallel', async () => {
    await r.span('a', async () => { c.set(c.now() + 40); });
  });
  assert.equal(r.report().parallel.wallMs, 40);
  assert.equal(r.report().a.wallMs, 40);
});

test('LogBudget caps lines per minute, counts the suppressed ones and refills next minute', () => {
  let now = 0;
  const budget = new LogBudget(2, () => now);
  assert.deepEqual([budget.take(), budget.take(), budget.take(), budget.take()], [true, true, false, false]);
  assert.equal(budget.suppressed, 2);
  now = 61_000;
  assert.equal(budget.take(), true);
});

test('pushBounded drops the oldest entry and reports it', () => {
  const buffer = [1, 2, 3];
  assert.equal(pushBounded(buffer, 4, 3), true);
  assert.deepEqual(buffer, [2, 3, 4]);
  assert.equal(pushBounded(buffer, 5, 4), false);
});

test('errorKind keeps the class name and never the message (driver errors can embed connection strings)', () => {
  const leak = new Error('connect failed mongodb://user:s3cret@db.internal:27017');
  assert.equal(errorKind(leak), 'Error');
  assert.ok(!errorKind(leak).includes('s3cret'));
  assert.equal(errorKind('plain string'), 'string');
});
