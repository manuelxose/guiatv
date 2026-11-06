/**
 * Per-provider request budget.
 *
 * A daily budget with a reserve preserved for important matches (live and
 * approaching-kickoff), a per-run cap, automatic throttling once the reserve is
 * reached, and an emergency disable switch. `normal` requests may never consume
 * the reserve; `live`/`approaching_kickoff` may. The budget resets at UTC
 * midnight and is process-local (documented in M05-B-NOTES.md).
 */

export type RequestImportance = 'normal' | 'live' | 'approaching_kickoff';

export interface RequestBudgetConfig {
  dailyBudget: number;
  liveReserve: number;
  perRunCap: number;
  throttleBackoffMs: number;
}

export interface BudgetSnapshot {
  remaining: number;
  reserveRemaining: number;
  availableForNormal: number;
  runConsumed: number;
  throttleUntil: number;
  disabled: boolean;
  quotaResetAt: number;
}


/**
 * Budget port consumed by the ingestion service (M06).
 *
 * Declared Promise-returning so BOTH the M05 process-local RequestBudget and the
 * M06 durable DurableRequestBudget satisfy it: the sync methods are simply
 * returned as resolved promises. This is what lets the durable, cluster-shared
 * authority be wired in without every call site guessing which implementation it
 * holds - and it prevents the silent failure mode where a durable budget is
 * constructed but the service keeps calling a sync API that never awaits it.
 */
export interface IngestionBudgetPort {
  isDisabled(): Promise<boolean>;
  beginRun(now?: number): Promise<void>;
  tryAcquire(importance: RequestImportance, now?: number): Promise<boolean>;
  snapshot(now?: number): Promise<BudgetSnapshot>;
  consumedToday(now?: number): Promise<number>;
}

/** Adapts the M05 process-local budget to the port. Process-local, NOT cluster-safe. */
export class LocalBudgetAdapter implements IngestionBudgetPort {
  constructor(private readonly inner: RequestBudget) {}
  async isDisabled(): Promise<boolean> {
    return this.inner.isDisabled();
  }
  async beginRun(now?: number): Promise<void> {
    this.inner.beginRun(now);
  }
  async tryAcquire(importance: RequestImportance, now?: number): Promise<boolean> {
    return this.inner.tryAcquire(importance, now);
  }
  async snapshot(now?: number): Promise<BudgetSnapshot> {
    return this.inner.snapshot(now);
  }
  async consumedToday(_now?: number): Promise<number> {
    return this.inner.consumedToday();
  }
}

export class RequestBudget {
  private remaining: number;
  private runConsumed = 0;
  private throttleUntil = 0;
  private disabledFlag: boolean;
  private quotaResetAt: number;
  private readonly clock: () => number;

  constructor(
    private readonly config: RequestBudgetConfig,
    options: { clock?: () => number; resetAt?: number; initiallyDisabled?: boolean } = {}
  ) {
    this.clock = options.clock ?? Date.now;
    this.remaining = config.dailyBudget;
    this.disabledFlag = options.initiallyDisabled ?? false;
    this.quotaResetAt = options.resetAt ?? nextUtcMidnight(this.clock());
  }

  /** Resets the per-run counter; call once at the start of a tick. */
  beginRun(now?: number): void {
    const t = now ?? this.clock();
    this.rolloverIfNeeded(t);
    this.runConsumed = 0;
  }

  /**
   * Consumes one request when allowed. Denies (and, for `normal`, throttles)
   * once only the reserve remains, the per-run cap is hit, the daily budget is
   * exhausted, or the emergency switch is engaged.
   */
  tryAcquire(importance: RequestImportance, now?: number): boolean {
    const t = now ?? this.clock();
    this.rolloverIfNeeded(t);
    if (this.disabledFlag) return false;
    if (this.runConsumed >= this.config.perRunCap) return false;
    if (this.throttleUntil > t) return false;
    if (this.remaining <= 0) {
      this.throttleUntil = t + this.config.throttleBackoffMs;
      return false;
    }
    if (importance === 'normal' && this.remaining <= this.config.liveReserve) {
      this.throttleUntil = t + this.config.throttleBackoffMs;
      return false;
    }
    this.remaining -= 1;
    this.runConsumed += 1;
    return true;
  }

  remainingNow(now?: number): number {
    this.rolloverIfNeeded(now ?? this.clock());
    return this.remaining;
  }

  consumedToday(): number {
    return this.config.dailyBudget - this.remaining;
  }

  disable(): void {
    this.disabledFlag = true;
  }

  enable(): void {
    this.disabledFlag = false;
  }

  isDisabled(): boolean {
    return this.disabledFlag;
  }

  snapshot(now?: number): BudgetSnapshot {
    const t = now ?? this.clock();
    this.rolloverIfNeeded(t);
    return {
      remaining: this.remaining,
      reserveRemaining: Math.max(0, Math.min(this.config.liveReserve, this.remaining)),
      availableForNormal: Math.max(0, this.remaining - this.config.liveReserve),
      runConsumed: this.runConsumed,
      throttleUntil: this.throttleUntil,
      disabled: this.disabledFlag,
      quotaResetAt: this.quotaResetAt,
    };
  }

  private rolloverIfNeeded(t: number): void {
    if (t >= this.quotaResetAt) {
      this.remaining = this.config.dailyBudget;
      this.throttleUntil = 0;
      this.quotaResetAt = nextUtcMidnight(t);
    }
  }
}

