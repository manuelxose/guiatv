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
