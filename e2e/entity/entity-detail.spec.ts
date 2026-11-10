import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

type Harness = typeof import('../../apps/frontend/scripts/entity-ssr-harness.mjs');
const SHOTS = process.env.ENTITY_SHOTS_DIR;

let backend: { origin: string; stop: () => Promise<void> };
let ssr: { origin: string; stop: () => Promise<void>; logs: () => string };
let entityFixture: Harness['entityFixture'];

// A 2x3 grey rectangle stands in for TMDB artwork so the spec needs no internet.
const POSTER = '<svg xmlns="http://www.w3.org/2000/svg" width="380" height="570"><rect width="380" height="570" fill="#445"/></svg>';

test.beforeAll(async () => {
  // @ts-ignore .mjs is plain ESM shared with the node SSR tests
  const harness: Harness = await import('../../apps/frontend/scripts/entity-ssr-harness.mjs');
  entityFixture = harness.entityFixture;
  const soon = new Date(Date.now() + 3 * 3_600_000);
  const later = new Date(Date.now() + 3 * 86_400_000);
  const item = (airingId: string, channel: { id: string; name: string; path: string }, at: Date, minutes = 140) => ({
    airingId, channel, programmeTitle: 'La cura del bienestar', start: at.toISOString(), end: new Date(at.getTime() + minutes * 60_000).toISOString(),
    startLocal: at.toISOString().replace('Z', '+00:00'), localDate: at.toISOString().slice(0, 10), localTime: '21:00', durationMinutes: minutes,
  });
  const generatedAt = new Date().toISOString();
  backend = await harness.startBackend({
    '/peliculas/la-cura-del-bienestar': entityFixture({ broadcasts: { status: 'ok', generatedAt, timeZone: 'Europe/Madrid', items: [item('a1', { id: 'amc', name: 'AMC', path: '/canales/amc' }, soon), item('a2', { id: 'la_1', name: 'La 1', path: '/canales/la-1' }, later)] } }),
    '/peliculas/sin-emisiones': entityFixture({ title: 'Sin emisiones', canonicalPath: '/peliculas/sin-emisiones', broadcasts: { status: 'none', items: [], generatedAt, timeZone: 'Europe/Madrid' } }),
    '/peliculas/agenda-caida': entityFixture({ title: 'Agenda caída', canonicalPath: '/peliculas/agenda-caida', broadcasts: { status: 'unavailable', items: [], generatedAt, timeZone: 'Europe/Madrid' } }),
    '/peliculas/solo-titulo': { entityId: 'ce_0000000000000000000000000B', kind: 'movie', title: 'Solo el título', canonicalPath: '/peliculas/solo-titulo', year: 1949 },
    '/peliculas/titulo-larguisimo': entityFixture({ title: 'Un título larguísimo que debe romperse sin desbordar la pantalla en ningún ancho ni en ninguna tipografía de sistema', canonicalPath: '/peliculas/titulo-larguisimo', originalTitle: 'Supercalifragilisticexpialidocious_Supercalifragilisticexpialidocious_Supercalifragilisticexpialidocious', broadcasts: { status: 'none', items: [], generatedAt, timeZone: 'Europe/Madrid' } }),
    '/peliculas/error-de-servicio': { status: 503, code: 'ENTITY_UNAVAILABLE' },
    '/peliculas/retirada': { status: 410, code: 'ENTITY_GONE' },
  });
  ssr = await harness.launchSsr(backend.origin);
});
test.afterAll(async () => { await ssr?.stop(); await backend?.stop(); });

