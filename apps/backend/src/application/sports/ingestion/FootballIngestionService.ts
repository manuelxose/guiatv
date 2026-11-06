/**
 * Central ingestion service: one lock-guarded, idempotent tick plus the
 * diagnostics read path.
 *
 * The tick:
 *   1. acquires the distributed lock (two ingesters never both write);
 *   2. honours the emergency-disable switch and the circuit breaker;
 *   3. begins a per-run budget and acquires one request (bounded by quota);
 *   4. fetches the season through SingleFlight + GracefulDegradation;
 *   5. builds idempotent snapshots and upserts them (safe to run twice);
 *   6. updates sync state, metrics and the ingestion run record.
 *
 * On provider failure nothing is written: the last good snapshots remain in the
 * store — the system never replaces a rich record with an empty/EPG-only one.
 */

import { FootballMatch } from '@/domain/sports/football/types';
import { AdaptiveScheduler } from './AdaptiveScheduler';
import { RequestBudget } from './RequestBudget';
import { SingleFlight } from './SingleFlight';
import { RefreshCoordinator } from './RefreshCoordinator';
import { GracefulDegradation, refuseEpgOnlyDowngrade } from './GracefulDegradation';
import { LockPort } from './Lock';
import { buildSnapshots } from './snapshots';
import { createIngestionMetrics, IngestionMetrics, pushError } from './metrics';
import { redact, redactDiagnostics } from './util';
import {
  FootballDiagnosticsReport,
  FootballPersistencePort,
  IngestionBucket,
  ProviderDiagnostics,
  TickResult,
} from './types';

export interface MatchFetcher {
  fetchMatches(leagueShortcut: string, season: string | number, now?: Date): Promise<FootballMatch[]>;
}

/** One competition in the ingestion plan (M06). */
export interface IngestionCompetition {
  shortcuts: readonly string[];
  season: string;
}

/** Per-competition result inside a single tick (M06). */
export interface CompetitionOutcome {
  leagueShortcut: string;
  season: string;
  outcome: 'success' | 'partial' | 'failed' | 'skipped' | 'empty';
  reason?: string;
  requestsUsed: number;
  snapshotsWritten: number;
  matches?: number;
}

export interface FootballIngestionServiceOptions {
  providerId: string;
  /**
   * M06: the competitions this service ingests. When omitted, `leagueShortcut` +
   * `season` are used for a single competition (M05 callers stay valid).
   */
  competitions?: readonly IngestionCompetition[];
  leagueShortcut?: string;
  season?: string;
  adapter: MatchFetcher;
  persistence: FootballPersistencePort;
  lock: LockPort;
  budget: RequestBudget;
  scheduler?: AdaptiveScheduler;
  singleFlight?: SingleFlight;
  coordinator?: RefreshCoordinator<FootballMatch[]>;
  degradation?: GracefulDegradation<FootballMatch[]>;
  clock?: () => number;
  lockTtlMs?: number;
  circuitFailureThreshold?: number;
  circuitOpenMs?: number;
  stalenessMs?: number;
  maxStoredErrors?: number;
  metrics?: IngestionMetrics;
}

const DEFAULT_LOCK_TTL_MS = 60_000;
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;
const DEFAULT_CIRCUIT_OPEN_MS = 30_000;
const DEFAULT_STALENESS_MS = 30 * 60 * 1000;
const DEFAULT_MAX_STORED_ERRORS = 10;

let runCounter = 0;

export class FootballIngestionService {
  readonly providerId: string;
  private readonly competitions: readonly IngestionCompetition[];
  private readonly adapter: MatchFetcher;
  private readonly persistence: FootballPersistencePort;
  private readonly lock: LockPort;
  private readonly budget: RequestBudget;
  private readonly scheduler: AdaptiveScheduler;
  private readonly singleFlight: SingleFlight;
  private readonly coordinator: RefreshCoordinator<FootballMatch[]>;
  private readonly degradation: GracefulDegradation<FootballMatch[]>;
  private readonly clock: () => number;
  private readonly lockTtlMs: number;
  private readonly circuitFailureThreshold: number;
  private readonly circuitOpenMs: number;
  private readonly stalenessMs: number;
  private readonly maxStoredErrors: number;
  private readonly metrics: IngestionMetrics;

