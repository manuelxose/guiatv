// M04 measured page cost: TTFB/HTML (3 runs, median), JS/CSS/font/API/image bytes + request counts, LCP, CLS, INP-style interaction latency.
// Usage: node scripts/sv2-perf.mjs <label> <url> [clickSelector]   (mobile profile, Slow-4G-ish CPU 4x unthrottled network on localhost)
import { chromium } from 'playwright';
const [label, url, click] = process.argv.slice(2);
const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
const ttfb = [], size = [];
for (let i = 0; i < 5; i++) { const t = performance.now(); const r = await fetch(url); const buf = await r.arrayBuffer(); ttfb.push(performance.now() - t); size.push(buf.byteLength); }
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-ES' });
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const bytes = { js: 0, css: 0, font: 0, img: 0, api: 0, other: 0 }; const reqs = { total: 0, api: 0 };
cdp.on?.('Network.loadingFinished', () => {});
await cdp.send('Network.enable');
const types = new Map();
cdp.on('Network.responseReceived', (e) => types.set(e.requestId, { type: e.type, url: e.response.url }));
cdp.on('Network.loadingFinished', (e) => { const t = types.get(e.requestId); if (!t) return; reqs.total++; const k = /\/v2\/|\/api\//.test(t.url) ? 'api' : t.type === 'Script' ? 'js' : t.type === 'Stylesheet' ? 'css' : t.type === 'Font' ? 'font' : t.type === 'Image' ? 'img' : 'other'; bytes[k] += e.encodedDataLength; if (k === 'api') reqs.api++; });
await p.addInitScript(() => {
  window.__m = { cls: 0, lcp: 0, inp: 0 };
  new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__m.cls += e.value; })).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => { window.__m.lcp = e.startTime; })).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.interactionId) window.__m.inp = Math.max(window.__m.inp, e.duration); })).observe({ type: 'event', durationThreshold: 16, buffered: true });
});
await p.goto(url, { waitUntil: 'load' }); await p.waitForTimeout(3000);
if (click) { const el = p.locator(click).first(); if (await el.count()) { await el.tap(); await p.waitForTimeout(800); } }
const m = await p.evaluate(() => window.__m);
console.log(JSON.stringify({ label, url, ttfbMsMedian: Math.round(med(ttfb)), htmlKB: +(med(size) / 1024).toFixed(1), jsKB: +(bytes.js / 1024).toFixed(0), cssKB: +(bytes.css / 1024).toFixed(0), fontKB: +(bytes.font / 1024).toFixed(0), imgKB: +(bytes.img / 1024).toFixed(0), requests: reqs.total, apiCalls: reqs.api, lcpMs: Math.round(m.lcp), cls: +m.cls.toFixed(3), interactionMs: Math.round(m.inp) }));
await b.close();
