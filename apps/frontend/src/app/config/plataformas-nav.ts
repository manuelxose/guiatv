import type { PanelNavLink } from '../components/panel-nav/panel-nav.component';
import { PORTAL_ICON_PATHS } from './portal-navigation.config';
import { APP_PATHS } from './route-map';

export interface StreamingPlatform {
  /** Registry key (same id as the offers API `provider.id`). */
  key: string;
  /** Name used in ?platform= and by the catalogue filter. */
  name: string;
  color: string;
  /** Existing ranking article, when there is one. */
  guide?: string;
}

/**
 * Platforms whose catalogue filter returns titles (checked against the API). RTVE Play, ATRESplayer,
 * Mitele and Pluto TV return nothing yet, so they would be dead filters; they stay in the comparator.
 */
export const STREAMING_PLATFORMS: StreamingPlatform[] = [
  { key: 'netflix', name: 'Netflix', color: '#e50914', guide: '/guias/mejores-series-y-peliculas-netflix-espana' },
  { key: 'prime-video', name: 'Prime Video', color: '#00a8e1', guide: '/guias/mejores-series-y-peliculas-prime-video-espana' },
  { key: 'disney-plus', name: 'Disney+', color: '#113ccf', guide: '/guias/mejores-series-y-peliculas-disney-plus-espana' },
  { key: 'max', name: 'HBO Max', color: '#5b2bd9', guide: '/guias/mejores-series-y-peliculas-hbo-max-espana' },
  { key: 'movistar-plus', name: 'Movistar+', color: '#00a9e0', guide: '/guias/mejores-series-y-peliculas-movistar-plus-espana' },
  { key: 'skyshowtime', name: 'SkyShowtime', color: '#1d9bf0' },
  { key: 'apple-tv-plus', name: 'Apple TV+', color: '#6b7280' },
  { key: 'filmin', name: 'Filmin', color: '#00a88f' },
];

/** Menu of the Plataformas section (left panel and phone sub-nav). */
export const PLATAFORMAS_LINKS: PanelNavLink[] = [
  { label: 'Todas las plataformas', path: APP_PATHS.platforms, iconPath: PORTAL_ICON_PATHS.streaming, exact: true },
  { label: 'Comparador', path: APP_PATHS.streamingComparison, iconPath: PORTAL_ICON_PATHS.compare },
  { label: 'Gratis en streaming', path: APP_PATHS.platforms, queryParams: { availability: 'free' }, iconPath: PORTAL_ICON_PATHS.play },
];
