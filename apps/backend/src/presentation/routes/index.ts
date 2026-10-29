// src/v2/presentation/routes/index.ts

import { Router } from 'express';
import { createEntityRoutes } from './entities.routes';
import { createHealthRoutes } from './health.routes';
import { generalRateLimit } from '../middlewares/rateLimit';
import { AdminController } from '../controllers/AdminController';
import { createAdminRoutes } from './admin.routes';
import { createSwaggerRoutes } from './swagger.routes';
import { AuthController } from '../controllers/AuthController';
import { createAuthRoutes } from './auth.routes';
import { DiscoveryController } from '../controllers/DiscoveryController';
import { createDiscoveryRoutes } from './discovery.routes';
import { ContentController } from '../controllers/ContentController';
import { createContentRoutes } from './content.routes';
import { CatalogController } from '../controllers/CatalogController';
import { createCatalogRoutes } from './catalog.routes';
import { TvController } from '../controllers/TvController';

import { createTvRoutes } from './tv.routes';
import { FootballController } from '../controllers/FootballController';
import { createFootballRoutes } from './football.routes';
import { BlogController } from '../controllers/BlogController';
import { createBlogRoutes } from './blog.routes';
import { AnalyticsController } from '../controllers/AnalyticsController';
import { createAnalyticsRoutes } from './analytics.routes';
import { AdminUsersController } from '../controllers/AdminUsersController';
import { createAdminUsersRoutes } from './admin-users.routes';
import { UserController } from '../controllers/UserController';
import { SocialController } from '../controllers/SocialController';
import { ChatController } from '../controllers/ChatController';
import { SitemapController } from '../controllers/SitemapController';
import { createUserRoutes } from './user.routes';
import { createSocialRoutes } from './social.routes';
import { createChatRoutes } from './chat.routes';
import { AuthService } from '../../domain/services/AuthService';
import { InteractionController } from '../controllers/InteractionController';
import { AIController } from '../controllers/AIController';
import { createInteractionRoutes } from './interaction.routes';
import { createAIRoutes } from './ai.routes';
import { AIAnalyticsController } from '../controllers/AIAnalyticsController';
import { createAdminAIAnalyticsRoutes } from './admin-ai-analytics.routes';
import { createListsPublicRoutes } from './lists-public.routes';
import { MonetizationController } from '../controllers/MonetizationController';
import { createMonetizationRoutes } from './monetization.routes';
import { AffiliateController } from '../controllers/AffiliateController';
import { createAffiliateRoutes } from './affiliate.routes';
import { AffiliateAdminController } from '../controllers/AffiliateAdminController';
import { createAdminAffiliateRoutes } from './admin-affiliate.routes';
import { EditorialOpsController } from '../controllers/EditorialOpsController';
import { createAdminEditorialRoutes } from './admin-editorial.routes';
import { editorialFactsHandler } from './editorial-facts.routes';

/**
 * Dependencies required by every route factory.
 */
export interface RoutesDependencies {
  adminController: AdminController;
  adminUsersController: AdminUsersController;
  authController: AuthController;
  authService: AuthService;
  discoveryController: DiscoveryController;
  contentController: ContentController;
  catalogController: CatalogController;

  tvController: TvController;
  footballController: FootballController;
  blogController: BlogController;
  editorialOpsController: EditorialOpsController;
  analyticsController: AnalyticsController;
  monetizationController: MonetizationController;
  affiliateController: AffiliateController;
  affiliateAdminController: AffiliateAdminController;
  userController: UserController;
  interactionController: InteractionController;
  socialController: SocialController;
  chatController: ChatController;
  aiController: AIController;
  aiAnalyticsController: AIAnalyticsController;
  sitemapController: SitemapController;
}

/**
 * Registers all v2 routers and shared middlewares.
 */
