/**
 * M05 football ingestion job registration (captain wiring).
 *
 * The tick itself is scheduled adaptively: the ingestion service reports how long to
 * wait (`nextPollIntervalMs`, derived by the AdaptiveScheduler from each match's
 * bucket and bounded by the provider's remaining budget), and this module re-arms a
 * single `setTimeout` for exactly that long. There is no fixed polling cycle here, so
 * the loop cannot drift into a 10 s hammer that exhausts the free quota.
 *
 * Minimum/maximum clamps protect against a buggy or zero interval.
 */

import { getFootballIngestionServices, isFootballIngestionEnabled } from '../../application/sports/ingestion/footballIngestionContainer';
import type { FootballIngestionService } from '../../application/sports/ingestion/FootballIngestionService';

export interface FootballIngestionLoop {
  /** Runs one tick now (also exposed to the job registry as a manual run). */
  runOnce: () => Promise<unknown>;
  /** Stops the loop and clears any pending timer. */
  stop: () => void;
}

const MIN_INTERVAL_MS = 15_000;
const MAX_INTERVAL_MS = 6 * 60 * 60 * 1000;
const ERROR_RETRY_MS = 5 * 60 * 1000;

/** Provider tables change at most once per matchday: refresh every 6 h (OpenLigaDB is unmetered). */
const TABLES_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function startFootballIngestionLoop(options: { runOnStart?: boolean } = {}): FootballIngestionLoop {
  // M07: one independent timer per provider, each paced by its own scheduler and quota.
  const timers = new Map<string, NodeJS.Timeout>();
  let stopped = false;
  let lastTablesAt = 0;

  const runOnce = async (): Promise<unknown> => {
    const services = await getFootballIngestionServices();
    if (!services.length) return { outcome: 'disabled' as const };
    const results = [];
    for (const service of services) results.push({ provider: service.providerId, ...(await service.runTick()) });
    return results.length === 1 ? results[0] : results;
  };

  const arm = (id: string, delayMs: number, run: () => Promise<void>) => {
    if (stopped) return;
    const bounded = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.floor(delayMs)));
    const timer = setTimeout(() => void run(), bounded);
    timer.unref?.();
    timers.set(id, timer);
  };

  const tickProvider = (service: FootballIngestionService) => async () => {
    if (stopped) return;
    try {
      const result = (await service.runTick()) as { outcome?: string; nextPollIntervalMs?: number };
      // A tick the budget refused or that failed still re-arms, but never below the clamp.
      arm(service.providerId, result?.nextPollIntervalMs ?? ERROR_RETRY_MS, tickProvider(service));
    } catch (error) {
      console.error(`[FootballIngestion] ${service.providerId} tick failed; will retry`, error);
      arm(service.providerId, ERROR_RETRY_MS, tickProvider(service));
    }
    if (Date.now() - lastTablesAt >= TABLES_INTERVAL_MS) {
      lastTablesAt = Date.now();
      // Best effort and budgeted: a table failure never touches the match tick.
      void refreshStandingsTables().catch(() => undefined);
      void refreshFootballDataIoTables().catch(() => undefined);
      void refreshFootballDataOrgTables().catch(() => undefined);
    }
  };

  const start = async () => {
    const services = await getFootballIngestionServices();
    for (const service of services) arm(service.providerId, MIN_INTERVAL_MS, tickProvider(service));
  };

  if (!isFootballIngestionEnabled()) {
    console.log('[FootballIngestion] disabled by FOOTBALL_INGESTION_ENABLED=0');
  } else if (options.runOnStart) {
    const boot = setTimeout(() => void start().catch((e) => console.error('[FootballIngestion] start failed', e)), MIN_INTERVAL_MS);
    boot.unref?.();
    timers.set('boot', boot);
  }

  return {
    runOnce,
    stop: () => {
      stopped = true;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}

/** Client + a durable budget under its own quota key; null without a key or a ready Mongo. */
async function footballDataIoContext(budgetKey: string, dailyBudget: number) {
  const apiKey = process.env.FOOTBALLDATA_IO_API_KEY?.trim();
  if (!apiKey) return null;
  const mongoose = await import('mongoose');
  const db = mongoose.default.connection.db;
  if (mongoose.default.connection.readyState !== 1 || !db) return null;
  const { FootballDataIoClient } = await import('../../infrastructure/sports/providers/footballDataIo/FootballDataIoClient');
  const { MongoDurableQuotaStore } = await import('../../infrastructure/sports/persistence/DurableQuotaStore');
  const { DurableRequestBudget } = await import('../../application/sports/ingestion/RequestBudget');
  const store = new MongoDurableQuotaStore(db.collection('football_quota') as any, db.collection('football_ingestion_control') as any);
  const budget = new DurableRequestBudget({ dailyBudget, liveReserve: 0, perRunCap: dailyBudget, throttleBackoffMs: 60 * 60 * 1000 }, store, budgetKey);
  await budget.beginRun(Date.now());
  return { client: new FootballDataIoClient(globalThis.fetch as never, { apiKey }), budget };
}

/** Pages of /fixtures/results stored as footballdata.io snapshots (they carry statistics). */
async function ingestFootballDataIoResults(
  ctx: NonNullable<Awaited<ReturnType<typeof footballDataIoContext>>>,
  from: string,
  to: string
): Promise<{ requests: number; written: number; complete: boolean }> {
  const { parseMatchPage, FOOTBALLDATA_IO_PROVIDER_ID } = await import('../../infrastructure/sports/providers/footballDataIo/FootballDataIoAdapter');
  const { buildSnapshots } = await import('../../application/sports/ingestion/snapshots');
  const { FootballIngestionRepository } = await import('../../infrastructure/sports/persistence/FootballIngestionRepository');
  const repository = new FootballIngestionRepository();
  let requests = 0;
  let written = 0;
  for (let page = 1, total = 1; page <= total; page += 1) {
    if (!(await ctx.budget.tryAcquire('normal', Date.now()))) return { requests, written, complete: false }; // fail closed
    requests += 1;
    const parsed = parseMatchPage(await ctx.client.getResults(from, to, page), new Date());
    total = parsed.totalPages;
    written += await repository.upsertSnapshots(buildSnapshots(parsed.matches, FOOTBALLDATA_IO_PROVIDER_ID, new Date().toISOString()).snapshots);
  }
  return { requests, written, complete: true };
}

/**
 * M07: once a day (separate durable key, FOOTBALLDATA_IO_DAILY_TABLE_BUDGET = 3):
 * the last two days of results WITH statistics (1 request) and the provider's own
 * tables for La Liga and Premier League (2 requests). Never eats the match-window quota.
 */
export async function refreshFootballDataIoTables(): Promise<void> {
  const { FOOTBALLDATA_IO_DAILY_TABLE_BUDGET } = await import('./factory');
  const ctx = await footballDataIoContext('footballdata-io:daily', FOOTBALLDATA_IO_DAILY_TABLE_BUDGET);
  if (!ctx) return;
  const { mapFootballDataIoStandings, footballDataIoDayKey, FOOTBALLDATA_IO_LEAGUES, FOOTBALLDATA_IO_TABLE_LEAGUES, FOOTBALLDATA_IO_PROVIDER_ID } = await import(
    '../../infrastructure/sports/providers/footballDataIo/FootballDataIoAdapter'
  );
  const { FootballStandingsTableModel } = await import('../../infrastructure/sports/persistence/models');
  const now = Date.now();
  try {
    // shortcut: a single page (100 results) covers two days of 5 leagues.
    if (await ctx.budget.tryAcquire('normal', now)) {
      const { parseMatchPage } = await import('../../infrastructure/sports/providers/footballDataIo/FootballDataIoAdapter');
      const { buildSnapshots } = await import('../../application/sports/ingestion/snapshots');
      const { FootballIngestionRepository } = await import('../../infrastructure/sports/persistence/FootballIngestionRepository');
      const parsed = parseMatchPage(await ctx.client.getResults(footballDataIoDayKey(now - 2 * 86_400_000), footballDataIoDayKey(now)), new Date());
      await new FootballIngestionRepository().upsertSnapshots(buildSnapshots(parsed.matches, FOOTBALLDATA_IO_PROVIDER_ID, new Date().toISOString()).snapshots);
    }
  } catch {
    // Best effort: never retry (monthly quota).
  }
  for (const leagueId of FOOTBALLDATA_IO_TABLE_LEAGUES) {
    if (!(await ctx.budget.tryAcquire('normal', Date.now()))) return; // fail closed: quota spent today
    try {
      const rows = mapFootballDataIoStandings(await ctx.client.getStandings(leagueId));
      if (!rows.length) continue;
      await FootballStandingsTableModel.updateOne(
        { competitionSlug: FOOTBALLDATA_IO_LEAGUES[String(leagueId)], providerId: FOOTBALLDATA_IO_PROVIDER_ID, season: 'current' },
        { $set: { rows, fetchedAt: new Date() } },
        { upsert: true }
      ).exec();
    } catch {
      // Best effort: keep the last good table; never retry (monthly quota).
    }
  }
}

/**
 * M07 one-off: season results the community provider is missing (CLI only, never
 * scheduled). Capped by its own durable daily key (FOOTBALLDATA_IO_BACKFILL_BUDGET).
 */
export async function backfillFootballDataIoResults(from: string, to: string): Promise<{ requests: number; written: number; complete: boolean } | null> {
  const { FOOTBALLDATA_IO_BACKFILL_BUDGET } = await import('./factory');
  const ctx = await footballDataIoContext('footballdata-io:backfill', FOOTBALLDATA_IO_BACKFILL_BUDGET);
  return ctx ? ingestFootballDataIoResults(ctx, from, to) : null;
}

/**
 * F27: fetch and store the provider's OWN league table for every planned
 * competition. Best effort: a table failure must never fail the ingestion tick,
 * and a competition without a table simply keeps the derived fallback.
 */
export async function refreshStandingsTables(): Promise<void> {
  const mongoose = await import('mongoose');
  if (mongoose.default.connection.readyState !== 1) return;
  const { OpenLigaDbClient } = await import('../../infrastructure/sports/providers/openLigaDb/OpenLigaDbClient');
  const { mapBlTable } = await import('../../infrastructure/sports/providers/openLigaDb/OpenLigaDbAdapter');
  const { FootballStandingsTableModel } = await import('../../infrastructure/sports/persistence/models');
  const { M06_OPENLIGADB_COMPETITIONS } = await import('./factory');
  const { resolveCompetitionSlug } = await import('../../infrastructure/sports/providers/openLigaDb/OpenLigaDbAdapter');
  const client = new OpenLigaDbClient(globalThis.fetch as never, {
    userAgent: process.env.OPENLIGADB_USER_AGENT || 'guiatv-m06-ingestion/1.0',
    timeoutMs: Number(process.env.OPENLIGADB_TIMEOUT_MS) || 10_000,
  });
  for (const entry of M06_OPENLIGADB_COMPETITIONS) {
    for (const shortcut of entry.shortcuts) {
      const slug = resolveCompetitionSlug(shortcut);
      if (!slug) continue;
      try {
        const raw = await client.getTable(shortcut, entry.season);
        const rows = mapBlTable(raw);
        if (!rows.length) continue;
        await FootballStandingsTableModel.updateOne(
          { competitionSlug: slug, providerId: 'openligadb', season: entry.season },
          { $set: { rows, fetchedAt: new Date() } },
          { upsert: true }
        ).exec();
      } catch {
        // Best effort: keep the last good table.
      }
    }
  }
}

/** football-data.org client + its own durable budget; null without a key or a ready Mongo. */
async function footballDataOrgContext(budgetKey: string, dailyBudget: number) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY?.trim();
  if (!apiKey) return null;
  const mongoose = await import('mongoose');
  const db = mongoose.default.connection.db;
  if (mongoose.default.connection.readyState !== 1 || !db) return null;
  const { FootballDataOrgClient } = await import('../../infrastructure/sports/providers/footballDataOrg/FootballDataOrgIngestion');
  const { MongoDurableQuotaStore } = await import('../../infrastructure/sports/persistence/DurableQuotaStore');
  const { DurableRequestBudget } = await import('../../application/sports/ingestion/RequestBudget');
  const store = new MongoDurableQuotaStore(db.collection('football_quota') as any, db.collection('football_ingestion_control') as any);
  const budget = new DurableRequestBudget({ dailyBudget, liveReserve: 0, perRunCap: dailyBudget, throttleBackoffMs: 5 * 60 * 1000 }, store, budgetKey);
  await budget.beginRun(Date.now());
  return { client: new FootballDataOrgClient(globalThis.fetch as never, { apiKey }), budget };
}

