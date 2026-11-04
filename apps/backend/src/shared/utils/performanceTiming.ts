import { AsyncLocalStorage } from 'async_hooks';
import type { PhaseStat } from './phaseTimer';

export interface RequestTimingContext {
  phases: Map<string, number>;
  /** Span count and summed work of the phases added by `addPhaseReport` (parallel phases: sum > wall). */
  detail?: Map<string, { count: number; sumMs: number }>;
  cache?: 'hit' | 'stale' | 'miss' | 'bypass';
}

const storage = new AsyncLocalStorage<RequestTimingContext>();

export function withRequestTiming(context: RequestTimingContext, next: () => void): void {
  storage.run(context, next);
}

export async function measureTiming<T>(phase: string, operation: () => Promise<T>): Promise<T> {
  const start = process.hrtime.bigint();
  try {
    return await operation();
  } finally {
    addTiming(phase, Number(process.hrtime.bigint() - start) / 1_000_000);
  }
}

export function addTiming(phase: string, durationMs: number): void {
  const context = storage.getStore();
  if (!context) return;
  context.phases.set(phase, (context.phases.get(phase) || 0) + durationMs);
}

export function setCacheTiming(result: RequestTimingContext['cache']): void {
  const context = storage.getStore();
  if (context) context.cache = result;
}

/**
 * M13-B1: adds the phases of a `PhaseRecorder` to the current request as `<prefix><name>` entries. `dur` is the wall-clock
 * union of the phase (parallel spans are NOT summed); `desc` carries the span count and summed work when they differ.
 */
export function addPhaseReport(prefix: string, report: Record<string, PhaseStat>): void {
  const context = storage.getStore();
  if (!context) return;
  const detail = (context.detail ??= new Map());
  for (const [name, stat] of Object.entries(report)) {
    const key = `${prefix}${name}`;
    context.phases.set(key, (context.phases.get(key) || 0) + stat.wallMs);
    const previous = detail.get(key);
    detail.set(key, { count: (previous?.count ?? 0) + stat.count, sumMs: (previous?.sumMs ?? 0) + stat.sumMs });
  }
}

export function formatServerTiming(context: RequestTimingContext, totalMs: number): string {
  const entries = Array.from(context.phases.entries())
    .filter(([, duration]) => Number.isFinite(duration))
    .map(([phase, duration]) => {
      const detail = context.detail?.get(phase);
      const desc = detail && detail.count > 1 ? `;desc="n=${detail.count} sum=${detail.sumMs.toFixed(1)}"` : '';
      return `${sanitizeToken(phase)};dur=${duration.toFixed(1)}${desc}`;
    });
  if (context.cache) entries.push(`cache-${context.cache};dur=0`);
  entries.push(`total;dur=${totalMs.toFixed(1)}`);
  return entries.join(', ');
}

function sanitizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}
