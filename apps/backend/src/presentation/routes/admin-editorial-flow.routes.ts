import { Router } from 'express';
import { AuthService } from '../../domain/services/AuthService';
import { createAdminAccessGuard } from '../middlewares/adminAccessGuard';
import { humanEditorialReviewGuard } from '../middlewares/editorialReviewGuard';
import { strictRateLimit } from '../middlewares/rateLimit';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { EditorialFlowController } from '../controllers/EditorialFlowController';

/**
 * M14-R7 — Observatorio editorial (/v2/admin/editorial/flow).
 *
 * Solo lectura para el diagnóstico. Las dos escrituras reutilizan los mecanismos
 * existentes y quedan con el mismo guard de admin del resto del panel:
 * - `/recovery/*` encola solicitudes de generación, acciones de cola o reintentos del ledger;
 * - `/publication/:postId/now` exige además la clave de revisión HUMANA, como la
 *   activación de la política y el cambio de límite diario, y publica por la ruta
 *   real de publicación por política (gates incluidos).
 */
export const createAdminEditorialFlowRoutes = (controller: EditorialFlowController, authService: AuthService): Router => {
  const router = Router();
  router.use(createAdminAccessGuard(authService));

  router.get('/guide', asyncHandler(controller.guide));
  router.get('/funnel', asyncHandler(controller.funnel));
  router.get('/reconciliation', asyncHandler(controller.reconciliation));
  router.get('/scheduler', asyncHandler(controller.scheduler));
  router.get('/topic/:id', asyncHandler(controller.topic));

  router.get('/publication/:postId/eligibility', asyncHandler(controller.eligibility));
  router.post('/publication/:postId/now', strictRateLimit, humanEditorialReviewGuard, asyncHandler(controller.publishNow));

  router.post('/recovery/bulk', strictRateLimit, asyncHandler(controller.recoveryBulk));
  router.post('/recovery/:topicId', strictRateLimit, asyncHandler(controller.recovery));

  return router;
};
