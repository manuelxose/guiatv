import { performance } from 'node:perf_hooks';
import { round1 } from './diagnosticsCommon';

export interface PhaseStat {
  /** Spans started under this name. */
  count: number;
  /** Wall-clock time during which at least one span of this name was running (the union of the intervals). */
  wallMs: number;
  /** Sum of the individual span durations. Equals wallMs only when the spans never overlapped. */
  sumMs: number;
  maxMs: number;
}

interface PhaseState extends PhaseStat {
  active: number;
  since: number;
}

/**
 * M13-B1: times named phases of one operation without presenting parallel work as sequential.
 *
 * `Promise.all` of 16 provider lookups of 200 ms each takes ~200 ms of wall clock, not 3200 ms. `wallMs` is the union of
 * the span intervals of a name (what that phase cost the caller), `sumMs` the total work, `count` the number of spans.
 * Phases of different names may overlap or nest; their `wallMs` values are therefore NOT additive to the total.
 *
 * Phase names must be fixed literals (they become metric keys); the recorder itself holds no request data.
 */
export class PhaseRecorder {
  private readonly phases = new Map<string, PhaseState>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  async span<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const start = this.begin(name);
    try {
      return await operation();
    } finally {
      this.end(name, start);
    }
  }

  sync<T>(name: string, operation: () => T): T {
    const start = this.begin(name);
    try {
      return operation();
    } finally {
      this.end(name, start);
    }
  }

  /** A span still running (an abandoned promise) is counted up to now, so it cannot disappear from the report. */
  report(): Record<string, PhaseStat> {
    const now = this.now();
    const out: Record<string, PhaseStat> = {};
    for (const [name, p] of this.phases) {
      out[name] = {
        count: p.count,
        wallMs: round1(p.wallMs + (p.active > 0 ? now - p.since : 0)),
        sumMs: round1(p.sumMs),
        maxMs: round1(p.maxMs),
      };
    }
    return out;
  }

  private begin(name: string): number {
    const start = this.now();
    let state = this.phases.get(name);
    if (!state) {
      state = { count: 0, wallMs: 0, sumMs: 0, maxMs: 0, active: 0, since: start };
      this.phases.set(name, state);
    }
    if (state.active === 0) state.since = start;
    state.active += 1;
    state.count += 1;
    return start;
  }

  private end(name: string, start: number): void {
    const end = this.now();
    const state = this.phases.get(name);
    if (!state) return;
    const duration = end - start;
    state.sumMs += duration;
    if (duration > state.maxMs) state.maxMs = duration;
    state.active -= 1;
    if (state.active === 0) state.wallMs += end - state.since;
  }
}
