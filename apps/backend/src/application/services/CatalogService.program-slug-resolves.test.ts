import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogService } from './CatalogService';

// M09: the sitemap lists /programas/:slug only when this answers true, so it must mirror resolveBySlugInternal
// followed by getProgramDetail -> getItem (404 for an item that is not consumer-visible).
const visible = { id: 'a-1', program: { title: 'X', titleResolutionState: 'resolved' } };
const service = (find: (text: string, slug: string, date: string) => Promise<unknown>) => {
  const s = new CatalogService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any) as any;
  s.findTvReadItemBySlug = find;
  return s as CatalogService;
};

test('a programme found today and consumer-visible resolves, with one lookup', async () => {
  const dates: string[] = [];
  const s = service(async (text, _slug, date) => { dates.push(date); assert.equal(text, 'sentimos las molestias t2 e1'); return visible; });
  assert.equal(await s.programSlugResolves('sentimos-las-molestias-t2-e1'), true);
  assert.equal(dates.length, 1, 'tomorrow is not queried after a hit today');
});

test('a programme only on tomorrow resolves via the second lookup', async () => {
  const dates: string[] = [];
  const s = service(async (_t, _s, date) => { dates.push(date); return dates.length === 2 ? visible : null; });
  assert.equal(await s.programSlugResolves('bonanza'), true);
  assert.notEqual(dates[0], dates[1], 'today then tomorrow');
});

test('an alias that matches no airing, or an empty slug, does not resolve', async () => {
  let lookups = 0;
  const s = service(async () => { lookups++; return null; });
  assert.equal(await s.programSlugResolves('no-existe'), false);
  assert.equal(await s.programSlugResolves('  '), false);
  assert.equal(lookups, 2, 'the empty slug never reaches the database');
});

test('a hit the detail read would reject (suppressed or generic) does not resolve', async () => {
  const suppressed = service(async () => ({ ...visible, trustDecision: { consumerSuppressed: true } }));
  assert.equal(await suppressed.programSlugResolves('magnolia'), false);
  const generic = service(async () => ({ ...visible, program: { title: 'X', titleResolutionState: 'generic_suppressed' } }));
  assert.equal(await generic.programSlugResolves('magnolia'), false);
});

test('M09-B: the sitemap gets the disposition of the row the page loads', async () => {
  const row = (program: Record<string, unknown>) => service(async () => ({ ...visible, program: { titleResolutionState: 'resolved', ...program } }));
  const words = Array.from({ length: 25 }, (_, i) => `palabra${i}`).join(' ');
  assert.equal(await row({ title: 'Gladiator', tmdbId: 98, workPath: '/peliculas/gladiator' }).programSlugDisposition('gladiator'), 'work');
  assert.equal(await row({ title: 'Furia', tmdbId: 5 }).programSlugDisposition('furia'), 'ambiguous');
  assert.equal(await row({ title: 'Fallen T1 E3', tmdbId: 5, workPath: '/series/fallen' }).programSlugDisposition('fallen-t1-e3'), 'episode');
  assert.equal(await row({ title: 'Cómicos nuestros', description: words }).programSlugDisposition('cmicos-nuestros'), 'standalone');
  assert.equal(await row({ title: 'Deportes', description: 'Deportes.' }).programSlugDisposition('deportes'), 'thin');
  assert.equal(await service(async () => null).programSlugDisposition('x'), null);
});

test('database failures are not swallowed as "missing"', async () => {
  const s = service(async () => { throw new Error('mongo down'); });
  await assert.rejects(s.programSlugResolves('x-y'), /mongo down/);
});

test('M10-B: an airing links its programme page only when that page is standalone (indexed, in the sitemap) for the same title', async () => {
  const words = Array.from({ length: 25 }, (_, i) => `palabra${i}`).join(' ');
  const row = (program: Record<string, unknown>) => service(async () => ({ ...visible, program: { titleResolutionState: 'resolved', ...program } })) as any;
  const before = process.env.PROGRAMME_SEO_POLICY;
  process.env.PROGRAMME_SEO_POLICY = 'on';
  try {
    assert.equal(await row({ title: 'Cómicos nuestros', description: words }).standaloneProgrammePath('Cómicos nuestros'), '/programas/comicos-nuestros');
    // Thin, TMDB-matched (unverified or twin) and episode pages are noindex or canonicalised elsewhere: no link.
    assert.equal(await row({ title: 'Deportes', description: 'Deportes.' }).standaloneProgrammePath('Deportes'), undefined);
    assert.equal(await row({ title: 'Modern Family', tmdbId: 1421, description: words }).standaloneProgrammePath('Modern Family'), undefined);
    assert.equal(await row({ title: 'Fallen T1 E3', description: words }).standaloneProgrammePath('Fallen T1 E3'), undefined);
    // The slug loads another title ("Papá" vs "Papa"): never link a page about something else.
    assert.equal(await row({ title: 'Papa', description: words }).standaloneProgrammePath('Papá'), undefined);
    assert.equal(await service(async () => null as unknown).programSlugResolves('x'), false);
    delete process.env.PROGRAMME_SEO_POLICY;
    assert.equal(await row({ title: 'Cómicos nuestros', description: words }).standaloneProgrammePath('Cómicos nuestros'), undefined, 'policy off: no disposition, no link');
  } finally {
    if (before === undefined) delete process.env.PROGRAMME_SEO_POLICY; else process.env.PROGRAMME_SEO_POLICY = before;
  }
});
