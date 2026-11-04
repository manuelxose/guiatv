import { performance } from 'node:perf_hooks';
import { pushBounded, round1 } from './diagnosticsCommon';

/**
 * M13-B3a: a bounded registry of the HTTP requests that are in flight, so an event-loop stall can be listed next to the
 * requests that overlapped it.
 *
 * What it is: a CORRELATION source. A request being in flight (or completing) during a stall does not prove it caused
 * the stall: a stalled loop delays every request that happens to be open. The registry only narrows the candidates.
 *
 * Privacy: an entry keeps the HTTP method (from a fixed list) and a route LABEL. The label is either a trusted Express
 * route template (`req.baseUrl + req.route.path`, string paths only, character-whitelisted and length-capped) or one of
 * the fixed classifications below. It never keeps the URL, query string, headers, cookies, IP, body or user id.
 *
 * Bounds: at most `maxActive` tracked entries (when full the OLDEST are kept and newcomers are only counted in `evicted`),
 * `maxRecent` completed ones, at most `maxReported` entries per snapshot, and at most `MAX_LABELS` distinct labels for the
 * whole process life. `req.baseUrl` is the RESOLVED mount path, so every `app.use`/`router.use` mount must be static (no
 * `:param`); a test scans the route files for that.
 */
export const UNRESOLVED_ROUTE = '(unresolved)'; // no Express route matched yet (the request is still in earlier middleware)
export const UNMATCHED_ROUTE = '(unmatched)'; // finished without ever matching a route (static files, 404)
export const OTHER_ROUTE = '(other)'; // label rejected by the whitelist or beyond the label cap

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const SAFE_LABEL = /^[A-Za-z0-9/_\-.:*()?+]{1,120}$/;
// Express route definitions (the v2 router is mounted at '/' and '/v2'): ~230 templates today, so 1 024 leaves ample room.
export const MAX_LABELS = 1024;

/** The only parts of an Express request the registry reads. */
export interface RouteSource {
  method?: unknown;
  baseUrl?: unknown;
  route?: { path?: unknown } | null;
}

export interface InFlightEntry {
  method: string;
  route: string;
  ageMs: number;
}

export interface CompletedEntry {
  method: string;
  route: string;
  durationMs: number;
  aborted: boolean;
}

export interface RequestOverlap {
  /** Every request in flight, including any beyond the tracked bound. */
  activeCount: number;
  /** Oldest first, at most `maxReported`. */
  inFlight: InFlightEntry[];
  /** Finished inside the stall interval, longest first, at most `maxReported`. */
  completed: CompletedEntry[];
  /** In-flight plus completed entries that matched but were not listed. */
  omitted: number;
  /** In-flight requests grouped by method+route (all tracked ones), busiest first, at most `maxReported`. */
  byRoute: Array<{ method: string; route: string; count: number; oldestAgeMs: number }>;
}

interface Entry {
  method: string;
  startMs: number;
  req: RouteSource;
}

interface Finished {
  method: string;
  route: string;
  startMs: number;
  endMs: number;
  aborted: boolean;
}

export interface InflightRegistryOptions {
  now?: () => number;
  maxActive?: number;
  maxRecent?: number;
  maxReported?: number;
}

export class InflightRequestRegistry {
  private readonly now: () => number;
  private readonly maxActive: number;
  private readonly maxRecent: number;
  private readonly maxReported: number;
  private readonly active = new Map<number, Entry>();
  private readonly recent: Finished[] = [];
  private readonly labels = new Set<string>();
  private seq = 0;
  private activeTotal = 0;
  private peakActive = 0;
  private evicted = 0;
  private started = 0;

  constructor(options: InflightRegistryOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.maxActive = options.maxActive ?? 256;
    this.maxRecent = options.maxRecent ?? 128;
    this.maxReported = options.maxReported ?? 8;
  }

