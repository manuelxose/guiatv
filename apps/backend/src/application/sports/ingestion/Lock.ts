/**
 * Distributed lock port.
 *
 * `InMemoryLock` coordinates a single process (or several instances sharing the
 * same injected `Map` in tests). `MongoLock` uses an atomic `findOneAndUpdate`
 * upsert on a unique `key` index with a document-level expiry — the standard
 * multi-instance pattern. The `football_ingestion_locks` collection's unique
 * index is declared in `createFootballIndexes()`.
 */

export interface LockPort {
  acquire(key: string, ttlMs: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

export interface LockEntry {
  owner: string;
  expiresAt: number;
}

export class InMemoryLock implements LockPort {
  private readonly owner: string;

  constructor(
    private readonly store: Map<string, LockEntry> = new Map(),
    private readonly clock: () => number = Date.now,
    owner?: string
  ) {
    this.owner = owner ?? `owner-${nextOwnerId++}`;
  }

  async acquire(key: string, ttlMs: number): Promise<boolean> {
    const now = this.clock();
    const existing = this.store.get(key);
    if (existing && existing.expiresAt > now && existing.owner !== this.owner) {
      return false;
    }
    this.store.set(key, { owner: this.owner, expiresAt: now + ttlMs });
    return true;
  }

  async release(key: string): Promise<void> {
    const existing = this.store.get(key);
    if (existing && existing.owner === this.owner) {
      this.store.delete(key);
    }
  }
}

let nextOwnerId = 1;

/** Minimal native-Mongo collection surface the Mongo lock needs. */
export interface LockCollection {
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<{ value: { owner?: string } | null }>;
  deleteOne(filter: Record<string, unknown>): Promise<unknown>;
}

export function isDuplicateKeyError(error: unknown): boolean {
  const code = (error as { code?: number })?.code;
  const innerCode = (error as { err?: { code?: number } })?.err?.code;
  const message = String((error as { message?: string })?.message ?? '');
  return (
    code === 11000 ||
    innerCode === 11000 ||
    message.includes('E11000') ||
    message.toLowerCase().includes('duplicate key')
  );
}

export class MongoLock implements LockPort {
  constructor(
    private readonly collection: LockCollection,
    private readonly owner: string,
    private readonly clock: () => number = Date.now
  ) {}

  async acquire(key: string, ttlMs: number): Promise<boolean> {
    const now = this.clock();
    const expiresAt = now + ttlMs;
    try {
      const result = await this.collection.findOneAndUpdate(
        { key, $or: [{ expiresAt: { $lte: now } }] },
        { $set: { key, owner: this.owner, expiresAt } },
        { upsert: true, returnDocument: 'after' }
      );
      return result?.value?.owner === this.owner;
    } catch (error) {
      // A non-expired lock held by another owner matches nothing, so the upsert
      // collides with the unique `key` index — that means "not acquired".
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  }

  async release(key: string): Promise<void> {
    await this.collection.deleteOne({ key, owner: this.owner });
  }
}
