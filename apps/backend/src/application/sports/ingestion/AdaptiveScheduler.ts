/**
 * Adaptive polling policy (pure, clock injected).
 *
 * Every bucket has a distinct, documented, configurable interval. The fastest
 * bucket (`live`) is 30 seconds — never a fixed 10s loop — and the actual poll
 * cadence is still bounded by the provider's remaining quota (see
 * `RequestBudget`) and the per-run cap. `future`/`historical` poll on the order
 * of hours; `completed` stops after the final full-time confirmation (0).
 *
 * Justification for each default (configurable via `AdaptiveSchedulerConfig`):
 *  - historical .................... 12h — long-gone matches barely change;
 *  - future ........................ 6h  — nothing changes between broadcasts;
 *  - today .......................... 30m — lineups/venues firm up through the day;
 *  - approaching_kickoff (<=2h) .... 5m  — team news right before kickoff;
 *  - live .......................... 30s — scores change fastest; quota-bounded;
 *  - halftime ...................... 2m  — halftime score is a single update;
 *  - completed ..................... 0   — stop (a final full-time confirmation is
 *                                            written the first time `finished` is seen);
 *  - standings ..................... 1h  — tables move slowly;
 *  - team_metadata ................. 24h — crests/names are near-static;
 *  - lineup_event_enrichment ....... 2h  — roster/event enrichment cadence.
 */

import { FootballMatchStatus } from '@/domain/sports/football/types';
import { IngestionBucket } from './types';

export interface AdaptiveSchedulerConfig {
  historicalMs: number;
  futureMs: number;
  todayMs: number;
  approachingKickoffMs: number;
  liveMs: number;
  halftimeMs: number;
  completedMs: number;
  standingsMs: number;
  teamMetadataMs: number;
  lineupEventEnrichmentMs: number;
  /** Kickoffs within this window before kickoff are "approaching". */
  approachingKickoffThresholdMs: number;
  /** A kickoff this far in the past (without a finished status) is "historical". */
  recentWindowMs: number;
}

export const DEFAULT_SCHEDULER_CONFIG: AdaptiveSchedulerConfig = {
  historicalMs: 12 * 60 * 60 * 1000,
  futureMs: 6 * 60 * 60 * 1000,
  todayMs: 30 * 60 * 1000,
  approachingKickoffMs: 5 * 60 * 1000,
  liveMs: 30 * 1000,
  halftimeMs: 2 * 60 * 1000,
  completedMs: 0,
  standingsMs: 60 * 60 * 1000,
  teamMetadataMs: 24 * 60 * 60 * 1000,
  lineupEventEnrichmentMs: 2 * 60 * 60 * 1000,
  approachingKickoffThresholdMs: 2 * 60 * 60 * 1000,
  recentWindowMs: 4 * 60 * 60 * 1000,
};

export interface MatchScheduleInput {
  kickoffAt: string;
  status: FootballMatchStatus;
}

const INTERVAL_KEY: Record<IngestionBucket, keyof AdaptiveSchedulerConfig> = {
  historical: 'historicalMs',
  future: 'futureMs',
  today: 'todayMs',
  approaching_kickoff: 'approachingKickoffMs',
  live: 'liveMs',
  halftime: 'halftimeMs',
  completed: 'completedMs',
  standings: 'standingsMs',
  team_metadata: 'teamMetadataMs',
  lineup_event_enrichment: 'lineupEventEnrichmentMs',
};

/**
 * Classifies a match into a polling bucket. Scheduling cadence is derived from
 * kickoff/status — that is a *polling* concern, not a data field. The live
 * minute is never derived here (or anywhere else).
 */
export function classifyBucket(
  input: MatchScheduleInput,
  nowMs: number,
  config: AdaptiveSchedulerConfig = DEFAULT_SCHEDULER_CONFIG
): IngestionBucket {
  if (input.status === 'live') return 'live';
  if (input.status === 'halftime') return 'halftime';
  if (
    input.status === 'finished' ||
    input.status === 'cancelled' ||
    input.status === 'postponed' ||
    input.status === 'suspended'
  ) {
    return 'completed';
  }

  const kickoffMs = Date.parse(input.kickoffAt);
  if (Number.isNaN(kickoffMs)) return 'future';

  const diff = kickoffMs - nowMs;
  if (diff < -config.recentWindowMs) return 'historical';
  if (diff > config.approachingKickoffThresholdMs) {
    return isSameUtcDay(kickoffMs, nowMs) ? 'today' : 'future';
  }
  // Within [0, threshold] ahead, or already kicked off (within the recent
  // window) but not yet marked finished: poll at the approaching cadence.
  return 'approaching_kickoff';
}

export function nextIntervalMs(
  bucket: IngestionBucket,
  config: AdaptiveSchedulerConfig = DEFAULT_SCHEDULER_CONFIG
): number {
  return config[INTERVAL_KEY[bucket]];
}

/** Most urgent interval across a set of matches; completed matches never drive polling. */
export function minimumIntervalMs(
  matches: MatchScheduleInput[],
  nowMs: number,
  config: AdaptiveSchedulerConfig = DEFAULT_SCHEDULER_CONFIG
): number {
  if (matches.length === 0) return config.futureMs;
  let min = Number.POSITIVE_INFINITY;
  for (const match of matches) {
    const interval = nextIntervalMs(classifyBucket(match, nowMs, config), config);
    if (interval <= 0) continue;
    if (interval < min) min = interval;
  }
  return Number.isFinite(min) ? min : config.futureMs;
}

function isSameUtcDay(aMs: number, bMs: number): boolean {
  return new Date(aMs).toISOString().slice(0, 10) === new Date(bMs).toISOString().slice(0, 10);
}

export class AdaptiveScheduler {
  constructor(
    private readonly config: AdaptiveSchedulerConfig = DEFAULT_SCHEDULER_CONFIG,
    private readonly clock: () => number = Date.now
  ) {}

  classify(match: MatchScheduleInput, now?: number): IngestionBucket {
    return classifyBucket(match, now ?? this.clock(), this.config);
  }

  intervalMs(bucket: IngestionBucket): number {
    return nextIntervalMs(bucket, this.config);
  }

  minimumIntervalMs(matches: MatchScheduleInput[], now?: number): number {
    return minimumIntervalMs(matches, now ?? this.clock(), this.config);
  }

  isDue(lastSyncAtMs: number | undefined, bucket: IngestionBucket, now?: number): boolean {
    const interval = nextIntervalMs(bucket, this.config);
    if (interval <= 0) return false;
    if (lastSyncAtMs == null) return true;
    return (now ?? this.clock()) - lastSyncAtMs >= interval;
  }
}
