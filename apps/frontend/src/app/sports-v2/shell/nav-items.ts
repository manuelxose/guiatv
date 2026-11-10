import { IconName } from '../ui/icon';

export interface NavItem {
  readonly label: string;
  readonly segments: readonly string[]; // relative to SPORTS_V2_BASE
  readonly icon: IconName;
  readonly mobile: boolean; // shown in the bottom tab bar
  /** App path outside football (the item opens another section instead of a football page). */
  readonly path?: string;
}

/** Football news are the blog's football guides: the news link opens that section of Guías. */
export const FOOTBALL_NEWS_PATH = '/guias/categoria/futbol';

/** Single source for sidebar, mobile tab bar and route titles. */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Inicio', segments: [], icon: 'home', mobile: true },
  { label: 'En directo', segments: ['en-directo'], icon: 'live', mobile: true },
  { label: 'Partidos', segments: ['partidos'], icon: 'calendar', mobile: true },
  { label: 'Resultados', segments: ['resultados'], icon: 'results', mobile: false },
  { label: 'Competiciones', segments: ['competiciones'], icon: 'trophy', mobile: true },
  { label: 'Clasificaciones', segments: ['clasificaciones'], icon: 'shield', mobile: false },
  { label: 'Noticias', segments: ['noticias'], icon: 'news', mobile: true, path: FOOTBALL_NEWS_PATH },
  { label: 'Mi fútbol', segments: ['siguiendo'], icon: 'star', mobile: false },
];
