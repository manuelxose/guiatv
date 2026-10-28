import { Router } from 'express';
import { SitemapController } from '../controllers/SitemapController';

export const createSitemapRoutes = (controller: SitemapController): Router => {
  const router = Router();

  router.get('/sitemap.xml', (req, res, next) => {
    void controller.getSitemapIndex(req, res, next);
  });
  router.get('/sitemap-static.xml', (req, res, next) => {
    void controller.getStaticSitemap(req, res, next);
  });
  router.get('/sitemap-channels.xml', (req, res, next) => {
    void controller.getChannelsSitemap(req, res, next);
  });
  router.get('/sitemap-programs.xml', (req, res, next) => {
    void controller.getProgramsSitemap(req, res, next);
  });
  router.get('/sitemap-works.xml', (req, res, next) => {
    void controller.getWorksSitemap(req, res, next);
  });
  router.get('/sitemap-blog.xml', (req, res, next) => {
    void controller.getBlogSitemap(req, res, next);
  });
  router.get('/sitemap-streaming.xml', (req, res, next) => {
    void controller.getStreamingSitemap(req, res, next);
  });
  router.get('/sitemap-football.xml', (req, res, next) => {
    void controller.getFootballSitemap(req, res, next);
  });

  return router;
};
