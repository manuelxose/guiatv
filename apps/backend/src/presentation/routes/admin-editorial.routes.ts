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
  router.post('/jobs', asyncHandler(controller.recordJob));
  router.post(
    '/media/:sha256',
    express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '10mb' }),
    asyncHandler(controller.uploadCover)
  );
  return router;
};