  private nextPollIntervalMs: number;
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(options: FootballIngestionServiceOptions) {
    this.providerId = options.providerId;
    this.competitions =
      options.competitions && options.competitions.length > 0
        ? options.competitions
        : [{ shortcuts: [options.leagueShortcut ?? 'bl1'], season: options.season ?? '2026' }];
    this.adapter = options.adapter;
    this.persistence = options.persistence;
    this.lock = options.lock;
    this.budget = options.budget;
    this.scheduler = options.scheduler ?? new AdaptiveScheduler();
    this.singleFlight = options.singleFlight ?? new SingleFlight();
    this.coordinator = options.coordinator ?? new RefreshCoordinator<FootballMatch[]>();
    this.degradation =
      options.degradation ?? new GracefulDegradation<FootballMatch[]>(refuseEpgOnlyDowngrade);
    this.clock = options.clock ?? Date.now;
    this.lockTtlMs = options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
    this.circuitFailureThreshold = options.circuitFailureThreshold ?? DEFAULT_CIRCUIT_FAILURE_THRESHOLD;
    this.circuitOpenMs = options.circuitOpenMs ?? DEFAULT_CIRCUIT_OPEN_MS;
    this.stalenessMs = options.stalenessMs ?? DEFAULT_STALENESS_MS;
    this.maxStoredErrors = options.maxStoredErrors ?? DEFAULT_MAX_STORED_ERRORS;
    this.metrics = options.metrics ?? createIngestionMetrics();
    this.nextPollIntervalMs = this.scheduler.intervalMs('future');
  }

  async runTick(): Promise<TickResult> {
    const lockKey = `football:ingestion:${this.providerId}`;
    const acquired = await this.lock.acquire(lockKey, this.lockTtlMs);
    if (!acquired) {
      return { outcome: 'skipped', reason: 'lock_held', requestsUsed: 0, snapshotsWritten: 0 };
    }
    try {
      return await this.tickLocked();
    } finally {
      await this.lock.release(lockKey);
    }
  }


  diagnostics(): FootballDiagnosticsReport {
    const nowMs = this.clock();
    const budget = this.budget.snapshot(nowMs);
    const provider: ProviderDiagnostics = {
      provider: this.providerId,
      health: this.metrics.health,
      quotaRemaining: budget.remaining,
      quotaReserveRemaining: budget.reserveRemaining,
      quotaResetAt: new Date(budget.quotaResetAt).toISOString(),
      throttledUntil: budget.throttleUntil > nowMs ? new Date(budget.throttleUntil).toISOString() : undefined,
      lastSyncAt: this.metrics.lastSuccessAt ? new Date(this.metrics.lastSuccessAt).toISOString() : undefined,
      lastErrorAt: this.metrics.lastErrorAt ? new Date(this.metrics.lastErrorAt).toISOString() : undefined,
      lastLatencyMs: this.metrics.lastLatencyMs,
      consecutiveFailures: this.consecutiveFailures,
      fieldCoverage: this.metrics.fieldCoverage,
      errors: this.metrics.errors.slice(-5).map((e) => ({
        at: new Date(e.at).toISOString(),
        kind: e.kind,
        message: redact(e.message),
      })),
      activeMatches: this.metrics.activeMatches,
      staleCount: this.metrics.staleSnapshots,
      identityConflicts: this.metrics.identityConflicts,
      queueSize: this.metrics.queueSize,
      lastSuccessAt: this.metrics.lastSuccessAt ? new Date(this.metrics.lastSuccessAt).toISOString() : undefined,
    };

    return redactDiagnostics({
      generatedAt: new Date(nowMs).toISOString(),
      providers: [provider],
      summary: {
        activeMatches: provider.activeMatches,
        staleSnapshots: provider.staleCount,
        queueSize: provider.queueSize,
        identityConflicts: provider.identityConflicts,
        lastSuccessAt: provider.lastSuccessAt,
        lastRunAt: this.metrics.lastRunAt ? new Date(this.metrics.lastRunAt).toISOString() : undefined,
      },
    });
  }

