import { constants as gcConstants, monitorEventLoopDelay, performance, PerformanceObserver, type IntervalHistogram } from 'node:perf_hooks';
import { envNumber, LogBudget, pushBounded, round1, round2 } from './diagnosticsCommon';
import { logger } from './logger';
import { inflightRequests, type RequestOverlap } from './inflightRequests';
import { stepsOverlapping, type StepOverlap } from './stepTimeline';

/**
 * M13-B1: windowed event-loop delay, stall events and process context, to tell apart the causes of a multi-second stall.
 *
 * The cumulative `process.eventLoopLagMs` in `runtimeMetrics` keeps its meaning (a process-lifetime histogram whose `max`
 * can never go down). This adds, without changing it:
 *  - fixed windows (default 60 s, last 15 kept): delay mean/p50/p95/p99/max, CPU utilisation, event-loop utilisation, GC;
 *  - stall events: a 100 ms timer that arrives >= `stallThresholdMs` late records when it happened (wall clock and
 *    process uptime), how long, how much CPU the process burnt in that interval (busy => JS or GC; idle => starved by the
 *    host, swapped out or blocked), involuntary context switches and page faults (host contention), and which named
 *    start-up/background steps overlapped it.
 * Storage and logging are bounded: ring buffers, a per-minute log budget, no request data, no labels from user input.
 */
export interface StallEvent {
  at: string;
  uptimeMs: number;
  durationMs: number;
  /** Process CPU (user+system) consumed during the stall interval, ms. */
  cpuMs: number;
  /** cpuMs / (stall interval): ~1 CPU-bound, << 1 waiting / descheduled. Can exceed 1 with worker threads or GC threads. */
  cpuRatio: number;
  involuntaryCtxSwitches: number;
  voluntaryCtxSwitches: number;
  majorPageFaults: number;
  rssMb: number;
  steps: StepOverlap[];
  heapUsedMb: number;
  /**
   * M13-B4a: garbage collections inside the stall interval: how many, their summed duration clipped to it, the longest
   * pause, and how many were major (mark-compact). overlapMs close to durationMs means the stall was mostly GC; a small
   * value means the time went to JavaScript between collections. Correlation, like the other overlaps.
   */
  gc: { count: number; overlapMs: number; maxPauseMs: number; major: number };
  /** M13-B3a: requests in flight / completed during the stall. Correlation only: an open request is not proven to be the cause. */
  requests: RequestOverlap;
  /**
   * What the overlapping evidence is, never a verdict: 'none' = nothing instrumented overlapped (an explicit
   * "unattributed" stall, not a guessed cause); 'steps', 'requests' or 'steps+requests' = candidates to investigate.
   */
  correlation: 'none' | 'steps' | 'requests' | 'steps+requests';
}

export interface WindowSummary {
  endedAt: string;
  uptimeMs: number;
  windowMs: number;
  samples: number;
  delayMs: { mean: number; p50: number; p95: number; p99: number; max: number };
  cpuRatio: number;
  eventLoopUtilization: number;
  gc: { count: number; totalMs: number; maxMs: number };
  stalls: number;
}

export interface EventLoopDiagnosticsOptions {
  intervalMs?: number;
  stallThresholdMs?: number;
  windowMs?: number;
  maxWindows?: number;
  maxStalls?: number;
  maxLogsPerMinute?: number;
  now?: () => number;
  wallClock?: () => number;
  /** Request overlap provider (defaults to the process-wide registry). */
  requestOverlap?: (fromMs: number, toMs: number) => RequestOverlap;
}

const log = logger.child('EventLoop');
const MAX_RECENT_GC = 256;

export class EventLoopDiagnostics {
  readonly intervalMs: number;
  readonly stallThresholdMs: number;
  readonly windowMs: number;
  private readonly maxWindows: number;
  private readonly maxStalls: number;
  private readonly now: () => number;
  private readonly wallClock: () => number;
  private readonly logBudget: LogBudget;
  private readonly requestOverlap: (fromMs: number, toMs: number) => RequestOverlap;

