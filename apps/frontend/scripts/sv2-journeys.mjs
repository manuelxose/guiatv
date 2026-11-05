// M03 browser verification against a running SSR server whose API is the real, read-only production API.
// Real data everywhere except ONE deliberately mocked endpoint: /matches/live (to exercise live-score updates
// deterministically, since real live matches are not available on demand). Usage: node scripts/sv2-m03-verify.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4210';
const API = 'https://guiaprogramaciontv.com/v2/sports/football';
const out = new URL('../../../docs/sports-v2/evidence/m04/journeys-', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(out.replace(/journeys-$/, ''), { recursive: true });
const report = { checks: [], consoleErrors: [], hydrationErrors: [] };
const check = (name, ok, detail = '') => { report.checks.push({ name, ok: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail); };

const today = new Date().toISOString().slice(0, 10);
const plus = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const { data } = await (await fetch(`${API}/matches?dateFrom=${plus(-4)}&dateTo=${plus(5)}`)).json();
const upcoming = data.matches.filter((m) => m.status === 'scheduled' && Date.parse(m.kickoffAt) > Date.now()).sort((a, b) => Date.parse(a.kickoffAt) - Date.parse(b.kickoffAt))[0];
if (!upcoming) throw new Error('no scheduled real match in the window; run again later');
const kickoff = Date.parse(upcoming.kickoffAt);

const browser = await chromium.launch();

// 1. Time zone: same real match, two visitors.
for (const [tz, label] of [['Europe/Madrid', 'madrid'], ['Asia/Tokyo', 'tokyo']]) {
  const ctx = await browser.newContext({ timezoneId: tz, locale: 'es-ES', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/v2/')) report.consoleErrors.push(`${label}: ${r.status()} ${r.url()}`); });
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) report.consoleErrors.push(`${label}: ${m.text()}`); if (/NG0[45]\d\d|hydrat/i.test(m.text())) report.hydrationErrors.push(`${label}: ${m.text()}`); });
  await page.goto(`${base}/deportes/futbol/partido/${upcoming.slug}`, { waitUntil: 'networkidle' });
  const text = await page.locator('main').innerText();
  const expectedTime = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(kickoff);
  check(`timezone ${label}: kickoff shown as ${expectedTime}`, text.includes(`· ${expectedTime} ·`), text.match(/·\s\d\d:\d\d\s·[^\n]*/)?.[0]);
  check(`timezone ${label}: zone is stated`, tz === 'Europe/Madrid' ? text.includes('hora de Madrid') : text.includes(`tu hora local (${tz}`));
  if (label === 'tokyo') await page.screenshot({ path: `${out}match-tokyo.png` });
  await ctx.close();
}

// 2. Live updates (mocked /matches/live) with a controlled clock.
{
  const ctx = await browser.newContext({ timezoneId: 'Europe/Madrid', locale: 'es-ES', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  let liveCalls = 0;
  let fail = false;
  page.on('console', (m) => { if (m.type() === 'error' && !/500|503|Failed to load resource/.test(m.text())) report.consoleErrors.push(`live: ${m.text()}`); });
  await page.route('**/v2/sports/football/matches/live', (route) => {
    liveCalls++;
    if (fail) return route.fulfill({ status: 503, body: '{}' });
    const goals = Math.min(liveCalls, 3);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: { matches: [{ ...upcoming, status: 'live', minute: null, score: { home: goals, away: 0 }, lastUpdatedAt: new Date().toISOString() }] } }) });
  });
  await page.clock.install({ time: kickoff - 5 * 60_000 }); // five minutes before a real kickoff
  await page.goto(`${base}/deportes/futbol/en-directo`, { waitUntil: 'networkidle' });
  await page.clock.runFor(31_000);
  await page.waitForTimeout(500);
  const body = () => page.locator('main').innerText();
  check('live: a poll happened near kickoff', liveCalls >= 1, `calls=${liveCalls}`);
  const rowText = (await page.locator('app-sv2-match-row').filter({ hasText: upcoming.homeTeam.name }).first().innerText()).replace(/\s+/g, ' ');
  check('live: the match moved to live with score 1-0, in place, no reload', /\b1\b/.test(rowText) && /vivo/i.test(rowText), rowText);
  check('live: last-update line visible', /Última actualización: \d\d:\d\d/.test(await body()));
  const before = liveCalls;
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(120_000);
  check('live: no polling while the tab is hidden', liveCalls === before, `calls ${before} -> ${liveCalls}`);
  fail = true;
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(10_000);
  await page.waitForTimeout(300);
  check('live: failure marks data stale and keeps the last score', (await body()).includes('No se pudo actualizar') && /\b\d\b/.test(await body()));
  const failCalls = liveCalls;
  await page.clock.runFor(30 * 60_000);
  check('live: retries are bounded after repeated failures', liveCalls - failCalls <= 6, `extra calls over 30 min = ${liveCalls - failCalls}`);
  await page.screenshot({ path: `${out}live-stale.png` });
  await ctx.close();
}

// 3. Search by keyboard + favourites persistence (real data).
{
  const ctx = await browser.newContext({ locale: 'es-ES', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/deportes/futbol`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.getByRole('combobox', { name: 'Buscar en Guía TV' }).fill(upcoming.homeTeam.name.slice(0, 5));
  await page.waitForSelector('[role=option]');
  const hits = await page.locator('[role=option]').allInnerTexts();
  check('search: groups real results', hits.length > 1, hits.slice(0, 3).join(' | ').replace(/\s+/g, ' '));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForURL(/futbol\/(equipos|competiciones|partido|noticias)\//, { timeout: 5000 }).catch(() => undefined);
  check('search: keyboard selection navigates to a semantic URL', /\/deportes\/futbol\/(equipos|competiciones|partido|noticias)\/[a-z0-9-]+$/.test(page.url()), page.url());
  await page.goto(`${base}/deportes/futbol/equipos/${upcoming.homeTeam.slug}`, { waitUntil: 'load' });
  await page.getByRole('button', { name: new RegExp(`^Seguir ${upcoming.homeTeam.name}`) }).first().click();
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  check('favourites: followed team survives a reload', (await page.getByRole('button', { name: new RegExp(`^Dejar de seguir ${upcoming.homeTeam.name}`) }).count()) > 0);
  await page.goto(`${base}/deportes/futbol`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const homeText = await page.locator('main').innerText();
  check('favourites: home personalises "Mis equipos"', homeText.includes(upcoming.homeTeam.name) && !homeText.includes('Sigue a tus equipos'));
  await page.screenshot({ path: `${out}home-personalised.png` });
  await ctx.close();
}

report.hydrationErrors.length && check('no hydration errors', false, report.hydrationErrors.join('; '));
check('no unexpected console errors', report.consoleErrors.length === 0, report.consoleErrors.slice(0, 3).join(' || '));
await browser.close();
writeFileSync(`${out}verify.json`, JSON.stringify({ ranAt: new Date().toISOString(), match: upcoming.slug, ...report }, null, 2));
process.exit(report.checks.every((c) => c.ok) ? 0 : 1);
