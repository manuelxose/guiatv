import { Router } from 'express';
import { AuthService } from '../../domain/services/AuthService';
import { FootballController } from '../controllers/FootballController';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { errorResponse } from '../../shared/types/ApiResponse';
import { createAdminAccessGuard } from '../middlewares/adminAccessGuard';

export const createFootballRoutes = (controller: FootballController, authService: AuthService): Router => {
  const router = Router();
  const adminAccessGuard = createAdminAccessGuard(authService);

  router.get('/home', asyncHandler(controller.home.bind(controller)));

  router.get('/matches/live', asyncHandler(controller.liveMatches.bind(controller)));
  router.get('/matches', asyncHandler(controller.matches.bind(controller)));
  router.get('/matches/:idOrSlug', asyncHandler(controller.matchDetail.bind(controller)));

  router.get('/competitions', asyncHandler(controller.competitions.bind(controller)));
  router.get('/competitions/:slug', asyncHandler(controller.competitionDetail.bind(controller)));

  router.get('/teams/:slug', asyncHandler(controller.teamDetail.bind(controller)));

  router.get('/news', asyncHandler(controller.news.bind(controller)));
  router.get('/search', asyncHandler(controller.search.bind(controller)));

  // Crest proxy: OpenLigaDB still publishes some badges over plain http://, which
  // an https page blocks as mixed content. Only these hosts are ever fetched, the
  // response is size-capped, and nothing is cached server-side. It is a pass-through
  // of the provider's own public asset, not a new data source.
  router.get('/image', asyncHandler(async (req, res) => {
    const ALLOWED = ['img.uefa.com', 'mediadb.kicker.de', 'assets.dfb.de', 'upload.wikimedia.org', 'i.imgur.com', 'ssl.gstatic.com', 's.hs-data.com', 'preview.redd.it'];
    let target: URL;
    try {
      target = new URL(String(req.query.url ?? ''));
    } catch {
      res.status(400).json(errorResponse('INVALID_PARAMS', 'url must be an absolute image URL'));
      return;
    }
    if (!ALLOWED.includes(target.hostname)) {
      res.status(400).json(errorResponse('INVALID_PARAMS', 'host not allowed'));
      return;
    }
    // We only ever upgrade to https: never fetch over plain http.
    target.protocol = 'https:';
    const upstream = await fetch(target.href, { signal: AbortSignal.timeout(6000) });
    if (!upstream.ok) {
      res.status(502).end();
      return;
    }
    const type = upstream.headers.get('content-type') ?? 'image/png';
    if (!/^image\//i.test(type)) {
      res.status(502).end();
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.byteLength > 512 * 1024) {
      res.status(502).end();
      return;
    }
    res.setHeader('content-type', type);
    res.setHeader('cache-control', 'public, max-age=86400, immutable');
    res.status(200).end(buf);
  }));

  // Broadcast reconciliation overrides (admin-only, shared admin boundary).
  router.post(
    '/broadcasts/override',
    adminAccessGuard,
    asyncHandler(controller.upsertBroadcastOverride.bind(controller))
  );
  router.delete(
    '/broadcasts/override',
    adminAccessGuard,
    asyncHandler(controller.clearBroadcastOverride.bind(controller))
  );

  return router;
};
