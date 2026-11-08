import { APP_PATHS } from './route-map';
import { UnifiedPortalRailSection } from '../models/portal-shell.models';

export const PORTAL_ICON_PATHS = {
  menu:
    'M4.5 7.5h15M4.5 12h15M4.5 16.5h10.5',
  panel:
    'M4.5 6.75h4.5v10.5H4.5zM10.5 6.75h9v4.5h-9zM10.5 12.75h9v4.5h-9z',
  home:
    'M3.75 9.75 12 3l8.25 6.75M5.25 8.625V20.25h4.5v-4.5h4.5v4.5h4.5V8.625',
  live:
    'M4.5 6.75h15a1.5 1.5 0 0 1 1.5 1.5v8.25A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5V8.25a1.5 1.5 0 0 1 1.5-1.5Zm3-3 4.5 3m4.5-3-4.5 3',
  discover:
    'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18Zm3.75-11.25-4.5 1.5-1.5 4.5 4.5-1.5 1.5-4.5Z',
  streaming:
    'M3.75 7.5a2.25 2.25 0 0 1 2.25-2.25h12A2.25 2.25 0 0 1 20.25 7.5v9A2.25 2.25 0 0 1 18 18.75H6A2.25 2.25 0 0 1 3.75 16.5v-9Zm3 1.5h10.5m-10.5 3h6.75m-6.75 3h4.5',
  sports:
    'M7.5 6.75c1.15-.87 2.77-.87 3.92 0l4.16 3.15c1.15.87 1.68 2.35 1.36 3.76l-1.17 5.03a3.38 3.38 0 0 1-3.29 2.61H11.5a3.38 3.38 0 0 1-3.29-2.61l-1.17-5.03c-.32-1.41.21-2.89 1.36-3.76l4.16-3.15Z',
  editorial:
    'M6.75 5.25h10.5v13.5H6.75zM9 8.25h6M9 11.25h6M9 14.25h4.5',
  rankings:
    'M6.75 18.75h10.5M8.25 15.75h7.5M9.75 12.75h4.5',
  trends:
    'M7.5 15.75 10.5 12l2.25 2.25L16.5 9.75',
  compare:
    'M6.75 7.5h4.5v9h-4.5zM12.75 5.25h4.5v11.25h-4.5z',
  calendar:
    'M6.75 3.75v2.25M17.25 3.75v2.25M4.5 8.25h15M6.75 12h3v3h-3zM4.5 6.75h15v12h-15z',
  search:
    'M10.5 4.5a6 6 0 1 0 0 12a6 6 0 0 0 0-12Zm0 0 7.5 7.5',
  account:
    'M15.75 6.75a3.75 3.75 0 1 1-7.5 0a3.75 3.75 0 0 1 7.5 0ZM4.5 19.5a7.5 7.5 0 0 1 15 0',
  play:
    'M8.25 7.5 16.5 12l-8.25 4.5v-9Z',
  bolt:
    'M13.5 3 5.25 13.5h5.25L9.75 21l9-11.25H13.5L13.5 3Z',
  sparkles:
    'M12 3.75 13.76 8.24 18.25 10 13.76 11.76 12 16.25 10.24 11.76 5.75 10l4.49-1.76L12 3.75Zm6.75 10.5 1.03 2.47 2.47 1.03-2.47 1.03-1.03 2.47-1.03-2.47-2.47-1.03 2.47-1.03 1.03-2.47Z',
  bookmark:
    'M6.75 4.5h10.5a1.5 1.5 0 0 1 1.5 1.5v13.19a.75.75 0 0 1-1.2.6L12 15.75l-5.55 4.04a.75.75 0 0 1-1.2-.6V6a1.5 1.5 0 0 1 1.5-1.5Z',
  history:
    'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4.5H9m3-3.75V12l3.75 2.25',
  liveDot:
    'M8.25 8.25h.008v.008H8.25V8.25Zm3.75 0h.008v.008H12V8.25Zm3.75 0h.008v.008H15.75V8.25ZM6.75 12h10.5M6.75 15.75h6',
  channels:
    'M4.5 7.5h15v9h-15zM7.5 19.5h9',
  platforms:
    'M4.5 7.5h15v9h-15zM8.25 19.5h7.5',
  clock:
    'M12 6v6l4.5 2.25M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
} as const;

