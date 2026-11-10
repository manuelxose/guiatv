import type { EditorialCategory } from '../blog/models/editorial.models';
import type { PanelNavGroup, PanelNavLink } from '../components/panel-nav/panel-nav.component';
import { PORTAL_ICON_PATHS } from './portal-navigation.config';
import { APP_PATHS } from './route-map';

const cat = (slug: string) => `${APP_PATHS.blog}/categoria/${slug}`;

export interface GuiasSection {
  name: string;
  description: string;
  /** Streaming service of a platform section: its page also shows that catalogue. */
  platform?: string;
}

/**
 * Guías sections of the menu (as in the mockup). Some have no guides yet: their category page
 * renders as an upcoming section (200, noindex) instead of a 404, so the menu never breaks.
 */
export const GUIAS_SECTIONS: Record<string, GuiasSection> = {
  streaming: { name: 'Streaming', description: 'Precios, planes y qué ofrece cada plataforma de streaming en España.' },
  futbol: { name: 'Fútbol', description: 'Dónde ver LaLiga, la Champions y cada competición: canales, plataformas y precios.' },
  television: { name: 'TV y legislación', description: 'Lo que dice la ley sobre la televisión: publicidad, protección de menores, accesibilidad y grabaciones.' },
  comparativas: { name: 'Comparativas', description: 'Plataformas y servicios cara a cara: precio, catálogo, calidad y qué conviene a cada uno.' },
  plataformas: { name: 'Plataformas', description: 'Guías para elegir plataforma de streaming y sacarle partido.' },
  tecnologia: { name: 'Tecnología', description: 'Grabar, descargar y ver la tele en cualquier pantalla.' },
  netflix: { name: 'Netflix', platform: 'Netflix', description: 'Qué ver en Netflix, cuánto cuesta y lo mejor de su catálogo en España.' },
  'prime-video': { name: 'Prime Video', platform: 'Prime Video', description: 'Qué ver en Prime Video, cuánto cuesta y lo mejor de su catálogo en España.' },
  disney: { name: 'Disney+', platform: 'Disney+', description: 'Qué ver en Disney+, cuánto cuesta y lo mejor de su catálogo en España.' },
  'hbo-max': { name: 'HBO Max', platform: 'HBO Max', description: 'Qué ver en HBO Max, cuánto cuesta y lo mejor de su catálogo en España.' },
  'movistar-plus': { name: 'Movistar Plus+', platform: 'Movistar+', description: 'Qué ver en Movistar Plus+, cuánto cuesta y lo mejor de su catálogo en España.' },
  skyshowtime: { name: 'SkyShowtime', platform: 'SkyShowtime', description: 'Qué ver en SkyShowtime, cuánto cuesta y lo mejor de su catálogo en España.' },
  'apple-tv-plus': { name: 'Apple TV+', platform: 'Apple TV+', description: 'Qué ver en Apple TV+, cuánto cuesta y lo mejor de su catálogo en España.' },
  filmin: { name: 'Filmin', platform: 'Filmin', description: 'Qué ver en Filmin, cuánto cuesta y lo mejor de su catálogo de cine de autor.' },
};

/** Editorial categories that are a streaming service (slug → catalogue name). */
export const GUIAS_PLATFORM_CATEGORIES: Record<string, string> = Object.fromEntries(
  Object.entries(GUIAS_SECTIONS)
    .filter(([, s]) => s.platform)
    .map(([slug, s]) => [slug, s.platform!])
);

const PLATFORM_SLUGS = ['netflix', 'prime-video', 'disney', 'hbo-max', 'movistar-plus', 'skyshowtime', 'apple-tv-plus', 'filmin'];
const MAIN_SLUGS = ['streaming', 'futbol', 'television', 'comparativas'];

/** Main menu of the Guías section (left panel and phone sub-nav), in the mockup's order. */
export const GUIAS_LINKS: PanelNavLink[] = [
  { label: 'Destacadas', path: APP_PATHS.blog, iconPath: PORTAL_ICON_PATHS.editorial, exact: true },
  { label: 'Streaming', path: cat('streaming'), iconPath: PORTAL_ICON_PATHS.streaming },
  { label: 'Fútbol', path: cat('futbol'), iconPath: PORTAL_ICON_PATHS.sports },
  { label: 'TV y legislación', path: cat('television'), iconPath: PORTAL_ICON_PATHS.live },
  { label: 'Comparativas', path: cat('comparativas'), iconPath: PORTAL_ICON_PATHS.compare },
  { label: 'Lo mejor del mes', path: APP_PATHS.top10, iconPath: PORTAL_ICON_PATHS.rankings },
];

/** Name shown for a category: the section name when there is one ("TV y legislación"), else the API's. */
export function guiasSectionName(slug: string, fallback = ''): string {
  return GUIAS_SECTIONS[slug]?.name || fallback;
}

/**
 * Groups below the main menu: every platform section, then the other topics (the fixed ones plus any
 * category the API returns that the menu does not list yet). Plain links, marked by the router.
 */
export function guiasCategoryGroups(categories: EditorialCategory[]): PanelNavGroup[] {
  const listed = new Set([...MAIN_SLUGS, ...PLATFORM_SLUGS, 'rankings']);
  const extra = categories.filter((c) => c.count > 0 && !c.isRankingCategory && !listed.has(c.slug));
  const others = ['plataformas', 'tecnologia'].filter((slug) => !extra.some((c) => c.slug === slug));
  return [
    { title: 'Por plataforma', links: PLATFORM_SLUGS.map((slug) => ({ label: GUIAS_SECTIONS[slug].name, path: cat(slug) })) },
    {
      title: 'Más temas',
      links: [
        ...others.map((slug) => ({ label: GUIAS_SECTIONS[slug].name, path: cat(slug) })),
        ...extra.map((c) => ({ label: guiasSectionName(c.slug, c.name), path: c.canonicalPath || cat(c.slug) })),
      ],
    },
  ];
}