test.beforeEach(async ({ page }) => {
  await page.route('https://image.tmdb.org/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: POSTER }));
  await page.route(/\/v2\/(?!entities\/)/, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"success":false}' }));
});

const open = async (page: Page, slug: string) => {
  const response = await page.goto(`${ssr.origin}/peliculas/${slug}`, { waitUntil: 'domcontentloaded' });
  // Inside the content column: the shell's side menu has its own h2, hidden on mobile.
  await page.locator('main').locator('h1, [role="alert"], h2').first().waitFor();
  return response!;
};
const shot = async (page: Page, name: string, projectName: string) => {
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}-${projectName}.png`), fullPage: true }); }
};
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test('the film page: header, facts, broadcasts, credits and attribution, single h1, noindex, one canonical', async ({ page }, info) => {
  const response = await open(page, 'la-cura-del-bienestar');
  expect(response.status()).toBe(200);
  expect(response.headers()['x-robots-tag']).toBe('noindex, follow');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('La cura del bienestar');
  await expect(page.getByText('A Cure for Wellness')).toBeVisible();
  // The context panel restates the facts by design (as the catalog page's "Ficha" does); check the hero.
  await expect(page.locator('main').getByText('2 h 27 min')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Géneros' }).getByRole('listitem')).toHaveText(['Terror', 'Misterio']);
  await expect(page.getByRole('img', { name: 'Cartel de La cura del bienestar' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Próximas emisiones' })).toBeVisible();
  const cards = page.locator('app-entity-broadcast-list li');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('AMC');
  await expect(cards.first().getByRole('link', { name: 'AMC' })).toHaveAttribute('href', '/canales/amc');
  await expect(cards.first()).toContainText(/en [23] h/);
  // The fixture is relative to the current instant; Madrid midnight can make the calendar-day label 2 or 3.
  await expect(cards.nth(1)).toContainText(/en [23] días/);
  await expect(cards.first()).toContainText('2 h 20 min');
  await expect(page.locator('p', { hasText: 'Dirección:' })).toContainText('Gore Verbinski');
  await expect(page.getByText('Datos e imágenes de TMDB.')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://guiaprogramaciontv.com/peliculas/la-cura-del-bienestar');
  expect(await noHorizontalScroll(page)).toBe(true);
  await shot(page, 'film', info.project.name);
});

test('keyboard and assistive technology: landmarks, labelled sections, reachable links with a visible focus', async ({ page }) => {
  await open(page, 'la-cura-del-bienestar');
  for (const heading of ['Próximas emisiones', 'Reparto y dirección', 'Sigue explorando']) await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sigue explorando' })).toBeVisible();
  const link = page.locator('app-entity-broadcast-list').getByRole('link', { name: 'AMC' });
  await link.focus();
  await expect(link).toBeFocused();
  const outline = await link.evaluate((el) => { const s = getComputedStyle(el); return { style: s.outlineStyle, width: s.outlineWidth, deco: s.textDecorationLine }; });
  expect(outline.style !== 'none' || outline.deco.includes('underline') || Number.parseFloat(outline.width) > 0).toBe(true);
  // Tab order stays inside the page: pressing Tab from the first broadcast link reaches the next link, in document order.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('A');
  expect(await link.evaluate((el) => el === document.activeElement)).toBe(false);
  const times = await page.locator('app-entity-broadcast-list time[datetime]').evaluateAll((els) => els.map((e) => [e.getAttribute('datetime'), e.getAttribute('aria-label')]));
  expect(times.length).toBe(2);
  for (const [datetime, label] of times) { expect(datetime).toMatch(/^\d{4}-\d{2}-\d{2}T/); expect(label).toMatch(/CET|CEST|GMT/); }
});

test('accessibility: no axe violations on the film page, in light and dark', async ({ page }, info) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, 'la-cura-del-bienestar');
    const results = await new AxeBuilder({ page }).include('app-entity-detail').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).exclude('app-where-to-watch').analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    await shot(page, `film-${scheme}`, info.project.name);
  }
});

test('theme consistency: text keeps its contrast against its surface in light and dark', async ({ page }) => {
  const luminance = ([r, g, b]: number[]) => { const c = [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a: number[], b: number[]) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, 'la-cura-del-bienestar');
    const measured = await page.evaluate(() => {
      const rgb = (css: string) => (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const surface = (el: Element): number[] => { for (let n: Element | null = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba?\(0, 0, 0, 0\)|transparent/.test(c)) return rgb(c); } return [255, 255, 255]; };
      const pick = (selector: string) => { const el = document.querySelector(selector)!; return { fg: rgb(getComputedStyle(el).color), bg: surface(el) }; };
      return { h2: pick('app-entity-broadcast-list h2'), card: pick('app-entity-broadcast-list li article a'), footer: pick('footer p') };
    });
    for (const [name, { fg, bg }] of Object.entries(measured)) expect(ratio(fg, bg), `${scheme} ${name}`).toBeGreaterThanOrEqual(4.5);
  }
});

test('states: empty schedule, unreadable schedule, bare entity, very long title, gone and failing', async ({ page }, info) => {
  let response = await open(page, 'sin-emisiones');
  expect(response.status()).toBe(200);
  await expect(page.getByText('No hay emisiones programadas en la programación disponible')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Qué ver hoy en TV' }).first()).toHaveAttribute('href', '/programacion-tv/que-ver-hoy');

  await open(page, 'agenda-caida');
  await expect(page.getByRole('status').filter({ hasText: 'No hemos podido comprobar la programación' })).toBeVisible();
  await expect(page.getByText('No hay emisiones programadas')).toHaveCount(0);

  await open(page, 'solo-titulo');
  await expect(page.locator('h1')).toHaveText('Solo el título');
  await expect(page.getByText('Sinopsis no disponible.')).toBeVisible();
  await expect(page.locator('app-entity-broadcast-list')).toHaveCount(0);
  await expect(page.getByRole('img')).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);

  await open(page, 'titulo-larguisimo');
  expect(await noHorizontalScroll(page)).toBe(true);
  await shot(page, 'long-title', info.project.name);

  response = await open(page, 'retirada');
  expect(response.status()).toBe(410);
  expect(response.headers()['x-robots-tag']).toBe('noindex, follow');
  await expect(page.getByText('Contenido no encontrado')).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);

  response = await open(page, 'error-de-servicio');
  expect(response.status()).toBe(503);
  await expect(page.getByRole('alert')).toContainText('Ficha no disponible');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});

test('mobile navigation: the page is one column, links are tappable and nothing is clipped', async ({ page, isMobile }, info) => {
  test.skip(!isMobile, 'mobile project only');
  await open(page, 'la-cura-del-bienestar');
  expect(page.viewportSize()!.width).toBeLessThanOrEqual(430);
  expect(await noHorizontalScroll(page)).toBe(true);
  const cards = await page.locator('app-entity-broadcast-list li').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
  expect(new Set(cards.map((x) => Math.round(x))).size, 'broadcast cards stack in one column').toBe(1);
  for (const link of await page.locator('nav[aria-labelledby="entity-explore-title"] a').all()) {
    const box = (await link.boundingBox())!;
    expect(box.height, 'target size').toBeGreaterThanOrEqual(24);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await link_navigates(page);
  await shot(page, 'mobile-after-nav', info.project.name);
});

async function link_navigates(page: Page) {
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Películas' }).first().click();
  await expect(page).toHaveURL(/\/programacion-tv\/peliculas$/);
}
