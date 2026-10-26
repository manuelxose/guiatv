import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

let backend: { origin: string; stop: () => Promise<void> };
let ssr: { origin: string; stop: () => Promise<void> };
const competitions = [
  { id: 'm08-es', slug: 'm08-liga', name: 'Liga de prueba', country: 'España', type: 'league', providerIds: {}, lastUpdatedAt: '2026-10-23T10:00:00Z' },
  { id: 'm08-it', slug: 'm08-copa', name: 'Copa de prueba', country: 'Italia', type: 'cup', providerIds: {}, lastUpdatedAt: '2026-10-23T10:00:00Z' },
];
const api: Record<string, unknown> = {
  '/v2/sports/football/competitions': { competitions, meta: {} },
  '/v2/sports/football/search': { matches: [], teams: [], competitions: [], news: [], meta: {} },
  '/v2/discovery/search': { items: [], meta: {} },
};

test.beforeAll(async () => {
  // @ts-ignore existing ESM SSR harness
  const harness = await import('../../apps/frontend/scripts/entity-ssr-harness.mjs');
  backend = await harness.startBackend({}, api);
  ssr = await harness.launchSsr(backend.origin);
});
test.afterAll(async () => { await ssr?.stop(); await backend?.stop(); });
test.beforeEach(async ({ page }) => {
  await page.route(/\/v2\//, route => {
    const data = api[new URL(route.request().url()).pathname];
    return route.fulfill({ status: data ? 200 : 404, contentType: 'application/json', body: JSON.stringify(data ? { success: true, data } : { success: false, error: { code: 'NOT_FOUND' } }) });
  });
});

test('M08 competition filter works with keyboard, accents and empty recovery', async ({ page }) => {
  await page.goto(`${ssr.origin}/deportes/futbol/competiciones`);
  const filter = page.getByRole('searchbox', { name: 'Filtrar competiciones' });
  await filter.fill('espana');
  await expect(page.locator('#competition-count')).toHaveText('1 competición');
  await expect(page.getByRole('link', { name: /Liga de prueba/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Copa de prueba/ })).toHaveCount(0);
  await filter.fill('no existe');
  await expect(page.getByText('No hay competiciones para este filtro')).toBeVisible();
  const reset = page.getByRole('button', { name: 'Quitar filtro' });
  await reset.focus();
  await page.keyboard.press('Enter');
  await expect(filter).toHaveValue('');
  await expect(page.locator('#competition-count')).toHaveText('2 competiciones');
});

test('M08 mobile search traps focus, dismisses empty results and releases resize lock', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(`${ssr.origin}/deportes/futbol/competiciones`);
  const trigger = page.getByRole('button', { name: 'Buscar', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Buscar en Guía TV' });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole('combobox');
  await expect(input).toBeFocused();
  await input.fill('sin coincidencias');
  await expect(dialog.getByText(/No hay sugerencias/)).toBeVisible();
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await input.focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator('body')).not.toHaveClass(/portal-overlay-open/);
  await trigger.click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/portal-overlay-open/);
});

test('M08 football catalog and shared shell responsive WCAG AA matrix', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'Explicit matrix covers mobile and desktop.');
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${ssr.origin}/deportes/futbol/competiciones`);
  for (const width of [375, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => localStorage.setItem('guiatv-theme', value), theme);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Competiciones de fútbol');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => `${n.target}: ${n.failureSummary}`).join(', ')}`)).toEqual([]);
      await page.screenshot({ path: info.outputPath(`m08-competitions-${width}-${theme}.png`), fullPage: true });
    }
  }
  expect(errors).toEqual([]);
});

test('M08 signed-out auth entry points keep readable controls in both themes', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'Explicit matrix covers both sizes.');
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.goto(`${ssr.origin}/iniciar-sesion`);
      await page.evaluate(value => localStorage.setItem('guiatv-theme', value), theme);
      for (const path of ['/iniciar-sesion', '/registro']) {
        await page.goto(`${ssr.origin}${path}`);
        await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.failureSummary).join(', ')}`)).toEqual([]);
      }
    }
  }
});
