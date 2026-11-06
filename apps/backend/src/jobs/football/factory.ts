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

export interface FootballIngestionFactoryOptions {
  fetch?: FetchLike;
}

export function buildFootballIngestionService(
  options: FootballIngestionFactoryOptions = {}
): FootballIngestionService {
  const fetchImpl: FetchLike = options.fetch ?? (globalThis.fetch as unknown as FetchLike);

  const client = new OpenLigaDbClient(fetchImpl, {
    userAgent: process.env.OPENLIGADB_USER_AGENT || 'guiatv-m05-ingestion/1.0',
    timeoutMs: Number(process.env.OPENLIGADB_TIMEOUT_MS) || 10_000,
  });
  const adapter = new OpenLigaDbAdapter(client);
  const repository = new FootballIngestionRepository();
  const lock = new InMemoryLock();
  const scheduler = new AdaptiveScheduler(DEFAULT_SCHEDULER_CONFIG);
  const budget = new RequestBudget(
    {
      dailyBudget: Number(process.env.OPENLIGADB_DAILY_BUDGET) || 1500,
      liveReserve: Number(process.env.OPENLIGADB_LIVE_RESERVE) || 300,
      perRunCap: Number(process.env.OPENLIGADB_PER_RUN_CAP) || 5,
      throttleBackoffMs: Number(process.env.OPENLIGADB_THROTTLE_BACKOFF_MS) || 60_000,
    },
    { initiallyDisabled: process.env.OPENLIGADB_EMERGENCY_DISABLED === '1' }
  );

  return new FootballIngestionService({
    providerId: 'openligadb',
    leagueShortcut: process.env.OPENLIGADB_LEAGUE || 'bl1',
    season: process.env.OPENLIGADB_SEASON || '2026',
    adapter,
    persistence: repository,
    lock,
    budget,
    scheduler,
  });
}
