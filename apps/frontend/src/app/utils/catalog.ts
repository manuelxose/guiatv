export type CatalogSource = 'program' | 'tmdb';
export type CatalogContentType = 'movie' | 'series' | 'program';

export function buildProgramCatalogId(programId: string): string {
  return `program:${String(programId || '').trim()}`;
}

export function buildTmdbCatalogId(
  type: 'movie' | 'tv',
  tmdbId: number
): string {
  return `tmdb:${type}:${Number(tmdbId)}`;
}

export function parseCatalogId(value: string): {
  source: CatalogSource;
  contentType: CatalogContentType;
  programId?: string;
  tmdbId?: number;
} | null {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  if (raw.startsWith('program:')) {
    const programId = raw.slice('program:'.length).trim();
    return programId
      ? { source: 'program', contentType: 'program', programId }
      : null;
  }

  if (raw.startsWith('tmdb:movie:')) {
    const tmdbId = Number(raw.slice('tmdb:movie:'.length));
    return Number.isFinite(tmdbId)
      ? { source: 'tmdb', contentType: 'movie', tmdbId }
      : null;
  }

  if (raw.startsWith('tmdb:tv:')) {
    const tmdbId = Number(raw.slice('tmdb:tv:'.length));
    return Number.isFinite(tmdbId)
      ? { source: 'tmdb', contentType: 'series', tmdbId }
      : null;
  }

  return null;
}

export function normalizeCatalogInteractionId(input: {
  contentId?: string;
  contentType?: CatalogContentType;
  tmdbId?: number;
}): string {
  const raw = String(input.contentId || '').trim();
  if (
    raw.startsWith('program:') ||
    raw.startsWith('tmdb:movie:') ||
    raw.startsWith('tmdb:tv:')
  ) {
    return raw;
  }

  if (typeof input.tmdbId === 'number' && Number.isFinite(input.tmdbId)) {
    if (input.contentType === 'series') {
      return buildTmdbCatalogId('tv', input.tmdbId);
    }
    if (input.contentType === 'movie') {
      return buildTmdbCatalogId('movie', input.tmdbId);
    }
  }

  return buildProgramCatalogId(raw);
}

export function buildDetailPath(
  contentType: CatalogContentType,
  title: string,
  slugifyFn: (text: string) => string
): string {
  const slug = slugifyFn(title) || 'sin-titulo';
  const prefix =
    contentType === 'movie' ? '/peliculas' :
    contentType === 'series' ? '/series' :
    '/programas';
  return `${prefix}/${slug}`;
}

/**
 * Slugifier for movie/series (TMDB-sourced) titles. The legacy `slugify` drops
 * accented characters entirely ("último" -> "ltimo"), which breaks the backend
 * slug lookup and the TMDB search derived from it. This variant keeps the base
 * letter ("último" -> "ultimo"). Since M09-B programme slugs use it too; the
 * legacy slug still resolves and declares this one as canonical.
 */
export function slugifyTitle(text: string): string {
  const safe = String(text || '').toString();
  const transliterated = safe.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return (
    transliterated
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]+/g, '')
      .replace(/--+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '')
  );
}


/**
 * Splits airings by instant (epoch ms, so time zones and midnight-spanning airings compare correctly) at `now`:
 * on air (start <= now < end) and upcoming (start > now). Finished airings are in neither; the API response may
 * be cached, so its `liveNow` flag is not trusted.
 */
export function splitAiringsByTime<T extends { start: string; end: string }>(
  airings: readonly T[] | undefined,
  now: number = Date.now()
): { current: T | null; upcoming: T[] } {
  const timed = (airings || []).map((airing) => ({ airing, start: Date.parse(airing.start), end: Date.parse(airing.end) }));
  return {
    current: timed.find(({ start, end }) => start <= now && now < end)?.airing ?? null,
    upcoming: timed.filter(({ start }) => start > now).sort((a, b) => a.start - b.start).map(({ airing }) => airing),
  };
}
