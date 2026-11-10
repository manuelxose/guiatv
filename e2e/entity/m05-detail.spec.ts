import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

let backend: { origin: string; stop: () => Promise<void> };
let ssr: { origin: string; stop: () => Promise<void> };
const at = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const airing = (title: string, channelId: string, start: number, detailPath?: string) => ({ channelId, channelName: channelId.toUpperCase(), title, start: at(start), end: at(start + 2), detailPath });
const film = {
  catalogId: 'program:m05-film', source: 'program', contentType: 'movie', title: 'Película M05', slug: 'm05-film', detailPath: '/peliculas/m05-film',
  synopsis: 'Una película con emisiones verificadas y programación del canal independiente.', genres: ['Drama'], primaryPlatforms: [], releaseYear: 2020, durationMinutes: 120,
  airings: [airing('Película M05', 'amc', -1), airing('Película M05', 'tcm', -1), airing('Película M05', 'amc', 3)],
  channelAirings: [airing('Otra película del canal', 'amc', 6, '/contenido/program:m05-known'), airing('Episodio sin destino confirmado', 'amc', 9)],
};

test.beforeAll(async () => {
  // @ts-ignore shared ESM harness
  const harness = await import('../../apps/frontend/scripts/entity-ssr-harness.mjs');
  const disabled = { status: 404, code: 'ENTITY_PUBLIC_READ_DISABLED' };
  backend = await harness.startBackend({ '/peliculas/m05-film': disabled, '/series/m05-series': disabled, '/peliculas/m05-empty': disabled }, {
    '/v2/catalog/slug/movie/m05-film': film,
    '/v2/catalog/program%3Am05-known': { ...film, catalogId: 'program:m05-known', title: 'Otra película del canal', detailPath: '/contenido/program:m05-known' },
    '/v2/content/program%3Am05-known': { ...film, catalogId: 'program:m05-known', title: 'Otra película del canal', detailPath: '/contenido/program:m05-known' },
    '/v2/catalog/slug/series/m05-series': { ...film, catalogId: 'program:m05-series', contentType: 'series', title: 'Serie M05', slug: 'm05-series', detailPath: '/series/m05-series', airings: [], channelAirings: [] },
    '/v2/catalog/slug/movie/m05-empty': { ...film, catalogId: 'program:m05-empty', title: 'Sin programación', slug: 'm05-empty', detailPath: '/peliculas/m05-empty', airings: [], channelAirings: [], durationMinutes: undefined, releaseYear: undefined, synopsis: undefined, genres: [] },
  });
  ssr = await harness.launchSsr(backend.origin);
});
test.afterAll(async () => { await ssr?.stop(); await backend?.stop(); });
test.beforeEach(async ({ page }) => {
  await page.route(/\/v2\/(?!entities\/|catalog\/slug\/|content\/)/, route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"success":false}' }));
});

test('M05 separates broadcasts from channel suggestions, retains simultaneous airings and SSR SEO', async ({ page, request }) => {
  const response = await request.get(`${ssr.origin}/peliculas/m05-film`);
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('Película M05');
  expect(html).toContain('Próximas emisiones');
  await page.goto(`${ssr.origin}/peliculas/m05-film`);
  await expect(page.locator('h1')).toHaveText('Película M05');
  const schedule = page.locator('app-entity-broadcast-list');
  await expect(schedule.locator('li')).toHaveCount(3);
  await expect(schedule).not.toContainText('Otra película del canal');
  const channel = page.locator('section[aria-labelledby="channel-programmes-heading"]');
  await expect(channel).toContainText('Qué más echan en');
  await expect(channel).toContainText('Otra película del canal');
  await expect(channel.getByRole('link', { name: /Episodio sin destino/ })).toHaveAttribute('href', '/canales/amc');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://guiaprogramaciontv.com/peliculas/m05-film');
  const schema = await page.locator('script[type="application/ld+json"]').evaluateAll(els => els.flatMap(el => [JSON.parse(el.textContent || '[]')].flat()));
  expect(schema.filter(x => x['@type'] === 'Movie')).toHaveLength(1);
  expect(schema.some(x => x['@type'] === 'VideoObject' || x.aggregateRating)).toBe(false);
  await page.getByRole('navigation', { name: 'En esta ficha' }).getByRole('link', { name: 'Emisiones', exact: true }).click();
  expect(new URL(page.url()).pathname).toBe('/peliculas/m05-film');
  await expect(page.locator('#emisiones')).toBeInViewport();
  await channel.getByRole('link', { name: /Otra película del canal/ }).click();
  await expect(page.locator('h1')).toHaveText('Otra película del canal');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
  expect(new URL(page.url()).pathname).toBe('/contenido/program:m05-known');
});

test('M05 series omits whole-series runtime; incomplete data has honest empty state', async ({ page }) => {
  await page.goto(`${ssr.origin}/series/m05-series`);
  await expect(page.locator('h1')).toHaveText('Serie M05');
  await expect(page.getByText('120 min', { exact: true })).toHaveCount(0);
  await page.goto(`${ssr.origin}/peliculas/m05-empty`);
  await expect(page.locator('h1')).toHaveText('Sin programación');
  await expect(page.getByText('Sinopsis no disponible.')).toBeVisible();
  await expect(page.locator('app-entity-broadcast-list')).toContainText('No hay emisiones programadas');
  await expect(page.getByRole('heading', { name: /Qué más echan en/ })).toHaveCount(0);
});

test('M05 responsive layouts and WCAG AA across required widths and themes', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [375, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark'] as const) {
      await page.addInitScript(value => localStorage.setItem('guiatv-theme', value), theme);
      await page.goto(`${ssr.origin}/peliculas/m05-film`);
      await expect(page.locator('h1')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const axe = await new AxeBuilder({ page }).include('app-catalog-detail').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`)).toEqual([]);
      await page.screenshot({ path: info.outputPath(`m05-${width}-${theme}.png`), fullPage: true });
    }
  }
  expect(errors).toEqual([]);
});
