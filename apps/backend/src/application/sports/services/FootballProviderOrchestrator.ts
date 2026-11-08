/**
 * FootballProviderOrchestrator — the single entry point for football provider
 * data (M05-A).
 *
 * For a fixtures/live request it: (a) asks the selector for eligible
 * candidates, (b) calls ONLY approved providers, (c) enforces quota + circuit
 * breaker + backoff around every call, (d) reconciles identity, (e) merges
 * fields with provenance, and (f) preserves the previous snapshot on total
 * failure instead of degrading a rich record to a poorer one. A prototype
 * provider can never be reached through ordinary fallback.
 */

import {
  EnrichedMatch,
  FootballProviderCapability,
  ProviderFixtureQuery,
  ProviderId,
  ProviderMatchRecord,
} from '../../../domain/sports/football/provider-types';
import { TokenBucket } from '../../../infrastructure/sports/providers/health/TokenBucket';
import {
  CircuitBreaker,
  CircuitBreakerConfig,
} from '../../../infrastructure/sports/providers/health/CircuitBreaker';
import {
  classifyProviderError,
  computeBackoff,
  extractRetryAfter,
} from '../../../infrastructure/sports/providers/health/backoff';
import { ProviderSelector, SelectorCandidate } from '../providers/ProviderSelector';
import {
  DEFAULT_KICKOFF_WINDOW_MS,
  DEFAULT_RESCHEDULE_WINDOW_MS,
  reconcile,
} from '../providers/IdentityReconciler';
import { resolveMatchFields } from '../providers/conflictResolution';

export type OrchestratorRequestKind = 'fixtures' | 'live';

export interface OrchestratorProviderSource {
  providerId: ProviderId;
  capabilities: FootballProviderCapability[];
  competitions: string[];
  priority: number;
  fetchFixtures?: (query: ProviderFixtureQuery) => Promise<ProviderMatchRecord[]>;
  fetchLive?: (query: ProviderFixtureQuery) => Promise<ProviderMatchRecord[]>;
}

export interface OrchestratorOptions {
  selector?: ProviderSelector;
  quota?: TokenBucket;
  breakers?: Map<ProviderId, CircuitBreaker>;
  breaker?: CircuitBreakerConfig;
  maxRetries?: number;
  backoff?: { baseDelayMs?: number; maxDelayMs?: number };
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  initialSnapshot?: EnrichedMatch[];
  kickoffWindowMs?: number;
  rescheduleWindowMs?: number;
}

export class FootballProviderUnavailableError extends Error {
  constructor(reason: string) {
    super(`No football data available: ${reason}`);
    this.name = 'FootballProviderUnavailableError';
  }
}

export class FootballProviderOrchestrator {
  private readonly selector: ProviderSelector;
  private readonly quota: TokenBucket;
  private readonly breakers: Map<ProviderId, CircuitBreaker>;
  private readonly breakerConfig: CircuitBreakerConfig;
  private readonly maxRetries: number;
  private readonly backoff: { baseDelayMs: number; maxDelayMs: number };
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly kickoffWindowMs: number;
  private readonly rescheduleWindowMs: number;
  private readonly lastSuccess = new Map<ProviderId, number>();
  private previousSnapshot: EnrichedMatch[];

  constructor(options: OrchestratorOptions = {}) {
    this.selector = options.selector ?? new ProviderSelector();
    this.quota = options.quota ?? new TokenBucket(options.now ?? Date.now);
    this.breakerConfig = options.breaker ?? { failureThreshold: 3, cooldownMs: 30_000 };
    this.breakers = options.breakers ?? new Map();
    this.maxRetries = options.maxRetries ?? 2;
    this.backoff = {
      baseDelayMs: options.backoff?.baseDelayMs ?? 500,
      maxDelayMs: options.backoff?.maxDelayMs ?? 30_000,
    };
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.kickoffWindowMs = options.kickoffWindowMs ?? DEFAULT_KICKOFF_WINDOW_MS;
    this.rescheduleWindowMs = options.rescheduleWindowMs ?? DEFAULT_RESCHEDULE_WINDOW_MS;
    this.previousSnapshot = options.initialSnapshot ?? [];
  }

