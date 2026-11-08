// M04 visual / a11y / vitals sweep of Sports v2 against a running SSR server (real read-only API).
// Usage: node scripts/sv2-m04-qa.mjs [baseUrl] [outDir]
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4211';
const out = process.argv[3] ?? '../../docs/sports-v2/evidence/m04';
mkdirSync(out, { recursive: true });
const SIZES = [['mobile', 390, 844], ['tablet', 768, 1024], ['desktop', 1440, 900], ['wide', 1920, 1080]];
const report = { base, at: new Date().toISOString(), pages: [] };

const browser = await chromium.launch();
const probe = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const href = async (path, re) => {
  await probe.goto(base + path, { waitUntil: 'load' }); await probe.waitForTimeout(1500);
  return probe.$$eval('a[href]', (as, src) => as.map((a) => a.getAttribute('href')).find((h) => new RegExp(src).test(h)), re.source);
};
const root = '/deportes/futbol';
const routes = [
  ['home', root], ['live', `${root}/en-directo`], ['fixtures', `${root}/partidos`], ['results', `${root}/resultados`],
  ['competitions', `${root}/competiciones`], ['news', `${root}/noticias`], ['search', `${root}/buscar?q=real`], ['following', `${root}/siguiendo`],
  ['competition', await href(`${root}/competiciones`, /\/competiciones\/[a-z0-9-]+$/)],
  ['standings', await href(`${root}/clasificaciones`, /clasificaciones\/[a-z0-9-]+$/).then((h) => h ?? `${root}/clasificaciones`)],
  ['team', await href(`${root}/partidos`, /\/equipos\/[a-z0-9-]+$/)],
  ['match', await href(`${root}/partidos`, /\/partido\/[a-z0-9-]+$/)],
  ['not-found-competition', `${root}/competiciones/no-existe-xyz`],
];
await probe.context().close();

for (const [size, width, height] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'es-ES', timezoneId: 'Europe/Madrid', hasTouch: size === 'mobile', isMobile: size === 'mobile' });
  for (const [name, path] of routes.filter(([, p]) => p)) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => {
      window.__v = { cls: 0, lcp: 0 };
      new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__v.cls += e.value; })).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((l) => l.getEntries().forEach((e) => { window.__v.lcp = e.startTime; })).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    const res = await page.goto(base + path, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const small = [...document.querySelectorAll('a[href],button,input,select,[role=button],[role=tab]')]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24) && getComputedStyle(e).visibility !== 'hidden'; })
        .slice(0, 5).map((e) => `${e.tagName.toLowerCase()}:${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30)}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
      return { overflowX: de.scrollWidth - de.clientWidth, h1: document.querySelectorAll('h1').length, main: document.querySelectorAll('main').length, smallTargets: small, cls: window.__v.cls, lcp: window.__v.lcp, imgNoAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).length, text: document.body.innerText.length };
    });
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    await page.screenshot({ path: `${out}/${name}-${size}.png`, fullPage: false });
    report.pages.push({ size, name, path, status: res.status(), ...m, axe: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') })), errors });
    console.log(size, name, res.status(), `overflow=${m.overflowX}`, `cls=${m.cls.toFixed(3)}`, `lcp=${Math.round(m.lcp)}`, `axe=${axe.violations.length}`, errors.length ? `ERR=${errors[0].slice(0, 80)}` : '');
    await page.close();
  }
  await ctx.close();
}
writeFileSync(`${out}/qa.json`, JSON.stringify(report, null, 1));
await browser.close();
