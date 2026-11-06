import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryLock, LockEntry, LockPort, MongoLock } from './Lock';

test('in-memory lock prevents two owners from both holding the same key', async () => {
  const store = new Map<string, LockEntry>();
  const lockA = new InMemoryLock(store, () => 1000, 'ingester-a');
  const lockB = new InMemoryLock(store, () => 1000, 'ingester-b');

  assert.equal(await lockA.acquire('football:ingestion', 60_000), true);
  assert.equal(await lockB.acquire('football:ingestion', 60_000), false);

  await lockA.release('football:ingestion');
  assert.equal(await lockB.acquire('football:ingestion', 60_000), true);
});

test('an expired lock is reclaimed', async () => {
  const store = new Map<string, LockEntry>();
  let now = 1000;
  const clock = () => now;
  const lockA = new InMemoryLock(store, clock, 'a');
  const lockB = new InMemoryLock(store, clock, 'b');

  assert.equal(await lockA.acquire('k', 10_000), true);
  now = 11_000; // ttl (10s) elapsed
  assert.equal(await lockB.acquire('k', 10_000), true);
});

test('MongoLock uses an atomic findOneAndUpdate with expiry and unique-key semantics', async () => {
  // A tiny fake collection mimicking the native Mongo upsert + unique key index.
  const docs = new Map<string, { key: string; owner: string; expiresAt: number }>();
  const duplicateKey = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
  const collection = {
    async findOneAndUpdate(filter: Record<string, any>, update: Record<string, any>, options?: Record<string, any>) {
      const key = filter.key as string;
      const owner = (update.$set as any).owner as string;
      const expiresAt = (update.$set as any).expiresAt as number;
      const existing = docs.get(key);
      const expired = existing && existing.expiresAt <= (filter.$or as any[])[0].expiresAt.$lte;
      if (options?.upsert && !existing) {
        docs.set(key, { key, owner, expiresAt });
        return { value: { owner } };
      }
      if (options?.upsert && existing && expired) {
        docs.set(key, { key, owner, expiresAt });
        return { value: { owner } };
      }
      if (options?.upsert && existing && !expired) {
        throw duplicateKey; // unique index collision → not acquired
      }
      return { value: existing ? { owner: existing.owner } : null };
    },
    async deleteOne(filter: Record<string, any>) {
      if (docs.get(filter.key)?.owner === filter.owner) docs.delete(filter.key);
      return {};
    },
  };

  const now = 1000;
  const lockA = new MongoLock(collection, 'a', () => now);
  const lockB = new MongoLock(collection, 'b', () => now);

  assert.equal(await lockA.acquire('k', 10_000), true);
  assert.equal(await lockB.acquire('k', 10_000), false);

  await lockA.release('k');
  assert.equal(await lockB.acquire('k', 10_000), true);
});

test('LockPort type stays minimal', async () => {
  const lock: LockPort = new InMemoryLock();
  assert.equal(await lock.acquire('x', 1000), true);
  await lock.release('x');
});
