/**
 * In-flight request deduplication keyed by `provider:resource`.
 *
 * Concurrent calls with the same key share one upstream call; the first caller
 * drives the request and the rest await the same promise. This prevents two
 * ingesters (or a retry storm) from doubling upstream load for identical work.
 *
 * Process-local only: two separate processes do NOT share this map. The
 * cross-process safety net for identical work is the durable quota authority
 * (`DurableRequestBudget`) plus the scheduler lease (`MongoLock`).
 */

export class SingleFlight {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private dedupes = 0;
  private readonly onDedupe?: () => void;

  constructor(options: { onDedupe?: () => void } = {}) {
    this.onDedupe = options.onDedupe;
  }

  async do<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      this.dedupes += 1;
      this.onDedupe?.();
      return existing as Promise<T>;
    }

    const promise = Promise.resolve().then(fn);
    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      // Only clear our own entry: a slow caller must not erase a replacement
      // that a later call installed after this one settled.
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    }
  }

  /** Number of keys currently in flight (diagnostics). */
  active(): number {
    return this.inFlight.size;
  }

  /** Number of upstream calls avoided by deduplication (measured). */
  dedupeCount(): number {
    return this.dedupes;
  }
}
