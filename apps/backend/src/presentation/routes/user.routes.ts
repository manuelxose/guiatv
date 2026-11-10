import express, { Router } from 'express';
import { UserController } from '../controllers/UserController';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { createAuthGuard } from '../middlewares/authGuard';
import { createRateLimiter } from '../middlewares/rateLimit';
import { AuthService } from '../../domain/services/AuthService';

/**
 * User account endpoints (profile, lists, favorites, settings).
 */
export const createUserRoutes = (controller: UserController, authService: AuthService): Router => {
  const router = Router();
  const authGuard = createAuthGuard(authService);
  const exportRateLimit = createRateLimiter({
    windowMs: 24 * 60 * 60 * 1000,
    max: 3,
    message: 'Export limit reached, please try again tomorrow',
    exemptLocalReads: false,
  });

  router.use(authGuard);

  router.get('/profile', asyncHandler(controller.getProfile.bind(controller)));
  router.patch('/profile', asyncHandler(controller.updateProfile.bind(controller)));
  router.post(
    '/avatar',
    express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '5mb' }),
    asyncHandler(controller.uploadAvatar.bind(controller))
  );
  router.patch('/privacy', asyncHandler(controller.updatePrivacy.bind(controller)));
  router.patch('/notifications', asyncHandler(controller.updateNotifications.bind(controller)));
  router.patch('/preferences', asyncHandler(controller.updateTvPreferences.bind(controller)));
  router.post('/status', asyncHandler(controller.updateStatus.bind(controller)));

  router.get('/lists', asyncHandler(controller.getLists.bind(controller)));
  router.post('/lists', asyncHandler(controller.createList.bind(controller)));
  router.patch('/lists/:id', asyncHandler(controller.updateList.bind(controller)));
  router.delete('/lists/:id', asyncHandler(controller.deleteList.bind(controller)));

  router.get('/lists/:id/items', asyncHandler(controller.getListItems.bind(controller)));
  router.post('/lists/:id/items', asyncHandler(controller.addListItem.bind(controller)));
  router.patch('/lists/:id/items/:itemId', asyncHandler(controller.updateListItem.bind(controller)));
  router.delete('/lists/:id/items/:itemId', asyncHandler(controller.removeListItem.bind(controller)));

  router.get('/favorites', asyncHandler(controller.getFavorites.bind(controller)));
  router.post('/favorites', asyncHandler(controller.addFavorite.bind(controller)));
  router.delete('/favorites/:id', asyncHandler(controller.removeFavorite.bind(controller)));

  router.get('/notifications', asyncHandler(controller.getNotifications.bind(controller)));
  router.post('/notifications/read', asyncHandler(controller.markNotificationsRead.bind(controller)));
  router.get('/notifications/unread-count', asyncHandler(controller.getUnreadNotificationsCount.bind(controller)));

  router.delete('/account', asyncHandler(controller.deleteAccount.bind(controller)));
  router.get('/export', exportRateLimit, asyncHandler(controller.exportData.bind(controller)));

  return router;
};