  private histogram?: IntervalHistogram;
  private timer?: NodeJS.Timeout;
  private gcObserver?: PerformanceObserver;
  private lastTickAt = 0;
  private lastCpu = process.cpuUsage();
  private lastUsage = safeResourceUsage();
  private windowStartedAt = 0;
  private windowCpu = process.cpuUsage();
  private windowElu = performance.eventLoopUtilization();
  private windowGc = { count: 0, totalMs: 0, maxMs: 0 };
  private readonly recentGc: Array<{ startMs: number; endMs: number; major: boolean }> = [];
  private readonly stallIntervals = new WeakMap<StallEvent, { fromMs: number; toMs: number }>();
  private windowStalls = 0;
  private readonly windows: WindowSummary[] = [];
  private readonly stalls: StallEvent[] = [];
  private worst?: StallEvent;
  private stallCount = 0;
  private stallTotalMs = 0;
  private started = false;

  constructor(options: EventLoopDiagnosticsOptions = {}) {
    this.intervalMs = options.intervalMs ?? 100;
    this.stallThresholdMs = options.stallThresholdMs ?? 250;
    this.windowMs = options.windowMs ?? 60_000;
    this.maxWindows = options.maxWindows ?? 15;
    this.maxStalls = options.maxStalls ?? 25;
    this.now = options.now ?? (() => performance.now());
    this.wallClock = options.wallClock ?? (() => Date.now());
    this.requestOverlap = options.requestOverlap ?? ((from, to) => inflightRequests.overlap(from, to));
    this.logBudget = new LogBudget(options.maxLogsPerMinute ?? 6, this.wallClock);
  }

  /** Starts the timer, the window histogram and the GC observer. Idempotent; a facility that is unavailable is skipped. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.lastTickAt = this.windowStartedAt = this.now();
    this.lastCpu = this.windowCpu = process.cpuUsage();
    this.lastUsage = safeResourceUsage();
    this.windowElu = performance.eventLoopUtilization();
    try {
      this.histogram = monitorEventLoopDelay({ resolution: 20 });
      this.histogram.enable();
    } catch (error) {
      log.warn('Windowed event-loop histogram unavailable', { reason: (error as Error).name });
    }
    try {
      this.gcObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) this.ingestGc(entry);
      });
      this.gcObserver.observe({ entryTypes: ['gc'] });
    } catch (error) {
      this.gcObserver = undefined;
      log.warn('GC observer unavailable', { reason: (error as Error).name });
    }
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.histogram?.disable();
    this.gcObserver?.disconnect();
    this.started = false;
  }

  /** One timer arrival. Public so tests can drive it with an injected clock. */
  tick(): void {
    try {
      const now = this.now();
      const expected = this.lastTickAt + this.intervalMs;
      const lateness = now - expected;
      const cpu = process.cpuUsage();
      const usage = safeResourceUsage();
      try {
        if (lateness >= this.stallThresholdMs) this.recordStall(now, lateness, cpu, usage);
      } finally {
        this.lastTickAt = now;
        this.lastCpu = cpu;
        this.lastUsage = usage;
      }
      if (now - this.windowStartedAt >= this.windowMs) this.rotateWindow();
    } catch {
      // A diagnostics failure must never surface in the application.
    }
  }

  /** Closes the current window and starts the next one (histogram reset). Public for tests. */
  rotateWindow(): void {
    const now = this.now();
    const wall = Math.max(now - this.windowStartedAt, 1);
    const cpuDelta = process.cpuUsage(this.windowCpu);
    const elu = performance.eventLoopUtilization(this.windowElu);
    const h = this.histogram;
    const summary: WindowSummary = {
      endedAt: new Date(this.wallClock()).toISOString(),
      uptimeMs: Math.round(now),
      windowMs: Math.round(wall),
      samples: h ? h.count : 0,
      delayMs: h && h.count > 0
        ? { mean: ms(h.mean), p50: ms(h.percentile(50)), p95: ms(h.percentile(95)), p99: ms(h.percentile(99)), max: ms(h.max) }
        : { mean: 0, p50: 0, p95: 0, p99: 0, max: 0 },
      cpuRatio: round2((cpuDelta.user + cpuDelta.system) / 1_000 / wall),
      eventLoopUtilization: round2(elu.utilization),
      gc: { count: this.windowGc.count, totalMs: round1(this.windowGc.totalMs), maxMs: round1(this.windowGc.maxMs) },
      stalls: this.windowStalls,
    };
    pushBounded(this.windows, summary, this.maxWindows);
    h?.reset();
    this.windowStartedAt = now;
    this.windowCpu = process.cpuUsage();
    this.windowElu = performance.eventLoopUtilization();
    this.windowGc = { count: 0, totalMs: 0, maxMs: 0 };
    this.windowStalls = 0;
  }

