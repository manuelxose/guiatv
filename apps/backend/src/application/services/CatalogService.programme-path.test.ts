import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogService } from './CatalogService';
import { InMemoryCache } from '@/infrastructure/cache/InMemoryCache';

// M10: a work page links its `/programas/:slug` broadcast page only when that page resolves to the same TMDB work.
const airing = (title: string) => ({ channelId: 'la-1', channelName: 'La 1', start: '', end: '', title, catalogId: 'program:x', detailPath: '/contenido/program:x' });
const item = (title: string, tmdbId: number | undefined, editorialCategory: string, consumerSuppressed = false) => ({
  id: `${title}-slot`,
  program: { title, tmdbId, editorialCategory, titleResolutionState: 'specific_source_title' },
  trustDecision: consumerSuppressed ? { consumerSuppressed: true } : undefined,
});

function serviceWith(bySlug: Record<string, unknown>) {
  const cache = new InMemoryCache();
  const service = new CatalogService({} as any, cache, {} as any, {} as any, {} as any, {} as any);
  const lookups: string[] = [];
  (service as any).findTvReadItemBySlug = async (_text: string, slug: string) => {
    lookups.push(slug);
    return (bySlug[slug] as any) ?? null;
  };
  return { service, cache, lookups };
}

test('links the programme page when its lookup resolves to a visible airing of the same TMDB work and kind', async () => {
  const { service, cache } = serviceWith({ gladiator: item('Gladiator', 98, 'Cine') });
  try {
    assert.equal(await (service as any).resolveProgrammePath(98, 'movie', [airing('Gladiator')]), '/programas/gladiator');
  } finally { cache.destroy(); }
});

test('no link for a homonymous programme, the other TMDB kind, a suppressed airing or an unresolved slug', async () => {
  const { service, cache } = serviceWith({
    'otra-obra': item('Otra obra', 5, 'Cine'),
    'misma-cifra': item('Misma cifra', 98, 'Series'), // tv id 98 is not movie 98
    oculto: item('Oculto', 98, 'Cine', true),
  });
  try {
    for (const title of ['Otra obra', 'Misma cifra', 'Oculto', 'Sin emisión']) {
      assert.equal(await (service as any).resolveProgrammePath(98, 'movie', [airing(title)]), undefined, title);
    }
  } finally { cache.destroy(); }
});

test('checks at most two distinct programme slugs per work', async () => {
  const { service, cache, lookups } = serviceWith({});
  try {
    await (service as any).resolveProgrammePath(98, 'movie', ['A', 'A', 'B', 'C', 'D'].map(airing));
    assert.deepEqual([...new Set(lookups)], ['a', 'b']);
  } finally { cache.destroy(); }
});

test('M10-B: no link to a programme page that declares this work page as its canonical; an unverified one keeps its link', async () => {
  const twin = { ...item('Gladiator', 98, 'Cine'), program: { ...item('Gladiator', 98, 'Cine').program, workPath: '/peliculas/gladiator' } };
  const { service, cache } = serviceWith({ gladiator: twin, 'modern-family': item('Modern Family', 1421, 'Series') });
  const before = process.env.PROGRAMME_SEO_POLICY;
  process.env.PROGRAMME_SEO_POLICY = 'on';
  try {
    assert.equal(await (service as any).resolveProgrammePath(98, 'movie', [airing('Gladiator')]), undefined, 'canonical is the work page itself');
    // Identity unverified (no workPath): the programme page is self-canonical (noindex, follow) and stays a schedule link.
    assert.equal(await (service as any).resolveProgrammePath(1421, 'series', [airing('Modern Family')]), '/programas/modern-family');
  } finally {
    if (before === undefined) delete process.env.PROGRAMME_SEO_POLICY; else process.env.PROGRAMME_SEO_POLICY = before;
    cache.destroy();
  }
});

test('M10-B: the related rail of a work page links only the indexable set, under each work\'s canonical path', async () => {
  const { RelatedWorkGraph } = await import('./RelatedWorks');
  const set = [1, 2, 3].map((id) => ({ kind: 'movie' as const, tmdbId: id, path: `/peliculas/obra-${id}`, title: `Obra ${id}`, genreIds: [18], posterPath: '/p.jpg', year: '2001', rating: 7 }));
  const graph = new RelatedWorkGraph(set);
  const cache = new InMemoryCache();
  const providers = { getMovieProviders: async () => null, getTVProviders: async () => null };
  const tmdb = { getImageUrl: (p: string | null) => (p ? `https://image.tmdb.org/t/p/w500${p}` : undefined) };
  const service = new CatalogService({} as any, cache, tmdb as any, providers as any, {} as any, {} as any, undefined, undefined, { get: async () => graph });
  const empty = new CatalogService({} as any, cache, tmdb as any, providers as any, {} as any, {} as any, undefined, undefined, { get: async () => undefined });
  try {
    const related = await (service as any).loadRelatedForTmdb({ id: 1, genres: [{ id: 18, name: 'Drama' }] }, 'movie');
    assert.deepEqual(related.map((r: any) => [r.detailPath, r.slug, r.tmdbId, r.contentType, r.releaseYear]),
      [['/peliculas/obra-2', 'obra-2', 2, 'movie', 2001], ['/peliculas/obra-3', 'obra-3', 3, 'movie', 2001]].sort((a, b) => related.findIndex((r: any) => r.tmdbId === a[2]) - related.findIndex((r: any) => r.tmdbId === b[2])));
    assert.ok(related.every((r: any) => r.image === 'https://image.tmdb.org/t/p/w500/p.jpg'));
    // The set could not be read: no rail, never TMDB's unverified popular list.
    assert.deepEqual(await (empty as any).loadRelatedForTmdb({ id: 1, genres: [] }, 'movie'), []);
  } finally { cache.destroy(); }
});
