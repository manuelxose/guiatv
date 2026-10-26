import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { assertNoRenderedUndefined, assertNotBlankScreen } from '../fixtures/helpers';

/**
 * Football vertical E2E coverage (spec §115-119).
 *
 * Replaces the old sports.spec.ts, which asserted on `#tab-panel-sports` /
 * `.program-card` — the pre-rebuild unified-guide sports tab. That element
 * no longer exists anywhere in the app (grep-confirmed); `/deportes` now
 * redirects straight to the dedicated `/deportes/futbol` module these specs
 * actually cover.
 *
 * Runs against the real backend's read-only football data (football-data.org
 * when FOOTBALL_DATA_API_KEY is configured; falls back to EPG-derived data
 * otherwise, in which case scores/standings/live-minute assertions below
 * may legitimately see fewer/no results — the specs account for that by
 * skipping score-shape assertions when a section is empty rather than
 * failing on absence of data outside this suite's control).
 */

test.describe('Football Home', () => {
  test('loads and renders real match content, not a blank shell', async ({ page }) => {
    await page.goto('/deportes/futbol');
    await assertNotBlankScreen(page);
    await expect(page.locator('h1', { hasText: 'Fútbol' })).toBeVisible({ timeout: 20_000 });
    await assertNoRenderedUndefined(page);
  });

  test('the standard contextual football menu reaches every route-level destination', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/deportes/futbol');
    await assertNotBlankScreen(page);
    const menu = page.getByRole('navigation', { name: 'Secciones de Fútbol' });
    await expect(page.locator('app-portal-context-nav app-breadcrumb')).toBeVisible();
    await expect(menu.getByRole('link')).toHaveCount(5);
    const destinations = [
      { label: 'Portada', url: /\/deportes\/futbol$/ },
      { label: 'Partidos', url: /\/deportes\/futbol\/partidos-hoy/ },
      { label: 'Competiciones', url: /\/deportes\/futbol\/competiciones/ },
      { label: 'Dónde ver', url: /\/deportes\/futbol#donde-ver$/ },
      { label: 'Noticias', url: /\/deportes\/futbol\/noticias/ },
    ] as const;

    for (const destination of destinations) {
      await page.goto('/deportes/futbol');
      await menu.getByRole('link', { name: destination.label, exact: true }).click();
      await page.waitForURL(destination.url, { timeout: 20_000 });
      await assertNotBlankScreen(page);
    }
  });

  test('the redesigned home remains contained at every required handoff width in both themes', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const widths = [1440, 1280, 1024, 768, 430, 390, 375, 360, 320];

    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/deportes/futbol');
      await expect(page.locator('h1', { hasText: 'Fútbol' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('navigation', { name: 'Secciones de Fútbol' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const widthsOnPage = await page.evaluate(() => ({
        football: document.querySelector<HTMLElement>('.football-home')?.getBoundingClientRect().width || 0,
        content: document.querySelector<HTMLElement>('.app-public-layout-shell__content')?.getBoundingClientRect().width || 0,
      }));
      expect(Math.abs(widthsOnPage.football - widthsOnPage.content)).toBeLessThan(1);
      await page.screenshot({
        path: testInfo.outputPath(`football-home-light-${width}.png`),
        fullPage: true,
      });
    }

    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/deportes/futbol');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`football-home-dark-${width}.png`),
        fullPage: true,
      });
    }
  });

  test('football uses the app-wide search instead of mounting a separate search control', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/deportes/futbol');
    await expect(page.locator('.football-home__search')).toHaveCount(0);
    const globalSearch = page.locator('#unified-search-input');
    await expect(globalSearch).toBeVisible();
    await expect(globalSearch).toHaveAttribute('placeholder', /fútbol/);
    // Exercise keyboard input; an instantaneous fill can race SSR form hydration.
    await globalSearch.click();
    await globalSearch.pressSequentially('LaLiga', { delay: 100 });
    await expect(page.getByRole('group', { name: 'Fútbol' })).toBeVisible({ timeout: 20_000 });
    await expect(globalSearch).toHaveValue('LaLiga');
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
  });
});

