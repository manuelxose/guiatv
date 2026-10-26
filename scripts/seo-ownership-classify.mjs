// Ownership class of a /programas/ URL (M09). Its own module so other audits import it without running the M09 crawl.
/** `prog`/`movie`/`series` are the slim API answers (null = 404). */
export function classify({ prog, movie, series }) {
  if (!prog) return 'unresolvable';
  const twin = [movie, series].find((r) => r && r.tmdbId && r.tmdbId === prog.tmdbId);
  if (!twin) return prog.tmdbId ? 'tmdb-work-single-url' : 'programme-only';
  return twin.airings > 0 ? 'duplicate-indexable-twin' : 'twin-noindex';
}
