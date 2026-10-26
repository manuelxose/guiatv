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

test('database failures are not swallowed as "missing"', async () => {
  const s = service(async () => { throw new Error('mongo down'); });
  await assert.rejects(s.programSlugResolves('x-y'), /mongo down/);
});