export interface PortalDestination {
  id: 'home' | 'live' | 'discover' | 'streaming' | 'sports' | 'editorial' | 'rankings' | 'trends' | 'compare';
  label: string;
  hint: string;
  path: string;
  iconPath: string;
}

/**
 * The compact mobile bar is intentionally a subset of the global model.  The
 * final item opens the secondary navigation surface; it is not a duplicate
 * route disguised as a tab.
 */
export interface PortalMobileDestination {
  id: PortalDestination['id'] | 'more';
  label: string;
  path?: string;
  iconPath: string;
  kind: 'route' | 'more';
}

export interface PortalContextDestination {
  id: string;
  label: string;
  kind?: 'route' | 'action';
  path?: string;
  fragment?: string;
  queryParams?: Record<string, string>;
  iconPath?: string;
}

export type PortalSection = 'live' | 'discover' | 'platforms' | 'sports' | 'blog';

export interface PortalSectionNavigation {
  label: string;
  rootLabel: string;
  rootPath: string;
  items: readonly PortalContextDestination[];
}

export type PortalPublicShellSection =
  | 'generic'
  | 'live'
  | 'discover'
  | 'streaming'
  | 'sports'
  | 'editorial'
  | 'rankings';

export const PORTAL_PRIMARY_DESTINATIONS: readonly PortalDestination[] = [
  {
    id: 'live',
    label: 'TV',
    hint: 'Emisión activa, parrilla y canales',
    path: APP_PATHS.guide,
    iconPath: PORTAL_ICON_PATHS.live,
  },
  {
    id: 'discover',
    label: 'Qué ver',
    hint: 'Discovery editorial y catálogo',
    path: APP_PATHS.explore,
    iconPath: PORTAL_ICON_PATHS.discover,
  },
  {
    id: 'streaming',
    label: 'Plataformas',
    hint: 'Plataformas, tops y comparador',
    path: APP_PATHS.platforms,
    iconPath: PORTAL_ICON_PATHS.streaming,
  },
  {
    id: 'sports',
    label: 'Fútbol',
    hint: 'Directo, agenda y próximos',
    path: APP_PATHS.sports,
    iconPath: PORTAL_ICON_PATHS.sports,
  },
  {
    id: 'editorial',
    label: 'Guías',
    hint: 'Dónde ver, precios y rankings',
    path: APP_PATHS.blog,
    iconPath: PORTAL_ICON_PATHS.editorial,
  },
] as const;

export const PORTAL_GLOBAL_DESTINATIONS: readonly PortalDestination[] = [
  {
    id: 'home',
    label: 'Inicio',
    hint: 'Hub maestro del producto',
    path: APP_PATHS.home,
    iconPath: PORTAL_ICON_PATHS.home,
  },
  ...PORTAL_PRIMARY_DESTINATIONS,
  {
    id: 'rankings',
    label: 'Rankings',
    hint: 'Top listas para decidir rápido',
    path: APP_PATHS.top10,
    iconPath: PORTAL_ICON_PATHS.rankings,
  },
  {
    id: 'trends',
    label: 'Tendencias',
    hint: 'Lo que más se mueve ahora',
    path: APP_PATHS.stats,
    iconPath: PORTAL_ICON_PATHS.trends,
  },
  {
    id: 'compare',
    label: 'Comparador',
    hint: 'Cruce de plataformas y servicios',
    path: APP_PATHS.streamingComparison,
    iconPath: PORTAL_ICON_PATHS.compare,
  },
] as const;

