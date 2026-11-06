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
