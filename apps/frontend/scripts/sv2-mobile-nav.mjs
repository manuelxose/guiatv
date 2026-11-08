// M04 journey F (mobile navigation) + E (broadcaster info) + B (competition -> standings -> team). Usage: node scripts/sv2-mobile-nav.mjs [base]
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:4211';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'es-ES' });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
const ok = (n, c, d = '') => console.log(c ? 'PASS' : 'FAIL', n, d);
await p.goto(`${base}/deportes/futbol`, { waitUntil: 'load' }); await p.waitForTimeout(1500);
for (const [label, re] of [['En directo', /en-directo$/], ['Partidos', /partidos$/], ['Competiciones', /competiciones$/], ['Noticias', /noticias$/], ['Inicio', /futbol$/]]) {
  await p.getByRole('navigation').getByRole('link', { name: label, exact: true }).last().tap(); await p.waitForTimeout(700);
  ok(`mobile nav: ${label}`, re.test(p.url()) && (await p.locator('h1').count()) === 1, p.url().replace(base, ''));
}
// B: competition -> standings -> team
await p.goto(`${base}/deportes/futbol/competiciones`, { waitUntil: 'load' }); await p.waitForTimeout(1200);
await p.locator('a[href*="/competiciones/"]').first().tap(); await p.waitForTimeout(1200);
ok('B: competition opens', /\/competiciones\/[a-z0-9-]+$/.test(p.url()), p.url().replace(base, ''));
const tab = p.getByRole('tab', { name: /Clasificaci/ }); if (await tab.count()) { await tab.first().tap(); await p.waitForTimeout(900); }
const team = p.locator('a[href*="/equipos/"]').first();
ok('B: standings/teams list links to a team', (await team.count()) > 0);
if (await team.count()) { await team.tap(); await p.waitForTimeout(1500); ok('B: team page', /\/equipos\//.test(p.url()) && (await p.locator('h1').count()) === 1, p.url().replace(base, '')); }
// E: where to watch
const m = (await (await fetch(`${base}/deportes/futbol/partidos`)).text()).match(/href="(\/deportes\/futbol\/partido\/[a-z0-9-]+)"/);
await p.goto(`${base}${m[1]}?tab=donde-verlo`, { waitUntil: 'load' }); await p.waitForTimeout(1500);
const t = await p.locator('main').innerText();
ok('E: where-to-watch states a channel with evidence or says unconfirmed', /Emisi[óo]n no confirmada|Fuente|confirmad/i.test(t), t.replace(/\s+/g, ' ').slice(0, 160));
ok('no page errors', errs.length === 0, errs[0] ?? '');
await b.close();
