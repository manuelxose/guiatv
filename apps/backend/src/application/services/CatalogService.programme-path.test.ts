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
