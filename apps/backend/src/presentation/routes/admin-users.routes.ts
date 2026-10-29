import { Router } from 'express';
import { AdminUsersController } from '../controllers/AdminUsersController';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { AuthService } from '../../domain/services/AuthService';
import { createAdminAccessGuard } from '../middlewares/adminAccessGuard';

export const createAdminUsersRoutes = (
  controller: AdminUsersController,
  authService: AuthService
): Router => {
  const router = Router();
  const adminAccessGuard = createAdminAccessGuard(authService);

  router.get(
    '/',
    adminAccessGuard,
    asyncHandler(controller.listUsers.bind(controller))
  );
  router.get(
    '/retention',
    adminAccessGuard,
    asyncHandler(controller.getRetention.bind(controller))
  );
  router.patch(
    '/:id',
    adminAccessGuard,
    asyncHandler(controller.updateUser.bind(controller))
  );
  router.get(
    '/reports',
    adminAccessGuard,
    asyncHandler(controller.listReports.bind(controller))
  );
  router.patch(
    '/reports/:id',
    adminAccessGuard,
    asyncHandler(controller.updateReport.bind(controller))
  );

  return router;
};
