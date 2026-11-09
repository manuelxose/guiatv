/**
 * Builds the football ingestion service from environment configuration.
 *
 * No network or database I/O happens here — only object construction. The CLI
 * connects Mongo and creates indexes before running the first tick. Credentials
 * are referenced by environment-variable NAME only (OpenLigaDB is unauthenticated;
 * nothing here reads a secret).
 */

import { OpenLigaDbClient, FetchLike } from '@/infrastructure/sports/providers/openLigaDb/OpenLigaDbClient';
import { OpenLigaDbAdapter } from '@/infrastructure/sports/providers/openLigaDb/OpenLigaDbAdapter';
import { FootballIngestionRepository } from '@/infrastructure/sports/persistence/FootballIngestionRepository';
import { InMemoryLock } from '@/application/sports/ingestion/Lock';
import { RequestBudget } from '@/application/sports/ingestion/RequestBudget';
import { AdaptiveScheduler, DEFAULT_SCHEDULER_CONFIG } from '@/application/sports/ingestion/AdaptiveScheduler';
import { FootballIngestionService } from '@/application/sports/ingestion/FootballIngestionService';

/**
 * M06: the competitions OpenLigaDB is approved to serve (see
 * `docs/sports-v2/M06-PROVIDER-ELIGIBILITY.md`). Each entry was verified by probe
 * against season 2026 with real finished matches and goal timelines.
 *
 * A competition absent from this list is NOT ingsted - never guessed, never
 * substituted by another code. `OPENLIGADB_LEAGUES` narrows the set (comma
 * separated codes) for a bounded run; it can never widen it beyond this list.
 */
export const M06_OPENLIGADB_COMPETITIONS: ReadonlyArray<{ shortcuts: readonly string[]; season: string }> = [
  { shortcuts: ['bl1'], season: '2026' },
  { shortcuts: ['bl2'], season: '2026' },
  { shortcuts: ['pl'], season: '2026' },
  { shortcuts: ['ucl'], season: '2026' },
  { shortcuts: ['uel2026'], season: '2026' },
  { shortcuts: ['uecl2026'], season: '2026' },
  { shortcuts: ['dfb'], season: '2026' },
  // LaLiga 2026/27: 380 real fixtures verified against the provider (la1).
  { shortcuts: ['la1'], season: '2026' },
  { shortcuts: ['wm2026'], season: '2026' },
  // M07: UEFA Nations League A 2026 (48 fixtures verified 2026-11-09).
  { shortcuts: ['nla'], season: '2026' },
];

/**
 * Resolves the configured competition set.
 *
 * Deliberately fail-closed: an unknown code in `OPENLIGADB_LEAGUES` is ignored
 * (reported as skipped) rather than passed to the provider, and an empty result
 * means nothing is ingested.
 */
