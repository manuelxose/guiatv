import assert from 'node:assert/strict';
import test from 'node:test';
import { CatalogService } from './CatalogService';
import { InMemoryCache } from '@/infrastructure/cache/InMemoryCache';

// M09-B: the /programas/:slug payload carries the page's canonical and robots; work pages are untouched.
const service = (detail: Record<string, unknown>, foldedLoads = detail.title) => {
  const s = new CatalogService({} as any, new InMemoryCache() as any, {} as any, {} as any, {} as any, {} as any);
  (s as any).resolveBySlug = async () => ({ ...detail });
  (s as any).findTvReadItemBySlug = async () => ({ program: { title: foldedLoads } });
  return s;
};

test('the folded slug is declared only when it loads the same programme (collision "Último" / "Ultimo")', async () => {
  const detail = { title: 'Último', contentType: 'program' };
  assert.equal((await service(detail).getBySlug('program', 'ltimo')).seo?.canonicalPath, '/programas/ultimo');
  assert.equal((await service(detail, 'Ultimo').getBySlug('program', 'ltimo')).seo?.canonicalPath, '/programas/ltimo');
});

test('a programme lookup declares the folded canonical, and the verified work page once the policy applies', async () => {
  const detail = { title: 'El último sol', contentType: 'movie', tmdbId: 9, workPath: '/peliculas/el-ultimo-sol' };
  const saved = process.env.PROGRAMME_SEO_POLICY;
  try {
    delete process.env.PROGRAMME_SEO_POLICY;
    assert.equal((await service(detail).getBySlug('program', 'el-ltimo-sol')).seo?.canonicalPath, '/programas/el-ultimo-sol');
    process.env.PROGRAMME_SEO_POLICY = 'on';
    const s = service(detail);
    const [a, b] = await Promise.all([s.getBySlug('program', 'el-ltimo-sol'), s.getBySlug('program', 'el-ltimo-sol')]);
    assert.equal(a.seo?.canonicalPath, '/peliculas/el-ultimo-sol');
    assert.deepEqual(a.seo, b.seo, 'a concurrent (de-duplicated) lookup gets the same signals');
    assert.equal((await service(detail).getBySlug('movie', 'el-ultimo-sol')).seo, undefined, 'work pages carry no programme policy');
  } finally {
    if (saved === undefined) delete process.env.PROGRAMME_SEO_POLICY; else process.env.PROGRAMME_SEO_POLICY = saved;
  }
});
