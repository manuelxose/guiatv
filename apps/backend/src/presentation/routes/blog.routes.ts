import { Router } from 'express';
import { BlogController } from '../controllers/BlogController';
import { analyticsAdminGuard } from '../middlewares/analyticsAdminGuard';
import { editorialReviewGuard } from '../middlewares/editorialReviewGuard';

export const createBlogRoutes = (blogController: BlogController): Router => {
  const router = Router();

  router.get('/', blogController.getPosts);
  router.get('/categories', blogController.getCategories);
  router.post('/', analyticsAdminGuard, blogController.createPost);
  router.post('/:id/approve', analyticsAdminGuard, editorialReviewGuard, blogController.approvePost);
  router.post('/:id/approve-by-policy', analyticsAdminGuard, editorialReviewGuard, blogController.approveByPolicy);
  router.post('/:id/rollback', analyticsAdminGuard, editorialReviewGuard, blogController.rollbackPost);
  router.put('/:id', analyticsAdminGuard, blogController.updatePost);
  router.delete('/:id', analyticsAdminGuard, blogController.deletePost);

  return router;
};
