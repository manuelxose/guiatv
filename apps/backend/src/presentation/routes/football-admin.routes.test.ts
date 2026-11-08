import test from 'node:test';
import assert from 'node:assert/strict';
import { FootballOpsController } from '@/presentation/controllers/FootballOpsController';
import { createFootballAdminRoutes } from '@/presentation/routes/football-admin.routes';
import { createAdminAccessGuard } from '@/presentation/middlewares/adminAccessGuard';
import { UnauthorizedError } from '@/shared/errors';
import { FootballAdminService } from '@/application/sports/services/FootballAdminService';
import {
  FootballSnapshotModel,
  FootballProviderSyncStateModel,
  FootballIngestionRunModel,
} from '@/infrastructure/sports/persistence/models';
import { FootballCompetitionModel } from '@/infrastructure/sports/models/FootballCompetition.model';
import { FootballTeamModel } from '@/infrastructure/sports/models/FootballTeam.model';
import { FootballBroadcastMappingModel } from '@/infrastructure/sports/models/FootballBroadcastMapping.model';

const EMPTY_DIAGNOSTICS = () => ({
  generatedAt: new Date().toISOString(),
  providers: [],
  summary: { activeMatches: 0, staleSnapshots: 0, queueSize: 0, identityConflicts: 0 },
});

const REJECTING_AUTH_SERVICE = {
  getSession: async () => {
    throw new UnauthorizedError('invalid session');
  },
};

function fakeRes() {
  const out: { status: number; body: Record<string, any> } = { status: 200, body: {} };
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(payload: Record<string, any>) {
      out.body = payload;
      return res;
    },
  } as any;
  return { res, out };
}

test('every football admin route is mounted behind the shared admin guard', async () => {
  const controller = new FootballOpsController({ diagnostics: EMPTY_DIAGNOSTICS });
  const router = createFootballAdminRoutes(controller, REJECTING_AUTH_SERVICE as never);

  const stack = (router as any).stack as Array<{ route?: { path?: string; stack?: Array<{ handle: unknown }> } }>;
  const routes = stack.filter((l) => l?.route).map((l) => ({ method: Object.keys(l.route!).find((k) => k !== 'path' && k !== 'stack'), path: l.route!.path, handlers: (l.route!.stack ?? []).map((h) => h.handle) }));

  assert.ok(routes.length >= 13, `expected at least 13 routes, got ${routes.length}`);
  for (const route of routes) {
    assert.ok(route.handlers.length >= 2, `route ${route.method} ${route.path} must mount a guard before its handler`);
    const guard = route.handlers[0];
    assert.equal(typeof guard, 'function', `route ${route.method} ${route.path} first handler must be the guard`);
    // Fail-closed behavior: a credential-less request must be rejected.
    let err: unknown;
    await (guard as (req: unknown, res: unknown, next: (e?: unknown) => void) => unknown)(
      { header: () => undefined, headers: {} } as never,
      {} as never,
      (e?: unknown) => {
        err = e;
      }
    );
    assert.ok(err, `route ${route.method} ${route.path} guard must reject a credential-less request`);
  }
});

test('the shared admin guard rejects a request without credentials', async () => {
  const previous = process.env.ANALYTICS_ADMIN_KEY;
  delete process.env.ANALYTICS_ADMIN_KEY;
  try {
    const guard = createAdminAccessGuard(REJECTING_AUTH_SERVICE as never);
    let err: unknown;
    await guard({ header: () => undefined, headers: {} } as never, {} as never, (e?: unknown) => {
      err = e;
    });
    assert.ok(err instanceof UnauthorizedError);
  } finally {
    if (previous === undefined) delete process.env.ANALYTICS_ADMIN_KEY;
    else process.env.ANALYTICS_ADMIN_KEY = previous;
  }
});

test('malformed pagination params are rejected with 400 before any read', async () => {
  let serviceCalled = false;
  const service = {
    listMatches: async () => {
      serviceCalled = true;
      return { page: 1, limit: 25, total: 0, items: [] };
    },
  } as unknown as FootballAdminService;
  const controller = new FootballOpsController({ diagnostics: EMPTY_DIAGNOSTICS }, service);
  const { res, out } = fakeRes();

  await controller.listMatches({ query: { page: 'not-a-number', limit: 25 } } as any, res);

  assert.equal(out.status, 400);
  assert.equal(out.body.success, false);
  assert.equal(serviceCalled, false, 'validation must reject before reaching the read model');
});

test('opening the dashboard issues zero upstream provider calls', async () => {
  // Guard: any network access would hit global fetch — the service must never.
  let upstreamCalls = 0;
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = () => {
    upstreamCalls += 1;
    throw new Error('upstream provider call is forbidden from the dashboard read path');
  };

  // Stub the stored projections the dashboard reads (Mongoose static methods).
  const count = (n: number) => (() => ({ exec: async () => n })) as any;
  const original = {
    competition: FootballCompetitionModel.countDocuments,
    team: FootballTeamModel.countDocuments,
    snapshot: FootballSnapshotModel.countDocuments,
    provider: FootballProviderSyncStateModel.countDocuments,
    mapping: FootballBroadcastMappingModel.countDocuments,
    runFindOne: FootballIngestionRunModel.findOne,
    runCount: FootballIngestionRunModel.countDocuments,
  };
  try {
    (FootballCompetitionModel as any).countDocuments = count(7);
    (FootballTeamModel as any).countDocuments = count(20);
    (FootballSnapshotModel as any).countDocuments = count(1444);
    (FootballProviderSyncStateModel as any).countDocuments = count(1);
    (FootballBroadcastMappingModel as any).countDocuments = count(5);
    (FootballIngestionRunModel as any).findOne = () => ({
      sort: () => ({ lean: () => ({ exec: async () => null }) }),
    });
    (FootballIngestionRunModel as any).countDocuments = count(0);

    const service = new FootballAdminService();
    assert.equal(service.readsAreProjectionOnly, true);

    const controller = new FootballOpsController({ diagnostics: EMPTY_DIAGNOSTICS }, service);
    const { res, out } = fakeRes();
    await controller.dashboard({} as any, res);

    assert.equal(out.status, 200);
    assert.equal(out.body.data.competitions, 7);
    assert.equal(out.body.data.snapshots, 1444);
    assert.equal(out.body.data.countsState, 'observed');
    assert.equal(out.body.data.lastSyncState, 'not_measured');
    assert.equal(upstreamCalls, 0, 'the dashboard read must never call an upstream provider');
  } finally {
    (globalThis as any).fetch = realFetch;
    (FootballCompetitionModel as any).countDocuments = original.competition;
    (FootballTeamModel as any).countDocuments = original.team;
    (FootballSnapshotModel as any).countDocuments = original.snapshot;
    (FootballProviderSyncStateModel as any).countDocuments = original.provider;
    (FootballBroadcastMappingModel as any).countDocuments = original.mapping;
    (FootballIngestionRunModel as any).findOne = original.runFindOne;
    (FootballIngestionRunModel as any).countDocuments = original.runCount;
  }
});
