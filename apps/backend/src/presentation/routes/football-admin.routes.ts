/**
 * Football admin routes — admin-guarded, never public.
 *
 * Mounted by the captain under `/sports/football/admin` (see routes/index.ts).
 * Read endpoints serve stored projections only; the single mutating endpoint
 * (`POST /ingestion/sync`) is additionally rate-limited and idempotency-keyed
 * in the controller.
 */

import { Router } from 'express';
import { FootballOpsController } from '../controllers/FootballOpsController';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { analyticsAdminGuard } from '../middlewares/analyticsAdminGuard';
import { strictRateLimit } from '../middlewares/rateLimit';

export const createFootballAdminRoutes = (controller: FootballOpsController): Router => {
  const router = Router();

  router.get('/diagnostics', analyticsAdminGuard, asyncHandler(controller.diagnostics.bind(controller)));

  router.get('/dashboard', analyticsAdminGuard, asyncHandler(controller.dashboard.bind(controller)));
  router.get('/providers', analyticsAdminGuard, asyncHandler(controller.listProviders.bind(controller)));
  router.get('/providers/:provider', analyticsAdminGuard, asyncHandler(controller.providerDetail.bind(controller)));
  router.get('/coverage', analyticsAdminGuard, asyncHandler(controller.coverage.bind(controller)));
  router.get('/matches', analyticsAdminGuard, asyncHandler(controller.listMatches.bind(controller)));
  router.get('/matches/:idOrSlug', analyticsAdminGuard, asyncHandler(controller.matchDetail.bind(controller)));
  router.get('/entity-mappings', analyticsAdminGuard, asyncHandler(controller.listEntityMappings.bind(controller)));
  router.get('/broadcasts', analyticsAdminGuard, asyncHandler(controller.listBroadcasts.bind(controller)));
  router.get('/ingestion/status', analyticsAdminGuard, asyncHandler(controller.ingestionStatus.bind(controller)));
  router.get('/quality-issues', analyticsAdminGuard, asyncHandler(controller.qualityIssues.bind(controller)));
  router.get('/audit', analyticsAdminGuard, asyncHandler(controller.listAudit.bind(controller)));

  router.post('/ingestion/sync', analyticsAdminGuard, strictRateLimit, asyncHandler(controller.sync.bind(controller)));

  return router;
};
