import { test, expect } from '@playwright/test';
import { assertNoRenderedUndefined, assertNotBlankScreen } from '../fixtures/helpers';

const BACKEND_URL = process.env.E2E_BACKEND_URL || 'http://localhost:4000';

/**
 * Journey 3 (brief §28.3): Buscar -> suggestions -> resultado -> detalle.
 *
 * Setup/data only (never auth/write): reads a real, currently-airing program
 * title straight from the read-only /v2/tv/read endpoint so the search query
 * is guaranteed to match real content instead of a hand-picked guess.
 */
test.describe('Buscar -> suggestions -> resultado -> detalle', () => {
  test('typing a real title surfaces suggestions, submitting opens results, opening a result shows its detail', async ({
    page,
    request,
  }) => {
    // This journey is five sequential network round-trips against the real
    // backend (setup fetch, typeahead, submit, results render, detail
    // render) — longer than the suite default is warranted here.
    test.setTimeout(90_000);

    let readBody: any = null;
    await expect.poll(async () => {
      const response = await request.get(`${BACKEND_URL}/v2/tv/read?view=now`);
      if (response.ok()) readBody = await response.json();
      return response.status();
    }, { timeout: 20_000, intervals: [500, 1_000, 2_000] }).toBe(200);
    const items: Array<{ program?: { title?: string } }> = readBody?.data?.items || [];
    const realTitle = items.map((i) => i.program?.title).find((t) => t && t.trim().length >= 4);
    test.skip(!realTitle, 'No live program title available from the backend right now');
    const queryTerm = realTitle!.slice(0, Math.min(6, realTitle!.length));

    await page.goto('/');
    await assertNotBlankScreen(page);

    const searchInput = page.locator('#unified-search-input');
    await searchInput.click();
    await expect(page.getByRole('button', { name: 'Limpiar búsqueda' })).toHaveCount(0);
    await searchInput.fill(queryTerm);
    await expect(page.getByRole('button', { name: 'Limpiar búsqueda' })).toHaveCount(1);

    const suggestionMenu = page.locator('.search-shell__menu');
    await expect(suggestionMenu).toBeVisible({ timeout: 20_000 });

    const suggestionOptions = page.locator('.search-shell__option:not(.search-shell__option--history)');
    await expect(suggestionOptions.first()).toBeVisible({ timeout: 20_000 });
    const suggestionCount = await suggestionOptions.count();
    expect(suggestionCount).toBeGreaterThan(0);
    const firstSuggestionTitle = (
      await suggestionOptions.first().locator('.search-shell__option-title').innerText()
    ).trim();
    expect(firstSuggestionTitle.length).toBeGreaterThan(0);

    // Keyboard selection follows grouped display order and Escape restores a closed combobox.
    await searchInput.press('ArrowDown');
    const firstOptionId = await suggestionOptions.first().getAttribute('id');
    await expect(searchInput).toHaveAttribute('aria-activedescendant', firstOptionId!);
    await expect(suggestionOptions.first()).toHaveAttribute('aria-selected', 'true');
    await searchInput.press('Escape');
    await expect(suggestionMenu).not.toBeVisible();
    await expect(searchInput).toHaveAttribute('aria-expanded', 'false');
    await expect(searchInput).not.toHaveAttribute('aria-activedescendant');
    await searchInput.press('ArrowDown');
    await expect(suggestionMenu).toBeVisible();

    // "resultado": submit the full search instead of picking the suggestion directly.
    const submitButton = page.locator('.search-shell__submit', { hasText: 'Ver resultados completos' });
    await submitButton.click();

    await page.waitForURL(/[?&]q=/, { timeout: 15_000 });
    await assertNoRenderedUndefined(page);

    // "detalle": open the first real result from the results grid.
    const resultCard = page.locator('.program-card').first();
    await expect(resultCard).toBeVisible({ timeout: 15_000 });
    await resultCard.locator('a.program-card__tap').click();

    await page.waitForURL(/\/(contenido|programas|peliculas|series|detalles|canales)\//, { timeout: 15_000 });
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible({ timeout: 15_000 });
    expect((await heading.innerText()).trim().length).toBeGreaterThan(0);
    await assertNoRenderedUndefined(page);
  });
});