/** Contextual navigation for the Guías family: crawlable category hubs, not fragments of one page. */
export const PORTAL_BLOG_DESTINATIONS: readonly PortalContextDestination[] = [
  { id: 'latest', label: 'Todas', kind: 'route', path: APP_PATHS.blog },
  { id: 'streaming', label: 'Streaming', kind: 'route', path: `${APP_PATHS.blog}/categoria/streaming` },
  { id: 'football', label: 'Fútbol', kind: 'route', path: `${APP_PATHS.blog}/categoria/futbol` },
  { id: 'rankings', label: 'Rankings', kind: 'route', path: APP_PATHS.top10 },
] as const;

/** Destinations progressively disclosed from the compact mobile bar. */
export const PORTAL_MOBILE_MORE_DESTINATIONS: readonly PortalDestination[] =
  PORTAL_GLOBAL_DESTINATIONS.filter((destination) =>
    ['streaming', 'editorial', 'rankings', 'trends'].includes(destination.id)
  );

/** Contextual navigation for the platform family. */
export const PORTAL_PLATFORM_DESTINATIONS: readonly PortalContextDestination[] = [
  { id: 'platforms', label: 'Plataformas', kind: 'route', path: APP_PATHS.platforms },
  { id: 'compare', label: 'Comparador', kind: 'route', path: APP_PATHS.streamingComparison },
] as const;

export const PORTAL_TV_DESTINATIONS: readonly PortalContextDestination[] = [
  { id: 'now', label: 'En emisión', kind: 'action', iconPath: PORTAL_ICON_PATHS.liveDot },
  { id: 'next', label: 'A continuación', kind: 'action', iconPath: PORTAL_ICON_PATHS.clock },
  { id: 'night', label: 'Esta noche', kind: 'action', iconPath: PORTAL_ICON_PATHS.clock },
  { id: 'day', label: 'Parrilla', kind: 'action', iconPath: PORTAL_ICON_PATHS.channels },
  { id: 'channels', label: 'Canales', kind: 'route', path: APP_PATHS.channels, iconPath: PORTAL_ICON_PATHS.channels },
] as const;

export const PORTAL_DISCOVER_DESTINATIONS: readonly PortalContextDestination[] = [
  { id: 'all', label: 'Todo', kind: 'action', iconPath: PORTAL_ICON_PATHS.discover },
  { id: 'live', label: 'En TV', kind: 'action', iconPath: PORTAL_ICON_PATHS.liveDot },
  { id: 'free', label: 'Gratis', kind: 'action', iconPath: PORTAL_ICON_PATHS.sparkles },
  // Real landing pages rather than in-page filters, so crawlers and users reach them from the section menu.
  { id: 'movies', label: 'Películas', kind: 'route', path: APP_PATHS.movies, iconPath: PORTAL_ICON_PATHS.play },
  { id: 'series', label: 'Series', kind: 'route', path: APP_PATHS.series, iconPath: PORTAL_ICON_PATHS.editorial },
  { id: 'trends', label: 'Tendencias', kind: 'route', path: APP_PATHS.stats, iconPath: PORTAL_ICON_PATHS.trends },
] as const;

// Consolidated structural destinations (§4 nav rework): "En directo",
// "Partidos de hoy" and "Calendario" collapse into one `matches` destination.
// Those states are filters/date selection *inside* Partidos, not competing
// top-level routes — the underlying URLs (/en-directo, /partidos-hoy,
// /calendario) are preserved for SEO and still resolve to this same id via
// `resolveActive()` in portal-context-nav.component.ts.
export const PORTAL_SPORTS_DESTINATIONS: readonly PortalContextDestination[] = [
  { id: 'home', label: 'Portada', kind: 'route', path: APP_PATHS.football },
  { id: 'matches', label: 'Partidos', kind: 'route', path: `${APP_PATHS.football}/partidos` },
  { id: 'competitions', label: 'Competiciones', kind: 'route', path: `${APP_PATHS.football}/competiciones` },
  { id: 'watch', label: 'Dónde ver', kind: 'route', path: APP_PATHS.football, fragment: 'donde-ver' },
  { id: 'news', label: 'Noticias', kind: 'route', path: `${APP_PATHS.football}/noticias` },
] as const;