  /** Registers a request; the returned function must be called once when it ends (repeat calls are ignored). Never throws. */
  begin(req: RouteSource): (aborted?: boolean) => void {
    const id = ++this.seq;
    let closed = false;
    let entry: Entry | undefined;
    try {
      entry = { method: safeMethod(req.method), startMs: this.now(), req };
      this.started += 1;
      this.activeTotal += 1;
      if (this.activeTotal > this.peakActive) this.peakActive = this.activeTotal;
      // Full: keep the OLDEST entries (the likeliest stall suspects) and leave the newcomer untracked; it is still counted
      // in activeCount and still reaches the completed ring when it ends.
      if (this.active.size >= this.maxActive) this.evicted += 1;
      else this.active.set(id, entry);
    } catch {
      entry = undefined;
    }
    return (aborted = false) => {
      if (closed) return;
      closed = true;
      try {
        this.active.delete(id);
        this.activeTotal = Math.max(0, this.activeTotal - 1);
        if (!entry) return;
        pushBounded(
          this.recent,
          { method: entry.method, route: this.routeOf(entry.req, true), startMs: entry.startMs, endMs: this.now(), aborted },
          this.maxRecent
        );
      } catch {
        // Diagnostics must never affect the request they observe.
      }
    };
  }

  /** The requests that overlap [fromMs, toMs] (same clock as `now`). Read-only; never throws. */
  overlap(fromMs: number, toMs: number): RequestOverlap {
    const empty: RequestOverlap = { activeCount: this.activeTotal, inFlight: [], completed: [], omitted: 0, byRoute: [] };
    try {
      const inFlight: InFlightEntry[] = [];
      const groups = new Map<string, { method: string; route: string; count: number; oldestAgeMs: number }>();
      for (const e of this.active.values()) {
        if (e.startMs > toMs) continue; // registered after the interval ended
        const route = this.routeOf(e.req, false);
        const ageMs = round1(Math.max(toMs - e.startMs, 0));
        inFlight.push({ method: e.method, route, ageMs });
        const key = `${e.method} ${route}`;
        const g = groups.get(key);
        if (g) {
          g.count += 1;
          if (ageMs > g.oldestAgeMs) g.oldestAgeMs = ageMs;
        } else groups.set(key, { method: e.method, route, count: 1, oldestAgeMs: ageMs });
      }
      inFlight.sort((a, b) => b.ageMs - a.ageMs);
      const completed: CompletedEntry[] = [];
      for (const r of this.recent) {
        if (r.endMs < fromMs || r.startMs > toMs) continue;
        completed.push({ method: r.method, route: r.route, durationMs: round1(r.endMs - r.startMs), aborted: r.aborted });
      }
      completed.sort((a, b) => b.durationMs - a.durationMs);
      return {
        activeCount: this.activeTotal,
        inFlight: inFlight.slice(0, this.maxReported),
        completed: completed.slice(0, this.maxReported),
        omitted: Math.max(inFlight.length - this.maxReported, 0) + Math.max(completed.length - this.maxReported, 0),
        byRoute: Array.from(groups.values())
          .sort((a, b) => b.count - a.count || b.oldestAgeMs - a.oldestAgeMs)
          .slice(0, this.maxReported),
      };
    } catch {
      return empty;
    }
  }

  /** Cheap process-level counters for the public metrics snapshot. */
  stats(): { active: number; tracked: number; peakActive: number; started: number; evicted: number; labels: number } {
    return {
      active: this.activeTotal,
      tracked: this.active.size,
      peakActive: this.peakActive,
      started: this.started,
      evicted: this.evicted,
      labels: this.labels.size,
    };
  }

  /** Tests only. */
  reset(): void {
    this.active.clear();
    this.recent.length = 0;
    this.labels.clear();
    this.activeTotal = this.peakActive = this.evicted = this.started = this.seq = 0;
  }

  private routeOf(req: RouteSource, finished: boolean): string {
    try {
      const path = req.route?.path;
      if (typeof path !== 'string') return finished ? UNMATCHED_ROUTE : UNRESOLVED_ROUTE;
      const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
      return this.label(`${base}${path}`);
    } catch {
      return finished ? UNMATCHED_ROUTE : UNRESOLVED_ROUTE;
    }
  }

  private label(candidate: string): string {
    if (!SAFE_LABEL.test(candidate)) return OTHER_ROUTE;
    if (this.labels.has(candidate)) return candidate;
    if (this.labels.size >= MAX_LABELS) return OTHER_ROUTE;
    this.labels.add(candidate);
    return candidate;
  }
}

function safeMethod(method: unknown): string {
  return typeof method === 'string' && METHODS.has(method) ? method : 'OTHER';
}

/** The process-wide registry used by the Express middleware and the stall detector. */
export const inflightRequests = new InflightRequestRegistry();
