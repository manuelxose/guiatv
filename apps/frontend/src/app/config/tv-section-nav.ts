import type { PanelNavLink } from '../components/panel-nav/panel-nav.component';
import { PORTAL_ICON_PATHS } from './portal-navigation.config';
import { APP_PATHS } from './route-map';

/** Menu of the TV section (left panel and phone sub-nav), shared by the grid, channels, series and films pages. */
export const TV_SECTION_LINKS: PanelNavLink[] = [
  { label: 'Parrilla', path: APP_PATHS.guide, iconPath: PORTAL_ICON_PATHS.calendar },
  { label: 'Guía de canales', path: APP_PATHS.channels, iconPath: PORTAL_ICON_PATHS.channels, exact: true },
  { label: 'Series en TV', path: APP_PATHS.series, iconPath: PORTAL_ICON_PATHS.editorial },
  { label: 'Películas en TV', path: APP_PATHS.movies, iconPath: PORTAL_ICON_PATHS.play },
];