  private async tickLocked(): Promise<TickResult> {
    const nowMs = this.clock();
    this.metrics.lastRunAt = nowMs;
    const runId = `${this.providerId}-${nowMs}-${runCounter++}`;

    if (this.budget.isDisabled()) {
      this.metrics.health = 'disabled';
      return { outcome: 'skipped', reason: 'emergency_disabled', requestsUsed: 0, snapshotsWritten: 0 };
    }
    if (this.isCircuitOpen(nowMs)) {
      this.metrics.health = 'degraded';
      return { outcome: 'skipped', reason: 'circuit_open', requestsUsed: 0, snapshotsWritten: 0 };
    }

    this.budget.beginRun(nowMs);

    // M06: one tick serves every approved competition under the SAME lock and the
    // SAME budget. Each competition consumes one request from the shared quota; a
    // refused or failed competition is recorded individually and never prevents the
    // others from being ingested, and nothing is ever written on its behalf.
    const perCompetition: CompetitionOutcome[] = [];
    const startedAll = this.clock();
    let requestsUsed = 0;
    let snapshotsWritten = 0;
    let anySuccess = false;
    let anyFailure = false;
    let anyStale = false;
    let budgetRefused = false;
    const allMatches: FootballMatch[] = [];
    let lastIdentityConflicts = 0;

    for (const competition of this.competitions) {
      const shortcut = competition.shortcuts[0] ?? '';
      if (!this.budget.tryAcquire('normal', this.clock())) {
        budgetRefused = true;
        perCompetition.push({ leagueShortcut: shortcut, season: competition.season, outcome: 'skipped', reason: 'budget_exhausted', requestsUsed: 0, snapshotsWritten: 0 });
        continue;
      }
      requestsUsed += 1;
      try {
        const degraded = await this.singleFlight.do(
          `${this.providerId}:season:${shortcut}:${competition.season}`,
          () => this.degradation.get(() => this.adapter.fetchMatches(shortcut, competition.season))
        );
        const matches = degraded.value;
        const ingestedAt = new Date(this.clock()).toISOString();
        const { snapshots, identityConflicts } = buildSnapshots(matches, this.providerId, ingestedAt);
        const written = await this.persistence.upsertSnapshots(snapshots);
        snapshotsWritten += written;
        lastIdentityConflicts = identityConflicts;
        allMatches.push(...matches);
        anySuccess = true;
        if (degraded.stale) anyStale = true;
        // An empty provider response is NOT a success. It is a truthful, distinct
        // state: the competition is covered but supplied nothing this run (e.g. its
        // fixtures aged out of the provider's window). Reporting 'success' with zero
        // matches would be a false-healthy signal.
        if (matches.length === 0) {
          perCompetition.push({
            leagueShortcut: shortcut,
            season: competition.season,
            outcome: 'empty',
            reason: 'provider returned no matches for this competition',
            requestsUsed: 1,
            snapshotsWritten: 0,
            matches: 0,
          });
          continue;
        }
        perCompetition.push({
          leagueShortcut: shortcut,
          season: competition.season,
          outcome: degraded.stale ? 'partial' : 'success',
          requestsUsed: 1,
          snapshotsWritten: written,
          matches: matches.length,
        });
      } catch (error) {
        const message = redact(error instanceof Error ? error.message : String(error));
        anyFailure = true;
        pushError(this.metrics, 'provider', `${shortcut}: ${message}`, this.maxStoredErrors, this.clock());
        perCompetition.push({ leagueShortcut: shortcut, season: competition.season, outcome: 'failed', reason: message, requestsUsed: 1, snapshotsWritten: 0 });
      }
    }

        this.nextPollIntervalMs = this.scheduler.minimumIntervalMs(
      allMatches.map((m) => ({ kickoffAt: m.kickoffAt, status: m.status })),
      this.clock()
    );

    if (!anySuccess) {
      if (budgetRefused && requestsUsed === 0) {
        this.metrics.health = 'degraded';
        await this.recordRun(runId, 'failed', 0, ['budget_exhausted'], nowMs);
        return { outcome: 'skipped', reason: 'budget_exhausted', requestsUsed: 0, snapshotsWritten: 0 };
      }
      const firstError = perCompetition.find((c) => c.outcome === 'failed')?.reason ?? 'no competitions ingested';
      this.consecutiveFailures += 1;
      this.metrics.lastErrorAt = this.clock();
      this.metrics.health = this.consecutiveFailures >= this.circuitFailureThreshold ? 'down' : 'degraded';
      if (this.consecutiveFailures >= this.circuitFailureThreshold) {
        this.circuitOpenUntil = this.clock() + this.circuitOpenMs;
      }
      await this.persistence.updateSyncState(this.providerId, {
        provider: this.providerId,
        lastErrorAt: new Date(this.clock()).toISOString(),
        consecutiveFailures: this.consecutiveFailures,
        circuitState: this.consecutiveFailures >= this.circuitFailureThreshold ? 'open' : 'closed',
      });
      await this.recordRun(runId, 'failed', requestsUsed, [firstError], nowMs);
      // Nothing is written on a total failure: the last good snapshots remain.
      return { outcome: 'failed', requestsUsed, snapshotsWritten: 0 };
    }

    const outcome: 'success' | 'partial' = anyFailure || anyStale ? 'partial' : 'success';
    this.metrics.lastSuccessAt = this.clock();
    this.metrics.lastLatencyMs = this.clock() - startedAll;
    this.metrics.identityConflicts = lastIdentityConflicts;
    this.metrics.activeMatches = countActive(allMatches);
    this.metrics.fieldCoverage = computeFieldCoverage(allMatches);
    this.metrics.staleSnapshots = anyStale ? allMatches.length : computeStaleCount(allMatches, this.clock(), this.stalenessMs);
    this.metrics.queueSize = snapshotsWritten;
    this.metrics.health = anyFailure || anyStale || this.consecutiveFailures > 0 ? 'degraded' : 'ok';
    this.consecutiveFailures = 0;
    this.coordinator.publish(allMatches);

    await this.persistence.updateSyncState(this.providerId, {
      provider: this.providerId,
      lastSuccessAt: new Date(this.clock()).toISOString(),
      consecutiveFailures: 0,
      quotaConsumedToday: this.budget.consumedToday(),
      quotaResetAt: new Date(this.budget.snapshot().quotaResetAt).toISOString(),
      circuitState: 'closed',
    });
    await this.recordRun(runId, outcome, requestsUsed, [], nowMs);

    return {
      outcome,
      requestsUsed,
      snapshotsWritten,
      nextPollIntervalMs: this.nextPollIntervalMs,
      buckets: bucketCounts(allMatches, this.clock(), this.scheduler),
      competitions: perCompetition,
    } as TickResult;
  }