/**
 * M07: football-data.org OFFICIAL tables (Serie A, Ligue 1, Eredivisie, Primeira, Championship,
 * Brasileirão, plus LaLiga/Premier/Bundesliga/UCL as a second opinion). The read side serves the
 * table with the most matches counted, so the most up-to-date provider wins.
 */
export async function refreshFootballDataOrgTables(): Promise<void> {
  const { FOOTBALL_DATA_ORG_TABLE_BUDGET } = await import('./factory');
  const ctx = await footballDataOrgContext('football-data-org:tables', FOOTBALL_DATA_ORG_TABLE_BUDGET);
  if (!ctx) return;
  const { FOOTBALL_DATA_ORG_TABLES, FOOTBALL_DATA_ORG_COMPETITIONS, FOOTBALL_DATA_ORG_PROVIDER_ID, parseFootballDataOrgStandings, retryOnRateLimit } = await import(
    '../../infrastructure/sports/providers/footballDataOrg/FootballDataOrgIngestion'
  );
  const { FootballStandingsTableModel } = await import('../../infrastructure/sports/persistence/models');
  for (const code of FOOTBALL_DATA_ORG_TABLES) {
    if (!(await ctx.budget.tryAcquire('normal', Date.now()))) return; // fail closed
    try {
      const rows = parseFootballDataOrgStandings(await retryOnRateLimit(() => ctx.client.getStandings(code)));
      if (!rows.length) continue;
      await FootballStandingsTableModel.updateOne(
        { competitionSlug: FOOTBALL_DATA_ORG_COMPETITIONS[code], providerId: FOOTBALL_DATA_ORG_PROVIDER_ID, season: 'current' },
        { $set: { rows, fetchedAt: new Date() } },
        { upsert: true }
      ).exec();
    } catch {
      // Best effort: keep the last good table.
    }
  }
}

