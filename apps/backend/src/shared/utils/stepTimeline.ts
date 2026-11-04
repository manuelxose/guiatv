import { performance } from 'node:perf_hooks';
import { errorKind, pushBounded, round1 } from './diagnosticsCommon';
import { logger } from './logger';

/**
 * M13-B1: a bounded timeline of the named start-up and background steps, so a stall can be matched to what was running.
 *
 * Times are milliseconds since process start (`performance.now()`), the same clock the event-loop stall detector uses.
 * `cpuMs` is the process-wide CPU consumed while the step ran: for a step that ran alone it separates CPU-bound work
 * (cpuMs ~ durationMs) from waiting on I/O (cpuMs << durationMs); with other work running concurrently it is an upper
 * bound, not the step's own CPU. Step names are fixed literals; only the error class name is kept on failure (driver
 * error messages can contain connection strings).
 */
export interface StepRecord {
  step: string;
  startMs: number;
  durationMs: number;
  cpuMs: number;
  /** True for a step that runs synchronously on the event loop: any stall inside its interval is its own. */
  sync: boolean;
  ok: boolean;
  error?: string;
}

interface ActiveStep {
  step: string;
  startMs: number;
  sync: boolean;
}

export interface StepOptions {
  sync?: boolean;
  /** Background steps shorter than this are not stored (they would only evict useful entries). Boot steps always are. */
  minMs?: number;
  /**
   * M13-B3a: a recurring request-time or scheduled step. It never enters the start-up list (a hot path would fill its
   * 64 slots and its log lines within the boot window); it is stored in the recent ring when it lasts at least `minMs`.
   */
  background?: boolean;
}

let BOOT_WINDOW_MS = 10 * 60_000;
const MAX_BOOT = 64;
const MAX_RECENT = 64;
const MAX_ACTIVE = 64;

const log = logger.child('Diagnostics');
const boot: StepRecord[] = [];
const recent: StepRecord[] = [];
const active = new Map<number, ActiveStep>();
let nextId = 1;
let droppedBoot = 0;

function cpuMs(since: NodeJS.CpuUsage): number {
  const delta = process.cpuUsage(since);
  return (delta.user + delta.system) / 1_000;
}

function begin(step: string, sync: boolean): { id: number; startMs: number; cpuStart: NodeJS.CpuUsage } {
  const startMs = performance.now();
  const id = nextId++;
  if (active.size < MAX_ACTIVE) active.set(id, { step, startMs, sync });
  return { id, startMs, cpuStart: process.cpuUsage() };
}

function finish(
  started: { id: number; startMs: number; cpuStart: NodeJS.CpuUsage },
  step: string,
  options: StepOptions,
  error?: unknown,
  failed = false
): void {
  try {
    active.delete(started.id);
    const durationMs = performance.now() - started.startMs;
    const isBoot = !options.background && started.startMs < BOOT_WINDOW_MS;
    if (!isBoot && !failed && durationMs < (options.minMs ?? 0)) return;
    const record: StepRecord = {
      step,
      startMs: round1(started.startMs),
      durationMs: round1(durationMs),
      cpuMs: round1(cpuMs(started.cpuStart)),
      sync: Boolean(options.sync),
      ok: !failed,
      ...(failed ? { error: errorKind(error) } : {}),
    };
    if (isBoot && boot.length < MAX_BOOT) {
      boot.push(record);
      log.info('Startup step', { ...record }); // bounded by MAX_BOOT lines per process
    } else if (isBoot) droppedBoot += 1;
    else pushBounded(recent, record, MAX_RECENT);
  } catch {
    // Diagnostics must never affect the step they observe.
  }
}

export async function timeStep<T>(step: string, operation: () => Promise<T>, options: StepOptions = {}): Promise<T> {
  const started = begin(step, Boolean(options.sync));
  try {
    const result = await operation();
    finish(started, step, options);
    return result;
  } catch (error) {
    finish(started, step, options, error, true);
    throw error;
  }
}

export function timeStepSync<T>(step: string, operation: () => T, options: StepOptions = {}): T {
  const started = begin(step, true);
  try {
    const result = operation();
    finish(started, step, { ...options, sync: true });
    return result;
  } catch (error) {
    finish(started, step, { ...options, sync: true }, error, true);
    throw error;
  }
}

export interface StepOverlap {
  step: string;
  sync: boolean;
  /** Still running when asked. */
  running: boolean;
}

/** Steps whose interval intersects [fromMs, toMs]: finished, or still in flight. Correlation, not proof, for async steps. */
export function stepsOverlapping(fromMs: number, toMs: number): StepOverlap[] {
  const out: StepOverlap[] = [];
  const seen = new Set<string>();
  const add = (step: string, sync: boolean, running: boolean) => {
    const key = `${step}|${running}`;
    if (seen.has(key) || out.length >= 8) return;
    seen.add(key);
    out.push({ step, sync, running });
  };
  for (const s of active.values()) if (s.startMs <= toMs) add(s.step, s.sync, true);
  const finished = [...boot, ...recent]
    .filter((r) => r.startMs <= toMs && r.startMs + r.durationMs >= fromMs)
    .sort((a, b) => Number(b.sync) - Number(a.sync) || b.durationMs - a.durationMs);
  for (const r of finished) add(r.step, r.sync, false);
  return out;
}

/** Records a step that ended before diagnostics could time it (module loading: `startMs` 0, `durationMs` = time to now). */
export function recordElapsedStep(step: string, durationMs: number, sync = true): void {
  if (boot.length < MAX_BOOT) boot.push({ step, startMs: 0, durationMs: round1(durationMs), cpuMs: round1(cpuMs({ user: 0, system: 0 })), sync, ok: true });
}

export function stepTimelineSnapshot(): { startup: StepRecord[]; recent: StepRecord[]; running: ActiveStep[]; droppedStartup: number } {
  return {
    startup: boot.map((r) => ({ ...r })),
    recent: recent.map((r) => ({ ...r })),
    running: Array.from(active.values()).map((s) => ({ ...s, startMs: round1(s.startMs) })),
    droppedStartup: droppedBoot,
  };
}

/** Tests only. */
export function resetStepTimeline(): void {
  boot.length = 0;
  recent.length = 0;
  active.clear();
  droppedBoot = 0;
}

/** Tests only: lets a test leave the boot window, which otherwise lasts 10 minutes from process start. */
export function setBootWindowMsForTests(ms: number): void {
  BOOT_WINDOW_MS = ms;
}
