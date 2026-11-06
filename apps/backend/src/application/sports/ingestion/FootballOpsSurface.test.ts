import test from 'node:test';
import assert from 'node:assert/strict';
import { FootballOpsController } from '@/presentation/controllers/FootballOpsController';
import { createFootballAdminRoutes } from '@/presentation/routes/football-admin.routes';
import { analyticsAdminGuard } from '@/presentation/middlewares/analyticsAdminGuard';
import { FootballDiagnosticsReport } from './types';

test('diagnostics response never leaks credentials or keyed URLs', async () => {
  const report: FootballDiagnosticsReport = {
    generatedAt: new Date().toISOString(),
    providers: [
      {
        provider: 'openligadb',
        health: 'degraded',
        quotaRemaining: 10,
        quotaReserveRemaining: 3,
        consecutiveFailures: 1,
        fieldCoverage: 0.5,
        errors: [
          {
            at: new Date().toISOString(),
            kind: 'provider',
            message: 'GET https://api.example.com/matches?api_key=SECRETVALUE failed',
          },
        ],
        activeMatches: 0,
        staleCount: 0,
        identityConflicts: 0,
        queueSize: 0,
      },
    ],
    summary: { activeMatches: 0, staleSnapshots: 0, queueSize: 0, identityConflicts: 0 },
  };

  const controller = new FootballOpsController({ diagnostics: () => report });

  let status = 0;
  let body: Record<string, any> = {};
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: Record<string, any>) {
      body = payload;
    },
  } as any;

  await controller.diagnostics({} as any, res);

  assert.equal(status, 200);
  const json = JSON.stringify(body);
  assert.equal(json.includes('SECRETVALUE'), false);
  assert.match(json, /api_key=REDACTED/);
  assert.equal(body.success, true);
  assert.equal(body.data.providers[0].provider, 'openligadb');
  assert.equal(body.data.providers[0].quotaRemaining, 10);
});

test('diagnostics route is mounted behind the admin guard (never public)', () => {
  const controller = new FootballOpsController({
    diagnostics: () => ({
      generatedAt: new Date().toISOString(),
      providers: [],
      summary: { activeMatches: 0, staleSnapshots: 0, queueSize: 0, identityConflicts: 0 },
    }),
  });
  const router = createFootballAdminRoutes(controller);

  const stack = (router as any).stack as Array<{ route?: { path?: string; stack?: Array<{ handle: unknown }> } }>;
  const layer = stack.find((l) => l?.route?.path === '/diagnostics');
  assert.ok(layer);
  const handlers = (layer.route?.stack ?? []).map((h) => h.handle);
  assert.ok(handlers.includes(analyticsAdminGuard), 'analyticsAdminGuard must guard the route');
});
