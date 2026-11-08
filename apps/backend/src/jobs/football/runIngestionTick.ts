/**
 * Football ingestion job entry: runs one lock-guarded, idempotent ingestion
 * tick. No cron registration lives here — the caller (cron/CLI/captain) decides
 * the cadence from the scheduler's `nextPollIntervalMs`, bounded by quota.
 */

import { TickResult } from '@/application/sports/ingestion/types';

export interface IngestionTickRunner {
  runTick(): Promise<TickResult>;
}

export async function runFootballIngestionTick(service: IngestionTickRunner): Promise<TickResult> {
  return service.runTick();
}
