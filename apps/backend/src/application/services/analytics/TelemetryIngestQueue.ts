/**
 * Bounded in-process ingestion queue for analytics (no new infrastructure).
 *
 * The HTTP handler only validates and calls `offer()` (O(1), no I/O) and answers 202. A single drain loop processes
 * items in arrival order, which keeps per-session ordering (session start before its events), yields to the event
 * loop between items with `setImmediate`, and pauses while storage reports itself unavailable.
 *
 * Policy (all counted in `metrics()`):
 * * capacity: `maxItems` batches and `maxEvents` events; beyond either, `offer()` refuses (the route answers 503 +
 *   Retry-After, the browser keeps its own bounded queue and backs off) — backpressure, never unbounded memory;
 * * retries: a failed item is retried up to `maxAttempts` times with exponential backoff, then dropped;
 * * storage unavailable: the loop waits (`unavailableDelayMs`) and keeps the queue; when it fills up, new items are
 *   refused, so a long outage loses at most what arrives after the queue is full;
 * * loss window: items in memory are lost if the process stops (bounded by capacity; typically < 1 s of traffic).
 */
export interface IngestQueueOptions {
  maxItems: number;
  maxEvents: number;
  maxAttempts: number;
  retryBaseMs: number;
  unavailableDelayMs: number;
}

export interface IngestQueueMetrics {
  depth: number;
  depthEvents: number;
  accepted: number;
  acceptedEvents: number;
  rejectedFull: number;
  processed: number;
  processedEvents: number;
  failedAttempts: number;
  droppedAfterRetries: number;
  droppedEventsAfterRetries: number;
  storageUnavailableWaits: number;
  lastError?: string;
  lastErrorAt?: string;
  maxLagMs: number;
  lastLagMs: number;
}

interface Entry<T> {
  item: T;
  events: number;
  enqueuedAt: number;
  attempts: number;
}

export const DEFAULT_INGEST_OPTIONS: IngestQueueOptions = {
  maxItems: Number(process.env.ANALYTICS_QUEUE_MAX_BATCHES) || 5_000,
  maxEvents: Number(process.env.ANALYTICS_QUEUE_MAX_EVENTS) || 50_000,
  maxAttempts: 3,
  retryBaseMs: 500,
  unavailableDelayMs: 1_000,
};

export class TelemetryIngestQueue<T> {
  private readonly entries: Entry<T>[] = [];
  private head = 0;
  private eventsQueued = 0;
  private running = false;
  private scheduled = false;
  private readonly stats: IngestQueueMetrics = {
    depth: 0, depthEvents: 0, accepted: 0, acceptedEvents: 0, rejectedFull: 0, processed: 0, processedEvents: 0,
    failedAttempts: 0, droppedAfterRetries: 0, droppedEventsAfterRetries: 0, storageUnavailableWaits: 0, maxLagMs: 0, lastLagMs: 0,
  };

  constructor(
    private readonly processItem: (item: T) => Promise<void>,
    private readonly isAvailable: () => boolean = () => true,
    private readonly options: IngestQueueOptions = DEFAULT_INGEST_OPTIONS,
    private readonly now: () => number = Date.now
  ) {}

  get depth(): number {
    return this.entries.length - this.head;
  }

  /** O(1). Returns false when the queue is full (caller answers 503). */
  offer(item: T, events: number): boolean {
    if (this.depth >= this.options.maxItems || this.eventsQueued + events > this.options.maxEvents) {
      this.stats.rejectedFull++;
      return false;
    }
    this.entries.push({ item, events, enqueuedAt: this.now(), attempts: 0 });
    this.eventsQueued += events;
    this.stats.accepted++;
    this.stats.acceptedEvents += events;
    this.kick(0);
    return true;
  }

  metrics(): IngestQueueMetrics {
    return { ...this.stats, depth: this.depth, depthEvents: this.eventsQueued };
  }

  /** Resolves when the queue is empty (tests and graceful shutdown). */
  async drain(timeoutMs = 5_000): Promise<void> {
    const deadline = this.now() + timeoutMs;
    while (this.depth > 0 && this.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  }

  private kick(delayMs: number): void {
    if (this.running || this.scheduled) return;
    this.scheduled = true;
    const run = () => {
      this.scheduled = false;
      void this.loop();
    };
    if (delayMs > 0) setTimeout(run, delayMs).unref?.();
    else setImmediate(run);
  }

  private async loop(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.depth > 0) {
        if (!this.isAvailable()) {
          this.stats.storageUnavailableWaits++;
          this.running = false;
          this.kick(this.options.unavailableDelayMs);
          return;
        }
        const entry = this.entries[this.head];
        try {
          await this.processItem(entry.item);
          this.shift(entry);
          this.stats.processed++;
          this.stats.processedEvents += entry.events;
          const lag = this.now() - entry.enqueuedAt;
          this.stats.lastLagMs = lag;
          if (lag > this.stats.maxLagMs) this.stats.maxLagMs = lag;
        } catch (error) {
          entry.attempts++;
          this.stats.failedAttempts++;
          this.stats.lastError = error instanceof Error ? error.message.slice(0, 200) : 'unknown';
          this.stats.lastErrorAt = new Date(this.now()).toISOString();
          if (entry.attempts >= this.options.maxAttempts) {
            this.shift(entry);
            this.stats.droppedAfterRetries++;
            this.stats.droppedEventsAfterRetries += entry.events;
          } else {
            this.running = false;
            this.kick(this.options.retryBaseMs * 2 ** (entry.attempts - 1));
            return;
          }
        }
        // Yield between items so a burst never monopolises the event loop.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } finally {
      if (this.running) this.running = false;
    }
  }

  private shift(entry: Entry<T>): void {
    this.head++;
    this.eventsQueued -= entry.events;
    // Compact occasionally so the array does not grow without bound (amortised O(1)).
    if (this.head > 1024 && this.head * 2 > this.entries.length) {
      this.entries.splice(0, this.head);
      this.head = 0;
    }
  }
}
