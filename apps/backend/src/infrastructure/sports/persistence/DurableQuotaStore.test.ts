import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoDurableQuotaStore } from './DurableQuotaStore';

const WS = Date.parse('2026-11-06T00:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

interface WindowDoc {
  provider: string;
  windowStart: number;
  consumed: number;
  expiresAt: Date;
}

interface ControlDoc {
  provider: string;
  disabled: boolean;
  throttleUntil: number;
}

/** Fake window collection mimicking Mongo's atomic findOneAndUpdate + $inc. */
function makeWindowCollection() {
  const docs = new Map<string, WindowDoc>();
  const keyOf = (provider: string, windowStart: number) => `${provider}:${windowStart}`;
  return {
    docs,
    async updateOne(filter: Record<string, any>, update: Record<string, any>, options?: Record<string, any>) {
      const key = keyOf(filter.provider, filter.windowStart);
      if (options?.upsert && !docs.has(key)) {
        const s = update.$setOnInsert;
        docs.set(key, { provider: s.provider, windowStart: s.windowStart, consumed: s.consumed ?? 0, expiresAt: s.expiresAt });
        return { upsertedCount: 1 };
      }
      return { upsertedCount: 0 };
    },
    async findOneAndUpdate(filter: Record<string, any>, update: Record<string, any>) {
      const key = keyOf(filter.provider, filter.windowStart);
      const doc = docs.get(key);
      if (!doc) return null; // no window document → no match
      const limit = (filter.consumed as { $lt: number }).$lt;
      if (doc.consumed >= limit) return null; // filter rejects the $inc
      doc.consumed += (update.$inc as { consumed: number }).consumed;
      return { consumed: doc.consumed };
    },
    async findOne(filter: Record<string, any>) {
      return docs.get(keyOf(filter.provider, filter.windowStart)) ?? null;
    },
  };
}

function makeControlCollection() {
  const docs = new Map<string, ControlDoc>();
  return {
    docs,
    async updateOne(filter: Record<string, any>, update: Record<string, any>, options?: Record<string, any>) {
      const provider = filter.provider as string;
      let doc = docs.get(provider);
      if (!doc && options?.upsert) {
        doc = { provider, disabled: false, throttleUntil: 0 };
        docs.set(provider, doc);
      }
      if (!doc) return { upsertedCount: 0 };
      if (update.$set?.disabled !== undefined) doc.disabled = update.$set.disabled;
      if (update.$max?.throttleUntil !== undefined) {
        doc.throttleUntil = Math.max(doc.throttleUntil, update.$max.throttleUntil);
      }
      return { upsertedCount: 1 };
    },
    async findOne(filter: Record<string, any>) {
      return docs.get(filter.provider as string) ?? null;
    },
  };
}

test('two store instances against one shared window collection cannot exceed the limit', async () => {
  const windows = makeWindowCollection();
  const controls = makeControlCollection();
  const storeA = new MongoDurableQuotaStore(windows as any, controls as any);
  const storeB = new MongoDurableQuotaStore(windows as any, controls as any);

  await storeA.ensureWindow('openligadb', WS, WS + DAY_MS);

  let reserved = 0;
  // 12 interleaved reservations across two independent stores; only 10 may win.
  for (let i = 0; i < 12; i += 1) {
    const store = i % 2 === 0 ? storeA : storeB;
    if (await store.reserve('openligadb', WS, 10)) reserved += 1;
  }

  assert.equal(reserved, 10);
  assert.equal(await storeA.consumedInWindow('openligadb', WS), 10);
});

test('the emergency-disable flag is durable and the throttle only moves forward', async () => {
  const windows = makeWindowCollection();
  const controls = makeControlCollection();
  const store = new MongoDurableQuotaStore(windows as any, controls as any);

  await store.setDisabled('openligadb', true);
  assert.equal(await store.isDisabled('openligadb'), true);

  await store.setThrottleUntil('openligadb', 5000);
  await store.setThrottleUntil('openligadb', 3000); // stale writer must not shorten it
  assert.equal(await store.getThrottleUntil('openligadb'), 5000);
});
