import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { finalizeCanonical } from './ssr-canonical.mjs';
import { createSsrCache, isEditorialPath, isLivePath } from './ssr-cache.mjs';

const require = createRequire(import.meta.url);
try {
  const dominoUtils = require('domino/lib/utils');
  dominoUtils.nyi = () => null;
} catch {
  // Optional compatibility patch for transitive Domino usage.
}

await import('zone.js/node');
await import('@angular/compiler');

const {
  AngularNodeAppEngine,
} = await import('@angular/ssr/node');
const {
  ɵsetAngularAppEngineManifest,
  ɵsetAngularAppManifest,
} = await import('@angular/ssr');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const distFolder = process.env.FRONTEND_RELEASE_DIR
  ? resolve(process.env.FRONTEND_RELEASE_DIR)
  : resolve(__dirname, '../dist/guiatv');
const browserDistPath = join(distFolder, 'browser');
const serverDistPath = join(distFolder, 'server');
const port = Number(process.env.PORT || 3000);
const BASE_SITE_URL = 'https://guiaprogramaciontv.com';
const backendOrigin = process.env.API_ORIGIN || 'http://127.0.0.1:4000';
const backendUrl = new URL(backendOrigin);
const backendClient = backendUrl.protocol === 'https:' ? https : http;
const SSR_TIMEOUT_MS = 20000;
const SSR_CACHE_TTL_MS = Number(process.env.SSR_CACHE_TTL_MS) || 5 * 60 * 1000; // env override: tests only
// Marks this process's own refresh requests; random per process and never logged or sent to clients, so a header
// sent through nginx cannot skip the cache.
const SSR_REFRESH_TOKEN = randomUUID();
const SSR_ALLOWED_HOSTS = [
  'guiaprogramaciontv.com',
  'www.guiaprogramaciontv.com',
  '127.0.0.1',
  'localhost',
];
const SSR_ALLOWED_HOST_SET = new Set(SSR_ALLOWED_HOSTS);
const SSR_TRUST_PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-proto'];
const proxyPaths = ['/v2', '/storage', '/sitemap.xml'];
// Stale-while-revalidate (ssr-cache.mjs): "on now" pages may be served at most 10 min old, others 30 min.
const ssrCache = createSsrCache({
  ttlMs: SSR_CACHE_TTL_MS,
  staleMs: (path) => (isLivePath(path) ? 2 : 6) * SSR_CACHE_TTL_MS,
});

const KNOWN_ROUTES = [
  /^\/$/,
  /^\/iniciar-sesion$/,
  /^\/registro$/,
  /^\/perfil$/,
  /^\/mi-cuenta$/,
  /^\/comunidad$/,
  /^\/para-ti$/,
  /^\/admin$/,
  /^\/programacion-tv\/(series|peliculas|guia-canales|en-directo|que-ver-hoy)$/,
  /^\/programacion-tv\/ver-canal\/[^/]+$/,
  /^\/canales$/,
  /^\/canales\/[^/]+$/,
  /^\/plataformas$/,
  /^\/deportes$/,
  /^\/deportes\/futbol(\/.*)?$/,
  /^\/contenido\/[^/]+$/,
  /^\/peliculas\/[^/]+$/,
  /^\/series\/[^/]+$/,
  /^\/programas\/[^/]+$/,
  /^\/guias(\/.*)?$/,
  /^\/editorial(\/.*)?$/,
  /^\/blog(\/.*)?$/,
  /^\/comparador-streaming$/,
  /^\/developers$/,
  /^\/embed$/,
  /^\/embed\/programacion$/,
  /^\/tendencias$/,
  /^\/sobre-nosotros$/,
  /^\/prensa$/,
  /^\/program-full-details\/[^/]+$/,
  /^\/avisolegal$/,
  /^\/politica-editorial$/,
  /^\/privacidad$/,
  /^\/cookies$/,
  /^\/terminos$/,
  /^\/accesibilidad$/,
  /^\/sitemap$/,
  /^\/ver-canal\/[^/]+$/,
  /^\/detalles\/[^/]+$/,
  /^\/pelicula-details\/[^/]+$/,
];

