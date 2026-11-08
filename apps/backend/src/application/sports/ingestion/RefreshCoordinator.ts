/**
 * Stale-while-revalidate cache.
 *
 * A read returns the cached snapshot immediately and revalidates in the
 * background, so a slow (or failing) provider never blocks a read. A failed
 * background refresh keeps the last good value and marks it stale — it never
 * drops the cache. The ingestion tick calls `publish()` after a successful
 * foreground fetch to keep this read cache warm.
 */

export interface SnapshotEntry<T> {
  value: T;
  sourceTimestamp: number;
  ingestedAt: number;
  stale: boolean;
  lastError?: string;
}

export class RefreshCoordinator<T> {
  private cache: SnapshotEntry<T> | null = null;
  private refreshing = false;
  private background: Promise<void> = Promise.resolve();
  private readonly clock: () => number;

  constructor(options: { clock?: () => number } = {}) {
    this.clock = options.clock ?? Date.now;
  }

  /**
   * Serves the cached snapshot immediately (when one exists) and schedules a
   * background revalidation. On a cold cache this awaits the first fetch.
   */
  async get(fetch: () => Promise<T>): Promise<SnapshotEntry<T> | null> {
    if (!this.cache) return this.refresh(fetch);
    this.scheduleBackground(fetch);
    return this.cache;
  }

  /** Foreground refresh (used by the ingestion tick on a cold start). */
  async refreshNow(fetch: () => Promise<T>): Promise<SnapshotEntry<T>> {
    return this.refresh(fetch);
  }

  /** Publishes an externally-fetched value into the read cache. */
  publish(value: T, sourceTimestamp?: number): void {
    const now = this.clock();
    this.cache = { value, sourceTimestamp: sourceTimestamp ?? now, ingestedAt: now, stale: false };
  }

  /** The current cached entry, if any. */
  current(): SnapshotEntry<T> | null {
    return this.cache;
  }

  /** Resolves once any in-flight background revalidation settles (tests). */
  idle(): Promise<void> {
    return this.background;
  }

  private scheduleBackground(fetch: () => Promise<T>): void {
    if (this.refreshing) return;
    this.refreshing = true;
    this.background = (async () => {
      try {
        await this.refresh(fetch);
      } catch {
        // A cold-cache background refresh failure has nothing to return; the
        // next read retries. With a warm cache `refresh` never throws.
      } finally {
        this.refreshing = false;
      }
    })();
  }

  private async refresh(fetch: () => Promise<T>): Promise<SnapshotEntry<T>> {
    try {
      const value = await fetch();
      const now = this.clock();
      this.cache = { value, sourceTimestamp: now, ingestedAt: now, stale: false };
      return this.cache;
    } catch (error) {
      if (this.cache) {
        this.cache = {
          ...this.cache,
          stale: true,
          lastError: error instanceof Error ? error.message : String(error),
        };
        return this.cache;
      }
      throw error;
    }
  }
}
