/**
 * In-flight request deduplication keyed by `provider:resource`.
 *
 * Concurrent calls with the same key share one upstream call; the first caller
 * drives the request and the rest await the same promise. This prevents two
 * ingesters (or a retry storm) from doubling upstream load for identical work.
 */

export class SingleFlight {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  async do<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

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
}
