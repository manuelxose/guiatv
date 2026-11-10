import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

type Harness = typeof import('../../apps/frontend/scripts/entity-ssr-harness.mjs');

let backend: { origin: string; stop: () => Promise<void> };
let ssr: { origin: string; stop: () => Promise<void> };

// Phase 3E: the legacy film page, enriched, through the real SSR bundle in desktop and mobile browsers.
const SLUG = 'la-cura-del-bienestar';
const POSTER = '<svg xmlns="http://www.w3.org/2000/svg" width="380" height="570"><rect width="380" height="570" fill="#445"/></svg>';
const fixtureNow = Date.now();
const at = (h: number) => new Date(fixtureNow + h * 3_600_000);
const airing = (channelId: string, h: number) => ({ channelId, channelName: channelId.toUpperCase(), start: at(h).toISOString(), end: at(h + 2).toISOString(), title: 'La cura del bienestar', catalogId: `program:${channelId}`, detailPath: `/peliculas/${SLUG}` });
const broadcast = (id: string, name: string, h: number) => ({
  airingId: `b-${id}`, channel: { id, name, path: `/canales/${id}` }, programmeTitle: 'La cura del bienestar', start: at(h).toISOString(), end: at(h + 2).toISOString(),
  startLocal: at(h).toISOString().replace('Z', '+00:00'), localDate: at(h).toISOString().slice(0, 10), localTime: '21:30', durationMinutes: 120,
});
const legacy = (over: Record<string, unknown> = {}) => ({
  catalogId: 'tmdb:movie:340837', source: 'tmdb', contentType: 'movie', title: 'La cura del bienestar', slug: SLUG, detailPath: `/peliculas/${SLUG}`,
  synopsis: 'Texto editorial propio de la ficha, anterior a cualquier enriquecimiento.', genres: [], tmdbId: 340837, releaseYear: 2016, primaryPlatforms: [],
  image: 'https://image.tmdb.org/t/p/original/poster.jpg', airings: [airing('amc', 30), airing('tcm', 50)], ...over,
});
const enrichment = {
  version: 1,
  metadata: { originalTitle: 'A Cure for Wellness', runtimeMinutes: 147, genres: ['Terror', 'Misterio'] },
  broadcasts: { status: 'ok', windowDays: 7, generatedAt: new Date().toISOString(), timeZone: 'Europe/Madrid', items: [broadcast('amc', 'AMC', 30), broadcast('la_1', 'La 1', 100)] },
  attribution: { notice: 'Datos e imágenes de TMDB. Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB.', updatedAt: '2026-10-01T00:00:00.000Z' },
};

test.beforeAll(async () => {
  // @ts-ignore .mjs is plain ESM shared with the node SSR tests
  const harness: Harness = await import('../../apps/frontend/scripts/entity-ssr-harness.mjs');
  const disabled = { status: 404, code: 'ENTITY_PUBLIC_READ_DISABLED' };
  const slugs = ['plain', 'enriched', 'empty', 'unreadable'];
  backend = await harness.startBackend(
    Object.fromEntries(slugs.map((s) => [`/peliculas/${s}`, disabled])),
    {
      '/v2/catalog/slug/movie/plain': legacy({ slug: 'plain', detailPath: '/peliculas/plain' }),
      '/v2/catalog/slug/movie/enriched': legacy({ slug: 'enriched', detailPath: '/peliculas/enriched', enrichment }),
      '/v2/catalog/slug/movie/empty': legacy({ slug: 'empty', detailPath: '/peliculas/empty', airings: [], enrichment: { version: 1, broadcasts: { status: 'none', windowDays: 7, generatedAt: new Date().toISOString(), timeZone: 'Europe/Madrid', items: [] } } }),
      '/v2/catalog/slug/movie/unreadable': legacy({ slug: 'unreadable', detailPath: '/peliculas/unreadable', enrichment: { version: 1, broadcasts: { status: 'unavailable', windowDays: 7, generatedAt: new Date().toISOString(), timeZone: 'Europe/Madrid', items: [] } } }),
    }
  );
  ssr = await harness.launchSsr(backend.origin);
});
test.afterAll(async () => { await ssr?.stop(); await backend?.stop(); });

