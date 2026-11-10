import { APP_PATHS, channelCanonicalPath, channelPath, normalizePath } from './route-map';
import {
  PORTAL_BLOG_DESTINATIONS,
  PORTAL_MOBILE_MORE_DESTINATIONS,
  PORTAL_MOBILE_PRIMARY_DESTINATIONS,
  PORTAL_PLATFORM_DESTINATIONS,
  PORTAL_PRIMARY_DESTINATIONS,
  PORTAL_DISCOVER_DESTINATIONS,
  PORTAL_SECTION_NAVIGATION,
  PORTAL_SPORTS_DESTINATIONS,
  PORTAL_TV_DESTINATIONS,
  resolvePortalPrimaryDestination,
} from './portal-navigation.config';

describe('route map', () => {
  it('defines five deliberate mobile destinations from the shared portal model', () => {
    expect(PORTAL_MOBILE_PRIMARY_DESTINATIONS.map((tab) => tab.id)).toEqual([
      'home', 'live', 'assistant', 'sports', 'more',
    ]);
    PORTAL_MOBILE_PRIMARY_DESTINATIONS.forEach((tab) => {
      expect(tab.label.length).toBeGreaterThan(0);
      expect(tab.iconPath).toBeTruthy();
    });
  });

  it('defines the canonical desktop hierarchy and contextual children', () => {
    expect(PORTAL_PRIMARY_DESTINATIONS.map((tab) => tab.label)).toEqual([
      'TV', 'Qué ver', 'Plataformas', 'Fútbol', 'Guías',
    ]);
    expect(PORTAL_BLOG_DESTINATIONS.map((tab) => tab.label)).toEqual([
      'Todas', 'Streaming', 'Fútbol', 'Rankings',
    ]);
    expect(PORTAL_PLATFORM_DESTINATIONS.map((tab) => tab.label)).toEqual(['Plataformas', 'Comparador']);
    expect(PORTAL_TV_DESTINATIONS.map((tab) => tab.label)).toEqual([
      'En emisión', 'A continuación', 'Esta noche', 'Parrilla', 'Canales',
    ]);
    expect(PORTAL_DISCOVER_DESTINATIONS.map((tab) => tab.label)).toEqual([
      'Todo', 'En TV', 'Gratis', 'Películas', 'Series', 'Tendencias',
    ]);
    expect(PORTAL_SPORTS_DESTINATIONS.map((tab) => tab.label)).toEqual([
      'Portada', 'Partidos', 'Competiciones', 'Dónde ver', 'Noticias',
    ]);
    expect(PORTAL_MOBILE_MORE_DESTINATIONS.map((tab) => tab.label)).toEqual([
      'Plataformas', 'Guías', 'Rankings', 'Tendencias',
    ]);
  });

  it('uses one canonical section model with route and action semantics', () => {
    expect(Object.keys(PORTAL_SECTION_NAVIGATION)).toEqual([
      'live', 'discover', 'platforms', 'sports', 'blog',
    ]);
    // In-page states are actions; anything with its own URL (Canales, Películas…) is a crawlable route.
    expect(PORTAL_SECTION_NAVIGATION.live.items.filter((item) => item.kind === 'route').map((item) => item.path)).toEqual([APP_PATHS.channels]);
    expect(PORTAL_SECTION_NAVIGATION.sports.items.every((item) => item.kind === 'route')).toBeTrue();
    expect(PORTAL_SECTION_NAVIGATION.sports.items.map((item) => item.label)).toEqual([
      'Portada',
      'Partidos',
      'Competiciones',
      'Dónde ver',
      'Noticias',
    ]);
  });

  it('resolves active primary destinations from canonical and detail routes', () => {
    expect(resolvePortalPrimaryDestination(APP_PATHS.blog)).toBe('editorial');
    expect(resolvePortalPrimaryDestination(APP_PATHS.top10)).toBe('editorial');
    expect(resolvePortalPrimaryDestination(APP_PATHS.stats)).toBe('discover');
    expect(resolvePortalPrimaryDestination(APP_PATHS.streamingComparison)).toBe('streaming');
    expect(resolvePortalPrimaryDestination('/peliculas/una-pelicula')).toBe('discover');
  });

  it('builds hyphenated channel URLs from underscore ids', () => {
    expect(channelPath('la_1')).toBe('/canales/la-1');
    expect(channelPath('m_liga_de_campeones_2')).toBe('/canales/m-liga-de-campeones-2');
  });

  it('normalizes query strings, hashes, and trailing slashes', () => {
    expect(normalizePath('/deportes/?day=today#live')).toBe('/deportes');
    expect(normalizePath('')).toBe('/');
  });
});

describe('channelCanonicalPath', () => {
  it('uses the sitemap identity (normalizedName), not the internal id', () => {
    expect(channelCanonicalPath({ id: 'dmax', normalizedName: 'discovery' }, 'dmax')).toBe('/canales/discovery');
    expect(channelCanonicalPath({ id: 'fdf', normalizedName: 'factoria_de_ficcion' }, 'fdf')).toBe('/canales/factoria-de-ficcion');
    expect(channelCanonicalPath({ id: 'la_1', normalizedName: 'la_1' }, 'la-1')).toBe('/canales/la-1');
  });

  it('falls back to the id, then the requested slug', () => {
    expect(channelCanonicalPath({ id: 'la_2' }, 'x')).toBe('/canales/la-2');
    expect(channelCanonicalPath(null, 'la-sexta')).toBe('/canales/la-sexta');
  });
});