  private isCircuitOpen(nowMs: number): boolean {
    return this.circuitOpenUntil > nowMs;
  }

  private async recordRun(
    runId: string,
    outcome: 'success' | 'partial' | 'failed',
    requestsUsed: number,
    errors: string[],
    nowMs: number
  ): Promise<void> {
    await this.persistence.recordRun({
      runId,
      providerId: this.providerId,
      startedAt: new Date(nowMs).toISOString(),
      finishedAt: new Date(this.clock()).toISOString(),
      requestsUsed,
      outcome,
      errors,
    });
  }
}

export function countActive(matches: FootballMatch[]): number {
  return matches.filter((m) => m.status === 'live' || m.status === 'halftime').length;
}

export function computeFieldCoverage(matches: FootballMatch[]): number {
  if (matches.length === 0) return 0;
  let present = 0;
  let total = 0;
  for (const m of matches) {
    total += 4;
    if (m.venue) present += 1;
    if (m.score.home !== null || m.score.away !== null) present += 1;
    if (Array.isArray(m.events) && m.events.length > 0) present += 1;
    if (m.statistics && m.statistics.halftime) present += 1;
  }
  return total === 0 ? 0 : present / total;
}

export function computeStaleCount(matches: FootballMatch[], nowMs: number, stalenessMs: number): number {
  return matches.filter((m) => Date.parse(m.lastUpdatedAt) < nowMs - stalenessMs).length;
}

export function bucketCounts(
  matches: FootballMatch[],
  nowMs: number,
  scheduler: AdaptiveScheduler
): Partial<Record<IngestionBucket, number>> {
  const counts: Partial<Record<IngestionBucket, number>> = {};
  for (const m of matches) {
    const bucket = scheduler.classify({ kickoffAt: m.kickoffAt, status: m.status }, nowMs);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}
