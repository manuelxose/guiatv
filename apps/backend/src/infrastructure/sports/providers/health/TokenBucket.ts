import { ProviderId } from '../../../../domain/sports/football/provider-types';

export interface TokenBucketConfig {
  limit: number;
  windowSeconds: number;
}

export interface TokenBucketResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
  resetAt?: number;
}

/**
 * Rolling-window quota accounting keyed by provider. Consumption timestamps
 * older than the window are dropped lazily on every `take`, so the bucket
 * naturally survives a quota reset. The clock is injected for determinism.
 */
export class TokenBucket {
  private readonly configs = new Map<ProviderId, TokenBucketConfig>();
  private readonly consumed = new Map<ProviderId, number[]>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  configure(providerId: ProviderId, config: TokenBucketConfig): void {
    this.configs.set(providerId, config);
  }

  getConfig(providerId: ProviderId): TokenBucketConfig | undefined {
    return this.configs.get(providerId);
  }

  /** Tokens still available in the current window (Infinity when unconfigured). */
  remaining(providerId: ProviderId): number {
    const config = this.configs.get(providerId);
    if (!config) return Number.POSITIVE_INFINITY;
    const t = this.now();
    const tokens = (this.consumed.get(providerId) ?? []).filter(
      (ts) => ts > t - config.windowSeconds * 1000
    );
    return Math.max(0, config.limit - tokens.length);
  }

  /** Epoch ms when the current window fully resets (undefined when unconfigured). */
  resetAt(providerId: ProviderId): number | undefined {
    const config = this.configs.get(providerId);
    if (!config) return undefined;
    const tokens = (this.consumed.get(providerId) ?? []).filter(
      (ts) => ts > this.now() - config.windowSeconds * 1000
    );
    if (tokens.length === 0) return undefined;
    return Math.min(...tokens) + config.windowSeconds * 1000;
  }

  reset(providerId: ProviderId): void {
    this.consumed.delete(providerId);
  }

  take(providerId: ProviderId, n = 1): TokenBucketResult {
    const config = this.configs.get(providerId);
    if (!config) {
      return { allowed: true, remaining: Number.POSITIVE_INFINITY };
    }
    const t = this.now();
    const windowMs = config.windowSeconds * 1000;
    const tokens = (this.consumed.get(providerId) ?? []).filter((ts) => ts > t - windowMs);
    const remaining = Math.max(0, config.limit - tokens.length);
    if (n <= remaining) {
      for (let i = 0; i < n; i += 1) tokens.push(t);
      this.consumed.set(providerId, tokens);
      return {
        allowed: true,
        remaining: config.limit - tokens.length,
        resetAt: Math.min(...tokens) + windowMs,
      };
    }
    // Denied: find when enough tokens expire to admit the request.
    const needed = tokens.length + n - config.limit;
    const sorted = [...tokens].sort((a, b) => a - b);
    const freeAt = sorted[needed - 1] + windowMs;
    return {
      allowed: false,
      remaining,
      retryAfterMs: Math.max(0, freeAt - t),
      resetAt: sorted[0] + windowMs,
    };
  }
}
