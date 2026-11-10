import type { PanelNavLink } from '../components/panel-nav/panel-nav.component';
import { PORTAL_ICON_PATHS } from './portal-navigation.config';
import { APP_PATHS } from './route-map';

export const QUE_VER_PATH = APP_PATHS.explore;

/** Menu of the Qué ver section (left panel and phone sub-nav): views of the page plus Tendencias and Para ti. */
export const QUE_VER_LINKS: PanelNavLink[] = [
  { label: 'Qué ver hoy', path: QUE_VER_PATH, iconPath: PORTAL_ICON_PATHS.discover, exact: true },
  { label: 'Ahora en TV', path: QUE_VER_PATH, queryParams: { cuando: 'ahora' }, iconPath: PORTAL_ICON_PATHS.live },
  { label: 'Esta noche', path: QUE_VER_PATH, queryParams: { cuando: 'noche' }, iconPath: PORTAL_ICON_PATHS.calendar },
  { label: 'Películas', path: QUE_VER_PATH, queryParams: { types: 'movie' }, iconPath: PORTAL_ICON_PATHS.play },
  { label: 'Series', path: QUE_VER_PATH, queryParams: { types: 'series' }, iconPath: PORTAL_ICON_PATHS.editorial },
  { label: 'Gratis', path: QUE_VER_PATH, queryParams: { donde: 'gratis' }, iconPath: PORTAL_ICON_PATHS.streaming },
  { label: 'Tendencias', path: '/tendencias', iconPath: PORTAL_ICON_PATHS.trends },
  { label: 'Para ti', path: APP_PATHS.forYou, iconPath: PORTAL_ICON_PATHS.account },
];
