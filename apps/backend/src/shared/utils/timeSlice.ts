import { performance } from 'node:perf_hooks';

/**
 * M13-B3b: cooperative time slicing for long loops on the event loop. `tick()` is cheap (one clock read) and, once the
 * slice budget is spent, yields to the event loop with `setImmediate` so timers, I/O callbacks and requests run between
 * slices. A microtask-only `await` does NOT yield (the loop never leaves the current phase), which is why a cursor drained
 * with `for await` still decodes a whole buffered batch in one block.
 *
 * It changes only WHEN work runs, never what it computes.
 */
export class TimeSlice {
  private last: number;
  /** Number of times the slice yielded (tests and benchmarks). */
  yields = 0;

  constructor(
    private readonly budgetMs = 8,
    private readonly yielder: () => Promise<void> = () => new Promise<void>((resolve) => setImmediate(resolve)),
    private readonly now: () => number = () => performance.now()
  ) {
    this.last = this.now();
  }

  async tick(): Promise<void> {
    if (this.now() - this.last < this.budgetMs) return;
    this.yields += 1;
    await this.yielder();
    this.last = this.now();
  }
}