/** Canonical source for the primary contextual navigation of every portal section. */
export const PORTAL_SECTION_NAVIGATION: Readonly<Record<PortalSection, PortalSectionNavigation>> = {
  live: {
    label: 'Secciones de TV',
    rootLabel: 'TV',
    rootPath: APP_PATHS.guide,
    items: PORTAL_TV_DESTINATIONS,
  },
  discover: {
    label: 'Secciones de Qué ver',
    rootLabel: 'Qué ver',
    rootPath: APP_PATHS.explore,
    items: PORTAL_DISCOVER_DESTINATIONS,
  },
  platforms: {
    label: 'Secciones de Plataformas',
    rootLabel: 'Plataformas',
    rootPath: APP_PATHS.platforms,
    items: PORTAL_PLATFORM_DESTINATIONS,
  },
  sports: {
    label: 'Secciones de Fútbol',
    rootLabel: 'Fútbol',
    rootPath: APP_PATHS.football,
    items: PORTAL_SPORTS_DESTINATIONS,
  },
  blog: {
    label: 'Secciones de Guías',
    rootLabel: 'Guías',
    rootPath: APP_PATHS.blog,
    items: PORTAL_BLOG_DESTINATIONS,
  },
} as const;

export type PortalPrimaryDestinationId = 'live' | 'discover' | 'streaming' | 'sports' | 'editorial';

export function resolvePortalPrimaryDestination(path: string): PortalPrimaryDestinationId | null {
  const normalized = path.split('?')[0].split('#')[0].replace(/\/$/, '') || '/';

  if (normalized.startsWith(APP_PATHS.blog)) {
    return 'editorial';
  }
  if (normalized.startsWith(APP_PATHS.sports)) return 'sports';
  if (normalized.startsWith(APP_PATHS.platforms) || normalized.startsWith(APP_PATHS.streamingComparison)) return 'streaming';
  if (
    normalized.startsWith(APP_PATHS.guide) ||
    normalized === APP_PATHS.channels ||
    normalized.startsWith(`${APP_PATHS.channels}/`)
  ) return 'live';
  if (
    normalized.startsWith(APP_PATHS.explore) ||
    normalized.startsWith(APP_PATHS.movies) ||
    normalized.startsWith(APP_PATHS.series) ||
    normalized.startsWith(APP_PATHS.stats) ||
    /^\/(contenido|peliculas|series|programas|detalles|pelicula-details)\//.test(normalized)
  ) return 'discover';
  return null;
}

/** One mobile-first navigation model, shared by the fixed bar and its sheet. */
export const PORTAL_MOBILE_PRIMARY_DESTINATIONS: readonly PortalMobileDestination[] = [
  { ...PORTAL_GLOBAL_DESTINATIONS.find((destination) => destination.id === 'home')!, kind: 'route' },
  { ...PORTAL_GLOBAL_DESTINATIONS.find((destination) => destination.id === 'live')!, kind: 'route' },
  { ...PORTAL_GLOBAL_DESTINATIONS.find((destination) => destination.id === 'sports')!, kind: 'route' },
  { ...PORTAL_GLOBAL_DESTINATIONS.find((destination) => destination.id === 'discover')!, kind: 'route' },
  {
    id: 'more',
    label: 'Más',
    iconPath: PORTAL_ICON_PATHS.menu,
    kind: 'more',
  },
] as const;

export const PORTAL_ACCOUNT_DESTINATIONS = [
  { id: 'profile', label: 'Perfil', path: APP_PATHS.profile, iconPath: PORTAL_ICON_PATHS.account },
  { id: 'for-you', label: 'Para ti', path: APP_PATHS.forYou, iconPath: PORTAL_ICON_PATHS.sparkles },
  { id: 'community', label: 'Comunidad', path: APP_PATHS.community, iconPath: PORTAL_ICON_PATHS.history },
] as const;

