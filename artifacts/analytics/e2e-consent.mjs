// Real-browser consent / GA4 / dedup / device checks against a production SSR build behind the stub API.
//   STUB_GA4=1 node artifacts/analytics/stub-backend.mjs &   (GA4 enabled by the server config)
//   node artifacts/analytics/e2e-consent.mjs http://127.0.0.1:3002 [out.json]
// The page is served as guiaprogramaciontv.com (host-resolver mapping) so the collector does not skip localhost.
// Google hosts are unreachable from the benchmark host: requests to them are observed (attempted), not completed.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const target = new URL(process.argv[2] || 'http://127.0.0.1:3002');
const out = process.argv[3];
const stub = process.env.STUB_URL || 'http://127.0.0.1:4000';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const telemetry = async () => (await fetch(`${stub}/__telemetry`)).json();
const resetTelemetry = () => fetch(`${stub}/__telemetry`, { method: 'DELETE' });
const collectBodies = (t) => t.filter((x) => x.path.endsWith('/collect')).map((x) => x.body).filter(Boolean);
const pageViews = (t) => collectBodies(t).flatMap((b) => b.events || []).filter((e) => e.type === 'page_view');

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--headless=new', `--host-resolver-rules=MAP guiaprogramaciontv.com:80 127.0.0.1:${target.port}`] });
const context = await browser.newContext({ userAgent: ANDROID_UA, viewport: { width: 406, height: 724 }, screen: { width: 407, height: 904 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, locale: 'es-ES' });
const page = await context.newPage();
const requests = [];
page.on('request', (r) => requests.push({ url: r.url(), at: Date.now() }));
const google = () => requests.filter((r) => /googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick/.test(r.url));
await resetTelemetry();

// 1. First visit, no choice yet.
await page.goto('http://guiaprogramaciontv.com/cookies', { waitUntil: 'load' });
await page.waitForTimeout(6500);
const before = await telemetry();
check('no first-party telemetry before consent', before.length === 0, before.map((t) => t.path));
check('no Google request before consent', google().length === 0, google().map((r) => r.url));
const storageBefore = await page.evaluate(() => ({ anon: localStorage.getItem('gtv_anon_id'), session: sessionStorage.getItem('gtv_session'), cookies: document.cookie }));
check('no analytics identifier before consent', !storageBefore.anon && !storageBefore.session && !/_ga/.test(storageBefore.cookies), storageBefore);
const banner = page.locator('app-consent-banner section');
check('banner visible after hydration', await banner.isVisible());
const ssrHtml = await (await fetch(`${target.origin}/cookies`, { headers: { host: 'guiaprogramaciontv.com' } })).text();
check('SSR HTML: banner present for every visitor (paints with FCP), no GA4 tag', ssrHtml.includes('consent__btn') && !ssrHtml.includes('googletagmanager'));
const buttons = await page.locator('app-consent-banner button').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { text: e.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) }; }));
check('reject is as prominent as accept', buttons.length >= 2 && Math.abs(buttons[0].w - buttons[1].w) <= 2 && buttons[0].h === buttons[1].h, buttons);

// 1b. A visitor who already chose: the SSR banner is hidden before first paint (no flash) and stays hidden.
{
  const ctxKnown = await browser.newContext({ userAgent: ANDROID_UA, viewport: { width: 406, height: 724 }, isMobile: true, hasTouch: true });
  await ctxKnown.addCookies([{ name: 'cookie_consent', value: `v1.a0.${Date.now()}`, domain: 'guiaprogramaciontv.com', path: '/' }]);
  const known = await ctxKnown.newPage();
  // Sample the banner's style the moment the parser inserts it (before any app script runs, i.e. what first paint
  // would show); Angular's module scripts run before DOMContentLoaded, by which time hydration may have removed it.
  await known.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const el = document.querySelector('app-consent-banner section');
      if (el && window.__bannerAtDcl === undefined) { window.__bannerAtDcl = getComputedStyle(el).display; observer.disconnect(); }
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await known.goto('http://guiaprogramaciontv.com/cookies', { waitUntil: 'load' });
  await known.waitForTimeout(1500);
  const atDcl = await known.evaluate(() => window.__bannerAtDcl);
  const afterHydration = await known.locator('app-consent-banner section').count();
  check('known choice: banner hidden at first paint and removed after hydration', atDcl === 'none' && afterHydration === 0, { atDcl, afterHydration });
  await ctxKnown.close();
}

// 2. Accept.
const acceptAt = Date.now();
await page.click('[data-consent="grant"]');
await page.waitForTimeout(7000);
const afterGrant = await telemetry();
const firstBatch = collectBodies(afterGrant)[0];
check('session start delivered first after consent', Boolean(firstBatch?.session), firstBatch && Object.keys(firstBatch));
check('landing page view delivered after consent', pageViews(afterGrant).length === 1 && pageViews(afterGrant)[0].path === '/cookies', pageViews(afterGrant).map((e) => e.path));
check('mobile fixture classified mobile/portrait', firstBatch?.session?.device?.type === 'mobile' && firstBatch?.session?.device?.orientation === 'portrait', firstBatch?.session?.device);
check('payload has no query string, IP or user agent', !JSON.stringify(afterGrant).includes('?') && !/Mozilla|userAgent|"ip"/.test(JSON.stringify(collectBodies(afterGrant))));
const gtm = google();
check('GA4 script requested only after consent', gtm.length >= 1 && gtm.every((r) => r.at >= acceptAt), gtm.map((r) => r.url.split('?')[0]));
const dataLayer = await page.evaluate(() => (window.dataLayer || []).map((a) => Array.from(a)).map((a) => [a[0], a[1], a[2] && typeof a[2] === 'object' ? a[2] : undefined]));
const consentDefault = dataLayer.findIndex((a) => a[0] === 'consent' && a[1] === 'default');
const consentUpdate = dataLayer.findIndex((a) => a[0] === 'consent' && a[1] === 'update');
const config = dataLayer.findIndex((a) => a[0] === 'config');
check('Consent Mode v2: default(denied) → update(analytics granted) → config', consentDefault >= 0 && consentDefault < consentUpdate && consentUpdate < config
  && dataLayer[consentDefault][2].ad_user_data === 'denied' && dataLayer[consentDefault][2].ad_personalization === 'denied' && dataLayer[consentUpdate][2].analytics_storage === 'granted' && dataLayer[config][2].send_page_view === false, dataLayer.slice(0, 5));
