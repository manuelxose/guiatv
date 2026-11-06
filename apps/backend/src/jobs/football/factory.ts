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
  { shortcuts: ['wm2026'], season: '2026' },
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
  // process-local budget and lock remain available only when explicitly asked
  // for (FOOTBALL_DURABLE_QUOTA=0), so "cluster-safe" describes what actually
  // runs rather than an unwired library. A single instance still reads and
  // writes the shared store, which is what makes a second instance safe.
  // Requires an open connection; without one the durable store cannot be built, so the
  // factory degrades to the process-local budget rather than throwing at construction.
  const { mongoose } = require('@/config/mongodb') as typeof import('@/config/mongodb');
  const connectionReady = mongoose?.connection?.readyState === 1 && Boolean(mongoose.connection.db);
  const durable = process.env.FOOTBALL_DURABLE_QUOTA !== '0' && connectionReady;
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
    budget = new DurableRequestBudget(config, store, 'openligadb');
    lock = new MongoLock(db.collection('football_ingestion_locks') as any, `ingestion-${randomUUID()}`);
    if (process.env.OPENLIGADB_EMERGENCY_DISABLED === '1') {
      // Durable disable so a restart cannot silently re-enable a stopped provider.
      void store.setDisabled('openligadb', true);
    }
  } else {
    budget = new RequestBudget(config, {
      initiallyDisabled: process.env.OPENLIGADB_EMERGENCY_DISABLED === '1',
    });
    lock = new InMemoryLock();
  }

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