export function getPortalPublicRightRailLabel(section: PortalPublicShellSection): string {
  switch (section) {
    case 'live':
      return 'Panel TV';
    case 'streaming':
      return 'Panel streaming';
    case 'sports':
      return 'Panel deportes';
    case 'editorial':
      return 'Panel editorial';
    case 'rankings':
      return 'Panel rankings';
    default:
      return 'Panel contextual';
  }
}

export function getPortalPublicContextualLeftRailSection(
  section: PortalPublicShellSection
): UnifiedPortalRailSection {
  switch (section) {
    case 'live':
      return {
        id: 'public-live',
        eyebrow: 'TV Directo',
        title: 'Moverse por la guía',
        description: 'Ritmos y grupos de canal sin subir otra barra.',
        items: [
          { id: 'public-live-now', label: 'En emisión', description: 'Lo que está activo', iconPath: PORTAL_ICON_PATHS.liveDot, path: APP_PATHS.guide, queryParams: { liveView: 'now' } },
          { id: 'public-live-night', label: 'Esta noche', description: 'Prime time', iconPath: PORTAL_ICON_PATHS.clock, path: APP_PATHS.guide, queryParams: { liveView: 'night' } },
          { id: 'public-live-channels', label: 'Canales', description: 'Directorio lineal', iconPath: PORTAL_ICON_PATHS.channels, path: APP_PATHS.guide, queryParams: { liveView: 'day' } },
        ],
      };
    case 'streaming':
      return {
        id: 'public-streaming',
        eyebrow: 'Streaming',
        title: 'Entradas rápidas',
        description: 'Servicios, top valorado y comparador.',
        items: [
          { id: 'public-streaming-popular', label: 'Popular', description: 'Lo más visto', iconPath: PORTAL_ICON_PATHS.trends, path: APP_PATHS.platforms },
          { id: 'public-streaming-top', label: 'Top valorado', description: 'Mejor percepción', iconPath: PORTAL_ICON_PATHS.rankings, path: APP_PATHS.platforms, queryParams: { sort: 'rating' } },
          { id: 'public-streaming-compare', label: 'Comparador', description: 'Servicios y perfiles', iconPath: PORTAL_ICON_PATHS.compare, path: APP_PATHS.streamingComparison },
        ],
      };
    case 'sports':
      return {
        id: 'public-sports',
        eyebrow: 'Deportes',
        title: 'Agenda deportiva',
        description: 'Live, próximos y foco en fútbol.',
        items: [
          { id: 'public-sports-live', label: 'En directo', description: 'Eventos activos', iconPath: PORTAL_ICON_PATHS.liveDot, path: APP_PATHS.sports, queryParams: { timeRange: 'live' } },
          { id: 'public-sports-today', label: 'Hoy', description: 'Agenda del día', iconPath: PORTAL_ICON_PATHS.calendar, path: APP_PATHS.sports, queryParams: { timeRange: 'all' } },
          { id: 'public-sports-football', label: 'Fútbol', description: 'Disciplina prioritaria', iconPath: PORTAL_ICON_PATHS.sports, path: APP_PATHS.sports, queryParams: { sport: 'Fútbol' } },
        ],
      };
    case 'editorial':
    case 'rankings':
      return {
        id: 'public-editorial',
        eyebrow: 'Editorial',
        title: 'Contexto útil',
        description: 'Guías, rankings y cruces con discovery.',
        items: [
          { id: 'public-editorial-home', label: 'Editorial', description: 'Portada de Editorial', iconPath: PORTAL_ICON_PATHS.editorial, path: APP_PATHS.blog },
          { id: 'public-editorial-rankings', label: 'Rankings', description: 'Top listas conectadas', iconPath: PORTAL_ICON_PATHS.rankings, path: APP_PATHS.top10 },
          { id: 'public-editorial-explore', label: 'Qué Ver', description: 'Volver al discovery', iconPath: PORTAL_ICON_PATHS.discover, path: APP_PATHS.explore },
        ],
      };
    default:
      return {
        id: 'public-discover',
        eyebrow: 'Descubrir ahora',
        title: 'Entradas rápidas',
        description: 'Lo principal del portal en navegación secundaria.',
        items: [
          { id: 'public-generic-live', label: 'Ahora en TV', description: 'Lineal vivo', iconPath: PORTAL_ICON_PATHS.liveDot, path: APP_PATHS.guide, queryParams: { liveView: 'now' } },
          { id: 'public-generic-explore', label: 'Qué Ver', description: 'Discovery principal', iconPath: PORTAL_ICON_PATHS.discover, path: APP_PATHS.explore },
          { id: 'public-generic-platforms', label: 'Plataformas', description: 'Catálogos y servicios', iconPath: PORTAL_ICON_PATHS.platforms, path: APP_PATHS.platforms },
        ],
      };
  }
}

