/**
 * Bounded in-memory event queue with batch extraction and failure re-queueing. No timers or I/O: the collector owns
 * scheduling, this owns the limits. Oldest events are dropped first when full, and drops are counted.
 */
export interface QueuedEvent {
  eventId: string;
  type: string;
  name?: string;
  path?: string;
  title?: string;
  referrer?: string;
  occurredAt: string;
  data?: Record<string, unknown>;
  /** Delivery attempts already made for this event. */
  attempts?: number;
}

export interface QueueLimits {
  maxEvents: number;
  maxBatch: number;
  maxAttempts: number;
}

export const DEFAULT_QUEUE_LIMITS: QueueLimits = { maxEvents: 100, maxBatch: 25, maxAttempts: 3 };

export class AnalyticsQueue {
  private items: QueuedEvent[] = [];
  dropped = 0;

  constructor(private readonly limits: QueueLimits = DEFAULT_QUEUE_LIMITS) {}

  get size(): number {
    return this.items.length;
  }

  push(event: QueuedEvent): void {
    this.items.push(event);
    this.trim();
  }

  /** Removes and returns up to `maxBatch` events, oldest first. */
  take(max = this.limits.maxBatch): QueuedEvent[] {
    return this.items.splice(0, Math.min(max, this.limits.maxBatch));
  }

  /** Puts a failed batch back at the front (order preserved), dropping events that exhausted their attempts. */
  requeue(batch: QueuedEvent[]): void {
    const retry = batch
      .map((event) => ({ ...event, attempts: (event.attempts || 0) + 1 }))
      .filter((event) => {
        const keep = event.attempts < this.limits.maxAttempts;
        if (!keep) this.dropped++;
        return keep;
      });
    this.items = [...retry, ...this.items];
    this.trim();
  }

  clear(): void {
    this.items = [];
  }

  private trim(): void {
    const overflow = this.items.length - this.limits.maxEvents;
    if (overflow > 0) {
      this.items.splice(0, overflow);
      this.dropped += overflow;
    }
  }
}
