import { Router } from 'express';
import { EditorialAIAssistantController } from '../controllers/EditorialAIAssistantController';
import { AuthService } from '@/domain/services/AuthService';
import { createAdminAccessGuard } from '../middlewares/adminAccessGuard';
import { asyncHandler } from '@/shared/utils/asyncHandler';

export const createAdminEditorialAIRoutes = (
  controller: EditorialAIAssistantController,
  authService: AuthService
): Router => {
  const router = Router();
  const adminGuard = createAdminAccessGuard(authService);

  router.get('/models', adminGuard, controller.getModels.bind(controller));
  router.post('/assist', adminGuard, asyncHandler(controller.assist.bind(controller)));

  return router;
};
