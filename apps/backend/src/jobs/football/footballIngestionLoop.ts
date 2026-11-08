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

import { getFootballIngestionService, isFootballIngestionEnabled } from '../../application/sports/ingestion/footballIngestionContainer';

export interface FootballIngestionLoop {
  /** Runs one tick now (also exposed to the job registry as a manual run). */
  runOnce: () => Promise<unknown>;
  /** Stops the loop and clears any pending timer. */
  stop: () => void;
}

const MIN_INTERVAL_MS = 15_000;
const MAX_INTERVAL_MS = 6 * 60 * 60 * 1000;
const ERROR_RETRY_MS = 5 * 60 * 1000;

export function startFootballIngestionLoop(options: { runOnStart?: boolean } = {}): FootballIngestionLoop {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const runOnce = async (): Promise<unknown> => {
    const service = await getFootballIngestionService();
    if (!service) return { outcome: 'disabled' as const };
    return service.runTick();
  };

  const scheduleNext = (delayMs: number) => {
    if (stopped) return;
    const bounded = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.floor(delayMs)));
    timer = setTimeout(() => void tick(), bounded);
    timer.unref?.();
  };

  const tick = async () => {
    if (stopped) return;
    try {
      const result = (await runOnce()) as { outcome?: string; nextPollIntervalMs?: number };
      // A tick the budget refused or that failed still re-arms, but never below the clamp.
      scheduleNext(result?.nextPollIntervalMs ?? ERROR_RETRY_MS);
    } catch (error) {
      console.error('[FootballIngestion] tick failed; will retry', error);
      scheduleNext(ERROR_RETRY_MS);
    }
  };

  if (!isFootballIngestionEnabled()) {
    console.log('[FootballIngestion] disabled by FOOTBALL_INGESTION_ENABLED=0');
  } else if (options.runOnStart) {
    timer = setTimeout(() => void tick(), MIN_INTERVAL_MS);
    timer.unref?.();
  }

  return {
    runOnce,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
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
