import express, { Router } from 'express';
import { createRateLimiter } from '../middlewares/rateLimit';
import { AnalyticsController } from '../controllers/AnalyticsController';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { AuthService } from '../../domain/services/AuthService';
import { createAdminAccessGuard } from '../middlewares/adminAccessGuard';
import { createOptionalAuthGuard, AuthenticatedRequest } from '../middlewares/authGuard';
import { AnalyticsViewModel } from '../../infrastructure/database/models/AnalyticsView.model';
import { successResponse } from '../../shared/types/ApiResponse';

/** One limiter for every mount of this router (`/analytics` and `/telemetry` share the per-IP budget). */
let sharedCollectLimit: ReturnType<typeof createRateLimiter> | null = null;
function collectRateLimit() {
  sharedCollectLimit ||= createRateLimiter({ windowMs: 60_000, max: Number(process.env.ANALYTICS_COLLECT_RATE_PER_MIN) || 240, message: 'Too many telemetry batches', exemptLocalReads: false });
  return sharedCollectLimit;
}

export const createAnalyticsRoutes = (
  controller: AnalyticsController,
  authService: AuthService
): Router => {
  const router = Router();
  const adminAccessGuard = createAdminAccessGuard(authService);
  const identifyAdmin = createOptionalAuthGuard(authService);
  const excludeAdminSession = asyncHandler(async (req, _res, next) => {
    if ((req as AuthenticatedRequest).user?.role === 'admin' && typeof req.body?.sessionId === 'string') {
      await controller.markExcludedSession(req.body.sessionId);
    }
    next();
  });
  // Legacy per-event endpoints: they no longer write directly (see AnalyticsController.legacyIngest), so the
  // admin-exclusion write runs only when legacy ingestion is explicitly accepted.
  router.use(['/session/start', '/session/heartbeat', '/session/end', '/event'], identifyAdmin, asyncHandler(async (req, res, next) => {
    if (process.env.ANALYTICS_LEGACY_ENDPOINTS === 'accept') return excludeAdminSession(req, res, next);
    next();
  }));

  // Current collector: batched, validated, rate-limited, queued (202). Beacons may arrive as text/plain.
  // Admin identification for /collect happens in the ingestion worker (token resolved off the request path).
  router.post('/collect', collectRateLimit(), express.json({ limit: '64kb' }), express.text({ type: 'text/plain', limit: '64kb' }), (req, _res, next) => {
    if (typeof req.body === 'string') {
      try {
        req.body = JSON.parse(req.body);
      } catch {
        req.body = null;
      }
    }
    next();
  }, asyncHandler(controller.collect.bind(controller)));
  router.get('/config', (req, res) => controller.getConfig(req, res));
  router.get('/diagnostics', adminAccessGuard, (req, res) => controller.getDiagnostics(req, res));
  router.get('/ga4/demographics', adminAccessGuard, asyncHandler(controller.getGa4Demographics.bind(controller)));

  router.get('/view', adminAccessGuard, asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) { res.status(403).json({ success: false, message: 'Se requiere una cuenta de administrador' }); return; }
    const view = await AnalyticsViewModel.findOne({ userId: user.id }).lean().exec();
    res.json(successResponse({ view }));
  }));
  router.put('/view', adminAccessGuard, asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) { res.status(403).json({ success: false, message: 'Se requiere una cuenta de administrador' }); return; }
    const { tab, rangeHours, eventFilter } = req.body || {};
    if (!['overview', 'pages', 'live', 'events', 'journeys', 'retention', 'geography', 'diagnostics'].includes(tab)
      || ![24, 168, 720].includes(rangeHours)
      || (eventFilter && !['page_view', 'click', 'scroll_depth', 'visibility', 'session_start'].includes(eventFilter))) {
      res.status(400).json({ success: false, message: 'Vista no válida' }); return;
    }
    await AnalyticsViewModel.updateOne({ userId: user.id }, { $set: { tab, rangeHours, eventFilter: eventFilter || null } }, { upsert: true }).exec();
    res.json(successResponse({ saved: true }));
  }));

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
  router.get('/realtime-pages', adminAccessGuard, asyncHandler(controller.getRealtimePages.bind(controller)));
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