/**
 * M07 one-off (CLI): the whole current season of each football-data.org competition.
 * A rate limit waits for the minute window and retries once; anything still failing is
 * REPORTED in `failed` (never silently skipped) so the operator can re-run.
 */
export async function backfillFootballDataOrgSeasons(): Promise<{ requests: number; written: number; failed: string[] } | null> {
  const ctx = await footballDataOrgContext('football-data-org:backfill', 20);
  if (!ctx) return null;
  const { FOOTBALL_DATA_ORG_COMPETITIONS, FOOTBALL_DATA_ORG_PROVIDER_ID, parseFootballDataOrgMatches, retryOnRateLimit } = await import(
    '../../infrastructure/sports/providers/footballDataOrg/FootballDataOrgIngestion'
  );
  const { buildSnapshots } = await import('../../application/sports/ingestion/snapshots');
  const { FootballIngestionRepository } = await import('../../infrastructure/sports/persistence/FootballIngestionRepository');
  const repository = new FootballIngestionRepository();
  let requests = 0;
  let written = 0;
  const failed: string[] = [];
  for (const code of Object.keys(FOOTBALL_DATA_ORG_COMPETITIONS)) {
    if (!(await ctx.budget.tryAcquire('normal', Date.now()))) {
      failed.push(`${code}:budget`);
      continue;
    }
    requests += 1;
    try {
      const matches = parseFootballDataOrgMatches(await retryOnRateLimit(() => ctx.client.getSeasonMatches(code)));
      written += await repository.upsertSnapshots(buildSnapshots(matches, FOOTBALL_DATA_ORG_PROVIDER_ID, new Date().toISOString()).snapshots);
    } catch (error) {
      // One competition failing never blocks the others, but it is reported.
      failed.push(`${code}:${(error as { kind?: string })?.kind ?? 'error'}`);
    }
  }
  return { requests, written, failed };
}
