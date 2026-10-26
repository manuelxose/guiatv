import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { getSwaggerSpec } from '../swagger/swagger.config';

/**
 * Serves Swagger UI and JSON spec for v2 API.
 */
export const createSwaggerRoutes = (): Router => {
  const router = Router();
  const spec = getSwaggerSpec();

  // Swagger UI options
  const uiOptions = {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Guía TV API Documentation',
    explorer: true,
    swaggerOptions: {
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
      persistAuthorization: true,
    },
  };

  // M10: nginx strips trailing slashes (/v2/docs/ -> /v2/docs) and serve-static adds one back, a redirect loop.
  // Serve the page itself without the slash; <base> keeps its relative assets under /v2/docs/.
  const html = swaggerUi.generateHTML(spec, uiOptions).replace('<head>', '<head><base href="/v2/docs/">');
  router.get('/', (req, res, next) => (req.originalUrl.split('?')[0].endsWith('/') ? next() : res.type('html').send(html)));

  // Swagger UI
  router.use('/', swaggerUi.serve);
  router.get('/', swaggerUi.setup(spec, uiOptions));

  // JSON spec
  router.get('/json', (req, res) => {
    void req;
    res.setHeader('Content-Type', 'application/json');
    res.send(spec);
  });

  return router;
};