function nextUtcMidnight(t: number): number {
  const d = new Date(t);
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayStart(t: number): number {
  return Math.floor(t / DAY_MS) * DAY_MS;
}

/**
 * Durable quota store port.
 *
 * Implemented by the Mongo store (`infrastructure/sports/persistence`). The
 * contract is deliberately small so the authority can be driven by a real
 * MongoDB (atomic `findOneAndUpdate` reservations) or, in tests, by an
 * in-memory store that shares one counter between several instances.
 */
export interface DurableQuotaStore {
  /** Ensure the per-window document exists (idempotent, concurrent-safe). */
  ensureWindow(provider: string, windowStart: number, expiresAt: number): Promise<void>;
  /**
   * Atomically reserve one request in the window when `consumed < limit`.
   * Returns true only when THIS call performed the atomic increment — the
   * single-owner guarantee two instances rely on to never exceed the budget.
   */
  reserve(provider: string, windowStart: number, limit: number): Promise<boolean>;
  /** Consumed count for the window (0 when the window has no document yet). */
  consumedInWindow(provider: string, windowStart: number): Promise<number>;
  /** Emergency-disable flag — durable, so it survives a restart. */
  isDisabled(provider: string): Promise<boolean>;
  setDisabled(provider: string, disabled: boolean): Promise<void>;
  /** Persisted retry-after (ms epoch); 0 means "not throttled". */
  getThrottleUntil(provider: string): Promise<number>;
  setThrottleUntil(provider: string, until: number): Promise<void>;
}

/**
 * Cluster-safe request budget backed by a durable `DurableQuotaStore`.
 *
 * Unlike `RequestBudget` (process-local), the daily consumption, retry-after
 * and emergency-disable flag live in the shared store, so several instances
 * against one store can never exceed `dailyBudget`: the store's `reserve`
 * performs a single atomic `findOneAndUpdate` whose filter rejects the request
 * once `consumed` has reached the importance-specific limit.
 *
 * Cluster-safe: the daily budget and the live reserve are enforced by the
 * store's single atomic `findOneAndUpdate` `$inc`. The emergency-disable flag
 * and the persisted retry-after are durable read-checks: every reservation
 * attempt reads them first, so a persisted disable stops new reservations
 * across instances (a reservation already past the read is not a *new* one).
 * NOT cluster-safe: `perRunCap` (a per-tick, process-local bound) and the
 * caller's circuit breaker.
 */
export class DurableRequestBudget {
  constructor(
    private readonly config: RequestBudgetConfig,
    private readonly store: DurableQuotaStore,
    private readonly provider: string,
    private readonly clock: () => number = Date.now
  ) {}

  /** Resets the process-local per-run state (no-op durably); ensures the window exists. */
  async beginRun(now?: number): Promise<void> {
    const t = now ?? this.clock();
    const windowStart = utcDayStart(t);
    await this.store.ensureWindow(this.provider, windowStart, windowStart + DAY_MS);
  }

  async isDisabled(): Promise<boolean> {
    return this.store.isDisabled(this.provider);
  }

  async tryAcquire(importance: RequestImportance, now?: number): Promise<boolean> {
    const t = now ?? this.clock();
    // Durable read-checks first: the emergency-disable flag and the persisted
    // retry-after are consulted before any reservation attempt, so a disable
    // stops new reservations across every instance.
    if (await this.store.isDisabled(this.provider)) return false;
    if ((await this.store.getThrottleUntil(this.provider)) > t) return false;

    const windowStart = utcDayStart(t);
    const limit =
      importance === 'normal' ? this.config.dailyBudget - this.config.liveReserve : this.config.dailyBudget;
    if (limit <= 0) {
      await this.store.setThrottleUntil(this.provider, t + this.config.throttleBackoffMs);
      return false;
    }
    await this.beginRun(t);
    const reserved = await this.store.reserve(this.provider, windowStart, limit);
    if (reserved) return true;
    // Persist the retry-after so every instance backs off together.
    await this.store.setThrottleUntil(this.provider, t + this.config.throttleBackoffMs);
    return false;
  }

  async snapshot(now?: number): Promise<BudgetSnapshot> {
    const t = now ?? this.clock();
    const windowStart = utcDayStart(t);
    const [consumed, disabled, throttleUntil] = await Promise.all([
      this.store.consumedInWindow(this.provider, windowStart),
      this.store.isDisabled(this.provider),
      this.store.getThrottleUntil(this.provider),
    ]);
    const remaining = Math.max(0, this.config.dailyBudget - consumed);
    return {
      remaining,
      reserveRemaining: Math.max(0, Math.min(this.config.liveReserve, remaining)),
      availableForNormal: Math.max(0, remaining - this.config.liveReserve),
      runConsumed: 0, // per-run cap is process-local, not tracked durably
      throttleUntil,
      disabled,
      quotaResetAt: windowStart + DAY_MS,
    };
  }

  async consumedToday(now?: number): Promise<number> {
    const t = now ?? this.clock();
    return this.store.consumedInWindow(this.provider, utcDayStart(t));
  }

  async disable(): Promise<void> {
    await this.store.setDisabled(this.provider, true);
  }

  async enable(): Promise<void> {
    await this.store.setDisabled(this.provider, false);
  }
}
