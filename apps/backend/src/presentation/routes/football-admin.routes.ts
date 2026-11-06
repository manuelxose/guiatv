/**
 * Football admin routes (diagnostics) — admin-guarded, never public.
 *
 * Mounted by the captain behind the existing admin guard, same pattern as
 * `football.routes.ts`'s broadcast override routes.
 */

import { Router } from 'express';
import { FootballOpsController } from '../controllers/FootballOpsController';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { analyticsAdminGuard } from '../middlewares/analyticsAdminGuard';

export const createFootballAdminRoutes = (controller: FootballOpsController): Router => {
  const router = Router();

  router.get('/diagnostics', analyticsAdminGuard, asyncHandler(controller.diagnostics.bind(controller)));

  return router;
};
