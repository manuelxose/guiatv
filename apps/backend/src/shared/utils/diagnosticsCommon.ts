/**
 * M13-B1: small helpers shared by the diagnostics modules. Everything here is allocation-light and bounded.
 */

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Appends to a bounded buffer, dropping the oldest entry. Returns true when an entry was dropped. */
export function pushBounded<T>(target: T[], value: T, cap: number): boolean {
  target.push(value);
  if (target.length <= cap) return false;
  target.shift();
  return true;
}

/** Nearest-rank percentile of an unsorted sample; 0 for an empty one. */
export function percentileOf(values: readonly number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return round2(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]);
}

/**
 * Caps how many diagnostic log lines a module may emit per minute, so a stall storm or a slow-query storm cannot
 * flood the journal. Callers read `suppressed` to report how many lines were skipped.
 */
export class LogBudget {
  private minute = -1;
  private used = 0;
  suppressed = 0;

  constructor(private readonly perMinute: number, private readonly now: () => number = () => Date.now()) {}

  take(): boolean {
    const minute = Math.floor(this.now() / 60_000);
    if (minute !== this.minute) {
      this.minute = minute;
      this.used = 0;
    }
    if (this.used >= this.perMinute) {
      this.suppressed += 1;
      return false;
    }
    this.used += 1;
    return true;
  }
}

/** Reads a positive number from the environment, falling back (and clamping) so a typo cannot disable a bound. */
export function envNumber(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/** Only the error class name leaves a diagnostic: messages of driver errors can embed connection strings. */
export function errorKind(error: unknown): string {
  return error instanceof Error ? error.name.slice(0, 40) : typeof error;
}
