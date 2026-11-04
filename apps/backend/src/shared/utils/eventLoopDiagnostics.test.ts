import assert from 'node:assert/strict';
import test from 'node:test';
import { EventLoopDiagnostics, eventLoopDiagnosticsSnapshot } from './eventLoopDiagnostics';
import { resetStepTimeline, timeStepSync } from './stepTimeline';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function busy(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) { /* hold the event loop */ }
}

test('stall detection with an injected clock: on-time ticks are ignored, a late one becomes an event', () => {
  let t = 0;
  const diag = new EventLoopDiagnostics({ now: () => t, wallClock: () => Date.UTC(2026, 10, 4, 12, 0, 0), intervalMs: 100, stallThresholdMs: 250, windowMs: 10_000 });
  t = 100; diag.tick();
  t = 205; diag.tick(); // 5 ms of timer jitter: not a stall
  t = 1_005; diag.tick(); // due at 305: 700 ms late
  const snap = diag.snapshot() as any;
  assert.equal(snap.stalls.count, 1);
  const event = snap.stalls.recent[0];
  assert.equal(event.durationMs, 700);
  assert.equal(event.uptimeMs, 1_005);
  assert.equal(event.at, '2026-11-04T12:00:00.000Z');
});

test('stall events and log lines are bounded; the worst stall survives eviction', () => {
  let t = 0;
  const diag = new EventLoopDiagnostics({ now: () => t, wallClock: () => 1_700_000_000_000, intervalMs: 100, stallThresholdMs: 250, windowMs: 1e9, maxStalls: 3, maxLogsPerMinute: 2 });
  const lateBy = [3_000, 400, 500, 600, 700, 800];
  for (const late of lateBy) { t += 100 + late; diag.tick(); }
  const snap = diag.snapshot() as any;
  assert.equal(snap.stalls.count, 6);
  assert.equal(snap.stalls.recent.length, 3);
  assert.deepEqual(snap.stalls.recent.map((e: any) => e.durationMs), [600, 700, 800]);
  assert.equal(snap.stalls.worst.durationMs, 3_000, 'the 3 s stall was evicted from `recent` but is kept as `worst`');
  assert.equal(snap.stalls.suppressedLogs, 4, 'only 2 log lines per minute are emitted');
});

test('windows rotate on schedule, keep a bounded history and reset the window state', () => {
  let t = 0;
  const diag = new EventLoopDiagnostics({ now: () => t, wallClock: () => 1_700_000_000_000, intervalMs: 100, stallThresholdMs: 250, windowMs: 1_000, maxWindows: 2 });
  for (let i = 0; i < 35; i += 1) { t += 100; diag.tick(); }
  t += 600; diag.tick(); // one stall inside the next window
  const snap = diag.snapshot() as any;
  assert.equal(snap.windows.length, 2, 'history is capped at maxWindows');
  assert.equal(snap.current.stalls, 0, 'the stall was counted in the window it closed');
  assert.equal(snap.windows.at(-1).stalls, 1);
  assert.ok(snap.windows.at(-1).windowMs >= 1_000);
});

test('synthetic stall, real timers: the event carries duration, CPU-bound signature and the overlapping step', async () => {
  resetStepTimeline();
  const diag = new EventLoopDiagnostics({ intervalMs: 20, stallThresholdMs: 100, windowMs: 60_000, maxLogsPerMinute: 1 });
  diag.start();
  try {
    await sleep(80);
    timeStepSync('test.synthetic_stall', () => busy(400));
    await sleep(80);
    const snap = diag.snapshot() as any;
    assert.ok(snap.stalls.count >= 1, 'the stall must be detected');
    const worst = snap.stalls.worst;
    assert.ok(worst.durationMs >= 300 && worst.durationMs < 3_000, `duration ${worst.durationMs}`);
    assert.ok(worst.cpuRatio > 0.3, `a busy loop is CPU-bound, cpuRatio ${worst.cpuRatio}`);
    assert.ok(worst.steps.some((s: any) => s.step === 'test.synthetic_stall' && s.sync), JSON.stringify(worst.steps));
    assert.equal(typeof worst.rssMb, 'number');

    diag.rotateWindow();
    diag.rotateWindow();
    const [first, second] = (diag.snapshot() as any).windows;
    assert.ok(first.delayMs.max >= 250, `the windowed histogram saw the stall: ${first.delayMs.max}`);
    assert.ok(second.delayMs.max < first.delayMs.max, 'the next window starts clean (histogram reset)');
    assert.ok(first.stalls >= 1 && second.stalls === 0);
  } finally {
    diag.stop();
  }
});

test('an idle loop produces no stall and small delays (no false positives)', async () => {
  const diag = new EventLoopDiagnostics({ intervalMs: 20, stallThresholdMs: 600, windowMs: 60_000 });
  diag.start();
  try {
    await sleep(300);
    assert.equal((diag.snapshot() as any).stalls.count, 0);
  } finally {
    diag.stop();
  }
});

test('stop() is safe to call twice and an unstarted monitor reports itself disabled', () => {
  const diag = new EventLoopDiagnostics();
  assert.equal((diag.snapshot() as any).enabled, false);
  diag.start();
  diag.start();
  diag.stop();
  diag.stop();
  assert.equal((diag.snapshot() as any).enabled, false);
  assert.equal(typeof (eventLoopDiagnosticsSnapshot() as any).enabled, 'boolean');
});
