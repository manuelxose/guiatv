/**
 * Slugs this site answers with a 301 to a canonical guide. Source of truth: `EDITORIAL_REDIRECTS` in
 * `apps/frontend/scripts/ssr-server.mjs`, whose entries come from
 * docs/seo/editorial-drafts/consolidation-map.md.
 *
 * An imported article filed under one of these slugs would never be reachable at its own URL (the page redirects)
 * and would duplicate the guide it points to, so the article sync refuses it. Keep this list in step with that map:
 * it is the site's routing truth, not a feed preference.
 */
export const RETIRED_EDITORIAL_SLUGS: ReadonlySet<string> = new Set([
  // Champions League: one guide per competition.
  'donde-ver-la-champions-league-2026-27-en-tv-y-streaming-en-espana',
  'donde-ver-champions-league-en-espana',
  // LaLiga.
  'como-ver-laliga-en-streaming-en-espana-guia-2026',
  'como-ver-laliga-en-streaming-plataformas-precios-y-canales',
  'donde-ver-laliga-en-espana',
  // Streaming prices.
  'comparativa-de-precios-de-plataformas-de-streaming-en-espana-netflix',
  'comparativa-de-plataformas-de-streaming-en-espana-precios-y-catalogo',
  'cuanto-cuesta-streaming-espana',
  'streaming-por-menos-de-10-euros',
  'plataformas-streaming-mas-baratas',
  // "Which plan" comparisons.
  'netflix-vs-max-espana',
  'max-vs-disney-plus-espana',
  'netflix-vs-prime-video-espana',
  'mejores-plataformas-para-series',
  'mejores-plataformas-para-peliculas',
  'mejor-plataforma-streaming-familias',
  'que-plataforma-tiene-mas-peliculas',
  // "What to watch today": the live guide answers these.
  'futbol-hoy-en-tv',
  'series-hoy-en-tv',
  'peliculas-hoy-en-tv',
  'que-ver-hoy-en-tv-y-streaming',
  'como-saber-que-ver-esta-noche',
  'que-ver-esta-noche-en-la-tdt',
  'que-ver-en-familia-este-fin-de-semana',
  // Platform catalogues.
  'mejores-series-max-espana',
  'mejores-peliculas-max-espana',
  'mejores-series-max',
  'mejores-series-prime-video-espana',
  'mejores-peliculas-prime-video-espana',
  'mejores-peliculas-prime-video',
  'mejores-peliculas-netflix-espana',
  'mejores-series-netflix',
  'mejores-series-disney-plus',
  'mejores-series-movistar-plus',
  // Channel lists.
  'mejores-canales-tdt-para-cine-y-series',
  'canales-de-cine-en-tdt-guia-completa-para-ver-peliculas-gratis-hoy',
  'canales-infantiles-en-tdt-boing-sx3-y-clan-guia-de-programacion',
]);

/** True when the site redirects this slug away, so an imported article must not claim it. */
export const isRetiredEditorialSlug = (slug: string): boolean =>
  RETIRED_EDITORIAL_SLUGS.has(String(slug || '').trim().toLowerCase());