export function getPortalPublicRightRailSections(
  section: PortalPublicShellSection
): UnifiedPortalRailSection[] {
  switch (section) {
    case 'live':
      return [
        {
          id: 'right-live-now',
          eyebrow: 'Ahora',
          title: 'TV en foco',
          description: 'Zapping directo a la emisión y la noche.',
          variant: 'feature',
          items: [
            { id: 'right-live-feature', label: 'En emisión', description: 'Abrir la guía activa', iconPath: PORTAL_ICON_PATHS.liveDot, path: APP_PATHS.guide, queryParams: { liveView: 'now' } },
            { id: 'right-live-night', label: 'Prime time', description: 'Ir a esta noche', iconPath: PORTAL_ICON_PATHS.clock, path: APP_PATHS.guide, queryParams: { liveView: 'night' } },
          ],
        },
      ];
    case 'streaming':
      return [
        {
          id: 'right-streaming',
          eyebrow: 'Streaming',
          title: 'Servicios en foco',
          description: 'Entradas útiles sin convertir el panel en otro menú.',
          variant: 'logos',
          items: [
            { id: 'right-streaming-netflix', label: 'Netflix', description: 'Abrir servicio', path: APP_PATHS.platforms, queryParams: { platform: 'Netflix' } },
            { id: 'right-streaming-prime', label: 'Prime Video', description: 'Abrir servicio', path: APP_PATHS.platforms, queryParams: { platform: 'Prime Video' } },
            { id: 'right-streaming-max', label: 'HBO Max', description: 'Abrir servicio', path: APP_PATHS.platforms, queryParams: { platform: 'HBO Max' } },
          ],
        },
      ];
    case 'sports':
      return [
        {
          id: 'right-sports',
          eyebrow: 'Agenda',
          title: 'Live y próximos',
          description: 'Resumen deportivo lateral y compacto.',
          variant: 'feature',
          items: [
            { id: 'right-sports-live', label: 'En directo', description: 'Eventos activos ahora', iconPath: PORTAL_ICON_PATHS.liveDot, path: APP_PATHS.sports, queryParams: { timeRange: 'live' } },
            { id: 'right-sports-next', label: 'Próximos', description: 'Siguiente bloque', iconPath: PORTAL_ICON_PATHS.calendar, path: APP_PATHS.sports, queryParams: { timeRange: 'next' } },
          ],
        },
      ];
    case 'editorial':
    case 'rankings':
      return [
        {
          id: 'right-editorial',
          eyebrow: 'Editorial',
          title: 'Cruces útiles',
          description: 'Lleva el contexto editorial de vuelta al catálogo.',
          variant: 'compact',
          items: [
            { id: 'right-editorial-explore', label: 'Qué Ver', description: 'Volver al discovery', iconPath: PORTAL_ICON_PATHS.discover, path: APP_PATHS.explore },
            { id: 'right-editorial-top10', label: 'Rankings', description: 'Listas editoriales', iconPath: PORTAL_ICON_PATHS.rankings, path: APP_PATHS.top10 },
            { id: 'right-editorial-platforms', label: 'Plataformas', description: 'Abrir servicios', iconPath: PORTAL_ICON_PATHS.platforms, path: APP_PATHS.platforms },
          ],
        },
      ];
    default:
      return [
        {
          id: 'right-generic',
          eyebrow: 'Portal',
          title: 'Accesos rápidos',
          description: 'Contexto lateral sin duplicar la navegación principal.',
          variant: 'compact',
          items: [
            { id: 'right-generic-live', label: 'Ahora en TV', description: 'Ir al directo', iconPath: PORTAL_ICON_PATHS.liveDot, path: APP_PATHS.guide, queryParams: { liveView: 'now' } },
            { id: 'right-generic-platforms', label: 'Plataformas', description: 'Ver servicios', iconPath: PORTAL_ICON_PATHS.platforms, path: APP_PATHS.platforms },
            { id: 'right-generic-trends', label: 'Tendencias', description: 'Abrir tendencias', iconPath: PORTAL_ICON_PATHS.trends, path: APP_PATHS.stats },
          ],
        },
      ];
  }
}