const ga4PageViews = dataLayer.filter((a) => a[0] === 'event' && a[1] === 'page_view');
check('one GA4 page_view for the landing page', ga4PageViews.length === 1, ga4PageViews);

// 3. SPA navigation (+ a repeat of the same route) — no duplicates.
await resetTelemetry();
await page.evaluate(() => { const a = document.querySelector('a[href="/privacidad"]'); a && a.click(); });
await page.waitForTimeout(500);
await page.evaluate(() => { const a = document.querySelector('a[href="/privacidad"]'); a && a.click(); });
await page.waitForTimeout(6500);
const nav = await telemetry();
const navViews = pageViews(nav).map((e) => e.path);
check('one page_view per SPA navigation (repeat click deduplicated)', navViews.length === 1 && navViews[0] === '/privacidad', navViews);
const ga4After = await page.evaluate(() => (window.dataLayer || []).filter((a) => a[0] === 'event' && a[1] === 'page_view').length);
check('GA4 page_view count matches first-party (2 pages)', ga4After === 2, ga4After);

// 4. Revoke on a phone (the footer is not rendered at this width): the button on /cookies.
await page.evaluate(() => { const a = document.querySelector('a[href="/cookies"]'); a && a.click(); });
await page.waitForTimeout(1500);
await page.locator('main button:has-text("Configurar cookies")').first().click();
await page.waitForTimeout(300);
await page.click('[data-consent="deny"]');
await page.waitForTimeout(300);
const storageRevoked = await page.evaluate(() => ({ anon: localStorage.getItem('gtv_anon_id'), session: sessionStorage.getItem('gtv_session'), consent: document.cookie.match(/cookie_consent=([^;]+)/)?.[1], gaDisabled: window['ga-disable-G-P6Z3BY2DVW'] }));
check('revocation deletes identifiers and disables GA4', !storageRevoked.anon && !storageRevoked.session && /^v1\.a0\./.test(storageRevoked.consent || '') && storageRevoked.gaDisabled === true, storageRevoked);
await resetTelemetry();
await page.evaluate(() => { const a = document.querySelector('a[href="/privacidad"]'); a && a.click(); });
await page.waitForTimeout(6500);
const afterRevoke = (await telemetry()).filter((t) => t.path.endsWith('/collect'));
check('no collection after revocation', afterRevoke.length === 0, afterRevoke.length);

// 4b. Mobile "Más" sheet on a page with the bottom tab bar also reopens the choice.
{
  const ctxMore = await browser.newContext({ userAgent: ANDROID_UA, viewport: { width: 406, height: 724 }, isMobile: true, hasTouch: true });
  await ctxMore.addCookies([{ name: 'cookie_consent', value: `v1.a1.${Date.now()}`, domain: 'guiaprogramaciontv.com', path: '/' }]);
  const more = await ctxMore.newPage();
  await more.goto('http://guiaprogramaciontv.com/', { waitUntil: 'load' });
  await more.waitForTimeout(1500);
  const trigger = more.locator('button[aria-controls="mobile-more-sheet"]');
  let reopened = false;
  if (await trigger.count()) {
    await trigger.first().click({ timeout: 5000 });
    await more.waitForTimeout(400);
    await more.locator('#mobile-more-sheet button:has-text("Configurar cookies")').click();
    await more.waitForTimeout(300);
    reopened = await more.locator('[data-consent="deny"]').isVisible();
  }
  check('mobile "Más" sheet reopens the cookie choice', reopened);
  await ctxMore.close();
}

// 5. Precondition of the device bug: the SSR HTML that nginx caches per URL embeds the UA-estimated device of
// whoever rendered it, so an Android visitor can receive a desktop TransferState (the unit spec
// device-detector.service.spec.ts proves the browser now replaces it with the real viewport after the first render).
const desktopHtml = await (await fetch(`${target.origin}/`, { headers: { host: 'guiaprogramaciontv.com', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0 Safari/537.36' } })).text();
const transfer = desktopHtml.match(/"deviceInfo":\{[^}]*\}/)?.[0];
// Informational only: with the stub API (all content 503) the components that inject DeviceDetectorService may not
// render, so the TransferState key can be absent; the behaviour itself is covered by the unit spec.
console.log(`INFO  SSR TransferState deviceInfo on / (desktop UA): ${transfer || 'absent in stub mode'}`);

await browser.close();
const failed = checks.filter((c) => !c.ok).length;
if (out) writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), target: target.origin, checks }, null, 2));
console.log(`${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
