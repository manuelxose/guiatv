import { Router } from 'express';
import { BlogController } from '../controllers/BlogController';
import { AuthService } from '../../domain/services/AuthService';
import { createAdminAccessGuard } from '../middlewares/adminAccessGuard';
import { createOptionalAdminAccess } from '../middlewares/optionalAdminAccess';
import { editorialReviewGuard, policyApprovalGuard } from '../middlewares/editorialReviewGuard';

export const createBlogRoutes = (blogController: BlogController, authService: AuthService): Router => {
  const router = Router();
  const adminAccess = createAdminAccessGuard(authService);
  const optionalAdminAccess = createOptionalAdminAccess(authService);

  router.get('/', optionalAdminAccess, blogController.getPosts);
  router.get('/categories', blogController.getCategories);
  router.post('/', adminAccess, blogController.createPost);
  router.post('/:id/approve', adminAccess, editorialReviewGuard, blogController.approvePost);
  router.post('/:id/approve-by-policy', adminAccess, policyApprovalGuard, blogController.approveByPolicy);
  router.post('/:id/revise-by-policy', adminAccess, policyApprovalGuard, blogController.reviseByPolicy);
  router.post('/:id/rollback', adminAccess, editorialReviewGuard, blogController.rollbackPost);
  router.put('/:id', adminAccess, blogController.updatePost);
  router.delete('/:id', adminAccess, blogController.deletePost);

  return router;
};
