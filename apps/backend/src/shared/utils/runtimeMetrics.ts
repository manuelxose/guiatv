import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { catalogueDiagnosticsSnapshot } from './catalogueDiagnostics';
import { eventLoopDiagnosticsSnapshot } from './eventLoopDiagnostics';
import { inflightRequests } from './inflightRequests';
import { stepTimelineSnapshot } from './stepTimeline';

const MAX_SAMPLES = 2_000;
// Per-route sample cap is smaller than the global cap: with dozens of routes
// a global-sized buffer per route would multiply memory for little benefit —
// P50/P95/P99 over the last 500 requests per endpoint is plenty stable.
const MAX_ROUTE_SAMPLES = 500;
// Bounded by the number of distinct Express route definitions (req.route.path
// is the templated path, e.g. "/catalog/:catalogId" — not the raw URL), so
// this map's key cardinality does not grow with traffic or user input.
const MAX_TRACKED_ROUTES = 200;
const requestDurations: number[] = [];
const mongoDurations: number[] = [];
const providerDurations: number[] = [];
const cacheDurations: number[] = [];
const epgDurations: number[] = [];
const routeDurations = new Map<string, number[]>();
const routeCounts = new Map<string, number>();
const routeErrors = new Map<string, number>();
let requestCount = 0;
let serverErrors = 0;
let responseBytes = 0;
let cacheHits = 0;
let cacheMisses = 0;
let cacheErrors = 0;
let cacheConnected = false;
let cacheMemoryBytes = 0;
let cacheEvictions = 0;
// Monotonic counters — never trimmed, unlike the rolling latency sample
// arrays — so "requests since process start" stays exact even under
// sustained high traffic instead of only reflecting the last MAX_SAMPLES.
let providerRequestCount = 0;
let mongoRequestCount = 0;
const startedAt = Date.now();
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();

export function recordRequestMetric(input: {
  durationMs: number;
  statusCode: number;
  responseBytes?: number;
  route?: string;
  timings?: Record<string, number>;
}): void {
  requestCount += 1;
  if (input.statusCode >= 500) serverErrors += 1;
  responseBytes += Math.max(input.responseBytes || 0, 0);
  push(requestDurations, input.durationMs);
  if (input.timings?.db != null) {
    push(mongoDurations, input.timings.db);
    mongoRequestCount += 1;
  }
  if (input.timings?.provider != null) {
    push(providerDurations, input.timings.provider);
    providerRequestCount += 1;
  }
  if (input.timings?.cache != null) push(cacheDurations, input.timings.cache);
  if (input.timings?.epg != null) push(epgDurations, input.timings.epg);

  if (input.route) {
    recordRouteMetric(input.route, input.durationMs, input.statusCode);
  }
}

function recordRouteMetric(route: string, durationMs: number, statusCode: number): void {
  let samples = routeDurations.get(route);
  if (!samples) {
    if (routeDurations.size >= MAX_TRACKED_ROUTES) return;
    samples = [];
    routeDurations.set(route, samples);
  }
  push(samples, durationMs, MAX_ROUTE_SAMPLES);
  routeCounts.set(route, (routeCounts.get(route) || 0) + 1);
  if (statusCode >= 500) {
    routeErrors.set(route, (routeErrors.get(route) || 0) + 1);
  }
}

export function recordCacheLookup(hit: boolean, durationMs: number): void {
  if (hit) cacheHits += 1;
  else cacheMisses += 1;
  push(cacheDurations, durationMs);
}

export function recordCacheError(): void {
  cacheErrors += 1;
}

export function updateCacheRuntime(input: { connected: boolean; memoryBytes?: number; evictions?: number }): void {
  cacheConnected = input.connected;
  if (input.memoryBytes != null) cacheMemoryBytes = input.memoryBytes;
  if (input.evictions != null) cacheEvictions = input.evictions;
}

export function runtimeMetricsSnapshot(): Record<string, unknown> {
  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1_000, 1);
  const memory = process.memoryUsage();
  const lookups = cacheHits + cacheMisses;
  return {
    requests: {
      total: requestCount,
      requestsPerSecond: round(requestCount / elapsedSeconds),
      serverErrors,
      errorRate: requestCount ? round(serverErrors / requestCount) : 0,
      responseBytes,
      latencyMs: summary(requestDurations),
    },
    mongo: { requestCount: mongoRequestCount, latencyMs: summary(mongoDurations) },
    provider: { requestCount: providerRequestCount, latencyMs: summary(providerDurations) },
    epg: { latencyMs: summary(epgDurations) },
    routes: routeMetricsSnapshot(),
    cache: {
      connected: cacheConnected,
      hits: cacheHits,
      misses: cacheMisses,
      errors: cacheErrors,
      hitRate: lookups ? round(cacheHits / lookups) : 0,
      memoryBytes: cacheMemoryBytes,
      evictions: cacheEvictions,
      latencyMs: summary(cacheDurations),
    },
    process: {
      uptimeSeconds: Math.floor(process.uptime()),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      eventLoopLagMs: {
        mean: round(eventLoop.mean / 1e6),
        p95: round(eventLoop.percentile(95) / 1e6),
        max: round(eventLoop.max / 1e6),
      },
    },
    // M13-B1: additive. The cumulative figures above keep their meaning; these are windowed / attributed.
    diagnostics: diagnosticsSnapshot(),
  };
}

function diagnosticsSnapshot(): Record<string, unknown> {
  try {
    const cpu = process.cpuUsage();
    const memory = process.memoryUsage();
    return {
      note: 'Durations are client-observed in this process (they include pool waits, BSON decoding and event-loop waits); none is MongoDB server execution time.',
      eventLoop: eventLoopDiagnosticsSnapshot(),
      steps: stepTimelineSnapshot(),
      requests: inflightRequests.stats(),
      catalogue: catalogueDiagnosticsSnapshot(),
      cpu: { userMs: Math.round(cpu.user / 1_000), systemMs: Math.round(cpu.system / 1_000) },
      memory: { externalBytes: memory.external, arrayBuffersBytes: memory.arrayBuffers },
      host: {
        cpuCount: os.cpus().length,
        loadAverage: os.loadavg().map(round),
        freeMemoryBytes: os.freemem(),
        totalMemoryBytes: os.totalmem(),
      },
    };
  } catch {
    return { enabled: false };
  }
}

function push(target: number[], value: number, cap: number = MAX_SAMPLES): void {
  if (!Number.isFinite(value)) return;
  target.push(value);
  if (target.length > cap) target.shift();
}

/** Endpoint-level P50/P95/P99, sorted by traffic so the busiest routes — the
 * ones worth investigating first — are easy to find in the JSON payload. */
function routeMetricsSnapshot(): Array<{
  route: string;
  count: number;
  errorRate: number;
  latencyMs: Record<string, number>;
}> {
  return Array.from(routeDurations.entries())
    .map(([route, samples]) => {
      const count = routeCounts.get(route) || samples.length;
      const errors = routeErrors.get(route) || 0;
      return {
        route,
        count,
        errorRate: count ? round(errors / count) : 0,
        latencyMs: summary(samples),
      };
    })
    .sort((a, b) => b.count - a.count);
}

function summary(values: number[]): Record<string, number> {
  if (!values.length) return { count: 0, p50: 0, p95: 0, p99: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function percentile(values: number[], fraction: number): number {
  return round(values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)]);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
