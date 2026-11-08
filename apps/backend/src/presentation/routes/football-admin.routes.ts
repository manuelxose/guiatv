/**
 * Football admin routes — admin-guarded, never public.
 *
 * Mounted by the captain under `/sports/football/admin` (see routes/index.ts).
 * Read endpoints serve stored projections only; the single mutating endpoint
 * (`POST /ingestion/sync`) is additionally rate-limited and idempotency-keyed
 * in the controller.
 *
 * Authorization uses the single shared admin boundary (`createAdminAccessGuard`):
 * the shared `ANALYTICS_ADMIN_KEY` (constant-time) OR an authenticated admin
 * session. It is the same guard the legacy `/v2/admin/*` surface uses.
 */

import { Router } from 'express';
import { AuthService } from '../../domain/services/AuthService';
import { FootballOpsController } from '../controllers/FootballOpsController';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { createAdminAccessGuard } from '../middlewares/adminAccessGuard';
import { strictRateLimit } from '../middlewares/rateLimit';

export const createFootballAdminRoutes = (
  controller: FootballOpsController,
  authService: AuthService
): Router => {
  const router = Router();
  const adminAccessGuard = createAdminAccessGuard(authService);

  router.get('/diagnostics', adminAccessGuard, asyncHandler(controller.diagnostics.bind(controller)));

  router.get('/dashboard', adminAccessGuard, asyncHandler(controller.dashboard.bind(controller)));
  router.get('/providers', adminAccessGuard, asyncHandler(controller.listProviders.bind(controller)));
  router.get('/providers/:provider', adminAccessGuard, asyncHandler(controller.providerDetail.bind(controller)));
  router.get('/coverage', adminAccessGuard, asyncHandler(controller.coverage.bind(controller)));
  router.get('/matches', adminAccessGuard, asyncHandler(controller.listMatches.bind(controller)));
  router.get('/matches/:idOrSlug', adminAccessGuard, asyncHandler(controller.matchDetail.bind(controller)));
  router.get('/entity-mappings', adminAccessGuard, asyncHandler(controller.listEntityMappings.bind(controller)));
  router.get('/broadcasts', adminAccessGuard, asyncHandler(controller.listBroadcasts.bind(controller)));
  router.get('/ingestion/status', adminAccessGuard, asyncHandler(controller.ingestionStatus.bind(controller)));
  router.get('/quality-issues', adminAccessGuard, asyncHandler(controller.qualityIssues.bind(controller)));
  router.get('/audit', adminAccessGuard, asyncHandler(controller.listAudit.bind(controller)));

  router.get('/ingestion/sync', adminAccessGuard, asyncHandler(controller.listSyncOperations.bind(controller)));
  router.post('/ingestion/sync', adminAccessGuard, strictRateLimit, asyncHandler(controller.sync.bind(controller)));

  return router;
};
