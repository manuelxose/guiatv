export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  cooldownMs: number;
  now?: () => number;
}

export interface CircuitBreakerSnapshot {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt?: number;
  nextRetryAt?: number;
  halfOpenProbeInFlight: boolean;
}

/**
 * Deterministic circuit breaker: closed -> open -> half-open -> closed.
 * In half-open exactly one probe may be in flight; a second `canAttempt()`
 * returns false until the probe resolves (success or failure). Clock injected.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt?: number;
  private nextRetryAt?: number;
  private halfOpenProbeInFlight = false;
  private readonly now: () => number;

  constructor(private readonly config: CircuitBreakerConfig) {
    this.now = config.now ?? Date.now;
  }

  get currentState(): CircuitState {
    return this.state;
  }

  canAttempt(): boolean {
    const t = this.now();
    if (this.state === 'open') {
      if (this.nextRetryAt !== undefined && t >= this.nextRetryAt) {
        this.state = 'half-open';
        this.halfOpenProbeInFlight = false;
      } else {
        return false;
      }
    }
    if (this.state === 'half-open') {
      if (this.halfOpenProbeInFlight) return false;
      this.halfOpenProbeInFlight = true;
      return true;
    }
    return true; // closed
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.state === 'half-open') {
      this.state = 'closed';
      this.openedAt = undefined;
      this.nextRetryAt = undefined;
    }
    this.halfOpenProbeInFlight = false;
  }

  recordFailure(): void {
    if (this.state === 'open') return; // already open
    this.consecutiveFailures += 1;
    if (this.state === 'half-open') {
      this.open();
      return;
    }
    if (this.consecutiveFailures >= this.config.failureThreshold) {
      this.open();
    }
  }

  snapshot(): CircuitBreakerSnapshot {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt,
      nextRetryAt: this.nextRetryAt,
      halfOpenProbeInFlight: this.halfOpenProbeInFlight,
    };
  }

  private open(): void {
    this.state = 'open';
    this.openedAt = this.now();
    this.nextRetryAt = this.openedAt + this.config.cooldownMs;
    this.halfOpenProbeInFlight = false;
  }
}