export function resolvePortalPublicTopPillTarget(
  section: PortalPublicShellSection,
  value: string
): { path: string; queryParams?: Record<string, string> } | null {
  const shared: Record<string, { path: string; queryParams?: Record<string, string> }> = {
    platforms: { path: APP_PATHS.platforms },
    trending: { path: APP_PATHS.stats },
    free: { path: APP_PATHS.explore, queryParams: { availability: 'free' } },
  };

  if (section === 'live') {
    return {
      now: { path: APP_PATHS.guide, queryParams: { liveView: 'now' } },
      next: { path: APP_PATHS.guide, queryParams: { liveView: 'next' } },
      night: { path: APP_PATHS.guide, queryParams: { liveView: 'night' } },
      day: { path: APP_PATHS.guide, queryParams: { liveView: 'day' } },
      tdt: { path: APP_PATHS.guide, queryParams: { group: 'tdt' } },
      'sports-tv': { path: APP_PATHS.guide, queryParams: { group: 'deporte' } },
    }[value] || null;
  }

  if (section === 'streaming') {
    return {
      popular: { path: APP_PATHS.platforms, queryParams: { sort: 'popular' } },
      recent: { path: APP_PATHS.platforms, queryParams: { sort: 'recent' } },
      rating: { path: APP_PATHS.platforms, queryParams: { sort: 'rating' } },
      movie: { path: APP_PATHS.platforms, queryParams: { type: 'movie' } },
      series: { path: APP_PATHS.platforms, queryParams: { type: 'series' } },
      free: shared.free,
    }[value] || null;
  }

  if (section === 'sports') {
    return {
      live: { path: APP_PATHS.sports, queryParams: { timeRange: 'live' } },
      all: { path: APP_PATHS.sports, queryParams: { timeRange: 'all' } },
      tonight: { path: APP_PATHS.sports, queryParams: { timeRange: 'tonight' } },
      week: { path: APP_PATHS.sports, queryParams: { timeRange: 'week' } },
      football: { path: APP_PATHS.sports, queryParams: { sport: 'Fútbol' } },
      motor: { path: APP_PATHS.sports, queryParams: { sport: 'F1' } },
    }[value] || null;
  }

  if (section === 'editorial') {
    return {
      'editorial-home': { path: APP_PATHS.blog },
      'editorial-rankings': { path: APP_PATHS.top10 },
      'editorial-trends': { path: APP_PATHS.stats },
      'editorial-platforms': { path: APP_PATHS.platforms },
    }[value] || null;
  }

  if (section === 'rankings') {
    return {
      'rankings-all': { path: APP_PATHS.top10 },
      'rankings-streaming': { path: APP_PATHS.platforms },
      'rankings-tv': { path: APP_PATHS.guide },
      'rankings-sports': { path: APP_PATHS.sports },
    }[value] || null;
  }

  return (
    {
      'live-now': { path: APP_PATHS.guide, queryParams: { liveView: 'now' } },
      tonight: { path: APP_PATHS.guide, queryParams: { liveView: 'night' } },
      platforms: shared.platforms,
      'sports-live': { path: APP_PATHS.sports, queryParams: { timeRange: 'live' } },
      trending: shared.trending,
      free: shared.free,
    }[value] || null
  );
}