const NOINDEX_ROUTES = [
  /^\/(?:iniciar-sesion|registro|perfil|mi-cuenta|comunidad|para-ti|admin)(?:\/.*)?$/,
  /^\/contenido\/[^/]+$/,
  // Client-rendered iframe widget: a 200 shell for third-party sites, never a search result.
  /^\/embed\/programacion$/,
];
// The only page other sites may frame (the widget advertised on /embed); everything else stays SAMEORIGIN.
const FRAMEABLE_PATH = '/embed/programacion';

function isKnownRoute(url) {
  const path = url.split('?')[0].split('#')[0];
  return KNOWN_ROUTES.some((re) => re.test(path));
}

function isNoindexRoute(url) {
  const path = url.split('?')[0].split('#')[0];
  return NOINDEX_ROUTES.some((re) => re.test(path));
}

function injectRobots(html, value) {
  if (/<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/i.test(html)) {
    return html.replace(
      /<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="robots" content="${value}">`
    );
  }
  return html.replace('</head>', `<meta name="robots" content="${value}"></head>`);
}

function applyRobotsHeader(html, res) {
  const robotsMatch = html.match(/<meta\s+name="robots"\s+content="([^"]+)"/i);
  if (robotsMatch) res.setHeader('X-Robots-Tag', robotsMatch[1]);
}

function stripStatusMarker(html) {
  return html.replace(/<meta\s+name="ssr-status"\s+content="\d+"\s*\/?>/g, '');
}

// One background re-render per path through this server's own pipeline, so status, robots, canonical, host and
// cache rules all apply; its outcome settles the cache like any other render. Logged without the token.
function refreshInBackground(pathname) {
  ssrCache.refreshOnce(pathname, () => new Promise((resolve) => {
    const started = Date.now();
    const done = (outcome) => {
      const line = `[SSR] stale refresh ${pathname} -> ${outcome} in ${Date.now() - started} ms`;
      if (outcome === 200) console.log(line);
      else console.warn(line);
      resolve();
    };
    http
      .get(
        {
          host: '127.0.0.1',
          port,
          path: pathname,
          headers: { host: 'guiaprogramaciontv.com', 'x-forwarded-proto': 'https', 'x-ssr-refresh': SSR_REFRESH_TOKEN },
          timeout: SSR_TIMEOUT_MS + 5000,
        },
        (res) => res.resume().on('end', () => done(res.statusCode))
      )
      .on('timeout', function onTimeout() {
        this.destroy(new Error('timeout'));
      })
      .on('error', (error) => done(error.message));
  }));
}

function getFallbackIndexPath() {
  const indexHtml = join(browserDistPath, 'index.html');
  if (existsSync(indexHtml)) return indexHtml;
  const csrHtml = join(browserDistPath, 'index.csr.html');
  return existsSync(csrHtml) ? csrHtml : null;
}

function sendCsrFallback(req, res, statusCode) {
  if (statusCode >= 500) res.setHeader('Retry-After', '120');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const fallbackPath = getFallbackIndexPath();
  if (!fallbackPath) {
    res.status(500).send('<h1>500 - Error Interno</h1><p>No se pudo cargar la aplicación.</p>');
    return;
  }

  let html = readFileSync(fallbackPath, 'utf-8');
  if (statusCode >= 400 || isNoindexRoute(req.originalUrl)) {
    html = injectRobots(html, statusCode >= 400 ? 'noindex, nofollow' : 'noindex, follow');
  }
  html = finalizeCanonical(html, { baseUrl: BASE_SITE_URL, pathname: req.path, statusCode }).html;
  applyRobotsHeader(html, res);
  res.status(statusCode).send(html);
}

function copyResponseHeaders(source, destination) {
  for (const [name, value] of source.headers.entries()) {
    if (name === 'content-length') continue;
    if (name === 'set-cookie') {
      destination.setHeader(name, source.headers.getSetCookie());
      continue;
    }
    destination.setHeader(name, value);
  }
}

function proxyToBackend(req, res) {
  const targetUrl = new URL(req.originalUrl, backendOrigin);
  const headers = { ...req.headers, host: backendUrl.host };
  const options = {
    protocol: backendUrl.protocol,
    hostname: backendUrl.hostname,
    port: backendUrl.port || (backendUrl.protocol === 'https:' ? 443 : 80),
    method: req.method,
    path: `${targetUrl.pathname}${targetUrl.search}`,
    headers,
  };

  const proxyReq = backendClient.request(options, (proxyRes) => {
    res.statusCode = proxyRes.statusCode || 502;
    Object.entries(proxyRes.headers).forEach(([key, value]) => {
      if (value !== undefined) res.setHeader(key, value);
    });
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error('[SSR] Proxy error:', err);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Bad Gateway' });
      return;
    }
    res.end();
  });

  req.pipe(proxyReq, { end: true });
}

async function createAngularEngine() {
  const [appManifestModule, appEngineManifestModule] = await Promise.all([
    import(pathToFileURL(join(serverDistPath, 'angular-app-manifest.mjs')).href),
    import(pathToFileURL(join(serverDistPath, 'angular-app-engine-manifest.mjs')).href),
  ]);

  ɵsetAngularAppManifest(appManifestModule.default ?? appManifestModule);
  ɵsetAngularAppEngineManifest(appEngineManifestModule.default ?? appEngineManifestModule);

  return new AngularNodeAppEngine({
    allowedHosts: SSR_ALLOWED_HOSTS,
    trustProxyHeaders: SSR_TRUST_PROXY_HEADERS,
  });
}

const angularAppEngine = await createAngularEngine();
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', true);
app.set('etag', 'strong');

app.use((req, res, next) => {
  const hostHeader = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;
  let hostname = '';
  try {
    hostname = new URL(`http://${hostHeader || ''}`).hostname.toLowerCase();
  } catch {
    // Invalid or missing Host headers are rejected below.
  }
  if (!SSR_ALLOWED_HOST_SET.has(hostname)) {
    return res.status(400).send('Bad Request');
  }
  return next();
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.path === FRAMEABLE_PATH) {
    // CSP frame-ancestors supersedes X-Frame-Options; XFO has no "allow any origin" value, so it is omitted here.
    res.setHeader('Content-Security-Policy', 'frame-ancestors *');
  } else {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

try {
  const { default: compression } = await import('compression');
  app.use(compression());
  console.log('[SSR] Compression enabled');
} catch {
  console.log('[SSR] Compression not enabled (optional dependency missing)');
}

proxyPaths.forEach((path) => {
  app.use(path, (req, res) => proxyToBackend(req, res));
});

app.get('/.well-known/*', (_req, res) => {
  res.status(204).end();
});

// 301 to `path`, keeping the query string (filters in shared links survive the move).
const movedTo = (req, res, path) => {
  const query = req.originalUrl.indexOf('?');
  return res.redirect(301, query === -1 ? path : path + req.originalUrl.slice(query));
};
// 2026-10-20 restructure: section renamed to "Guías", live TV page named after its content, channel slugs hyphenated.
app.get('/programacion-tv/guia-canales', (req, res) => movedTo(req, res, '/programacion-tv/en-directo'));
app.get('/deportes/futbol/en-directo', (_req, res) => res.redirect(301, '/deportes/futbol/partidos-hoy?filter=live'));
// Football is the only sport: the section root is its hub (Angular's redirectTo would answer 302).
app.get('/deportes', (req, res) => movedTo(req, res, '/deportes/futbol'));
app.get('/canales/:id', (req, res, next) =>
  req.params.id.includes('_') ? movedTo(req, res, `/canales/${encodeURIComponent(req.params.id.replace(/_/g, '-'))}`) : next()
);
// Editorial posts merged into one canonical guide (docs/seo/editorial-drafts/consolidation-map.md): old slug -> new slug.
const PLAN_GUIDE = 'netflix-hbo-max-disney-prime-video-que-plan-elegir';
const EDITORIAL_REDIRECTS = {
  'donde-ver-la-champions-league-2026-27-en-tv-y-streaming-en-espana': 'donde-ver-champions-league-2026-27-espana',
  'donde-ver-champions-league-en-espana': 'donde-ver-champions-league-2026-27-espana',
  'como-ver-laliga-en-streaming-en-espana-guia-2026': 'donde-ver-laliga-2026-27-espana',
  'como-ver-laliga-en-streaming-plataformas-precios-y-canales': 'donde-ver-laliga-2026-27-espana',
  'donde-ver-laliga-en-espana': 'donde-ver-laliga-2026-27-espana',
  'comparativa-de-precios-de-plataformas-de-streaming-en-espana-netflix': 'precios-plataformas-streaming-espana',
  'comparativa-de-plataformas-de-streaming-en-espana-precios-y-catalogo': 'precios-plataformas-streaming-espana',
  'cuanto-cuesta-streaming-espana': 'precios-plataformas-streaming-espana',
  'streaming-por-menos-de-10-euros': 'precios-plataformas-streaming-espana',
  'plataformas-streaming-mas-baratas': 'precios-plataformas-streaming-espana',
  'netflix-vs-max-espana': PLAN_GUIDE,
  'max-vs-disney-plus-espana': PLAN_GUIDE,
  'netflix-vs-prime-video-espana': PLAN_GUIDE,
  'mejores-plataformas-para-series': PLAN_GUIDE,
  'mejores-plataformas-para-peliculas': PLAN_GUIDE,
  'mejor-plataforma-streaming-familias': PLAN_GUIDE,
  'que-plataforma-tiene-mas-peliculas': PLAN_GUIDE,
  // "hoy en TV" posts duplicated live pages: send readers to the live page (a value starting with "/" is a full path)
  'futbol-hoy-en-tv': '/deportes/futbol/partidos-hoy',
  'series-hoy-en-tv': '/programacion-tv/series',
  'peliculas-hoy-en-tv': '/programacion-tv/peliculas',
  'que-ver-hoy-en-tv-y-streaming': '/programacion-tv/que-ver-hoy',
  'como-saber-que-ver-esta-noche': '/programacion-tv/que-ver-hoy',
  'que-ver-esta-noche-en-la-tdt': '/programacion-tv/que-ver-hoy',
  'que-ver-en-familia-este-fin-de-semana': '/programacion-tv/que-ver-hoy',
  // Old per-platform ranking posts -> the rebuilt per-platform rankings
  'mejores-series-max-espana': 'mejores-series-y-peliculas-hbo-max-espana',
  'mejores-peliculas-max-espana': 'mejores-series-y-peliculas-hbo-max-espana',
  'mejores-series-max': 'mejores-series-y-peliculas-hbo-max-espana',
  'mejores-series-prime-video-espana': 'mejores-series-y-peliculas-prime-video-espana',
  'mejores-peliculas-prime-video-espana': 'mejores-series-y-peliculas-prime-video-espana',
  'mejores-peliculas-prime-video': 'mejores-series-y-peliculas-prime-video-espana',
  'mejores-peliculas-netflix-espana': 'mejores-series-y-peliculas-netflix-espana',
  'mejores-series-netflix': 'mejores-series-y-peliculas-netflix-espana',
  'mejores-series-disney-plus': 'mejores-series-y-peliculas-disney-plus-espana',
  'mejores-series-movistar-plus': 'mejores-series-y-peliculas-movistar-plus-espana',
  // TDT channel guides: the live channel directory is the maintained source
  'mejores-canales-tdt-para-cine-y-series': '/canales',
  'canales-de-cine-en-tdt-guia-completa-para-ver-peliculas-gratis-hoy': '/canales',
  'canales-infantiles-en-tdt-boing-sx3-y-clan-guia-de-programacion': '/canales',
};
const guidePath = (slug) => {
  const target = EDITORIAL_REDIRECTS[slug] || slug;
  return target.startsWith('/') ? target : `/guias/${encodeURIComponent(target)}`;
};
// The "rankings" category is the rankings hub under a second URL.
const categoryPath = (slug) => (slug === 'rankings' ? '/guias/rankings' : `/guias/categoria/${encodeURIComponent(slug)}`);
app.get('/guias/:slug', (req, res, next) =>
  EDITORIAL_REDIRECTS[req.params.slug] ? movedTo(req, res, guidePath(req.params.slug)) : next()
);
app.get('/guias/categoria/rankings', (req, res) => movedTo(req, res, '/guias/rankings'));
// Football articles are guides (the same blog posts); /guias/:slug is their one canonical URL.
app.get('/deportes/futbol/noticias/:slug', (req, res) => movedTo(req, res, guidePath(req.params.slug)));
app.get(['/editorial', '/blog'], (req, res) => movedTo(req, res, '/guias'));
app.get(['/editorial/rankings', '/blog/top10'], (req, res) => movedTo(req, res, '/guias/rankings'));
app.get(['/editorial/categoria/:slug', '/blog/categoria/:slug'], (req, res) => movedTo(req, res, categoryPath(req.params.slug)));
app.get(['/editorial/:slug', '/blog/:slug'], (req, res) => movedTo(req, res, guidePath(req.params.slug)));
app.get('/mi-cuenta', (_req, res) => res.redirect(301, '/perfil'));
app.get('/comunidad', (_req, res) => res.redirect(301, '/perfil'));

async function redirectLegacyCatalog(req, res, catalogId, next) {
  if (!catalogId) return res.status(404).send('Not found');
  try {
    const apiResponse = await fetch(`${backendOrigin}/v2/catalog/${encodeURIComponent(catalogId)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!apiResponse.ok && apiResponse.status !== 404 && apiResponse.status !== 410) {
      return sendCsrFallback(req, res, 503);
    }
    // 410 is the API's call (proof of permanent removal); a plain miss stays 404.
    if (apiResponse.status === 410) return res.status(410).send('Gone');
    if (apiResponse.ok) {
      const payload = await apiResponse.json();
      const detailPath = payload?.data?.detailPath;
      // A known airing can render directly without guessing a movie/series slug. It remains a noindex route.
      if (detailPath === req.path && req.path.startsWith('/contenido/')) return next();
      // Same-site content paths only: never the home page, another host (`//x`) or a redirect loop.
      if (typeof detailPath === 'string' && /^\/[^/]/.test(detailPath) && detailPath !== req.path) {
        return res.redirect(301, detailPath);
      }
    }
  } catch {
    return sendCsrFallback(req, res, 503);
  }
  return res.status(404).send('Not found');
}

app.get('/pelicula-details/:id', (req, res, next) => {
  const id = Number(req.params.id);
  return redirectLegacyCatalog(req, res, Number.isInteger(id) && id > 0 ? `tmdb:movie:${id}` : '', next);
});
app.get(['/detalles/:id', '/program-full-details/:id'], (req, res, next) => {
  const id = String(req.params.id || '').trim();
  return redirectLegacyCatalog(req, res, id ? `program:${id}` : '', next);
});

app.get('/contenido/:catalogId', async (req, res, next) => {
  const catalogId = req.params.catalogId || '';
  return redirectLegacyCatalog(req, res, catalogId, next);
});

// Historical EPG classification exposed this film under the series prefix. Keep the old URL useful without
// manufacturing a second catalogue identity; the movie route is the verified canonical target.
app.get('/series/camino-a-la-perdicion', (_req, res) => res.redirect(301, '/peliculas/camino-a-la-perdicion'));

// M10-C: a verified second XMLTV feed of a channel (`Telemadrid.TV` beside `Telemadrid.es`) is one channel: its page
// answers a 301 to the channel's own page. The API decides (persistent feed ids + same schedule, ChannelFeedAliases);
// only `-tv` slugs can be such a feed, so every other channel page costs no extra call. Any API doubt renders the page.
app.get('/canales/:slug', async (req, res, next) => {
  const slug = String(req.params.slug || '');
  if (!/[-_]tv$/i.test(slug)) return next();
  try {
    const apiResponse = await fetch(`${backendOrigin}/v2/tv/surface/channels/${encodeURIComponent(slug)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!apiResponse.ok) return next();
    const target = (await apiResponse.json())?.data?.canonicalChannel?.normalizedName;
    const path = typeof target === 'string' && /^[a-z0-9_]+$/.test(target) ? `/canales/${target.replace(/_/g, '-')}` : '';
    if (path && path !== req.path) return res.redirect(301, path);
  } catch {
    // Render the page as before; its canonical still names the channel when the API answers it.
  }
  return next();
});

app.get(['/programacion-tv/ver-canal/:id', '/ver-canal/:id'], (req, res) => {
  const slug = encodeURIComponent(String(req.params.id || '').trim());
  if (!slug) return res.status(404).send('Not found');
  return res.redirect(301, `/canales/${slug}`);
});

app.get('*.*', express.static(browserDistPath, { maxAge: '1y', immutable: true }));

app.get(/\.(?:js|mjs|css|map|json|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf)$/i, (_req, res) => {
  res.status(404).end();
});

app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('*', async (req, res) => {
  const hasAuthCookie = (req.headers.cookie || '').includes('session');
  const cachePath = req.originalUrl.split('?')[0];
  const noindexRoute = isNoindexRoute(req.originalUrl);
  const publicCacheable = !hasAuthCookie && !noindexRoute;

  const isRefresh = req.headers['x-ssr-refresh'] === SSR_REFRESH_TOKEN;

  if (publicCacheable && !isRefresh) {
    const cached = ssrCache.get(cachePath);
    if (cached) {
      res.setHeader('Cache-Control', cached.stale ? 'public, max-age=60, s-maxage=60' : 'public, max-age=60, s-maxage=300');
      res.setHeader('X-SSR-Cache', cached.stale ? 'STALE' : 'HIT');
      if (cached.stale) refreshInBackground(cachePath);
      applyRobotsHeader(cached.html, res);
      return res.status(cached.statusCode).send(cached.html);
    }
  }

  // Every rendered outcome settles the cache: one not stored below (redirect, 404/410 fallback, non-HTML) evicts a
  // stale copy, so an obsolete 200 never outlives a confirmed change; a 5xx keeps it (ssr-cache.mjs).
  let stored = false;
  if (publicCacheable) {
    res.once('finish', () => stored || ssrCache.settle(cachePath, { statusCode: res.statusCode, cacheable: false }));
  }

  res.setHeader('X-SSR-Cache', 'MISS');

  try {
    const response = await Promise.race([
      angularAppEngine.handle(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SSR render timeout')), SSR_TIMEOUT_MS)),
    ]);

    if (!response) {
      return sendCsrFallback(req, res, isKnownRoute(req.originalUrl) ? 503 : 404);
    }

    if (response.status >= 300 && response.status < 400) {
      copyResponseHeaders(response, res);
      return res.status(response.status).end();
    }

    const responseType = response.headers.get('content-type') || '';
    copyResponseHeaders(response, res);

    if (!responseType.includes('text/html')) {
      const text = await response.text();
      return res.status(response.status).send(text);
    }

    let html = await response.text();
    let statusCode = response.status || 200;
    const statusMatch = html.match(/<meta\s+name="ssr-status"\s+content="(\d+)"/);
    if (statusMatch) {
      statusCode = Number(statusMatch[1]);
    } else if (statusCode === 200 && !isKnownRoute(req.originalUrl)) {
      statusCode = 404;
    }

    if (!html.trim() || html.includes('<app-root></app-root>')) {
      // Private/auth pages (noindex, rendered client-side) are not a server failure: serve the shell with 200 + noindex
      // instead of a 503 that crawlers would read as an outage on every footer link to /perfil.
      if (noindexRoute && statusCode < 400) return sendCsrFallback(req, res, 200);
      return sendCsrFallback(req, res, statusCode >= 400 ? statusCode : 503);
    }

    html = stripStatusMarker(html);
    const entityResponse = response.headers.get('X-Entity-Public-Read') === '1';
    if (statusCode >= 400 || noindexRoute || entityResponse) {
      html = injectRobots(html, statusCode >= 400 && !entityResponse ? 'noindex, nofollow' : 'noindex, follow');
    }
    // Keeps the canonical Angular rendered (it used to be overwritten with req.path); see ssr-canonical.mjs.
    const canonical = finalizeCanonical(html, { baseUrl: BASE_SITE_URL, pathname: req.path, statusCode });
    html = canonical.html;
    if (canonical.fallback) res.setHeader('X-SSR-Canonical', 'fallback');

    applyRobotsHeader(html, res);

    // 5xx = the route could not load its data (see MetaService.markUnavailable): never cache it.
    if (statusCode >= 500) res.setHeader('Retry-After', '120');
    res.setHeader(
      'Cache-Control',
      publicCacheable && !entityResponse && statusCode < 500 ? 'public, max-age=60, s-maxage=300' : 'no-store'
    );
    if (publicCacheable && !entityResponse && statusCode < 500) {
      ssrCache.settle(cachePath, { statusCode, html, cacheable: true });
      stored = true;
    }

    return res.status(statusCode).send(html);
  } catch (err) {
    console.error('[SSR] ❌ Render Error:', err);
    return sendCsrFallback(req, res, 503);
  }
});

// Phase 3E: the API says which legacy pages receive enrichment (health header). When that changes, pages rendered
// under the previous state are dropped, so a rollout or rollback never serves a mixed set. A failed poll changes nothing.
// M11-F: the same poll carries the editorial epoch; a publication drops only the guide, football and home pages,
// so a new guide shows in its listings within one poll instead of after a stale-while-revalidate round.
let enrichmentEpoch = null;
let editorialEpoch = null;
function pollEnrichmentEpoch() {
  backendClient
    .get(new URL('/v2/health', backendUrl), { timeout: 3000 }, (res) => {
      res.resume();
      const epoch = res.headers['x-legacy-enrichment-epoch'];
      if (typeof epoch === 'string') {
        if (enrichmentEpoch !== null && epoch !== enrichmentEpoch) {
          ssrCache.clear();
          console.log(`[SSR] legacy enrichment state ${enrichmentEpoch} -> ${epoch}; rendered-page cache cleared`);
        }
        enrichmentEpoch = epoch;
      }
      const editorial = res.headers['x-editorial-epoch'];
      if (typeof editorial === 'string') {
        if (editorialEpoch !== null && editorial !== editorialEpoch) ssrCache.clear(isEditorialPath);
        editorialEpoch = editorial;
      }
    })
    .on('timeout', function onTimeout() { this.destroy(); })
    .on('error', () => undefined);
}
setInterval(pollEnrichmentEpoch, 30_000).unref();
pollEnrichmentEpoch();

const server = app.listen(port, () => {
  console.log(`[SSR] Server listening on http://localhost:${port}`);
});

function shutdown(signal) {
  console.log(`[SSR] Received ${signal}. Shutting down...`);
  server.close(() => {
    console.log('[SSR] Server closed.');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('[SSR] Forced shutdown.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
