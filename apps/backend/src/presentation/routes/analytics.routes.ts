import { Router } from 'express';
import { AnalyticsController } from '../controllers/AnalyticsController';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { AuthService } from '../../domain/services/AuthService';
import { createAdminAccessGuard } from '../middlewares/adminAccessGuard';

export const createAnalyticsRoutes = (
  controller: AnalyticsController,
  authService: AuthService
): Router => {
  const router = Router();
  const adminAccessGuard = createAdminAccessGuard(authService);

  router.post(
    '/session/start',
    asyncHandler(controller.startSession.bind(controller))
  );
  router.post(
    '/session/heartbeat',
    asyncHandler(controller.heartbeatSession.bind(controller))
  );
  router.post(
    '/session/end',
    asyncHandler(controller.endSession.bind(controller))
  );
  router.post('/event', asyncHandler(controller.trackEvent.bind(controller)));

  router.get(
    '/live',
    adminAccessGuard,
    asyncHandler(controller.getLive.bind(controller))
  );
  router.get(
    '/overview',
    adminAccessGuard,
    asyncHandler(controller.getOverview.bind(controller))
  );
  router.get(
    '/events',
    adminAccessGuard,
    asyncHandler(controller.getEvents.bind(controller))
  );
  router.get(
    '/journeys',
    adminAccessGuard,
    asyncHandler(controller.getJourneys.bind(controller))
  );

  return router;
};
