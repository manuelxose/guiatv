import { expect, test } from '@playwright/test';
import { reviewArtifactPath } from '../fixtures/review-artifact';

test.describe('Shared responsive shell', () => {
  test('mobile exposes the intentional primary destinations and More sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/programacion-tv/en-directo');

    const nav = page.getByRole('navigation', { name: 'Navegación principal móvil' });
    await expect(nav).toBeVisible();
    const tabs = nav.getByRole('link');
    await expect(tabs).toHaveCount(4);
    expect(new Set(await tabs.evaluateAll((items) => items.map((item) => item.getAttribute('href')))).size).toBe(4);
    await expect(nav.getByRole('link', { name: 'TV', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Inicio', exact: true })).toBeVisible();

    const more = nav.getByRole('button', { name: 'Más', exact: true });
    await more.click();
    const sheet = page.getByRole('dialog', { name: 'Más opciones' });
    await expect(sheet).toBeVisible();
    await expect(page.locator('.app-shell__route-content')).toHaveAttribute('inert', '');
    await expect(sheet.getByRole('link', { name: /Plataformas/ })).toBeVisible();
    await expect(sheet.getByRole('link', { name: /Guías/ })).toBeVisible();
    // Rankings are intentionally discoverable from the More sheet (design system §33).
    await expect(sheet.getByRole('link', { name: /Rankings/ })).toBeVisible();
    await expect(sheet.getByRole('link', { name: /Tendencias/ })).toBeVisible();
    await page.keyboard.press('Shift+Tab');
    await expect(sheet.locator(':focus')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();

    const chat = page.getByRole('button', { name: 'Abrir asistente de recomendaciones' });
    await expect(chat).toBeVisible();
    const [chatBox, navBox] = await Promise.all([chat.boundingBox(), nav.boundingBox()]);
    expect(chatBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(chatBox!.y + chatBox!.height).toBeLessThanOrEqual(navBox!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });

  test('one theme click always flips the concrete palette and persists', async ({ page }) => {
    await page.goto('/guias');
    const themeButton = page.locator('.unified-top-nav__theme');
    const before = await page.locator('html').getAttribute('data-theme');
    await themeButton.click();
    const selectedTheme = await page.locator('html').getAttribute('data-theme');
    expect(['light', 'dark']).toContain(selectedTheme);
    expect(selectedTheme).not.toBe(before);
    await themeButton.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', before!);

    await page.goto('/deportes');
    await expect(page.locator('html')).toHaveAttribute('data-theme', before!);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', before!);
  });

  test('desktop exposes the five canonical sibling destinations', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Secciones principales' });
    await expect(nav.getByRole('link')).toHaveCount(5);
    await expect(nav.getByRole('link', { name: 'Guías', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Editorial y más' })).toHaveCount(0);
  });

  test('shell keeps a single document width across supported responsive widths', async ({ page }) => {
    test.setTimeout(90_000);
    for (const width of [320, 360, 390, 430, 768, 1024, 1280, 1366, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      if (width < 768) {
        await expect(page.getByRole('navigation', { name: 'Navegación principal móvil' })).toBeVisible();
      } else {
        await expect(page.getByRole('navigation', { name: 'Secciones principales' })).toBeVisible();
      }
    }
  });

  test('chat opens assistant-first and keeps Personas as secondary navigation', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Abrir asistente de recomendaciones' }).click();

    const panel = page.locator('.app-shell__chat-panel--desktop');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Asistente GuíaTV' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Abrir chat con personas' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Personas', exact: true })).toHaveCount(0);
    await page.screenshot({ path: reviewArtifactPath(testInfo, 'assistant-desktop-light.png') });
  });
});