  async getMatches(
    kind: OrchestratorRequestKind,
    sources: OrchestratorProviderSource[],
    query: ProviderFixtureQuery = {}
  ): Promise<EnrichedMatch[]> {
    const neededCapability: FootballProviderCapability = kind === 'live' ? 'live_score' : 'fixtures';
    const candidates = sources.map((source) => this.toCandidate(source));
    const decision = this.selector.select(
      { capability: neededCapability, competitionSlug: query.competitionSlug },
      candidates
    );

    const fetched: ProviderMatchRecord[] = [];
    for (const providerId of decision.ordered) {
      const source = sources.find((candidate) => candidate.providerId === providerId);
      if (!source) continue;
      const records = await this.callProvider(source, kind, query);
      fetched.push(...records);
    }

    if (fetched.length === 0) {
      if (this.previousSnapshot.length > 0) {
        return this.previousSnapshot;
      }
      throw new FootballProviderUnavailableError(
        decision.selected ? `all approved providers failed (${decision.ordered.join(', ')})` : 'no eligible provider available'
      );
    }

    const groups = reconcile(fetched, {
      kickoffWindowMs: this.kickoffWindowMs,
      rescheduleWindowMs: this.rescheduleWindowMs,
      now: this.now,
    });
    const previousByIdentity = new Map(this.previousSnapshot.map((match) => [match.identityKey, match]));
    const merged = groups.map((group) => {
      const enriched = resolveMatchFields(group.records, previousByIdentity.get(group.identityKey), {
        now: () => new Date(this.now()),
        kickoffWindowMs: this.kickoffWindowMs,
        identityKey: group.identityKey,
      });
      if (group.quarantined) {
        enriched.quarantined = true;
        enriched.quarantineReason = group.quarantineReason;
      }
      return enriched;
    });

    this.previousSnapshot = merged;
    return merged;
  }

  private toCandidate(source: OrchestratorProviderSource): SelectorCandidate {
    const breaker = this.breakerFor(source.providerId);
    const snapshot = breaker.snapshot();
    const reliability = snapshot.state === 'closed' ? 1 : snapshot.state === 'half-open' ? 0.5 : 0;
    const remainingQuota = this.quota.getConfig(source.providerId)
      ? this.quota.remaining(source.providerId)
      : null;
    const lastOk = this.lastSuccess.get(source.providerId);
    return {
      providerId: source.providerId,
      capabilities: source.capabilities,
      competitions: source.competitions,
      priority: source.priority,
      reliability,
      remainingQuota,
      freshnessMs: lastOk === undefined ? Number.POSITIVE_INFINITY : this.now() - lastOk,
    };
  }

  private breakerFor(providerId: ProviderId): CircuitBreaker {
    let breaker = this.breakers.get(providerId);
    if (!breaker) {
      breaker = new CircuitBreaker({ ...this.breakerConfig, now: this.now });
      this.breakers.set(providerId, breaker);
    }
    return breaker;
  }

  private async callProvider(
    source: OrchestratorProviderSource,
    kind: OrchestratorRequestKind,
    query: ProviderFixtureQuery
  ): Promise<ProviderMatchRecord[]> {
    const fetch = kind === 'live' ? source.fetchLive : source.fetchFixtures;
    if (!fetch) return [];

    const quotaResult = this.quota.take(source.providerId, 1);
    if (!quotaResult.allowed) return [];

    const breaker = this.breakerFor(source.providerId);
    if (breaker.currentState === 'open') return [];
    if (!breaker.canAttempt()) return [];

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const records = await fetch(query);
        breaker.recordSuccess();
        this.lastSuccess.set(source.providerId, this.now());
        return records;
      } catch (error) {
        breaker.recordFailure();
        const classification = classifyProviderError(error);
        if (!classification.retryable || attempt >= this.maxRetries) {
          return [];
        }
        const delayMs = computeBackoff({
          attempt,
          baseDelayMs: this.backoff.baseDelayMs,
          maxDelayMs: this.backoff.maxDelayMs,
          retryAfter: extractRetryAfter(error),
          now: this.now,
        }).delayMs;
        await this.sleep(delayMs);
      }
    }
    return [];
  }
}
