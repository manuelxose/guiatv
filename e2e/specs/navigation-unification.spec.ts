import { expect, test } from '@playwright/test';

const routes = [
  { path: '/guias', heading: /Guías/, active: 'Todas' },
  { path: '/guias/rankings', heading: 'Rankings', active: 'Rankings' },
  { path: '/tendencias', heading: 'Tendencias', active: 'Tendencias' },
  { path: '/comparador-streaming', heading: 'Compara plataformas con datos útiles', active: 'Comparador' },
] as const;

const viewports = [
  { width: 320, height: 720 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

const visualRoutes = [
  '/',
  '/programacion-tv/en-directo',
  '/programacion-tv/que-ver-hoy',
  '/plataformas',
  '/deportes/futbol',
  '/deportes/futbol/partidos-hoy',
  '/guias',
  '/guias/rankings',
  '/tendencias',
  '/comparador-streaming',
  '/guias/estrenos-en-streaming-esta-semana',
] as const;

test.describe('Canonical section navigation', () => {
  for (const route of routes) {
    test(`${route.path} exposes its contextual active state`, async ({ page }) => {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible();
      const contextLabel = route.path.startsWith('/guias')
        ? 'Secciones de Guías'
        : route.path === '/tendencias' ? 'Secciones de Qué ver' : 'Secciones de Plataformas';
      await expect(
        page.getByRole('navigation', { name: contextLabel }).getByRole('link', { name: route.active, exact: true })
      ).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('app-portal-context-nav app-breadcrumb')).toHaveCount(1);
      await expect(page.locator('app-breadcrumb')).toHaveCount(1);
      await expect(page.locator('app-portal-context-nav .portal-context-nav')).toHaveCSS('border-radius', '0px');

      await expect(page.getByRole('navigation', { name: contextLabel })).toBeVisible();
    });
  }

  test('critical hubs do not overflow at supported widths', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const path of visualRoutes) {
        await page.goto(path);
        await expect(page.locator('.unified-top-nav')).toBeVisible();
        if (path !== '/') {
          await expect(page.locator('app-portal-context-nav')).toBeVisible();
        }
        // Late-rendering content (rails, EPG cells, skeletons settling under
        // shared-backend load) can momentarily widen the document. Poll until
        // the page settles to exactly the viewport width; a route that truly
        // overflows fails the poll instead of flaking on a transient state.
        await expect
          .poll(async () => page.evaluate(() => document.documentElement.scrollWidth), {
            timeout: 12_000,
          })
          .toBe(viewport.width);
        await page.screenshot({
          path: testInfo.outputPath(`${path.replaceAll('/', '-') || 'home'}-${viewport.width}x${viewport.height}.png`),
        });
      }
    }
  });

  test('contextual navigation and hierarchy stay visible on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible();
      await expect(page.locator('app-portal-context-nav')).toBeVisible();
      await expect(page.locator('app-portal-context-nav app-breadcrumb')).toBeVisible();
    }
  });

  test('TV, Qué ver and Fútbol share the same contextual navigation structure', async ({ page }) => {
    const sections = [
      { path: '/programacion-tv/en-directo', label: 'Secciones de TV', items: ['En emisión', 'A continuación', 'Esta noche', 'Parrilla', 'Canales'] },
      { path: '/programacion-tv/que-ver-hoy', label: 'Secciones de Qué ver', items: ['Todo', 'En TV', 'Gratis', 'Películas', 'Series', 'Tendencias'] },
      { path: '/deportes/futbol', label: 'Secciones de Fútbol', items: ['Portada', 'Partidos', 'Competiciones', 'Dónde ver', 'Noticias'] },
    ] as const;

    for (const section of sections) {
      await page.goto(section.path);
      await expect(page.locator('[data-testid="portal-section-nav"]')).toHaveCount(1);
      await expect(page.locator('app-breadcrumb')).toHaveCount(1);
      const nav = page.getByRole('navigation', { name: section.label });
      for (const item of section.items) await expect(nav.getByText(item, { exact: true })).toBeVisible();
    }
  });

  test('channel catalogue is discoverable, responsive and linked to canonical details', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/canales');
    await expect(page.getByRole('heading', { name: 'Canales de televisión' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Buscar canal u operador' })).toBeVisible();
    await expect(page.locator('.channel-card').first()).toBeVisible();
    await expect(page.locator('.app-shell__mobile-tab--active')).toContainText('TV');
    await expect(page.locator('.channel-card__footer a').first()).toHaveAttribute('href', /^\/canales\//);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });

  test('renders one search affordance for each responsive mode', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/guias');
    await expect(page.locator('#unified-search-input')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Buscar', exact: true })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#unified-search-input')).toHaveCount(0);
    const trigger = page.getByRole('button', { name: 'Buscar', exact: true });
    await expect(trigger).toHaveCount(1);
    await trigger.click();
    await expect(page.locator('#unified-search-input')).toHaveCount(1);
    await expect(page.locator('#unified-search-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });

  test('uses channel schedule rows on mobile and the EPG matrix on desktop', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/programacion-tv/en-directo?liveView=day');
    await expect(page.locator('.live-view__mobile-day')).toBeVisible({ timeout: 40_000 });
    await expect(page.locator('.live-view__grid-wrap')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

    const firstMobileRow = page.locator('.live-view__mobile-program').first();
    if (await firstMobileRow.count()) {
      const rowBox = await firstMobileRow.boundingBox();
      expect(rowBox?.height).toBeGreaterThanOrEqual(44);
    }

    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.locator('.live-view__mobile-day')).toBeHidden();
    await expect(page.locator('.live-view__grid-wrap')).toBeVisible();
    await expect(page.locator('app-epg-grid')).toBeVisible();
  });

  test('keeps Platforms and Comparator in the same shell with canonical exits', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/plataformas');

    const topNav = page.locator('app-unified-top-nav');
    await expect(topNav).toHaveCount(1);
    await page.getByRole('navigation', { name: 'Secciones de Plataformas' })
      .getByRole('link', { name: 'Comparador', exact: true })
      .click();

    await expect(page).toHaveURL(/\/comparador-streaming/);
    await expect(topNav).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Secciones de Plataformas' })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Compara plataformas con datos útiles' })).toBeVisible();

    await expect(page.getByRole('link', { name: 'Explorar catálogos' })).toHaveAttribute('href', '/plataformas');
    const providerLink = page.locator('.offer__actions').first().getByRole('link');
    await expect(providerLink).toHaveAccessibleName(/.+; abre una pestaña nueva/);
    await expect(providerLink).toHaveAttribute(
      'href',
      /^\/v2\/monetization\/go\//
    );
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`Blog and Comparator render in ${theme} theme without broken covers`, async ({ page }) => {
      await page.addInitScript((mode) => localStorage.setItem('guiatv-theme', mode), theme);
      await page.setViewportSize({ width: 1440, height: 900 });

      for (const path of ['/guias', '/guias/rankings', '/comparador-streaming']) {
        await page.goto(path);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
        const failedImages = await page.locator('main img, app-unified-portal-shell img').evaluateAll(
          (images) => images.filter((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth === 0).length
        );
        expect(failedImages).toBe(0);
      }
    });
  }
});
