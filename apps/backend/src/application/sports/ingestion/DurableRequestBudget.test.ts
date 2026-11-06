import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableQuotaStore, DurableRequestBudget, RequestBudgetConfig } from './RequestBudget';

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-11-06T10:00:00Z');

/**
 * In-memory durable store shared between several budget instances. Mirrors the
 * Mongo store's contract: `reserve` only increments when the window exists and
 * `consumed < limit`, and throttle only moves forward.
 */
class FakeDurableStore implements DurableQuotaStore {
  private readonly windows = new Map<string, { consumed: number; expiresAt: number }>();
  private readonly controls = new Map<string, { disabled: boolean; throttleUntil: number }>();

  private windowKey(provider: string, windowStart: number): string {
    return `${provider}:${windowStart}`;
  }

  async ensureWindow(provider: string, windowStart: number, expiresAt: number): Promise<void> {
    const key = this.windowKey(provider, windowStart);
    if (!this.windows.has(key)) this.windows.set(key, { consumed: 0, expiresAt });
  }

  async reserve(provider: string, windowStart: number, limit: number): Promise<boolean> {
    const key = this.windowKey(provider, windowStart);
    const window = this.windows.get(key);
    if (!window) return false; // no window document yet (mirrors findOneAndUpdate no-match)
    if (window.consumed < limit) {
      window.consumed += 1;
      return true;
    }
    return false;
  }

  async consumedInWindow(provider: string, windowStart: number): Promise<number> {
    return this.windows.get(this.windowKey(provider, windowStart))?.consumed ?? 0;
  }

  async isDisabled(provider: string): Promise<boolean> {
    return this.controls.get(provider)?.disabled === true;
  }

  async setDisabled(provider: string, disabled: boolean): Promise<void> {
    const control = this.controls.get(provider) ?? { disabled: false, throttleUntil: 0 };
    control.disabled = disabled;
    this.controls.set(provider, control);
  }

  async getThrottleUntil(provider: string): Promise<number> {
    return this.controls.get(provider)?.throttleUntil ?? 0;
  }

  async setThrottleUntil(provider: string, until: number): Promise<void> {
    const control = this.controls.get(provider) ?? { disabled: false, throttleUntil: 0 };
    control.throttleUntil = Math.max(control.throttleUntil, until);
    this.controls.set(provider, control);
  }
}

const config = (overrides: Partial<RequestBudgetConfig> = {}): RequestBudgetConfig => ({
  dailyBudget: 10,
  liveReserve: 3,
  perRunCap: 100,
  throttleBackoffMs: 60_000,
  ...overrides,
});

test('two independent instances against one store never exceed the shared budget', async () => {
  const store = new FakeDurableStore();
  const cfg = config({ dailyBudget: 10, liveReserve: 0, throttleBackoffMs: 0 });
  const a = new DurableRequestBudget(cfg, store, 'openligadb', () => T0);
  const b = new DurableRequestBudget(cfg, store, 'openligadb', () => T0);

  let acquired = 0;
  // 12 attempts interleaved across the two instances; only 10 may ever win.
  for (let i = 0; i < 12; i += 1) {
    const budget = i % 2 === 0 ? a : b;
    if (await budget.tryAcquire('normal', T0)) acquired += 1;
  }

  assert.equal(acquired, 10);
  assert.equal(await store.consumedInWindow('openligadb', Math.floor(T0 / DAY_MS) * DAY_MS), 10);
});

test('normal requests cannot consume the reserve; live requests may', async () => {
  const store = new FakeDurableStore();
  const cfg = config({ dailyBudget: 10, liveReserve: 3, throttleBackoffMs: 0 });
  const budget = new DurableRequestBudget(cfg, store, 'openligadb', () => T0);

  let normal = 0;
  while (await budget.tryAcquire('normal', T0)) normal += 1;
  assert.equal(normal, 7);

  let live = 0;
  while (await budget.tryAcquire('live', T0)) live += 1;
  assert.equal(live, 3);

  assert.equal(await budget.consumedToday(T0), 10);
});

test('emergency disable stops new reservations and survives a restart (new instance)', async () => {
  const store = new FakeDurableStore();
  const cfg = config({ dailyBudget: 10, liveReserve: 0, throttleBackoffMs: 0 });
  const first = new DurableRequestBudget(cfg, store, 'openligadb', () => T0);

  assert.equal(await first.tryAcquire('normal', T0), true);
  await first.disable();
  assert.equal(await first.isDisabled(), true);
  assert.equal(await first.tryAcquire('normal', T0), false);

  // A brand-new instance against the same store observes the persisted disable.
  const restarted = new DurableRequestBudget(cfg, store, 'openligadb', () => T0);
  assert.equal(await restarted.isDisabled(), true);
  assert.equal(await restarted.tryAcquire('normal', T0), false);
  // No new reservation slipped through: consumed is still 1.
  assert.equal(await restarted.consumedToday(T0), 1);

  await restarted.enable();
  assert.equal(await restarted.tryAcquire('normal', T0), true);
});

test('a denied reservation persists a retry-after and a fresh instance honours it', async () => {
  const store = new FakeDurableStore();
  const cfg = config({ dailyBudget: 2, liveReserve: 0, throttleBackoffMs: 1000 });
  const budget = new DurableRequestBudget(cfg, store, 'openligadb', () => T0);

  assert.equal(await budget.tryAcquire('normal', T0), true);
  assert.equal(await budget.tryAcquire('normal', T0), true);
  // Budget exhausted: denied and throttled for 1000ms.
  assert.equal(await budget.tryAcquire('normal', T0), false);
  assert.equal(await store.getThrottleUntil('openligadb'), T0 + 1000);

  const restarted = new DurableRequestBudget(cfg, store, 'openligadb', () => T0);
  assert.equal(await restarted.tryAcquire('normal', T0 + 500), false); // still throttled
  assert.equal(await restarted.tryAcquire('normal', T0 + 1001), false); // throttle past, budget still exhausted
});

test('the budget rolls over at UTC midnight into a fresh window', async () => {
  const store = new FakeDurableStore();
  const cfg = config({ dailyBudget: 3, liveReserve: 0, throttleBackoffMs: 0 });
  const budget = new DurableRequestBudget(cfg, store, 'openligadb', () => T0);

  await budget.tryAcquire('normal', T0);
  await budget.tryAcquire('normal', T0);
  await budget.tryAcquire('normal', T0);
  assert.equal(await budget.tryAcquire('normal', T0), false);

  const nextDay = T0 + DAY_MS;
  assert.equal(await budget.tryAcquire('normal', nextDay), true);
  assert.equal(await budget.consumedToday(nextDay), 1);
});
