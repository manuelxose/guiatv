import type { PanelNavLink } from '../components/panel-nav/panel-nav.component';
import { PORTAL_ICON_PATHS } from './portal-navigation.config';
import { APP_PATHS } from './route-map';

/** Tabs of the private area (`?tab=`). */
export type PerfilTab = 'overview' | 'canales' | 'futbol' | 'lista' | 'asistente' | 'gustos' | 'avisos' | 'cuenta';

const BELL = 'M14.86 17.08a24.26 24.26 0 0 0 5.4-1.3 8.97 8.97 0 0 1-2.26-5.96V9a6 6 0 1 0-12 0v.82a8.97 8.97 0 0 1-2.26 5.96c1.73.64 3.54 1.08 5.4 1.3m5.72 0a24.26 24.26 0 0 1-5.72 0m5.72 0a3 3 0 1 1-5.72 0';

/** Menu of the profile area (left panel and phone chips). */
export const PERFIL_LINKS: Array<PanelNavLink & { tab?: PerfilTab }> = [
  { tab: 'overview', label: 'Hoy', path: APP_PATHS.profile, iconPath: PORTAL_ICON_PATHS.home, exact: true },
  { tab: 'canales', label: 'Mis canales', path: APP_PATHS.profile, queryParams: { tab: 'canales' }, iconPath: PORTAL_ICON_PATHS.live },
  { tab: 'futbol', label: 'Mi fútbol', path: APP_PATHS.profile, queryParams: { tab: 'futbol' }, iconPath: PORTAL_ICON_PATHS.sports },
  { tab: 'lista', label: 'Mi lista', path: APP_PATHS.profile, queryParams: { tab: 'lista' }, iconPath: PORTAL_ICON_PATHS.bookmark },
  { tab: 'asistente', label: 'Asistente IA', path: APP_PATHS.profile, queryParams: { tab: 'asistente' }, iconPath: PORTAL_ICON_PATHS.sparkles },
  { tab: 'gustos', label: 'Gustos y plataformas', path: APP_PATHS.profile, queryParams: { tab: 'gustos' }, iconPath: PORTAL_ICON_PATHS.streaming },
  { tab: 'avisos', label: 'Avisos', path: APP_PATHS.profile, queryParams: { tab: 'avisos' }, iconPath: BELL },
  { tab: 'cuenta', label: 'Cuenta y privacidad', path: APP_PATHS.profile, queryParams: { tab: 'cuenta' }, iconPath: PORTAL_ICON_PATHS.account },
];
