/**
 * M13-B3b: shared fixtures of the parity tests: the cf19518 selection as an oracle, the SEO scenarios, a seeded PRNG.
 * (Not a test file: the runner only loads *.test.js.)
 */
import { buildDetailPath, slugifyTitle } from '@/domain/services/detailPath';
import { slugLookupKey } from './VerifiedWorkLinks';
import { workDisposition, workPolicyApplies, type IndexableWork, type WorkRow } from './WorkSeoPolicy';

export const ENV = { WORK_SEO_POLICY: 'on' } as NodeJS.ProcessEnv;
export type Row = WorkRow & { rating?: number };
export type Aired = Array<{ _id: { id: number; c: string } }>;

// ---- ORACLE: cf19518 `selectIndexableWorks`, verbatim ---------------------------------------------------------------
export function oracle(rows: Row[], aired: Aired, env: NodeJS.ProcessEnv): IndexableWork[] {
  const airedKeys = new Set(aired.map((a) => `${a._id.c === 'Cine' ? 'movie' : 'tv'}:${a._id.id}`));
  const byKey = new Map<string, WorkRow[]>();
  for (const r of rows) (byKey.get(r.normalizedTitle ?? '') ?? byKey.set(r.normalizedTitle ?? '', []).get(r.normalizedTitle ?? '')!).push(r);
  const works = new Map<string, IndexableWork>();
  for (const r of rows) {
    const kind = r.tmdbType;
    if ((kind !== 'movie' && kind !== 'tv') || !airedKeys.has(`${kind}:${r.tmdbId}`)) continue;
    const slug = slugifyTitle(r.title ?? '');
    if (slug === 'sin-titulo' || !workPolicyApplies(slug, env)) continue;
    if (workDisposition(slug, r.tmdbId as number, kind, byKey.get(slugLookupKey(slug)) ?? [], false, true) !== 'indexable') continue;
    const path = buildDetailPath(kind === 'movie' ? 'movie' : 'series', slug);
    if (works.has(path)) continue;
    works.set(path, {
      kind, tmdbId: r.tmdbId as number, path, title: r.title ?? '',
      genreIds: (r.tmdbGenres ?? []).map((g) => (g as { id?: unknown }).id).filter((id): id is number => typeof id === 'number'),
      posterPath: r.posterPath ?? undefined, year: r.year ?? undefined, rating: typeof r.rating === 'number' ? r.rating : undefined,
    });
  }
  return [...works.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
// ---------------------------------------------------------------------------------------------------------------------

export const SYN = 'Una joven huérfana vive con su madrastra y sus dos hermanastras, que la tratan como a una criada. '.repeat(4);
export const key = (title: string) => slugLookupKey(slugifyTitle(title));
export const row = (tmdbId: number | string | undefined, tmdbType: 'movie' | 'tv' | undefined, title: string, over: Record<string, unknown> = {}): Row => ({
  tmdbId: tmdbId as number, tmdbType, title, normalizedTitle: key(title), synopsis: SYN, year: '2015', runtimeMinutes: 100, posterPath: '/p.jpg',
  tmdbGenres: [{ id: 18 }], castSummary: [{}, {}, {}], directors: ['D'], lastEnrichedAt: new Date('2026-10-01'), rating: 7.1, ...over,
} as Row);
export const air = (tmdbId: number, kind: 'movie' | 'tv') => ({ _id: { id: tmdbId, c: kind === 'movie' ? 'Cine' : 'Series' } });

/** Every SEO scenario of the brief, in one deterministic fixture. */
export function fixture(): { rows: Row[]; aired: Aired } {
  const rows: Row[] = [
    row(1, 'movie', 'Cenicienta'),                                               // verified work
    row(2, 'tv', 'La promesa', { year: undefined, runtimeMinutes: undefined }),   // series need no year/runtime
    row(3, 'movie', 'La huella'), row(4, 'movie', 'La huella', { year: '1972' }), // ambiguous identity (namesakes, both aired)
    row(10, 'movie', 'Tres caminos'), row(11, 'movie', 'Tres caminos'), row(12, 'movie', 'Tres caminos'), // 3 TMDB candidates
    row(5, 'movie', 'Mismo id'), row(5, 'tv', 'Otro mismo id'),                   // same numeric id, both kinds (only the movie aired as Cine)
    row(20, 'movie', 'Sin generos', { tmdbGenres: undefined }), row(21, 'movie', 'Generos nulos', { tmdbGenres: null as never }),
    row(22, 'movie', 'Generos raros', { tmdbGenres: [{}, { id: 'x' }, { id: 35 }] as never }), row(23, 'movie', 'Generos vacios', { tmdbGenres: [] }),
    row(30, 'movie', 'Corta', { synopsis: 'Breve.' }), row(31, 'movie', 'Sin poster', { posterPath: undefined }), row(32, 'movie', 'Sin reparto', { castSummary: [], directors: [] }),
    row(33, 'movie', 'Sin año', { year: undefined }), row(34, 'movie', 'Sin enriquecer', { lastEnrichedAt: undefined }),
    row(35, 'movie', 'Sinopsis media', { synopsis: SYN.slice(0, 200) }),                                       // short tier: complete record, aired once
    row(40, 'movie', 'Cénicienta nueva'), row(41, 'movie', 'Cenicienta nueva'),                                 // accent-variant slugs collide
    row(50, 'movie', ''), row(51, 'movie', '   '), row(52, 'movie', 'Sin título'),                              // untitled
    row(60, 'movie', 'Nunca emitida'),                                                                           // never aired
    row(70, undefined, 'Sin tipo'), row('71', 'movie', 'Id texto'), row(undefined, 'movie', 'Sin id'),          // malformed identity
    row(80, 'movie', 'Duplicada'), row(80, 'movie', 'Duplicada'),                                                // the same row twice
    row(90, 'tv', 'Historica', { rating: undefined }),                                                           // historical: aired long ago, only the key survives
  ];
  const aired = [air(1, 'movie'), air(2, 'tv'), air(3, 'movie'), air(4, 'movie'), air(10, 'movie'), air(11, 'movie'), air(12, 'movie'), air(5, 'movie'),
    air(20, 'movie'), air(21, 'movie'), air(22, 'movie'), air(23, 'movie'), air(30, 'movie'), air(31, 'movie'), air(32, 'movie'), air(33, 'movie'), air(34, 'movie'),
    air(35, 'movie'), air(40, 'movie'), air(41, 'movie'), air(50, 'movie'), air(51, 'movie'), air(52, 'movie'), air(70, 'movie'), air(71, 'movie'), air(80, 'movie'), air(90, 'tv')];
  return { rows, aired };
}

export function prng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
