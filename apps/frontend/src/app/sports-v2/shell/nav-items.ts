import { IconName } from '../ui/icon';

export interface NavItem {
  readonly label: string;
  readonly segments: readonly string[]; // relative to SPORTS_V2_BASE
  readonly icon: IconName;
  readonly mobile: boolean; // shown in the bottom tab bar
}

/** Single source for sidebar, mobile tab bar and route titles. */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Inicio', segments: [], icon: 'home', mobile: true },
  { label: 'En directo', segments: ['en-directo'], icon: 'live', mobile: true },
  { label: 'Partidos', segments: ['partidos'], icon: 'calendar', mobile: true },
  { label: 'Resultados', segments: ['resultados'], icon: 'results', mobile: false },
  { label: 'Competiciones', segments: ['competiciones'], icon: 'trophy', mobile: true },
  { label: 'Noticias', segments: ['noticias'], icon: 'news', mobile: true },
];
