import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const origin = process.env.M08_ORIGIN || 'http://127.0.0.1:4382';
const label = process.env.M08_CHILD_LABEL || 'football-child-final';
assert.match(label, /^[a-z0-9-]+$/);
const browser = await chromium.launch({ headless: true });
const results = [];
await mkdir(`artifacts/m08/${label}-screenshots`, { recursive: true });
try {
  for (const width of [375, 1440]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', timezoneId: 'Europe/Madrid' });
    await context.addInitScript(value => localStorage.setItem('guiatv-theme', value), theme);
    const page = await context.newPage();
    await page.goto(`${origin}/deportes/futbol`, { waitUntil: 'networkidle' });
    const competition = await page.locator('a[fragment="clasificacion"]').first().getAttribute('href');
    const match = await page.locator('.football-home a[href*="/partido/"]').first().getAttribute('href');
    assert(competition && match, 'Verified competition and match links must exist');
    const routes = [{ kind: 'competition-standings', path: competition }, { kind: 'match', path: match }];
    for (let index = 0; index < routes.length; index++) {
      const { kind, path } = routes[index];
      const errors = [];
      const onError = error => errors.push(error.message);
      page.on('pageerror', onError);
      const response = await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200);
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      if (kind === 'competition-standings') {
        assert.equal(await page.getByRole('button', { name: 'Clasificación', exact: true }).getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('app-football-standings-table').count(), 1, 'Fragment navigation must remove the SSR summary after hydration');
        const team = await page.locator('.standings__name').first().getAttribute('href');
        assert(team, 'Verified standings team link must exist');
        routes.push({ kind: 'team', path: team });
      }
      if (kind === 'match') {
        const time = page.locator('.scoreboard__time');
        if (await time.count()) assert.match(await time.innerText(), /^\d{2}:\d{2}$/);
        assert(await page.evaluate(() => {
          const bounds = document.querySelector('.scoreboard').getBoundingClientRect();
          return [...document.querySelectorAll('.scoreboard .badge__name')].every(element => {
            const rect = element.getBoundingClientRect();
            return rect.left >= bounds.left && rect.right <= bounds.right;
          });
        }), 'Both team names must stay inside the scoreboard');
      }
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      results.push({ kind, path, width, theme, status: response.status(), overflow, errors, violations: axe.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })) });
      await page.screenshot({ path: `artifacts/m08/${label}-screenshots/${kind}-${width}-${theme}.png`, fullPage: true });
      await writeFile(`artifacts/m08/${label}-qa.json`, JSON.stringify({ origin, at: new Date().toISOString(), results }, null, 2));
      console.log(kind, width, theme, 'overflow', overflow, 'axe', axe.violations.length);
      page.off('pageerror', onError);
    }
    await context.close();
  }
} finally { await browser.close(); }
assert(results.every(row => !row.overflow && !row.errors.length && !row.violations.some(v => ['serious', 'critical'].includes(v.impact))), 'Child views must pass overflow, runtime and serious accessibility checks');

