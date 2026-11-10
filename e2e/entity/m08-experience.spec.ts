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

// The M08 competition filter and the mobile search dialog belonged to the legacy football pages; the sports v2
// cutover (M04) serves /deportes/futbol with a catalogue without a filter and an inline header search, so their tests went with them.

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
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Competiciones');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      // The theme is applied after hydration and backgrounds transition: axe must read the settled colours.
      await page.waitForFunction(() => document.getAnimations().every(a => !(a instanceof CSSTransition) || a.playState !== 'running'));
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
        await page.waitForFunction(() => document.getAnimations().every(a => !(a instanceof CSSTransition) || a.playState !== 'running'));
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.failureSummary).join(', ')}`)).toEqual([]);
      }
    }
  }
});