  snapshot(): Record<string, unknown> {
    const now = this.now();
    const h = this.histogram;
    return {
      enabled: this.started,
      config: { intervalMs: this.intervalMs, stallThresholdMs: this.stallThresholdMs, windowMs: this.windowMs },
      // The window in progress: reading it does not reset anything.
      current: {
        windowedForMs: Math.round(now - this.windowStartedAt),
        samples: h ? h.count : 0,
        delayMs: h && h.count > 0
          ? { mean: ms(h.mean), p95: ms(h.percentile(95)), max: ms(h.max) }
          : { mean: 0, p95: 0, max: 0 },
        stalls: this.windowStalls,
        gc: { count: this.windowGc.count, totalMs: round1(this.windowGc.totalMs), maxMs: round1(this.windowGc.maxMs) },
      },
      windows: this.windows.map((w) => ({ ...w })),
      stalls: {
        count: this.stallCount,
        totalMs: round1(this.stallTotalMs),
        suppressedLogs: this.logBudget.suppressed,
        worst: this.worst ? { ...this.worst } : null,
        recent: this.stalls.map((s) => ({ ...s })),
      },
    };
  }

  /**
   * One garbage collection: counted in the window and kept (bounded) so a stall can say how much of its interval was GC.
   * Public so tests can feed it; the observer calls it.
   */
  ingestGc(entry: { startTime: number; duration: number; detail?: unknown; kind?: number }): void {
    this.windowGc.count += 1;
    this.windowGc.totalMs += entry.duration;
    if (entry.duration > this.windowGc.maxMs) this.windowGc.maxMs = entry.duration;
    const kind = entry.kind ?? (entry.detail as { kind?: number } | undefined)?.kind;
    const g = { startMs: entry.startTime, endMs: entry.startTime + entry.duration, major: kind === gcConstants.NODE_PERFORMANCE_GC_MAJOR };
    pushBounded(this.recentGc, g, MAX_RECENT_GC);
    // Node delivers GC entries AFTER the late timer that records the stall (seen on Linux CI), so a collection that
    // happened inside an already recorded stall is added to that event when it arrives.
    for (const event of this.recordedStalls()) {
      const interval = this.stallIntervals.get(event);
      if (interval) addGc(event.gc, g, interval.fromMs, interval.toMs);
    }
  }

  private recordedStalls(): StallEvent[] {
    return this.worst && !this.stalls.includes(this.worst) ? [...this.stalls, this.worst] : this.stalls;
  }

  /** GC time inside [fromMs, toMs] (entries clipped to it). A stall's GC share is a correlation: GC helper threads also raise cpuRatio. */
  private gcOverlap(fromMs: number, toMs: number): StallEvent['gc'] {
    // The observer delivers asynchronously, after the late timer: flush what the stall itself produced.
    try {
      for (const entry of this.gcObserver?.takeRecords() ?? []) this.ingestGc(entry);
    } catch {
      // Unavailable: the window totals still exist.
    }
    const out = { count: 0, overlapMs: 0, maxPauseMs: 0, major: 0 };
    for (const g of this.recentGc) addGc(out, g, fromMs, toMs);
    return out;
  }

  private safeRequestOverlap(fromMs: number, toMs: number): RequestOverlap {
    try {
      return this.requestOverlap(fromMs, toMs);
    } catch {
      return { activeCount: 0, inFlight: [], completed: [], omitted: 0, byRoute: [] };
    }
  }

