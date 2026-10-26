import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// M10: verified programme <-> work links and canonical channel links are real <a href> in the SSR HTML.
let backend: { origin: string; stop: () => Promise<void> };
let ssr: { origin: string; stop: () => Promise<void> };
const at = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const airing = (title: string, start: number, extra: Record<string, unknown> = {}) => ({
  channelId: 'dmax', channelNormalizedName: 'discovery', channelName: 'DMAX', title, start: at(start), end: at(start + 2), catalogId: 'program:x', detailPath: '/contenido/program:x', ...extra,
});
const programme = {
  catalogId: 'program:m10-prog', source: 'program', contentType: 'movie', title: 'Película M10', slug: 'pelicula-m10', detailPath: '/contenido/program:m10-prog',
  workPath: '/peliculas/pelicula-m10', synopsis: 'Emisión verificada de una película con ficha propia.', genres: ['Drama'], primaryPlatforms: [],
  start: at(1), end: at(3), channel: { id: 'dmax', name: 'DMAX', normalizedName: 'discovery' },
  airings: [airing('Película M10', 1)],
  channelAirings: [airing('Otra película verificada', 5, { workPath: '/peliculas/otra' }), airing('Magazine sin ficha', 8)],
};
const work = {
  catalogId: 'tmdb:movie:910', source: 'tmdb', contentType: 'movie', title: 'Película M10', slug: 'pelicula-m10', detailPath: '/peliculas/pelicula-m10',
  programmePath: '/programas/pelicula-m10', synopsis: 'Ficha de la obra con su horario de emisión.', genres: ['Drama'], primaryPlatforms: [], tmdbId: 910,
  airings: [airing('Película M10', 1)],
};

test.beforeAll(async () => {
  // @ts-ignore shared ESM harness
  const harness = await import('../../apps/frontend/scripts/entity-ssr-harness.mjs');
  const disabled = { status: 404, code: 'ENTITY_PUBLIC_READ_DISABLED' };
  backend = await harness.startBackend({ '/programas/pelicula-m10': disabled, '/peliculas/pelicula-m10': disabled }, {
    '/v2/catalog/slug/program/pelicula-m10': programme,
    '/v2/catalog/slug/movie/pelicula-m10': work,
  });
  ssr = await harness.launchSsr(backend.origin);
});
test.afterAll(async () => { await ssr?.stop(); await backend?.stop(); });
test.beforeEach(async ({ page }) => {
  await page.route(/\/v2\/(?!entities\/|catalog\/slug\/|content\/)/, route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"success":false}' }));
});

test('M10 programme page: SSR links its verified work page and the canonical channel; robots/canonical unchanged', async ({ page, request }) => {
  const html = await (await request.get(`${ssr.origin}/programas/pelicula-m10`)).text();
  expect(html).toMatch(/<a[^>]+href="\/peliculas\/pelicula-m10"[^>]*>\s*Ficha completa de la película\s*<\/a>/);
  expect(html).toContain('href="/peliculas/otra"');
  expect(html).toContain('href="/canales/discovery"');
  expect(html).not.toContain('href="/canales/dmax"');
  expect(html).toContain('<link rel="canonical" href="https://guiaprogramaciontv.com/programas/pelicula-m10"');

  await page.goto(`${ssr.origin}/programas/pelicula-m10`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index, follow/);
  const link = page.getByRole('link', { name: 'Ficha completa de la película' });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/peliculas\/pelicula-m10$/);
  await expect(page.locator('h1')).toHaveText('Película M10');
});

test('M10 work page: SSR links its verified broadcast page with a descriptive anchor; no violations', async ({ page, request }) => {
  const html = await (await request.get(`${ssr.origin}/peliculas/pelicula-m10`)).text();
  expect(html).toMatch(/<a[^>]+href="\/programas\/pelicula-m10"[^>]*>\s*Horarios de Película M10 en televisión\s*<\/a>/);
  expect(html).toContain('<link rel="canonical" href="https://guiaprogramaciontv.com/peliculas/pelicula-m10"');
  await page.goto(`${ssr.origin}/peliculas/pelicula-m10`);
  await expect(page.getByRole('link', { name: 'Horarios de Película M10 en televisión' })).toBeVisible();
  const axe = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map(v => v.id)).toEqual([]);
});
