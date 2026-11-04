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

test('M13-B4a: a stall reports the GC inside its interval (clipped), major collections and the longest pause', () => {
  let t = 0;
  const diag = new EventLoopDiagnostics({ now: () => t, wallClock: () => 1_700_000_000_000, intervalMs: 100, stallThresholdMs: 250, windowMs: 1e9 });
  t = 100; diag.tick();
  diag.ingestGc({ startTime: 50, duration: 40, kind: 1 });       // before the interval: ignored
  diag.ingestGc({ startTime: 80, duration: 60, kind: 1 });       // straddles its start (100): 40 ms inside
  diag.ingestGc({ startTime: 300, duration: 120, kind: 4 });     // major, fully inside
  diag.ingestGc({ startTime: 900, duration: 300, kind: 1 });     // straddles its end (1 000): 100 ms inside
  t = 1_000; diag.tick();
  const event = (diag.snapshot() as any).stalls.recent[0];
  assert.equal(event.durationMs, 800);
  assert.deepEqual(event.gc, { count: 3, overlapMs: 260, maxPauseMs: 300, major: 1 });
  assert.equal(typeof event.heapUsedMb, 'number');
  // The window totals keep counting every collection, inside or not.
  diag.rotateWindow();
  assert.equal((diag.snapshot() as any).windows[0].gc.count, 4);
});

test('M13-B4a: stalls without GC report zeros, and the GC ring is bounded', () => {
  let t = 0;
  const diag = new EventLoopDiagnostics({ now: () => t, wallClock: () => 1_700_000_000_000, intervalMs: 100, stallThresholdMs: 250, windowMs: 1e9 });
  for (let i = 0; i < 1_000; i += 1) diag.ingestGc({ startTime: i - 5_000, duration: 0.5, kind: 1 }); // all before the interval
  assert.ok((diag as any).recentGc.length <= 256);
  t = 100; diag.tick();
  t = 2_000; diag.tick();
  assert.deepEqual((diag.snapshot() as any).stalls.recent[0].gc, { count: 0, overlapMs: 0, maxPauseMs: 0, major: 0 });
});

test('M13-B4a: with real timers, an allocation-heavy stall is reported with real garbage collections', async () => {
  const diag = new EventLoopDiagnostics({ intervalMs: 20, stallThresholdMs: 100, windowMs: 60_000, maxLogsPerMinute: 1 });
  diag.start();
  try {
    await sleep(60);
    const keep: unknown[] = [];
    const end = performance.now() + 500;
    while (performance.now() < end) { keep.push({ a: new Array(64).fill(keep.length), b: String(keep.length) }); if (keep.length > 200_000) keep.length = 0; }
    await sleep(300); // Node delivers GC entries after the late timer: the event is completed when they arrive
    const worst = (diag.snapshot() as any).stalls.worst;
    assert.ok(worst && worst.durationMs >= 300, JSON.stringify(worst));
    assert.ok(worst.gc.count >= 1 && worst.gc.overlapMs > 0, `GC during the stall: ${JSON.stringify(worst.gc)}`);
    assert.ok(worst.gc.overlapMs <= worst.durationMs + 50);
  } finally {
    diag.stop();
  }
});

test('M13-B4a: a collection delivered AFTER the stall was recorded is added to that event (Node delivers GC entries late)', () => {
  let t = 0;
  const diag = new EventLoopDiagnostics({ now: () => t, wallClock: () => 1_700_000_000_000, intervalMs: 100, stallThresholdMs: 250, windowMs: 1e9, maxStalls: 2 });
  t = 100; diag.tick();
  t = 1_000; diag.tick();
  const snap = () => (diag.snapshot() as any).stalls;
  assert.deepEqual(snap().recent[0].gc, { count: 0, overlapMs: 0, maxPauseMs: 0, major: 0 });
  diag.ingestGc({ startTime: 200, duration: 150, kind: 4 });   // arrives late, inside the interval
  diag.ingestGc({ startTime: 5_000, duration: 50, kind: 1 });  // later than the stall: not attributed
  assert.deepEqual(snap().recent[0].gc, { count: 1, overlapMs: 150, maxPauseMs: 150, major: 1 });
  assert.equal(snap().worst.gc.count, 1, 'the worst stall is updated too');
  // The worst stall survives eviction from the bounded list and still receives late collections.
  t = 1_400; diag.tick(); t = 1_800; diag.tick(); t = 2_200; diag.tick(); // three smaller stalls evict the first from the list of 2
  diag.ingestGc({ startTime: 300, duration: 20, kind: 1 });
  assert.equal(snap().worst.gc.count, 2);
});
