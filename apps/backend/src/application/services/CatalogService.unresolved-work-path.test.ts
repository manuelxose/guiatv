import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogService } from './CatalogService';

// M10-C: a TMDB catalogue card (/plataformas, /guias rails) links its title's work page only when that page is not
// known to miss it. Production 2026-10-29: "20/20 Britain's Most Notorious Crime Investigations" linked
// /series/2020-britains-most-notorious-crime-investigations, which the page cannot resolve (404).
const card = (tmdbId: number, contentType: 'movie' | 'series', slug: string, title = slug) =>
  ({ catalogId: `tmdb:${contentType === 'movie' ? 'movie' : 'tv'}:${tmdbId}`, source: 'tmdb', contentType, title, slug, detailPath: `/${contentType === 'movie' ? 'peliculas' : 'series'}/${slug}`, tmdbId, genres: [], primaryPlatforms: [] }) as any;

function service(notFound: string[], local: Array<{ tmdbId: number; tmdbType: 'movie' | 'tv'; title: string }>, failing = false) {
  const cache = { get: async (key: string) => { if (failing) throw new Error('down'); return notFound.includes(key) ? true : null; }, set: async () => undefined } as any;
  const media = { findKnownMatchesForTitles: async () => local } as any;
  return new CatalogService({} as any, cache, {} as any, {} as any, {} as any, {} as any, media);
}
const mark = (s: CatalogService, items: any[]) => (s as any).markUnresolvedWorkPaths(items) as Promise<any[]>;

test('M10-C: proven 404 or a namesake row -> no work link; verified and unknown slugs keep theirs; airings untouched', async () => {
  const broken = card(1, 'series', '2020-britains-most-notorious-crime-investigations');
  const namesake = card(2, 'series', 'nick', 'Nick');
  const verified = card(3, 'movie', 'gladiator', 'Gladiator');
  const unknown = card(4, 'movie', 'nueva-pelicula');
  const airing = { catalogId: 'program:x', source: 'program', contentType: 'movie', title: 'Sin TMDB', slug: 'sin-tmdb', detailPath: '/contenido/program:x' };
  const s = service(['catalog:slug:notfound:series:2020-britains-most-notorious-crime-investigations'],
    [{ tmdbId: 99, tmdbType: 'tv', title: 'Nick' }, { tmdbId: 3, tmdbType: 'movie', title: 'Gladiator' }]);
  const out = await mark(s, [broken, namesake, verified, unknown, airing]);
  assert.deepEqual(out.map((i) => Boolean(i.workPathUnresolved)), [true, true, false, false, false]);
  assert.equal(out[2].detailPath, '/peliculas/gladiator');
});

test('M10-C: a negative cache entry older than a local row does not drop a link the page now resolves', async () => {
  const s = service(['catalog:slug:notfound:movie:gladiator'], [{ tmdbId: 3, tmdbType: 'movie', title: 'Gladiator' }]);
  const out = await mark(s, [card(3, 'movie', 'gladiator', 'Gladiator')]);
  assert.equal(out[0].workPathUnresolved, undefined);
});

test('M10-C: a read failure leaves the cards as they were', async () => {
  const items = [card(1, 'series', 'x')];
  assert.deepEqual(await mark(service([], [], true), items), items);
});