export function resolveCompetitionPlan(
  rawSelection: string | undefined = process.env.OPENLIGADB_LEAGUES
): { shortcuts: readonly string[]; season: string }[] {
  const requested = (rawSelection ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (requested.length === 0) return [...M06_OPENLIGADB_COMPETITIONS];
  const plan = M06_OPENLIGADB_COMPETITIONS.filter((entry) =>
    entry.shortcuts.some((shortcut) => requested.includes(shortcut))
  );
  return plan;
}

export interface FootballIngestionFactoryOptions {
  fetch?: FetchLike;
}

export function buildFootballIngestionService(
  options: FootballIngestionFactoryOptions = {}
): FootballIngestionService {
  const fetchImpl: FetchLike = options.fetch ?? (globalThis.fetch as unknown as FetchLike);

  // F05 (independent review): the eligibility registry (`assertEligible`) is the
  // sole admission gate, and it is now enforced INSIDE the `OpenLigaDbClient`
  // constructor — before the client is retained, before any adapter, request or
  // write can happen. The old order (construct client, THEN assert) let a
  // blocked provider construct a client first; now construction itself throws for
  // any provider that is not `approved`. Every ingestion entry path (scheduled
  // loop, manual sync, CLI, startup/recovery) builds this client through the
  // factory, so none can bypass the boundary.
  const client = new OpenLigaDbClient(fetchImpl, {
    userAgent: process.env.OPENLIGADB_USER_AGENT || 'guiatv-m06-ingestion/1.0',
    timeoutMs: Number(process.env.OPENLIGADB_TIMEOUT_MS) || 10_000,
  });
  const adapter = new OpenLigaDbAdapter(client);
  const repository = new FootballIngestionRepository();
  const scheduler = new AdaptiveScheduler(DEFAULT_SCHEDULER_CONFIG);
  const plan = resolveCompetitionPlan();
  const config = {
    // The default daily budget covers every approved competition. Raise it only
    // deliberately: OpenLigaDB publishes no rate limit, so this is self-imposed
    // politeness, not a provider quota.
    dailyBudget: Number(process.env.OPENLIGADB_DAILY_BUDGET) || 1500,
    liveReserve: Number(process.env.OPENLIGADB_LIVE_RESERVE) || 300,
    // M06: the per-run cap bounds ONE tick, and one tick serves every competition
    // in the plan (one request each). Sizing it below the plan length would starve
    // the tail competitions on every run; it never widens the daily budget.
    perRunCap: Number(process.env.OPENLIGADB_PER_RUN_CAP) || Math.max(plan.length, 5),
    throttleBackoffMs: Number(process.env.OPENLIGADB_THROTTLE_BACKOFF_MS) || 60_000,
  };

  // M06-C: the durable, cluster-shared authority is the DEFAULT. The M05
  // process-local budget and lock remain available only when explicitly asked for
  // (FOOTBALL_DURABLE_QUOTA=0), so "cluster-safe" describes what actually runs
  // rather than an unwired library.
  //
  // F07 (independent review): if MongoDB is not ready, silently falling back to a
  // process-local budget would let two workers each believe they own the quota. The
  // durable path therefore FAILS CLOSED: construction throws, so no ingestion runs
  // with an authority that is not shared. Tests and genuinely single-process setups
  // must opt in explicitly with FOOTBALL_DURABLE_QUOTA=0 (see buildBudgetAndLock).
  const { budget, lock } = buildBudgetAndLock('openligadb', config, process.env.OPENLIGADB_EMERGENCY_DISABLED === '1');

  return new FootballIngestionService({
    providerId: 'openligadb',
    competitions: plan,
    adapter,
    persistence: repository,
    lock,
    budget,
    scheduler,
  });
}

/**
 * M07: footballdata.io free plan = 1000 requests per MONTH (probe 2026-11-09).
 * The durable daily caps are the hard guarantee:
 *   match windows   24/day × 31 = 744
 *   daily results + tables 3/day × 31 = 93   (refreshFootballDataIoTables)
 *   one backfill run (CLI, manual) ≤ 12
 *   total ≤ 849 < 1000, leaving margin for the provider's own counting.
 * The scheduler is slowed so a busy matchday fits inside the day: live every
 * 25 min, approaching kickoff every hour.
 */
export const FOOTBALLDATA_IO_DAILY_MATCH_BUDGET = 24;
export const FOOTBALLDATA_IO_DAILY_TABLE_BUDGET = 3;
export const FOOTBALLDATA_IO_BACKFILL_BUDGET = 12;
export const FOOTBALLDATA_IO_SCHEDULER: typeof DEFAULT_SCHEDULER_CONFIG = {
  ...DEFAULT_SCHEDULER_CONFIG,
  futureMs: 8 * 60 * 60 * 1000,
  todayMs: 3 * 60 * 60 * 1000,
  approachingKickoffMs: 60 * 60 * 1000,
  liveMs: 25 * 60 * 1000,
  halftimeMs: 25 * 60 * 1000,
  historicalMs: 12 * 60 * 60 * 1000,
};

/** Null when no key is configured: the provider is simply not ingested. */
export function buildFootballDataIoIngestionService(options: FootballIngestionFactoryOptions = {}): FootballIngestionService | null {
  const apiKey = process.env.FOOTBALLDATA_IO_API_KEY?.trim();
  if (!apiKey) return null;
  const { FootballDataIoClient } = require('@/infrastructure/sports/providers/footballDataIo/FootballDataIoClient') as typeof import('@/infrastructure/sports/providers/footballDataIo/FootballDataIoClient');
  const { FootballDataIoAdapter, FOOTBALLDATA_IO_PROVIDER_ID, FOOTBALLDATA_IO_WINDOW } = require('@/infrastructure/sports/providers/footballDataIo/FootballDataIoAdapter') as typeof import('@/infrastructure/sports/providers/footballDataIo/FootballDataIoAdapter');
  const fetchImpl: FetchLike = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const client = new FootballDataIoClient(fetchImpl, { apiKey, timeoutMs: Number(process.env.FOOTBALLDATA_IO_TIMEOUT_MS) || 10_000 });
  const daily = Math.min(Number(process.env.FOOTBALLDATA_IO_DAILY_BUDGET) || FOOTBALLDATA_IO_DAILY_MATCH_BUDGET, FOOTBALLDATA_IO_DAILY_MATCH_BUDGET);
  const config = { dailyBudget: daily, liveReserve: 0, perRunCap: 1, throttleBackoffMs: 60 * 60 * 1000 };
  const { budget, lock } = buildBudgetAndLock(FOOTBALLDATA_IO_PROVIDER_ID, config, process.env.FOOTBALLDATA_IO_EMERGENCY_DISABLED === '1');
  return new FootballIngestionService({
    providerId: FOOTBALLDATA_IO_PROVIDER_ID,
    competitions: [{ shortcuts: [FOOTBALLDATA_IO_WINDOW], season: 'current' }],
    adapter: new FootballDataIoAdapter(client),
    persistence: new FootballIngestionRepository(),
    lock,
    budget,
    scheduler: new AdaptiveScheduler(FOOTBALLDATA_IO_SCHEDULER),
    // One failure opens the circuit for an hour: never burn the monthly quota on retries.
    circuitFailureThreshold: 1,
    circuitOpenMs: 60 * 60 * 1000,
  });
}

/**
 * M07: football-data.org free plan = 10 requests/MINUTE, no daily cap documented
 * (probe 2026-11-09). One window request per tick covers every licensed competition.
 * The durable daily cap (300) is self-imposed politeness well below the minute limit;
 * the client spaces calls 6.5 s apart so ticks, tables and backfill never burst.
 */
export const FOOTBALL_DATA_ORG_DAILY_BUDGET = 300;
export const FOOTBALL_DATA_ORG_TABLE_BUDGET = 40;
export const FOOTBALL_DATA_ORG_SCHEDULER: typeof DEFAULT_SCHEDULER_CONFIG = {
  ...DEFAULT_SCHEDULER_CONFIG,
  futureMs: 4 * 60 * 60 * 1000,
  todayMs: 60 * 60 * 1000,
  approachingKickoffMs: 15 * 60 * 1000,
  liveMs: 3 * 60 * 1000,
  halftimeMs: 5 * 60 * 1000,
};

/** Null when no key is configured: the provider is simply not ingested. */
export function buildFootballDataOrgIngestionService(options: FootballIngestionFactoryOptions = {}): FootballIngestionService | null {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY?.trim();
  if (!apiKey) return null;
  const { FootballDataOrgClient, FootballDataOrgIngestionAdapter, FOOTBALL_DATA_ORG_PROVIDER_ID, FOOTBALL_DATA_ORG_WINDOW } = require(
    '@/infrastructure/sports/providers/footballDataOrg/FootballDataOrgIngestion'
  ) as typeof import('@/infrastructure/sports/providers/footballDataOrg/FootballDataOrgIngestion');
  const fetchImpl: FetchLike = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const client = new FootballDataOrgClient(fetchImpl, { apiKey, timeoutMs: Number(process.env.FOOTBALL_PROVIDER_TIMEOUT_MS) || 10_000 });
  const config = { dailyBudget: FOOTBALL_DATA_ORG_DAILY_BUDGET, liveReserve: 0, perRunCap: 1, throttleBackoffMs: 5 * 60 * 1000 };
  const { budget, lock } = buildBudgetAndLock(FOOTBALL_DATA_ORG_PROVIDER_ID, config, process.env.FOOTBALL_DATA_ORG_EMERGENCY_DISABLED === '1');
  return new FootballIngestionService({
    providerId: FOOTBALL_DATA_ORG_PROVIDER_ID,
    competitions: [{ shortcuts: [FOOTBALL_DATA_ORG_WINDOW], season: 'current' }],
    adapter: new FootballDataOrgIngestionAdapter(client),
    persistence: new FootballIngestionRepository(),
    lock,
    budget,
    scheduler: new AdaptiveScheduler(FOOTBALL_DATA_ORG_SCHEDULER),
    circuitFailureThreshold: 3,
    circuitOpenMs: 10 * 60 * 1000,
  });
}

/**
 * Durable (cluster-shared, fail-closed) quota and lock per provider; the
 * process-local pair only with FOOTBALL_DURABLE_QUOTA=0.
 */
export function buildBudgetAndLock(
  providerId: string,
  config: { dailyBudget: number; liveReserve: number; perRunCap: number; throttleBackoffMs: number },
  emergencyDisabled: boolean
): { budget: any; lock: any } {
  const { mongoose } = require('@/config/mongodb') as typeof import('@/config/mongodb');
  const connectionReady = mongoose?.connection?.readyState === 1 && Boolean(mongoose.connection.db);
  const durable = process.env.FOOTBALL_DURABLE_QUOTA !== '0';
  if (durable && !connectionReady) {
    throw new Error(
      'football ingestion: durable quota authority requires a ready MongoDB connection; ' +
        'refusing to start with a process-local budget (set FOOTBALL_DURABLE_QUOTA=0 only for ' +
        'a deliberately single-process deployment)'
    );
  }
  let budget: any;
  let lock: any;
  if (durable) {
    const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
    const { mongoose } = require('@/config/mongodb') as typeof import('@/config/mongodb');
    const { MongoDurableQuotaStore } = require(
      '@/infrastructure/sports/persistence/DurableQuotaStore'
    ) as typeof import('@/infrastructure/sports/persistence/DurableQuotaStore');
    const { DurableRequestBudget } = require(
      '@/application/sports/ingestion/RequestBudget'
    ) as typeof import('@/application/sports/ingestion/RequestBudget');
    const { MongoLock } = require(
      '@/application/sports/ingestion/Lock'
    ) as typeof import('@/application/sports/ingestion/Lock');
    const db = mongoose.connection.db;
    if (!db) throw new Error('football ingestion requires an open MongoDB connection');
    // Native driver collections: MongoLock reads the returned document directly.
    const store = new MongoDurableQuotaStore(
      db.collection('football_quota') as any,
      db.collection('football_ingestion_control') as any
    );
    budget = new DurableRequestBudget(config, store, providerId);
    lock = new MongoLock(db.collection('football_ingestion_locks') as any, `ingestion-${randomUUID()}`);
    if (emergencyDisabled) {
      // Durable disable so a restart cannot silently re-enable a stopped provider.
      void store.setDisabled(providerId, true);
    }
  } else {
    budget = new RequestBudget(config, { initiallyDisabled: emergencyDisabled });
    lock = new InMemoryLock();
  }
  return { budget, lock };
}
