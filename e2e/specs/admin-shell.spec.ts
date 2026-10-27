import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockAdminShellBackend } from '../fixtures/admin-shell-mock';
import { assertNotBlankScreen } from '../fixtures/helpers';

/**
 * Admin shell rebuild — regression coverage for the two structural bugs the
 * rebuild fixed: (1) `/admin` was rendered through the consumer public
 * layout shell (`private-shell`), and (2) a single `sidebarOpen` boolean was
 * asked to mean both "mobile drawer open" and "desktop content should
 * reflow", which produced a sidebar/content overlap on desktop by default.
 *
 * Deliberately scoped to the shell only (not per-domain content) so it stays
 * fast and independent of any one section's mock shape — see
 * `admin-shell-mock.ts`.
 */

async function primeAdminSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('gtv_id_token', 'e2e-mock-shell-admin-token');
  });
}

test.describe('Admin shell', () => {
  test('desktop: sidebar and content never overlap, and Admin does not inherit the consumer shell', async ({
    page,
    context,
  }) => {
    await primeAdminSession(page);
    await mockAdminShellBackend(context);

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto('/admin');
    await assertNotBlankScreen(page);

    // Admin must not inherit the consumer public shell — no consumer footer
    // or bottom mobile nav mounted underneath the Admin shell.
    await expect(page.locator('app-public-layout-shell')).toHaveCount(0);
    await expect(page.locator('.app-shell__mobile-nav')).toHaveCount(0);

    const aside = page.locator('aside');
    const main = page.locator('main');
    await expect(aside).toBeVisible();
    await expect(main).toBeVisible();

    const asideBox = await aside.boundingBox();
    const mainBox = await main.boundingBox();
    expect(asideBox).not.toBeNull();
    expect(mainBox).not.toBeNull();
    // The regression this guards: sidebar rendered over content with zero
    // offset because `sidebarOpen` defaulted to false. The sidebar's right
    // edge must never extend past where the content column starts.
    expect(asideBox!.x + asideBox!.width).toBeLessThanOrEqual(mainBox!.x + 1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);

    expect(consoleErrors, `unexpected console/page errors: ${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('desktop: collapsing the sidebar narrows it without losing the content reflow', async ({ page, context }) => {
    await primeAdminSession(page);
    await mockAdminShellBackend(context);
    await page.goto('/admin');
    await assertNotBlankScreen(page);

    const aside = page.locator('aside');
    const before = await aside.boundingBox();

    await page.getByRole('button', { name: 'Collapse' }).click();

    await expect(async () => {
      const after = await aside.boundingBox();
      expect(after!.width).toBeLessThan(before!.width - 40);
    }).toPass({ timeout: 5000 });

    // The content column animates its offset after the sidebar does: poll until both have settled.
    const main = page.locator('main');
    await expect(async () => {
      const asideAfter = await aside.boundingBox();
      const mainAfter = await main.boundingBox();
      expect(asideAfter!.x + asideAfter!.width).toBeLessThanOrEqual(mainAfter!.x + 1);
    }).toPass({ timeout: 5000 });
  });

  test('mobile (390x844): drawer opens/closes via the trigger and Escape, traps focus, and restores it on close', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await primeAdminSession(page);
    await mockAdminShellBackend(context);

    await page.goto('/admin');
    await assertNotBlankScreen(page);

    const aside = page.locator('aside');
    const trigger = page.getByRole('button', { name: 'Open navigation' });

    // Closed by default on mobile.
    const closedBox = await aside.boundingBox();
    expect(closedBox!.x).toBeLessThan(0);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await expect(async () => {
      const openBox = await aside.boundingBox();
      expect(openBox!.x).toBe(0);
    }).toPass({ timeout: 5000 });
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Body scroll must be locked while the drawer overlay is open.
    const bodyOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
    expect(bodyOverflow).toBe('hidden');

    // Focus moves into the drawer on open (focus trap entry point).
    const activeInsideDrawer = await page.evaluate(() =>
      document.activeElement ? document.activeElement.closest('aside') !== null : false
    );
    expect(activeInsideDrawer).toBe(true);

    await page.keyboard.press('Escape');
    await expect(async () => {
      const closed = await aside.boundingBox();
      expect(closed!.x).toBeLessThan(0);
    }).toPass({ timeout: 5000 });

    // Focus is restored to the trigger that opened the drawer.
    await expect(trigger).toBeFocused();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('no critical accessibility violations on the default Overview landing', async ({ page, context }) => {
    await primeAdminSession(page);
    await mockAdminShellBackend(context);
    await page.goto('/admin');
    await assertNotBlankScreen(page);

    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations.filter((v) => v.impact === 'critical')).toEqual([]);
  });
});
