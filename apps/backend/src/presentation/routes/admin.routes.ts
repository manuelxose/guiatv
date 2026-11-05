// src/v2/presentation/routes/admin.routes.ts

import { Router } from 'express';
import { AdminController } from '../controllers/AdminController';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { strictRateLimit } from '../middlewares/rateLimit';
import { AuthService } from '../../domain/services/AuthService';
import { createAdminAccessGuard } from '../middlewares/adminAccessGuard';
import { entityPublicReadPolicy } from '../../application/services/EntityPublicReadPolicy';
import { successResponse } from '../../shared/types/ApiResponse';

/**
 * Admin/maintenance endpoints used for operational tasks.
 */
export const createAdminRoutes = (
  controller: AdminController,
  authService: AuthService
): Router => {
  const router = Router();
  const adminAccessGuard = createAdminAccessGuard(authService);

  router.use(adminAccessGuard);

  router.get('/epg/overview', asyncHandler(controller.getEpgOverview.bind(controller)));
  router.get('/epg/channels', asyncHandler(controller.listEpgChannels.bind(controller)));
  router.get('/providers', asyncHandler(controller.listProviders.bind(controller)));
  router.get('/football/overview', asyncHandler(controller.getFootballOverview.bind(controller)));
  router.get('/football/competitions', asyncHandler(controller.listFootballCompetitions.bind(controller)));
  router.get('/football/teams', asyncHandler(controller.listFootballTeams.bind(controller)));
  router.get('/football/fixtures', asyncHandler(controller.listFootballFixtures.bind(controller)));
  router.get('/jobs', asyncHandler(controller.listJobs.bind(controller)));
  router.get('/jobs/scheduled', asyncHandler(controller.listScheduledJobs.bind(controller)));
  router.post('/jobs/scheduled/:name/run', asyncHandler(controller.runScheduledJob.bind(controller)));
  router.get('/cache/diagnostics', asyncHandler(controller.getCacheDiagnostics.bind(controller)));
  router.get('/events', asyncHandler(controller.listOperationalEvents.bind(controller)));
  router.get('/alerts', asyncHandler(controller.listAlerts.bind(controller)));
  // 3B: per-route outcomes, breaker and kill state of the public entity canary (no entity content).
  router.get('/entities/canary', (_req, res) => res.json(successResponse(entityPublicReadPolicy().stats())));
  router.post('/football/refresh', strictRateLimit, asyncHandler(controller.refreshFootball.bind(controller)));
  router.post('/cache/invalidate', strictRateLimit, asyncHandler(controller.invalidateCacheNamespace.bind(controller)));

  // TODO: Agregar middleware de autenticación para producción
  // router.use(authMiddleware);

  /**
   * POST /v2/admin/sync
   * Body: { date?: string, forceRefresh?: boolean }
   */
  router.post(
    '/sync',
    strictRateLimit,
    asyncHandler(controller.triggerSync.bind(controller))
  );

  /**
   * POST /v2/admin/precompute
   * Body: { date?: string }
   */
  router.post(
    '/precompute',
    strictRateLimit,
    asyncHandler(controller.triggerPrecompute.bind(controller))
  );

  /**
   * POST /v2/admin/precompute-window
   * Body: { fields?: 'minimal' | 'full' }
   */
  router.post(
    '/precompute-window',
    strictRateLimit,
    asyncHandler(controller.triggerPrecomputeWindow.bind(controller))
  );

  /**
   * POST /v2/admin/cleanup
   * Body: { daysToKeep?: number }
   */
  router.post(
    '/cleanup',
    strictRateLimit,
    asyncHandler(controller.triggerCleanup.bind(controller))
  );

  /**
   * POST /v2/admin/cache/clear
   * Body: { pattern?: string }
   */
  router.post(
    '/cache/clear',
    strictRateLimit,
    asyncHandler(controller.clearCache.bind(controller))
  );

  /**
   * POST /v2/admin/reset
   * Body: { sourceUrl?: string, fields?: 'minimal' | 'full' }
   */
  router.post(
    '/reset',
    strictRateLimit,
    asyncHandler(controller.triggerReset.bind(controller))
  );

  /**
   * GET /v2/admin/health
   */
  router.get('/health', asyncHandler(controller.healthCheck.bind(controller)));

  return router;
};