export const createV2Routes = (dependencies: RoutesDependencies): Router => {
  const router = Router();

  // Documentación Swagger
  router.use('/docs', createSwaggerRoutes());

  // Health check (sin rate limit)
  router.use('/health', createHealthRoutes());

  // Rutas de catálogo y detalle con límites específicos para evitar que la
  // navegación normal agote el rate limit general demasiado pronto.
  router.use(
    '/discovery',
    createDiscoveryRoutes(dependencies.discoveryController, dependencies.authService)
  );
  router.use(
    '/content',
    createContentRoutes(dependencies.contentController, dependencies.authService)
  );
  router.use(
    '/catalog',
    createCatalogRoutes(dependencies.catalogController, dependencies.authService)
  );
  router.use(
    '/user/interactions',
    createInteractionRoutes(dependencies.interactionController, dependencies.authService)
  );

  // Aplicar rate limiting general al resto de recursos.
  router.use('/entities', createEntityRoutes());
  router.use(generalRateLimit);

  // Rutas de recursos
  router.use(
    '/tv',
    createTvRoutes(dependencies.tvController)
  );
  router.use(
    '/sports/football',
    createFootballRoutes(dependencies.footballController)
  );
  router.use('/user', createUserRoutes(dependencies.userController, dependencies.authService));
  router.use('/social', createSocialRoutes(dependencies.socialController, dependencies.authService));
  router.use('/chat', createChatRoutes(dependencies.chatController, dependencies.authService));
  router.use('/ai', createAIRoutes(dependencies.aiController, dependencies.authService));

  router.use(
    '/admin/users',
    createAdminUsersRoutes(dependencies.adminUsersController, dependencies.authService)
  );
  router.use('/admin/editorial', createAdminEditorialRoutes(dependencies.editorialOpsController, dependencies.authService));
  router.use('/admin', createAdminRoutes(dependencies.adminController, dependencies.authService));
  router.use(
    '/admin/affiliate',
    createAdminAffiliateRoutes(dependencies.affiliateAdminController, dependencies.authService)
  );
  router.use('/admin/ai-analytics', createAdminAIAnalyticsRoutes(dependencies.aiAnalyticsController, dependencies.authService));
  router.use('/auth', createAuthRoutes(dependencies.authController));
  router.use('/blog', createBlogRoutes(dependencies.blogController, dependencies.authService));
  router.get('/editorial/facts', editorialFactsHandler);
  router.use('/monetization', createMonetizationRoutes(dependencies.monetizationController));
  router.use('/affiliate', createAffiliateRoutes(dependencies.affiliateController));
  router.use('/lists/public', createListsPublicRoutes());
  router.use('/analytics', createAnalyticsRoutes(dependencies.analyticsController, dependencies.authService));
  router.use('/telemetry', createAnalyticsRoutes(dependencies.analyticsController, dependencies.authService));

  // oEmbed endpoint — enables CMS auto-embedding and rich preview cards
  router.get('/oembed', (req, res) => {
    const url = typeof req.query.url === 'string' ? req.query.url : '';
    const format = req.query.format === 'xml' ? 'xml' : 'json';
    const maxwidth = Math.min(Number(req.query.maxwidth) || 600, 1200);
    const maxheight = Math.min(Number(req.query.maxheight) || 720, 900);

    const baseUrl = 'https://guiaprogramaciontv.com';
    const allowedOrigin = 'guiaprogramaciontv.com';

    // Validate URL belongs to our domain
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== allowedOrigin && parsed.hostname !== `www.${allowedOrigin}`) {
        res.status(404).json({ error: 'URL not supported' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'Invalid URL' });
      return;
    }

    const oembedResponse = {
      version: '1.0',
      type: 'rich' as const,
      provider_name: 'Guía Programación TV',
      provider_url: baseUrl,
      title: 'Widget de programación TV — Guía Programación TV',
      html: `<iframe src="${baseUrl}/embed/programacion?theme=light&channels=5&date=today&autorefresh=300&lang=es" width="${maxwidth}" height="${maxheight}" frameborder="0" title="Programación TV embebida" loading="lazy"></iframe>`,
      width: maxwidth,
      height: maxheight,
      thumbnail_url: `${baseUrl}/assets/og-image.jpg`,
      thumbnail_width: 1200,
      thumbnail_height: 630,
    };

    if (format === 'xml') {
      res.set('Content-Type', 'text/xml; charset=utf-8');
      res.send(`<?xml version="1.0" encoding="utf-8"?>
<oembed>
  <version>${oembedResponse.version}</version>
  <type>${oembedResponse.type}</type>
  <provider_name>${oembedResponse.provider_name}</provider_name>
  <provider_url>${oembedResponse.provider_url}</provider_url>
  <title>${oembedResponse.title}</title>
  <html><![CDATA[${oembedResponse.html}]]></html>
  <width>${oembedResponse.width}</width>
  <height>${oembedResponse.height}</height>
  <thumbnail_url>${oembedResponse.thumbnail_url}</thumbnail_url>
  <thumbnail_width>${oembedResponse.thumbnail_width}</thumbnail_width>
  <thumbnail_height>${oembedResponse.thumbnail_height}</thumbnail_height>
</oembed>`);
      return;
    }

    res.json(oembedResponse);
  });

  return router;
};
