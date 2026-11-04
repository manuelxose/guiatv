import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import {
  resetStepTimeline,
  setBootWindowMsForTests,
  stepTimelineSnapshot,
  stepsOverlapping,
  timeStep,
  timeStepSync,
} from './stepTimeline';

beforeEach(() => {
  resetStepTimeline();
  setBootWindowMsForTests(10 * 60_000);
});

test('records a synchronous step with duration, cpu and the sync flag', () => {
  timeStepSync('t.sync', () => { const end = Date.now() + 120; while (Date.now() < end) { /* burn */ } });
  const [step] = stepTimelineSnapshot().startup;
  assert.equal(step.step, 't.sync');
  assert.equal(step.sync, true);
  assert.equal(step.ok, true);
  assert.ok(step.durationMs >= 100, `duration ${step.durationMs}`);
  assert.ok(step.cpuMs >= 20, `a busy loop must show CPU time, got ${step.cpuMs}`);
});

test('an async step that only waits shows wall time far above its cpu time', async () => {
  await timeStep('t.wait', () => new Promise<void>((resolve) => setTimeout(resolve, 60)));
  const [step] = stepTimelineSnapshot().startup;
  assert.ok(step.durationMs >= 50);
  assert.ok(step.cpuMs < step.durationMs / 2, `waiting is not CPU: ${step.cpuMs} vs ${step.durationMs}`);
  assert.equal(step.sync, false);
});

test('a failing step is recorded as failed, rethrown, and keeps only the error class (no message)', async () => {
  const error = new TypeError('mongodb://user:hunter2@db.internal/x');
  await assert.rejects(timeStep('t.fail', async () => { throw error; }), error);
  const [step] = stepTimelineSnapshot().startup;
  assert.equal(step.ok, false);
  assert.equal(step.error, 'TypeError');
  assert.ok(!JSON.stringify(stepTimelineSnapshot()).includes('hunter2'));
});

test('stepsOverlapping lists finished and still-running steps that intersect the interval', async () => {
  timeStepSync('t.done', () => undefined);
  let release!: () => void;
  const pending = timeStep('t.pending', () => new Promise<void>((resolve) => { release = resolve; }));
  const now = performance.now();
  const hits = stepsOverlapping(0, now + 1);
  assert.deepEqual(hits.map((h) => [h.step, h.running]).sort(), [['t.done', false], ['t.pending', true]]);
  assert.deepEqual(stepsOverlapping(now + 10_000, now + 20_000).filter((h) => !h.running), []);
  release();
  await pending;
  assert.equal(stepTimelineSnapshot().running.length, 0);
});

test('start-up steps are bounded and the overflow is counted, not stored', () => {
  for (let i = 0; i < 100; i += 1) timeStepSync(`t.step${i % 3}`, () => undefined);
  const snap = stepTimelineSnapshot();
  assert.equal(snap.startup.length, 64);
  assert.equal(snap.droppedStartup, 36);
});

test('outside the boot window, short background steps are skipped and slow or failed ones kept (bounded ring)', async () => {
  setBootWindowMsForTests(0);
  await timeStep('bg.fast', async () => undefined, { minMs: 50 });
  await timeStep('bg.slow', () => new Promise<void>((resolve) => setTimeout(resolve, 70)), { minMs: 50 });
  await assert.rejects(timeStep('bg.failed', async () => { throw new Error('x'); }, { minMs: 50 }));
  const snap = stepTimelineSnapshot();
  assert.equal(snap.startup.length, 0);
  assert.deepEqual(snap.recent.map((s) => s.step), ['bg.slow', 'bg.failed']);
  for (let i = 0; i < 100; i += 1) timeStepSync('bg.many', () => undefined);
  assert.equal(stepTimelineSnapshot().recent.length, 64);
});

test('M13-B3a: a `background` step inside the boot window never fills the start-up list and keeps only slow runs', async () => {
  for (let i = 0; i < 100; i += 1) await timeStep('req.fast', async () => undefined, { background: true, minMs: 50 });
  await timeStep('req.slow', () => new Promise<void>((resolve) => setTimeout(resolve, 70)), { background: true, minMs: 50 });
  const snap = stepTimelineSnapshot();
  assert.equal(snap.startup.length, 0, 'a hot request path must not consume the start-up slots');
  assert.equal(snap.droppedStartup, 0);
  assert.deepEqual(snap.recent.map((s) => s.step), ['req.slow']);
  for (let i = 0; i < 100; i += 1) await assert.rejects(timeStep('req.badinput', async () => { throw new Error('invalid date'); }, { background: true, minMs: 50 }));
  assert.deepEqual(stepTimelineSnapshot().recent.map((s) => s.step), ['req.slow'], 'quick failures of a recurring step do not push out evidence');
});
