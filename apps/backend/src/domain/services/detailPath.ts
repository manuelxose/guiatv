import { parseEpgTitle } from './contentIdentity';

/**
 * Public detail URLs of catalogue items and EPG airings. The one implementation shared by the catalogue detail
 * resolver (`CatalogService`) and the TV-read DTO, so a guide card links to exactly the path the detail page resolves.
 */
export type DetailContentType = 'movie' | 'series' | 'program';

export function slugify(text: string): string {
  const s = String(text || '').trim();
  if (!s) return 'sin-titulo';
  return s
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sin-titulo';
}

/**
 * Slugifier for TMDB-sourced movie/series titles. The legacy slugifier drops
 * accented characters entirely ("último" -> "ltimo"), which corrupts the
 * TMDB search text derived from the slug and leaves detail pages
 * unresolvable for accented Spanish titles. This variant keeps the base
 * letter ("último" -> "ultimo") so generated detail URLs and slug lookups
 * resolve. Since M09-B programme URLs use it too; their legacy slug still
 * resolves and declares this one as canonical (ProgrammeSeoPolicy).
 */
export function slugifyTitle(text: string): string {
  return slugify(String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, ''));
}

export function normalizeToken(value: string): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function inferContentType(editorialCategory?: string, genre?: string, title?: string): DetailContentType {
  const token = normalizeToken([editorialCategory, genre, title].filter(Boolean).join(' '));
  if (token.includes('series') || token.includes('serie') || token.includes('ficcion seriada')) return 'series';
  if (token.includes('cine') || token.includes('pelicula') || token.includes('pel') || token.includes('film')) return 'movie';
  return 'program';
}

/** The work of an EPG title with an explicit, high-confidence season/episode marker; null otherwise. */
export function episodeWorkTitle(title: string): string | null {
  const parsed = parseEpgTitle(title);
  return parsed.resolutionState === 'episode' && parsed.confidence === 'high' ? parsed.proposedWorkTitle : null;
}

/**
 * Detail slug for an EPG airing, accents folded (M09-B: programmes too; their legacy slug still resolves). A series
 * airing titled with an explicit season/episode marker ("Friends T3 E1 …") links to the work, not to an episode URL
 * that 404s.
 */
export function airingDetailSlug(contentType: DetailContentType, title: string): string {
  if (contentType === 'program') return slugifyTitle(title);
  return slugifyTitle((contentType === 'series' && episodeWorkTitle(title)) || title);
}

export function buildDetailPath(contentType: DetailContentType, slug: string): string {
  const prefix = contentType === 'movie' ? '/peliculas' : contentType === 'series' ? '/series' : '/programas';
  return `${prefix}/${slug}`;
}

/** An airing's known route; category/title inference cannot prove a public work slug exists. */
export function programDetailPath(programId: string): string {
  return `/contenido/program:${encodeURIComponent(programId)}`;
}
