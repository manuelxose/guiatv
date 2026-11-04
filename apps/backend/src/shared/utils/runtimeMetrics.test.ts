import assert from 'node:assert/strict';
import test from 'node:test';
import { recordRequestMetric, runtimeMetricsSnapshot } from './runtimeMetrics';

/**
 * Validates the per-endpoint P50/P95/P99 + request-count metrics added for
 * the backend performance consolidation work. There is no production
 * traffic in this environment to observe them under, so this pins the
 * aggregation logic itself: per-route latency/error tracking, the
 * mongo/provider/epg buckets, and the cardinality guard that keeps
 * unmatched (raw, user-controlled) request paths out of the per-route map.
 *
 * Route names are unique per test run (`route-metrics-test:<random>`) so
 * this doesn't collide with metrics recorded elsewhere in the same process.
 */

function uniqueRoute(label: string): string {
  return `GET /__test__/route-metrics/${label}-${Math.random().toString(36).slice(2)}`;
}

test('runtimeMetricsSnapshot reports per-route P50/P95/P99, sorted by traffic, with error rate', () => {
  const busyRoute = uniqueRoute('busy');
  const quietRoute = uniqueRoute('quiet');

  // 9 fast successful requests + 1 slow 500 on the busy route.
  for (let i = 0; i < 9; i += 1) {
    recordRequestMetric({ durationMs: 20, statusCode: 200, route: busyRoute });
  }
  recordRequestMetric({ durationMs: 500, statusCode: 500, route: busyRoute });

  // 2 requests on the quiet route — should sort after the busy one.
  recordRequestMetric({ durationMs: 30, statusCode: 200, route: quietRoute });
  recordRequestMetric({ durationMs: 40, statusCode: 200, route: quietRoute });

  const snapshot = runtimeMetricsSnapshot() as any;
  const routes: Array<{ route: string; count: number; errorRate: number; latencyMs: any }> =
    snapshot.routes;

  const busyIndex = routes.findIndex((r) => r.route === busyRoute);
  const quietIndex = routes.findIndex((r) => r.route === quietRoute);

  assert.ok(busyIndex >= 0, 'busy route must appear in the per-route snapshot');
  assert.ok(quietIndex >= 0, 'quiet route must appear in the per-route snapshot');
  assert.ok(
    busyIndex < quietIndex,
    'routes must be sorted busiest-first so the top offenders are easy to find'
  );

  const busy = routes[busyIndex];
  assert.equal(busy.count, 10);
  assert.equal(busy.errorRate, 0.1);
  assert.equal(busy.latencyMs.count, 10);

  const quiet = routes[quietIndex];
  assert.equal(quiet.count, 2);
  assert.equal(quiet.errorRate, 0);
});

test('runtimeMetricsSnapshot does not grow the per-route map for requests with no matched route', () => {
  // An unmatched request (404, static asset, bot probe) has no Express
  // route — requestLogger.ts omits `route` entirely rather than falling back
  // to the raw URL for exactly this reason: without this guard, an attacker
  // could grow the per-route map unboundedly by hitting arbitrary paths.
  const before = (runtimeMetricsSnapshot() as any).routes.length;
  recordRequestMetric({ durationMs: 15, statusCode: 404, route: undefined });
  const after = (runtimeMetricsSnapshot() as any).routes.length;

  assert.equal(after, before, 'a request with no matched route must not add a routes entry');
});

test('runtimeMetricsSnapshot tracks mongo/provider request counts and a distinct epg bucket', () => {
  const route = uniqueRoute('timings');
  const before = runtimeMetricsSnapshot() as any;
  const mongoBefore = before.mongo.requestCount;
  const providerBefore = before.provider.requestCount;

  recordRequestMetric({
    durationMs: 80,
    statusCode: 200,
    route,
    timings: { db: 10, provider: 25, epg: 8 },
  });

  const after = runtimeMetricsSnapshot() as any;
  assert.equal(after.mongo.requestCount, mongoBefore + 1);
  assert.equal(after.provider.requestCount, providerBefore + 1);
  assert.ok(after.epg.latencyMs.count >= 1);
});

test('M13-B1: existing snapshot keys keep their shape; diagnostics are purely additive', () => {
  const snapshot = runtimeMetricsSnapshot() as any;
  for (const key of ['requests', 'mongo', 'provider', 'epg', 'routes', 'cache', 'process']) {
    assert.ok(key in snapshot, `missing ${key}`);
  }
  assert.deepEqual(Object.keys(snapshot.process.eventLoopLagMs).sort(), ['max', 'mean', 'p95']);
  for (const key of ['uptimeSeconds', 'rssBytes', 'heapUsedBytes', 'heapTotalBytes']) assert.equal(typeof snapshot.process[key], 'number');
  assert.deepEqual(Object.keys(snapshot.requests.latencyMs).sort(), ['count', 'p50', 'p95', 'p99']);
  const diagnostics = snapshot.diagnostics;
  assert.ok(diagnostics.eventLoop && diagnostics.steps && diagnostics.catalogue && diagnostics.cpu && diagnostics.host);
  assert.doesNotThrow(() => JSON.stringify(snapshot));
});

test('M13-B1: a new timing phase does not leak into the mongo/provider/epg buckets', () => {
  const before = runtimeMetricsSnapshot() as any;
  recordRequestMetric({ durationMs: 10, statusCode: 200, timings: { cat_providers: 900, cat_total: 950 } });
  const after = runtimeMetricsSnapshot() as any;
  assert.equal(after.mongo.requestCount, before.mongo.requestCount);
  assert.equal(after.provider.requestCount, before.provider.requestCount);
  assert.equal(after.epg.latencyMs.count, before.epg.latencyMs.count);
});
