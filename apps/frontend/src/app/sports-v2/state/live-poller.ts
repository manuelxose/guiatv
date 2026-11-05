import { Match } from '../domain/models';

/** Adaptive cadence. The provider's free tier is rate-limited and not push-based, so this is polling, not real time. */
export const LIVE_INTERVAL_MS = 30_000;
export const IDLE_INTERVAL_MS = 5 * 60_000;
export const MAX_BACKOFF_MS = 5 * 60_000;
export const MAX_FAILURES = 5;
const KICKOFF_WINDOW_MS = 20 * 60_000;
const SOON_MS = 3 * 60 * 60_000;

/**
 * How long to wait before the next poll, or null for "do not poll".
 * - a match is live or about to start / just started -> 30 s
 * - otherwise a match is due within 3 h -> 5 min
 * - otherwise nothing to watch -> stop
 * Failures double the wait up to 5 min; after MAX_FAILURES the loop stops until something pokes it.
 */
export function nextPollDelay(matches: readonly Match[], nowMs: number, failures = 0): number | null {
  if (failures >= MAX_FAILURES) return null;
  let base: number | null = null;
  for (const m of matches) {
    const k = Date.parse(m.kickoff);
    if (m.status === 'live') return backoff(LIVE_INTERVAL_MS, failures);
    if (m.status !== 'scheduled' || Number.isNaN(k)) continue;
    if (Math.abs(k - nowMs) <= KICKOFF_WINDOW_MS) return backoff(LIVE_INTERVAL_MS, failures);
    if (k > nowMs && k - nowMs <= SOON_MS) base = IDLE_INTERVAL_MS;
  }
  return base === null ? null : backoff(base, failures);
}

const backoff = (base: number, failures: number): number => Math.min(base * 2 ** failures, MAX_BACKOFF_MS);

export interface PollerDeps {
  delay: (failures: number) => number | null;
  poll: () => Promise<void>;
  onFailure: (failures: number) => void;
  /** Called when the tab becomes visible again, before the catch-up poll. */
  onResume?: () => void;
}

/**
 * One timer, one in-flight request, paused while the tab is hidden, stopped after repeated failures.
 * Browser only: the caller constructs it after hydration. `stop()` releases the timer and the listener.
 */
export class LivePoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private failures = 0;
  private lastRun = 0;
  private stopped = true;
  private readonly onVisibility = () => {
    if (this.doc.hidden) this.clear();
    else {
      this.deps.onResume?.();
      this.poke();
    }
  };

  constructor(private readonly deps: PollerDeps, private readonly doc: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>, private readonly clock: () => number = Date.now) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.doc.addEventListener('visibilitychange', this.onVisibility);
    if (!this.doc.hidden) this.schedule();
  }

  stop(): void {
    this.stopped = true;
    this.clear();
    this.doc.removeEventListener('visibilitychange', this.onVisibility);
  }

  /** Poll now (manual refresh, tab resumed, or a recovery attempt). Coalesced: ignored within 5 s of the last run. */
  poke(): void {
    if (this.stopped || this.running || this.doc.hidden) return;
    if (this.clock() - this.lastRun < 5_000) return this.schedule();
    this.failures = 0;
    void this.run();
  }

  /** Data changed (first load, a lazy fetch): start the cadence if nothing is pending. Never postpones a pending timer. */
  reschedule(): void {
    if (!this.stopped && !this.running && !this.doc.hidden && !this.timer) this.schedule();
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.clear();
    const d = this.deps.delay(this.failures);
    if (d !== null && !this.stopped) this.timer = setTimeout(() => void this.run(), d);
  }

  private async run(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    this.clear();
    try {
      await this.deps.poll();
      this.failures = 0;
    } catch {
      this.failures++;
      this.deps.onFailure(this.failures);
    } finally {
      this.running = false;
      this.lastRun = this.clock();
      if (!this.doc.hidden) this.schedule();
    }
  }
}
