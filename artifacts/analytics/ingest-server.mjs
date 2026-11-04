// Ingestion benchmark server: the real analytics router + controller + Valkey repository from a built backend
// (`--dist`), on a local Valkey, instrumented with event-loop delay, CPU and memory. `--mode base` builds the
// baseline controller (per-event endpoints awaiting Valkey); `--mode cand` the candidate (batched /collect + queue).
//   node artifacts/analytics/ingest-server.mjs --dist <apps/backend/dist> --mode cand --port 4101 --redis redis://127.0.0.1:6390/3
import { createRequire } from 'node:module';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith('--') ? [...acc, [v.slice(2), a[i + 1]]] : acc), []));
const dist = resolve(args.dist);
const require = createRequire(resolve(dist, 'index.js'));
process.env.ANALYTICS_EXCLUDED_IPS = '';
process.env.ANALYTICS_LEGACY_ENDPOINTS = 'drop';
const express = require('express');
const { createAnalyticsRoutes } = require(resolve(dist, 'presentation/routes/analytics.routes.js'));
const { AnalyticsController } = require(resolve(dist, 'presentation/controllers/AnalyticsController.js'));
const { AnalyticsService } = require(resolve(dist, 'application/services/AnalyticsService.js'));
const { ValkeyAnalyticsRepository } = require(resolve(dist, 'infrastructure/repositories/ValkeyAnalyticsRepository.js'));

const repo = new ValkeyAnalyticsRepository(args.redis || 'redis://127.0.0.1:6390/3');
await repo.connect();
const service = new AnalyticsService(repo);
let controller;
let ingest = null;
if (args.mode === 'cand') {
  const { TelemetryIngestService } = require(resolve(dist, 'application/services/analytics/TelemetryIngestService.js'));
  const { GeoIpService } = require(resolve(dist, 'infrastructure/analytics/GeoIpService.js'));
  const { TelemetryFlagSource } = require(resolve(dist, 'application/services/analytics/telemetryFlags.js'));
  const geo = new GeoIpService({ enabled: process.env.BENCH_GEOIP === '1', cityPath: resolve(dist, '../test-fixtures/geoip/GeoIP2-City-Test.mmdb'), asnPath: resolve(dist, '../test-fixtures/geoip/GeoLite2-ASN-Test.mmdb') });
  await geo.init();
  geo.stop();
  ingest = new TelemetryIngestService(repo, geo);
  controller = new AnalyticsController(service, ingest, new TelemetryFlagSource({ ANALYTICS_COLLECT_RATE_PER_MIN: '1000000' }, () => false));
} else {
  controller = new AnalyticsController(service);
}
process.env.ANALYTICS_COLLECT_RATE_PER_MIN = '100000000';
const auth = { getSession: async () => { throw new Error('no session'); } };
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use('/v2/telemetry', createAnalyticsRoutes(controller, auth));
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ message: err.message }));

const histogram = monitorEventLoopDelay({ resolution: 1 });
let cpuStart = process.cpuUsage();
let rssPeak = 0;
const rssTimer = setInterval(() => { rssPeak = Math.max(rssPeak, process.memoryUsage().rss); }, 50);
rssTimer.unref();
app.post('/__reset', (_req, res) => { histogram.reset(); histogram.enable(); cpuStart = process.cpuUsage(); rssPeak = 0; res.json({ ok: true }); });
app.get('/__stats', async (_req, res) => {
  if (ingest) await ingest.queue.drain(60_000);
  const cpu = process.cpuUsage(cpuStart);
  res.json({
    eventLoop: { p50: histogram.percentile(50) / 1e6, p99: histogram.percentile(99) / 1e6, max: histogram.max / 1e6, mean: histogram.mean / 1e6 },
    cpuMs: (cpu.user + cpu.system) / 1000, rssPeakMb: rssPeak / 1048576, heapMb: process.memoryUsage().heapUsed / 1048576,
    ingest: ingest ? ingest.diagnostics().queue : null,
  });
});
app.listen(Number(args.port || 4101), '127.0.0.1', () => console.log(`ingest bench ${args.mode} on ${args.port}`));