test.beforeEach(async ({ page }) => {
  await page.route('https://image.tmdb.org/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: POSTER }));
  await page.route(/\/v2\/(?!entities\/|catalog\/slug\/)/, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"success":false}' }));
});

const open = async (page: Page, slug: string) => {
  const response = await page.goto(`${ssr.origin}/peliculas/${slug}`, { waitUntil: 'domcontentloaded' });
  await page.locator('h1').first().waitFor();
  return response!;
};
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const seo = (page: Page) => page.evaluate(() => ({
  robots: document.querySelector('meta[name="robots"]')?.getAttribute('content'),
  canonical: Array.from(document.querySelectorAll('link[rel="canonical"]')).map((l) => l.getAttribute('href')),
  description: document.querySelector('meta[name="description"]')?.getAttribute('content'),
}));

test('the enriched legacy page keeps its SEO surface and gains the verified schedule and facts', async ({ page }) => {
  const plain = await open(page, 'plain');
  const before = await seo(page);
  expect(plain.status()).toBe(200);
  await expect(page.locator('app-entity-broadcast-list li')).toHaveCount(2);

  const response = await open(page, 'enriched');
  expect(response.status()).toBe(200);
  expect(response.headers()['x-robots-tag']).toBe(plain.headers()['x-robots-tag']);
  const after = await seo(page);
  expect(after.robots).toBe(before.robots);
  expect(after.robots).toContain('index');
  expect(after.description).toBe(before.description);
  expect(after.canonical).toHaveLength(1);
  expect(after.canonical[0]).toBe('https://guiaprogramaciontv.com/peliculas/enriched');

  await expect(page.locator('h1')).toHaveCount(1);
  // The synopsis appears once on the page; the hero facts are also restated in the right panel's "Ficha", so check the content column.
  await expect(page.getByText('Texto editorial propio de la ficha')).toBeVisible();
  const main = page.locator('main');
  await expect(main.getByText('A Cure for Wellness')).toBeVisible();
  await expect(page.getByText('2 h 27 min')).toHaveCount(0); // hero shows the minutes the legacy layout always used
  await expect(main.getByText('147 min')).toBeVisible();
  await expect(main.getByRole('list', { name: 'Géneros' }).getByText('Terror', { exact: true })).toBeVisible();
  const cards = page.locator('app-entity-broadcast-list li');
  await expect(cards).toHaveCount(3);
  await expect(cards.first().getByRole('link', { name: 'AMC' })).toHaveAttribute('href', '/canales/amc');
  await expect(main.getByText('TCM').first()).toBeVisible(); // the legacy airing the join did not confirm is kept
  await expect(page.getByText('Datos e imágenes de TMDB.')).toBeVisible();
  const movies = await page.locator('script[type="application/ld+json"]').evaluateAll((els) => els.flatMap((e) => [JSON.parse(e.textContent || '[]')].flat()).filter((d) => d['@type'] === 'Movie'));
  expect(movies).toHaveLength(1);
  expect(movies[0].publication).toHaveLength(2);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test('empty and unreadable schedules', async ({ page }) => {
  await open(page, 'empty');
  await expect(page.getByText('No hay emisiones programadas en la programación disponible')).toBeVisible();
  await open(page, 'unreadable');
  await expect(page.locator('app-entity-broadcast-list li')).toHaveCount(2);
  await expect(page.locator('main').getByText('AMC').first()).toBeVisible(); // the side menu's channel link is hidden on mobile
});

test('accessibility: no axe violations on the enriched legacy page, in light and dark', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, 'enriched');
    const results = await new AxeBuilder({ page }).include('app-catalog-detail').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).exclude('app-where-to-watch').exclude('app-interaction-buttons').analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  }
});

test('mobile: one column, nothing clipped', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile project only');
  await open(page, 'enriched');
  expect(await noHorizontalScroll(page)).toBe(true);
  const lefts = await page.locator('app-entity-broadcast-list li').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  expect(new Set(lefts).size).toBe(1);
});