  private recordStall(now: number, lateness: number, cpu: NodeJS.CpuUsage, usage: ReturnType<typeof safeResourceUsage>): void {
    const interval = Math.max(now - this.lastTickAt, 1);
    const cpuMs = (cpu.user + cpu.system - this.lastCpu.user - this.lastCpu.system) / 1_000;
    const event: StallEvent = {
      at: new Date(this.wallClock()).toISOString(),
      uptimeMs: Math.round(now),
      durationMs: round1(lateness),
      cpuMs: round1(cpuMs),
      cpuRatio: round2(cpuMs / interval),
      involuntaryCtxSwitches: usage.involuntaryContextSwitches - this.lastUsage.involuntaryContextSwitches,
      voluntaryCtxSwitches: usage.voluntaryContextSwitches - this.lastUsage.voluntaryContextSwitches,
      majorPageFaults: usage.majorPageFault - this.lastUsage.majorPageFault,
      rssMb: Math.round(process.memoryUsage().rss / 1_048_576),
      steps: stepsOverlapping(this.lastTickAt + this.intervalMs, now),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1_048_576),
      gc: this.gcOverlap(this.lastTickAt, now),
      requests: this.safeRequestOverlap(this.lastTickAt, now),
      correlation: 'none',
    };
    const hasRequests = event.requests.inFlight.length > 0 || event.requests.completed.length > 0;
    event.correlation = event.steps.length > 0 ? (hasRequests ? 'steps+requests' : 'steps') : hasRequests ? 'requests' : 'none';
    this.stallCount += 1;
    this.stallTotalMs += lateness;
    this.windowStalls += 1;
    this.stallIntervals.set(event, { fromMs: this.lastTickAt, toMs: now });
    if (!this.worst || event.durationMs > this.worst.durationMs) this.worst = event;
    pushBounded(this.stalls, event, this.maxStalls);
    if (this.logBudget.take()) log.warn('Event loop stall', { ...event });
  }
}

/** Adds one collection to a stall's GC summary if it overlaps [fromMs, toMs] (clipped to it). */
function addGc(target: StallEvent['gc'], g: { startMs: number; endMs: number; major: boolean }, fromMs: number, toMs: number): void {
  const overlap = Math.min(g.endMs, toMs) - Math.max(g.startMs, fromMs);
  if (overlap <= 0) return;
  target.count += 1;
  target.overlapMs = round1(target.overlapMs + overlap);
  target.maxPauseMs = round1(Math.max(target.maxPauseMs, g.endMs - g.startMs));
  if (g.major) target.major += 1;
}

function ms(nanoseconds: number): number {
  return round2(nanoseconds / 1e6);
}

function safeResourceUsage(): { involuntaryContextSwitches: number; voluntaryContextSwitches: number; majorPageFault: number } {
  try {
    const u = process.resourceUsage();
    return {
      involuntaryContextSwitches: u.involuntaryContextSwitches,
      voluntaryContextSwitches: u.voluntaryContextSwitches,
      majorPageFault: u.majorPageFault,
    };
  } catch {
    return { involuntaryContextSwitches: 0, voluntaryContextSwitches: 0, majorPageFault: 0 };
  }
}

let instance: EventLoopDiagnostics | undefined;

/** Starts the process-wide monitor (idempotent). Thresholds are tunable by environment and clamped. */
export function startEventLoopDiagnostics(env: NodeJS.ProcessEnv = process.env): EventLoopDiagnostics {
  if (!instance) {
    instance = new EventLoopDiagnostics({
      stallThresholdMs: envNumber(env, 'DIAG_STALL_THRESHOLD_MS', 250, 50, 10_000),
      windowMs: envNumber(env, 'DIAG_WINDOW_MS', 60_000, 5_000, 600_000),
    });
    instance.start();
  }
  return instance;
}

export function eventLoopDiagnosticsSnapshot(): Record<string, unknown> {
  return instance ? instance.snapshot() : { enabled: false };
}
