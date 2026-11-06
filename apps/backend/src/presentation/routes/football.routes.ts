import { Router } from 'express';
import { AuthService } from '../../domain/services/AuthService';
import { FootballController } from '../controllers/FootballController';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { createAdminAccessGuard } from '../middlewares/adminAccessGuard';

export const createFootballRoutes = (controller: FootballController, authService: AuthService): Router => {
  const router = Router();
  const adminAccessGuard = createAdminAccessGuard(authService);

  router.get('/home', asyncHandler(controller.home.bind(controller)));

  router.get('/matches/live', asyncHandler(controller.liveMatches.bind(controller)));
  router.get('/matches', asyncHandler(controller.matches.bind(controller)));
  router.get('/matches/:idOrSlug', asyncHandler(controller.matchDetail.bind(controller)));

  router.get('/competitions', asyncHandler(controller.competitions.bind(controller)));
  router.get('/competitions/:slug', asyncHandler(controller.competitionDetail.bind(controller)));

  router.get('/teams/:slug', asyncHandler(controller.teamDetail.bind(controller)));

  router.get('/news', asyncHandler(controller.news.bind(controller)));
  router.get('/search', asyncHandler(controller.search.bind(controller)));

  // Broadcast reconciliation overrides (admin-only, shared admin boundary).
  router.post(
    '/broadcasts/override',
    adminAccessGuard,
    asyncHandler(controller.upsertBroadcastOverride.bind(controller))
  );
  router.delete(
    '/broadcasts/override',
    adminAccessGuard,
    asyncHandler(controller.clearBroadcastOverride.bind(controller))
  );

  return router;
};
