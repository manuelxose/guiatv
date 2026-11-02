import express, { Router } from 'express';
import { EditorialOpsController } from '../controllers/EditorialOpsController';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { AuthService } from '../../domain/services/AuthService';
import { createAdminAccessGuard } from '../middlewares/adminAccessGuard';
import { humanEditorialReviewGuard } from '../middlewares/editorialReviewGuard';
import { strictRateLimit } from '../middlewares/rateLimit';

/**
 * M11-C AI editorial operations. Every route needs the admin role (session) or the admin key; lifting the
 * emergency stop also needs the separate editorial review key. Drafts and evidence never leave this router.
 */
export const createAdminEditorialRoutes = (controller: EditorialOpsController, authService: AuthService): Router => {
  const router = Router();
  router.use(createAdminAccessGuard(authService));

  router.get('/overview', asyncHandler(controller.overview));
  router.get('/posts/:id', asyncHandler(controller.post));
  router.post('/policy/pause', strictRateLimit, asyncHandler(controller.pause));
  router.post('/policy/resume', strictRateLimit, humanEditorialReviewGuard, asyncHandler(controller.resume));
  router.post('/policy/daily-limit', strictRateLimit, humanEditorialReviewGuard, asyncHandler(controller.setDailyLimit));
  router.get('/generation/settings', asyncHandler(controller.generationSettings));
  router.put('/generation/settings', strictRateLimit, asyncHandler(controller.updateGenerationSettings));
  router.post('/generation/requests', strictRateLimit, asyncHandler(controller.createGenerationRequest));
  router.post('/generation/discovery', strictRateLimit, asyncHandler(controller.createDiscoveryRequest));
  router.post('/generation/requests/:id/cancel', strictRateLimit, asyncHandler(controller.cancelGenerationRequest));
  router.post('/generation/requests/:id/retry', strictRateLimit, asyncHandler(controller.retryGenerationRequest));
  router.get('/generation/runner/work', asyncHandler(controller.runnerWork));
  router.post('/generation/runner/heartbeat', asyncHandler(controller.runnerHeartbeat));
  router.post('/generation/runner/requests/:id/claim', asyncHandler(controller.claimGenerationRequest));
  router.post('/generation/runner/requests/:id/finish', asyncHandler(controller.finishGenerationRequest));
  router.post('/generation/runner/cycles', asyncHandler(controller.runnerCycle));
  router.post('/jobs', asyncHandler(controller.recordJob));
  router.post(
    '/media/:sha256',
    express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '10mb' }),
    asyncHandler(controller.uploadCover)
  );
  return router;
};
