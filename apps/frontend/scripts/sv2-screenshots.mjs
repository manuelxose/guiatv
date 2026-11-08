// Captures responsive evidence for sports-v2 (mobile 390, tablet 768, desktop 1440) and runs basic layout checks.
// Usage: node scripts/sv2-screenshots.mjs [baseUrl]   (needs a running app; writes docs/sports-v2/evidence/m02)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4210';
const out = new URL('../../../docs/sports-v2/evidence/m02/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(out, { recursive: true });
const sizes = { mobile: [390, 844], tablet: [768, 1024], desktop: [1440, 900] };
const pages = [
  ['home', '/deportes/futbol'],
  ['live', '/deportes/futbol/en-directo'],
  ['fixtures', '/deportes/futbol/partidos'],
  ['results', '/deportes/futbol/resultados'],
  ['competition', '/deportes/futbol/competiciones/liga-demo-a'],
  ['competition-table', '/deportes/futbol/competiciones/liga-demo-a?tab=clasificacion'],
  ['team', '/deportes/futbol/equipos/real-costa'],
  ['standings', '/deportes/futbol/clasificaciones/liga-demo-a'],
  ['match', '/deportes/futbol/partido/PLACEHOLDER'],
  ['news', '/deportes/futbol/noticias'],
  ['article', '/deportes/futbol/noticias/claves-del-duelo-real-costa-racing-sur'],
  ['search', '/deportes/futbol/buscar?q=real'],
  ['following', '/deportes/futbol/siguiendo'],
];
const browser = await chromium.launch();
const report = [];
for (const [device, [width, height]] of Object.entries(sizes)) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/502|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${base}/deportes/futbol`, { waitUntil: 'networkidle' });
  await page.waitForSelector('app-sv2-match-card, app-sv2-match-row');
  const live = await page.$eval('app-sv2-match-card', (el) => el.querySelector('.body').getAttribute('aria-label')).catch(() => '');
  const slug = await page.evaluate(() => document.querySelector('app-sv2-context-panel a[aria-label^="Abrir el partido"]')?.getAttribute('href')?.split('/').pop());
  for (const [name, path] of pages) {
    const url = path.replace('PLACEHOLDER', slug ?? '');
    await page.goto(`${base}${url}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main#sv2-main h1, main#sv2-main app-sv2-match-hero', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(250);
    const metrics = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, mainOverflow: (() => { const m = document.querySelector('main#sv2-main'); return m.scrollWidth - m.clientWidth; })() }));
    report.push(`${device} ${name}: pageOverflow=${metrics.overflow} mainOverflow=${metrics.mainOverflow}`);
    await page.screenshot({ path: `${out}${device}-${name}.png` });
  }
  if (device === 'desktop') {
    // Contextual Match Center: select a live row on the live page.
    await page.goto(`${base}/deportes/futbol/en-directo`, { waitUntil: 'networkidle' });
    await page.click('app-sv2-match-row .body >> nth=1');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}desktop-match-sidebar.png` });
  }
  report.push(`${device} errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  await ctx.close();
}
await browser.close();
console.log(report.join('\n'));