test.describe('Football Matches -> Match Centre', () => {
  test('Partidos de hoy loads and, if any match exists, opens a real Match Centre', async ({ page }) => {
    await page.goto('/deportes/futbol/partidos-hoy');
    await assertNotBlankScreen(page);

    const row = page.locator('.row').first();
    const hasMatches = await row.isVisible({ timeout: 20_000 }).catch(() => false);
    test.skip(!hasMatches, 'No matches for today in the current data window — nothing to open.');

    await row.click();
    await page.waitForURL(/\/deportes\/futbol\/partido\//, { timeout: 20_000 });
    await expect(page.locator('.scoreboard')).toBeVisible({ timeout: 20_000 });
    await assertNoRenderedUndefined(page);
  });

  test('uses one route navigation and filter chips across supported widths', async ({ page }) => {
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/deportes/futbol/partidos-hoy');
      await assertNotBlankScreen(page);

      await expect(page.getByRole('navigation', { name: 'Secciones de Fútbol' })).toBeVisible();
      await expect(page.locator('app-portal-local-toolbar')).toHaveCount(0);
      await expect(page.getByRole('group', { name: 'Filtrar partidos' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }

    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test('the Live filter narrows the list to live/halftime matches only', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/deportes/futbol/partidos-hoy?filter=live');
    await assertNotBlankScreen(page);
    await expect(page.getByRole('group', { name: 'Filtrar partidos' }).getByRole('button', { name: 'En directo', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('main.content')).toHaveAttribute('aria-busy', 'false');
    const rows = page.locator('app-football-match-row .row');
    if (await rows.count()) {
      await expect(page.locator('app-football-match-row .row:not(.row--live)')).toHaveCount(0);
    } else {
      await expect(page.getByText('No hay partidos para este filtro', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Ver todos los partidos', exact: true }).click();
      await expect(page.getByRole('group', { name: 'Filtrar partidos' }).getByRole('button', { name: 'Todos', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page).not.toHaveURL(/filter=live/);
    }
  });

  test('Calendario: the date strip actually changes which day is loaded (regression)', async ({ page }) => {
    // This is the exact bug fixed this session: the old day-nav wrote a
    // `day` query param but the page read a `date` PATH param the route
    // never defined, so clicking next/last day never changed the URL or
    // the loaded data at all.
    await page.goto('/deportes/futbol/calendario');
    await assertNotBlankScreen(page);

    const urlBefore = page.url();
    const nextDayButton = page.getByRole('button', { name: 'Día siguiente' });
    await expect(nextDayButton).toBeVisible({ timeout: 20_000 });
    await nextDayButton.click();

    await expect.poll(() => page.url(), { timeout: 20_000 }).not.toBe(urlBefore);
    const url = new URL(page.url());
    expect(url.searchParams.get('date')).toMatch(/^\d{8}$/);
  });

  test('the filter bar is present and All/Live/Upcoming/Finished are all reachable', async ({ page }) => {
    await page.goto('/deportes/futbol/partidos-hoy');
    await assertNotBlankScreen(page);
    const bar = page.getByRole('group', { name: 'Filtrar partidos' });
    await expect(bar).toBeVisible({ timeout: 20_000 });
    for (const label of ['Todos', 'En directo', 'TV', 'Próximos', 'Finalizados']) {
      await expect(bar.getByText(label, { exact: true })).toBeVisible();
    }
  });
});

test.describe('Competitions', () => {
  test('filters the catalog and recovers from no results on mobile without a second menu', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto('/deportes/futbol/competiciones');
    const firstCompetition = page.locator('.competition').first();
    await expect(firstCompetition).toBeVisible({ timeout: 30_000 });
    const initialCount = await page.locator('.competition').count();
    const input = page.getByRole('searchbox', { name: 'Filtrar competiciones' });
    await input.fill('competition-that-does-not-exist');
    await expect(page.getByText('No hay competiciones para este filtro')).toBeVisible();
    await expect(page.locator('#competition-count')).toHaveText('0 competiciones');
    await page.getByRole('button', { name: 'Quitar filtro', exact: true }).click();
    await expect(page.locator('.competition')).toHaveCount(initialCount);
    await expect(input).toHaveValue('');
    await expect(page.getByRole('navigation', { name: 'Secciones de Fútbol' })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });

  test('the hub lists real competitions grouped by country/featured', async ({ page }) => {
    await page.goto('/deportes/futbol/competiciones');
    await assertNotBlankScreen(page);
    const firstCompetition = page.locator('.competition').first();
    await expect(firstCompetition).toBeVisible({ timeout: 30_000 });
    await assertNoRenderedUndefined(page);
  });

  test('opening a competition shows a real header and Resumen/Calendario/Clasificación tabs', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/deportes/futbol/competiciones');
    await assertNotBlankScreen(page);

    const firstCompetition = page.locator('.competition').first();
    await expect(firstCompetition).toBeVisible({ timeout: 30_000 });
    await firstCompetition.click();
    await page.waitForURL(/\/deportes\/futbol\/competiciones\//, { timeout: 30_000 });

    await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
    const tabs = page.getByRole('group', { name: 'Secciones de la competición' });
    await expect(tabs.getByRole('button')).toHaveCount(3);

    await page.goto(`${page.url()}#clasificacion`);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(tabs.getByRole('button', { name: 'Clasificación', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('app-football-standings-table')).toHaveCount(1);
    // Either a real standings table renders, or the table's own honest
    // "not available" message does — never a blank/broken panel.
    const hasTable = await page.locator('.standings__row').first().isVisible({ timeout: 20_000 }).catch(() => false);
    const hasEmpty = await page.getByText('Clasificación no disponible').isVisible({ timeout: 20_000 }).catch(() => false);
    expect(hasTable || hasEmpty).toBeTruthy();
  });
});

test.describe('Team detail', () => {
  test('reached from a competition standings row, shows a real team header', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/deportes/futbol/competiciones');
    await assertNotBlankScreen(page);
    const firstCompetition = page.locator('.competition').first();
    await expect(firstCompetition).toBeVisible({ timeout: 30_000 });
    await firstCompetition.click();
    await page.waitForURL(/\/deportes\/futbol\/competiciones\//, { timeout: 30_000 });

    const tabs = page.getByRole('group', { name: 'Secciones de la competición' });
    await tabs.getByRole('button', { name: 'Clasificación', exact: true }).click();
    // The team name itself is the link (spec §100 "no dead-end pages") —
    // the row is a table row, not a single clickable target.
    const teamLink = page.locator('.standings__name').first();
    const hasStandings = await teamLink.isVisible({ timeout: 30_000 }).catch(() => false);
    test.skip(!hasStandings, 'No standings data for this competition in the current data window.');

    await teamLink.click();
    await page.waitForURL(/\/deportes\/futbol\/equipos\//, { timeout: 30_000 });
    await expect(page.locator('.head__title')).toBeVisible({ timeout: 30_000 });
    await assertNoRenderedUndefined(page);
  });
});

test.describe('Football search', () => {
  test('a real query returns grouped, navigable results', async ({ page }) => {
    await page.goto('/deportes/futbol/buscar');
    await assertNotBlankScreen(page);

    await page.locator('#football-search-input').fill('Real');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await page.waitForURL(/[?&]q=Real/, { timeout: 20_000 });

    // Either at least one grouped result section renders, or the search's
    // own honest "no results" message does.
    const hasAnyResult = await page.locator('.team-link, .row, .competition, .news').first().isVisible({ timeout: 20_000 }).catch(() => false);
    const hasEmpty = await page.getByText(/Sin resultados para/).isVisible({ timeout: 20_000 }).catch(() => false);
    expect(hasAnyResult || hasEmpty).toBeTruthy();
    await assertNoRenderedUndefined(page);
  });

  test('an empty query shows the search prompt, not an empty-results message', async ({ page }) => {
    await page.goto('/deportes/futbol/buscar');
    await expect(page.getByText('Busca un equipo, partido o competición')).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('Football news', () => {
  test('the list page renders its real empty state honestly when no football content is tagged yet', async ({ page }) => {
    // As of this session, zero blog posts carry football sportsRelations or
    // a football category — getNews() correctly returns empty rather than
    // showing the site's unrelated general blog feed (the bug this session
    // fixed). This spec locks in that honest behavior; once real football
    // content exists, this test starts seeing real cards instead and should
    // be revisited rather than treated as a permanent assertion of emptiness.
    await page.goto('/deportes/futbol/noticias');
    await assertNotBlankScreen(page);
    const hasCards = await page.locator('.grid > *').first().isVisible({ timeout: 30_000 }).catch(() => false);
    const hasEmptyState = await page.getByText('Todavía no hay noticias').isVisible({ timeout: 30_000 }).catch(() => false);
    expect(hasCards || hasEmptyState).toBeTruthy();
    await assertNoRenderedUndefined(page);
  });
});
