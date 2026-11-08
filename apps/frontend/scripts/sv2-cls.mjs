// Debug: which elements shift. Usage: node scripts/sv2-cls.mjs <url> [width]
import { chromium } from 'playwright';
const [url, w = '1440'] = process.argv.slice(2);
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: Number(w), height: 900 } })).newPage();
await p.addInitScript(() => {
  window.__s = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__s.push({ t: Math.round(e.startTime), v: +e.value.toFixed(3), recent: e.hadRecentInput, src: e.sources.map((s) => `${s.node?.nodeName}.${(s.node?.className || '').toString().slice(0, 40)}#${s.node?.id || ''} ${JSON.stringify(s.previousRect)}->${JSON.stringify(s.currentRect)}`) }))).observe({ type: 'layout-shift', buffered: true });
});
await p.goto(url, { waitUntil: 'load' });
await p.waitForTimeout(3000);
console.log(JSON.stringify(await p.evaluate(() => window.__s), null, 1).slice(0, 3500));
await b.close();
