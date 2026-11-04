// Analytics browser benchmark: SSR TTFB + browser vitals for one or more frontend builds behind the same stub API.
//
//   node artifacts/analytics/browser-bench.mjs --arm base=http://127.0.0.1:3001 --arm cand=http://127.0.0.1:3002 \
//        --runs 7 --out artifacts/analytics/bench-xxx.json [--consent granted|denied|unset]
//
// Each run is a fresh browser context (cold HTTP cache) followed by a second navigation in the same context (warm).
// The browser maps guiaprogramaciontv.com to the arm's port so the page sees a production hostname (the collectors
// skip localhost). Arms are interleaved per run (ABAB) to spread machine drift. Mobile = Android Chrome UA,
// viewport 406x724, screen 407x904, 4x CPU throttling, 40 ms RTT; desktop = 1366x768, no throttling.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const arms = [];
let runs = 7;
let out = null;
let consent = 'unset';
let pages = ['/', '/cookies'];
const stub = process.env.STUB_URL || 'http://127.0.0.1:4000';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--arm') { const [name, url] = args[++i].split('='); arms.push({ name, url }); }
  else if (args[i] === '--runs') runs = Number(args[++i]);
  else if (args[i] === '--out') out = args[++i];
  else if (args[i] === '--consent') consent = args[++i];
  else if (args[i] === '--pages') pages = args[++i].split(',');
}

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const profiles = {
  mobile: { userAgent: ANDROID_UA, viewport: { width: 406, height: 724 }, screen: { width: 407, height: 904 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, cpu: 4, latency: 40 },
  desktop: { viewport: { width: 1366, height: 768 }, screen: { width: 1366, height: 768 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, cpu: 1, latency: 0 },
};

const observerScript = () => {
  const perf = { lcp: 0, cls: 0, longTasks: [], events: [] };
  window.__perf = perf;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) perf.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) perf.cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) perf.longTasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) perf.events.push(e.duration); }).observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch {}
};

async function telemetryReset() { await fetch(`${stub}/__telemetry`, { method: 'DELETE' }); }
async function telemetryRead() { return (await fetch(`${stub}/__telemetry`)).json(); }

async function measure(page, url) {
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  const loadWall = Date.now() - t0;
  await page.waitForTimeout(3000);
  // One synthetic interaction (tap on page background) for INP-like event timing.
  await page.mouse.click(5, 300);
  await page.waitForTimeout(500);
  const telemetryBeforeConsent = (await telemetryRead()).length;
  return page.evaluate(({ loadWall, telemetryBeforeConsent }) => {
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0;
    const res = performance.getEntriesByType('resource');
    const js = res.filter((r) => /\.m?js(\?|$)/.test(r.name));
    const p = window.__perf;
    const tbt = p.longTasks.filter(([s]) => s >= fcp).reduce((acc, [, d]) => acc + Math.max(0, d - 50), 0);
    return {
      ttfb: nav.responseStart, fcp, lcp: p.lcp, cls: Number(p.cls.toFixed(4)), tbt: Math.round(tbt),
      longTasks: p.longTasks.length, maxLongTask: Math.round(Math.max(0, ...p.longTasks.map(([, d]) => d))),
      inp: Math.max(0, ...p.events), domContentLoaded: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, loadWall,
      requests: res.length + 1, jsRequests: js.length,
      jsTransfer: js.reduce((a, r) => a + (r.transferSize || 0), 0), jsDecoded: js.reduce((a, r) => a + (r.decodedBodySize || 0), 0),
      thirdParty: res.filter((r) => !r.name.startsWith(location.origin)).map((r) => new URL(r.name).host),
      telemetryInPage: res.filter((r) => /\/v2\/telemetry\//.test(r.name)).length, telemetryBeforeConsent,
      heap: performance.memory?.usedJSHeapSize || 0,
    };
  }, { loadWall, telemetryBeforeConsent });
}

async function runOnce(browser, profileName, arm, path) {
  const prof = profiles[profileName];
  const context = await browser.newContext({ userAgent: prof.userAgent, viewport: prof.viewport, screen: prof.screen, deviceScaleFactor: prof.deviceScaleFactor, isMobile: prof.isMobile, hasTouch: prof.hasTouch, locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  if (consent !== 'unset') {
    await context.addCookies([{ name: 'cookie_consent', value: `v1.${consent === 'granted' ? 'a1' : 'a0'}.${Date.now()}`, domain: 'guiaprogramaciontv.com', path: '/' }]);
  }
  await context.addInitScript(observerScript);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (prof.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpu });
  if (prof.latency) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: prof.latency, downloadThroughput: 1.25e6, uploadThroughput: 0.6e6 });
  await telemetryReset();
  const url = `http://guiaprogramaciontv.com${path}`;
  const cold = await measure(page, url);
  const warm = await measure(page, url);
  // pagehide: leave the page so final beacons are sent, then count everything the stub received.
  await page.goto('about:blank');
  await new Promise((r) => setTimeout(r, 400));
  const telemetry = await telemetryRead();
  await context.close();
  return { arm, profile: profileName, path, cold, warm, telemetryRequests: telemetry.length, telemetryBytes: telemetry.reduce((a, t) => a + t.bytes, 0), telemetryPaths: [...new Set(telemetry.map((t) => t.path))] };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };

const browsers = {};
for (const arm of arms) {
  const port = new URL(arm.url).port;
  browsers[arm.name] = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--headless=new', `--host-resolver-rules=MAP guiaprogramaciontv.com:80 127.0.0.1:${port}`] });
}
const results = [];
for (const profileName of ['mobile', 'desktop']) {
  for (const path of pages) {
    for (let r = 0; r < runs; r++) {
      const order = r % 2 ? [...arms].reverse() : arms;
      for (const arm of order) results.push(await runOnce(browsers[arm.name], profileName, arm.name, path));
    }
  }
}
for (const b of Object.values(browsers)) await b.close();

const keys = ['ttfb', 'fcp', 'lcp', 'cls', 'tbt', 'longTasks', 'maxLongTask', 'inp', 'load', 'requests', 'jsRequests', 'jsTransfer', 'jsDecoded', 'heap'];
const summary = {};
for (const r of results) {
  for (const phase of ['cold', 'warm']) {
    const k = `${r.profile} ${r.path} ${phase} ${r.arm}`;
    summary[k] ||= { n: 0, values: {} };
    summary[k].n++;
    for (const key of keys) (summary[k].values[key] ||= []).push(r[phase][key]);
    (summary[k].values.telemetryRequests ||= []).push(r.telemetryRequests);
    (summary[k].values.telemetryBytes ||= []).push(r.telemetryBytes);
    (summary[k].values.thirdPartyRequests ||= []).push(r[phase].thirdParty.length);
  }
}
const medians = Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, Object.fromEntries(Object.entries(v.values).map(([m, xs]) => [m, median(xs)]))]));
const report = { generatedAt: new Date().toISOString(), runs, consent, arms, profiles, medians, results };
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
for (const [k, v] of Object.entries(medians)) console.log(k.padEnd(34), `ttfb ${v.ttfb.toFixed(0)} fcp ${v.fcp.toFixed(0)} lcp ${v.lcp.toFixed(0)} cls ${v.cls} tbt ${v.tbt} lt ${v.longTasks} inp ${v.inp} js ${(v.jsTransfer / 1024).toFixed(1)}k req ${v.requests} tel ${v.telemetryRequests} 3p ${v.thirdPartyRequests}`);
