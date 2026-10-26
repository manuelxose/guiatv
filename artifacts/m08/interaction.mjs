// Same mobile interaction before/after; includes automation, debounce and API latency.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin = process.env.M08_ORIGIN || 'https://guiaprogramaciontv.com';
const label = process.env.M08_LABEL || 'before-resume';
assert.match(label, /^[a-z0-9-]+$/);
const browser = await chromium.launch({ headless: true });
const samples = [];
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(`${origin}/deportes/futbol`, { waitUntil: 'load' });
  const trigger = page.getByRole('button', { name: 'Buscar', exact: true });
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    await trigger.click();
    const input = page.getByRole('combobox');
    await input.waitFor({ state: 'visible' });
    const openMs = Math.round(performance.now() - start);
    const searchStart = performance.now();
    await input.fill('Madrid');
    await page.locator('.search-shell__option').first().waitFor({ state: 'visible' });
    samples.push({ openMs, suggestionsMs: Math.round(performance.now() - searchStart), options: await page.locator('.search-shell__option').count() });
    await input.press('Escape');
    assert.equal(await page.locator('body').evaluate(el => el.classList.contains('portal-overlay-open')), false);
  }
} finally { await browser.close(); }
await writeFile(new URL(`./interaction-${label}.json`, import.meta.url), JSON.stringify({ origin, at: new Date().toISOString(), query: 'Madrid', samples }, null, 2));
console.log(label, JSON.stringify(samples));
