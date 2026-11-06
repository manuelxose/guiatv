/**
 * Mongo-backed durable quota store.
 *
 * Implements the `DurableQuotaStore` port declared in the application layer.
 * The per-window counter (`football_quota`) and the provider-level control flag
 * (`football_ingestion_control`) are separate collections so the emergency
 * disable and the persisted retry-after survive a restart AND a UTC-midnight
 * window rollover.
 *
 * Cluster safety comes from MongoDB's atomic `findOneAndUpdate`: `reserve` uses
 * a single `$inc` whose filter rejects the reservation once `consumed` has
 * reached the limit, so two instances can never both win the last unit.
 */

import { DurableQuotaStore } from '@/application/sports/ingestion/RequestBudget';

export interface QuotaWindowCollection {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<unknown>;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<{ consumed?: number } | null>;
  findOne(filter: Record<string, unknown>): Promise<{ consumed?: number } | null>;
}

export interface QuotaControlCollection {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<unknown>;
  findOne(filter: Record<string, unknown>): Promise<{ disabled?: boolean; throttleUntil?: number } | null>;
}

export class MongoDurableQuotaStore implements DurableQuotaStore {
  constructor(
    private readonly window: QuotaWindowCollection,
    private readonly control: QuotaControlCollection
  ) {}

  async ensureWindow(provider: string, windowStart: number, expiresAt: number): Promise<void> {
    await this.window.updateOne(
      { provider, windowStart },
      { $setOnInsert: { provider, windowStart, consumed: 0, expiresAt: new Date(expiresAt) } },
      { upsert: true }
    );
  }

  async reserve(provider: string, windowStart: number, limit: number): Promise<boolean> {
    // Atomic: the `$inc` only fires when the filter still matches, so the limit
    // can never be exceeded by a concurrent reservation.
    const result = await this.window.findOneAndUpdate(
      { provider, windowStart, consumed: { $lt: limit } },
      { $inc: { consumed: 1 } },
      { returnDocument: 'after' }
    );
    return result != null;
  }

  async consumedInWindow(provider: string, windowStart: number): Promise<number> {
    const doc = await this.window.findOne({ provider, windowStart });
    return doc?.consumed ?? 0;
  }

  async isDisabled(provider: string): Promise<boolean> {
    const doc = await this.control.findOne({ provider });
    return doc?.disabled === true;
  }

  async setDisabled(provider: string, disabled: boolean): Promise<void> {
    await this.control.updateOne(
      { provider },
      { $setOnInsert: { provider, throttleUntil: 0 }, $set: { disabled } },
      { upsert: true }
    );
  }

  async getThrottleUntil(provider: string): Promise<number> {
    const doc = await this.control.findOne({ provider });
    return doc?.throttleUntil ?? 0;
  }

  async setThrottleUntil(provider: string, until: number): Promise<void> {
    // `$max` only moves the deadline forward, so a stale writer can never
    // shorten a retry-after another instance already persisted.
    await this.control.updateOne(
      { provider },
      { $setOnInsert: { provider, disabled: false }, $max: { throttleUntil: until } },
      { upsert: true }
    );
  }
}
