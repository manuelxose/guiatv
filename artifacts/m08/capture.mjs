// Read-only M08 evidence. Run the same route/viewport/theme matrix before and after release.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const origin = process.env.M08_ORIGIN || 'https://guiaprogramaciontv.com';
const label = process.env.M08_LABEL || 'before';
assert.match(label, /^[a-z0-9-]+$/);
const paths = (process.env.M08_PATHS || '/,/programacion-tv/en-directo,/canales,/programacion-tv/que-ver-hoy,/programacion-tv/peliculas,/programacion-tv/series,/deportes/futbol,/deportes/futbol/competiciones,/deportes/futbol/partidos-hoy,/guias,/perfil,/iniciar-sesion,/registro').split(',');
assert(paths.every(path => path.startsWith('/') && !path.startsWith('//')));
const dir = new URL(`./${label}/`, import.meta.url);
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: false });
const results = [];
try {
  for (const [index, path] of paths.entries()) {
    const context = await browser.newContext({ reducedMotion: 'reduce', timezoneId: 'Europe/Madrid' });
    const page = await context.newPage();
    const errors = [];
    const serverErrors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 500) serverErrors.push({ url: response.url(), status: response.status() }); });
    const ssrMs = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const response = await fetch(`${origin}${path}`);
      await response.text();
      ssrMs.push(Math.round(performance.now() - start));
    }
    const response = await page.goto(`${origin}${path}`, { waitUntil: 'load', timeout: 60000 });
    await page.locator('app-root').waitFor();
    const row = { path, status: response.status(), ssrMs, errors, serverErrors, matrix: [] };
    row.seo = await page.evaluate(() => ({ title: document.title, canonical: [...document.querySelectorAll('link[rel="canonical"]')].map(x => x.href), robots: document.querySelector('meta[name="robots"]')?.content, headings: [...document.querySelectorAll('h1')].map(x => x.textContent.trim()) }));
    for (const width of [375, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(value => localStorage.setItem('guiatv-theme', value), theme);
        await page.reload({ waitUntil: 'load', timeout: 60000 });
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
        row.matrix.push({ width, theme, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), violations: violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })) });
        await page.screenshot({ path: fileURLToPath(new URL(`${index}-${width}-${theme}.png`, dir)), fullPage: true });
        if (theme === 'light' && (width === 375 || width === 1440)) {
          await page.screenshot({ path: fileURLToPath(new URL(`${index}-${width}-${theme}-viewport.png`, dir)) });
        }
      }
    }
    results.push(row);
    await writeFile(new URL('report.json', dir), JSON.stringify({ origin, at: new Date().toISOString(), results }, null, 2));
    console.log(path, row.status, 'SSR ms', ssrMs.join('/'), 'axe', row.matrix.reduce((sum, x) => sum + x.violations.length, 0));
    await context.close();
  }
} finally { await browser.close(); }
