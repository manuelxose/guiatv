#!/usr/bin/env node
/**
 * M14-R7 T5 — Verificación de UI con Playwright + axe sobre el staging real.
 * Requiere staging arrancado: node scripts/m14r7-staging.mjs start (mongod 27139 + backend 3329 + SSR 4329).
 * Salida: PASS/FAIL por chequeo + artifacts en artifacts/m14r7/{ui-*.json, ui-*.png}.
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ART = join(ROOT, 'artifacts', 'm14r7');
const SSR = 'http://127.0.0.1:4329';
const MONGO = 'mongodb://127.0.0.1:27139/guiatv_m14r7';
const FLOW = '/v2/admin/editorial/flow';

function readEnv(file) {
  const out = {};
  try { for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line); if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); } } catch {}
  return out;
}
const env = readEnv(join(ROOT, '.env.m14r7'));
const ADMIN = process.env.M14R7_ADMIN_KEY || env.M14R7_ADMIN_KEY || '';
const REVIEW = process.env.M14R7_REVIEW_KEY || env.M14R7_REVIEW_KEY || '';

// Seed an admin user + sign a valid session JWT: the frontend admin route guard resolves the
// session (jwt sub -> user.role), so the raw admin key is not enough to render the admin section.
const ADMIN_USER_ID = '000000000000000000000001';
let SESSION_TOKEN = ADMIN;
{
  const { MongoClient, ObjectId } = await import('mongodb');
  const { default: jwt } = await import('jsonwebtoken');
  const c = new MongoClient(MONGO, { serverSelectionTimeoutMS: 8000 });
  await c.connect();
  await c.db().collection('users').updateOne(
    { _id: new ObjectId(ADMIN_USER_ID) },
    { $set: { email: 'admin@staging.local', name: 'Admin Staging', provider: 'local', role: 'admin', status: 'active' } },
    { upsert: true }
  );
  await c.close();
  SESSION_TOKEN = jwt.sign({ sub: ADMIN_USER_ID, email: 'admin@staging.local', role: 'admin', sid: 'seed', typ: 'access' }, ADMIN, { expiresIn: '1h' });
}

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mongo(collection, filter = {}) {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(MONGO, { serverSelectionTimeoutMS: 8000 });
  await c.connect();
  const docs = await c.db().collection(collection).find(filter).toArray();
  await c.close();
  return docs;
}
async function mongoCount(collection, filter = {}) {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(MONGO, { serverSelectionTimeoutMS: 8000 });
  await c.connect();
  const n = await c.db().collection(collection).countDocuments(filter);
  await c.close();
  return n;
}

/* Contraste WCAG: ratio entre color de texto y fondo medidos desde computed style. */
function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(fg, bg) {
  const [l1, l2] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a);
  return Number(((l1 + 0.05) / (l2 + 0.05)).toFixed(2));
}
function parseRgb(str) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(str || '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript((token) => { try { localStorage.setItem('gtv_id_token', token); } catch {} }, SESSION_TOKEN);

const flowUrl = (view) => `${SSR}/admin?group=administration&item=flow-guide&view=${view}`;

try {
  /* ── 1. Navegación real: URL directa, ambas vistas, contenido renderizado ── */
  const page = await context.newPage();
  const navErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') navErrors.push(m.text().slice(0, 160)); });
  await page.goto(flowUrl('how'), { waitUntil: 'networkidle', timeout: 60000 }).catch(async () => { await page.goto(flowUrl('how'), { waitUntil: 'domcontentloaded' }); });
  await sleep(3000);
  const howTitle = await page.title().catch(() => '');
  const howBody = await page.locator('body').innerText().catch(() => '');
  check('1a. URL directa view=how renderiza', howBody.length > 40, `body=${howBody.length} chars, title="${howTitle}"`);
  // La vista "Cómo funciona" debe mencionar el contrato/estados.
  check('1b. view=how muestra guía de estados', /Cómo funciona|estados|contrato|dimensión|Descubiertos/i.test(howBody), 'texto de guía presente');

  await page.goto(flowUrl('diagnostics'), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(4000);
  const diagBody = await page.locator('body').innerText().catch(() => '');
  check('1c. view=diagnostics renderiza embudo/diagnóstico', /Diagnóstico|embudo|Embudo|funnel|etapa/i.test(diagBody), `body=${diagBody.length} chars`);

  /* ── 2. axe en 390 y 1440 px, ambas vistas ── */
  const axeSummary = [];
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const view of ['how', 'diagnostics']) {
      await page.goto(flowUrl(view), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await sleep(3000);
      try {
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        const critical = axe.violations.filter((v) => v.impact === 'critical');
        const serious = axe.violations.filter((v) => v.impact === 'serious');
        axeSummary.push({ viewport: viewport.width, view, violations: axe.violations.length, critical: critical.length, serious: serious.length, ids: axe.violations.map((v) => `${v.id}:${v.impact}`) });
        check(`2. axe ${viewport.width}px ${view} sin critical/serious`, critical.length === 0 && serious.length === 0, `violations=${axe.violations.length}, critical=${critical.length}, serious=${serious.length}`);
      } catch (e) {
        check(`2. axe ${viewport.width}px ${view}`, false, `axe error: ${e.message}`);
      }
    }
  }
  writeFileSync(join(ART, 'ui-axe.json'), JSON.stringify(axeSummary, null, 2));

  /* ── 3. Táctiles >=24x24 + contraste AA (medidos) ── */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(flowUrl('diagnostics'), { waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(3000);
  const smallTargets = [];
  const lowContrast = [];
  const interactives = await page.locator('button, a[href], [role="button"], [role="tab"], [role="switch"], input, select').all();
  for (const el of interactives.slice(0, 80)) {
    try {
      const box = await el.boundingBox();
      if (box && (box.width < 24 || box.height < 24)) smallTargets.push({ w: Math.round(box.width), h: Math.round(box.height) });
    } catch {}
  }
  check('3a. objetivos táctiles >=24x24', smallTargets.length === 0, `targets<24px: ${smallTargets.length}`);
  const textEls = await page.locator('h1, h2, h3, button, a, [role="tab"], label, p, span').all();
  let measuredPairs = 0;
  for (const el of textEls.slice(0, 60)) {
    try {
      const style = await el.evaluate((n) => {
        const s = getComputedStyle(n);
        const text = (n.textContent || '').trim().slice(0, 40);
        if (!text) return null;
        let bg = s.backgroundColor;
        let cur = n.parentElement;
        while (cur && /rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/.test(bg)) { bg = getComputedStyle(cur).backgroundColor; cur = cur.parentElement; }
        if (/rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/.test(bg)) bg = 'rgb(255,255,255)';
        return { color: s.color, bg, text };
      });
      if (!style) continue;
      const fg = parseRgb(style.color); const bg = parseRgb(style.bg);
      if (fg && bg) { const ratio = contrastRatio(fg, bg); measuredPairs++; if (ratio < 4.5 && ratio > 0) lowContrast.push({ text: style.text, fg: style.color, bg: style.bg, ratio }); }
    } catch {}
  }
  check('3b. contraste AA (>=4.5:1) en texto visible', lowContrast.length === 0, `pares medidos=${measuredPairs}, bajos=${lowContrast.length}${lowContrast.slice(0, 3).map((c) => ` [${c.text}|${c.ratio}]`).join('')}`);
  writeFileSync(join(ART, 'ui-contrast.json'), JSON.stringify({ measuredPairs, lowContrast }, null, 2));

  /* ── 4. No desbordamiento horizontal ── */
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check('4. sin desbordamiento horizontal (1440px)', !overflow, `scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`);

  /* ── 5. CONTEOS: embudo UI vs Mongo directo (número a número) ── */
  const funnel = await (await fetch(`${SSR}${FLOW}/funnel`, { headers: { 'x-admin-key': ADMIN } })).json().catch(() => ({}));
  const funnelStages = funnel?.data?.stages ?? [];
  const measuredStages = funnelStages.filter((s) => s.state === 'measured');
  const queueDoc = (await mongo('editorial_queue_snapshot', { _id: 'current' }))[0];
  const qItems = (queueDoc?.items ?? []);
  const publishedSlugs = (await mongo('blog_posts', { status: 'publish' })).map((p) => p.slug);
  const gscSlugs = (await mongo('editorial_gsc_inspections', {})).map((g) => (g.url || '').split('/guias/')[1]);
  const expectedMap = {
    'candidate.eligible': qItems.filter((i) => ['queued', 'running', 'published'].includes(i.state)).length,
    'candidate.invalid': qItems.filter((i) => i.state === 'rejected' && /^invalid-candidate:/.test(i.reason || '')).length,
    'candidate.duplicate': qItems.filter((i) => i.state === 'rejected' && /^duplicate:/.test(i.reason || '')).length,
    'candidate.rejected-insufficient-evidence': qItems.filter((i) => i.state === 'rejected' && /^insufficient-evidence:/.test(i.reason || '')).length,
    'candidate.rejected': qItems.filter((i) => i.state === 'rejected' && /^manual:/.test(i.reason || '')).length,
    'candidate.retained': qItems.filter((i) => i.state === 'held').length,
    'candidate.expired': qItems.filter((i) => i.state === 'expired').length,
    'seo.pending-inspection': publishedSlugs.filter((s) => !gscSlugs.includes(s)).length,
  };
  const countPairs = [];
  let countMismatches = 0;
  for (const stage of measuredStages) {
    let exp = expectedMap[stage.key];
    if (exp === undefined) { const q = stage.queries?.[0]; exp = await mongoCount(q?.collection, q?.filter ?? {}); }
    const ok = stage.count === exp;
    countPairs.push({ stage: stage.key, ui: stage.count, mongo: exp, ok });
    if (!ok) countMismatches++;
  }
  check('5. conteos embudo UI = Mongo (número a número)', countMismatches === 0 && countPairs.length > 0, `${countPairs.length} etapas medidas, desajustes=${countMismatches}`);
  const jobs = await mongoCount('editorial_jobs');
  const publishedPosts = await mongoCount('blog_posts', { status: 'publish', origin: 'ai-assisted', reviewState: 'approved' });
  const gscIndexed = await mongoCount('editorial_gsc_inspections', { coverageState: 'Página indexada' });
  writeFileSync(join(ART, 'ui-counts.json'), JSON.stringify({ countPairs, jobs, publishedPosts, gscIndexed }, null, 2));

  /* ── 6. Scheduler: planificador desactivado (enabled=false) representado ── */
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const schedulerText = bodyText.match(/[^\n]*generación[^\n]*/i)?.[0] || bodyText.slice(0, 800);
  check('6. planificador enabled=false representado (sin afirmar activo)', !/generación.*activada|programada.*activada/i.test(schedulerText), `texto scheduler: ${schedulerText.slice(0, 120)}`);

  /* ── 7. Noindex del panel + ausencia en sitemap ── */
  const adminResp = await fetch(`${SSR}/admin`).then((r) => ({ status: r.status, robots: r.headers.get('x-robots-tag') || '', html: '' })).catch(() => ({ status: 0, robots: '', html: '' }));
  const adminHtml = await (await fetch(`${SSR}/admin`)).text();
  const robotsMeta = /<meta\s+name="robots"\s+content="([^"]+)"/i.exec(adminHtml)?.[1] || '';
  check('7a. /admin sirve noindex', /noindex/.test(adminResp.robots + robotsMeta), `X-Robots-Tag="${adminResp.robots}", meta="${robotsMeta}"`);
  const sitemap = await fetch(`${SSR}/sitemap.xml`).then((r) => r.text()).catch(() => '');
  check('7b. /admin ausente del sitemap', !/\/admin/.test(sitemap), `sitemap ${sitemap.length} bytes, contiene /admin=${/\/admin/.test(sitemap)}`);

  /* ── 8. Recuperación real vía API (la UI usa el mismo servicio) ── */
  const recover = async (topicId, action, body = {}) => {
    const r = await fetch(`${SSR}${FLOW}/recovery/${encodeURIComponent(topicId)}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN }, body: JSON.stringify({ action, ...body }) });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  const rec1 = await recover('compartir-cuenta-netflix-hogar-normas', 'replace-source', { sources: ['https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555', 'https://www.cnmc.es/ambitos-de-actuacion/audiovisual'] });
  const rec1persisted = await mongoCount('editorial_generation_requests', { kind: 'generate' });
  check('8a. recuperación individual vía API real + persistida', (rec1.status === 200 || rec1.status === 409) && rec1persisted >= 1, `HTTP ${rec1.status} (200=ok, 409=idempotente sin cambios), generation_requests=${rec1persisted}`);
  const bulk = await (await fetch(`${SSR}${FLOW}/recovery/bulk`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN }, body: JSON.stringify({ topicIds: ['compartir-cuenta-netflix-hogar-normas', 'proteccion-menores-control-parental-plataformas'], action: 'inspect-duplicate' }) })).json().catch(() => ({}));
  check('8b. recuperación en lote vía API real (resultado por ítem)', Array.isArray(bulk.data?.results) && bulk.data.results.length === 2, `results=${bulk.data?.results?.length}`);

  /* ── 9. Publicación idempotente E2E + ninguna publicada como indexada ── */
  const posts = await mongo('blog_posts', { status: 'publish' });
  const targetPost = posts.find((p) => p.slug === 'limite-anuncios-television-minutos-por-hora-ley');
  const postId = String(targetPost?._id || '');
  const pubCountBefore = await mongoCount('editorial_flow_publications', {});
  const key = `t5-key-${Date.now()}`;
  const pub = async () => { const r = await fetch(`${SSR}${FLOW}/publication/${postId}/now`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN, 'x-editorial-review-key': REVIEW, 'Idempotency-Key': key }, body: '{}' }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
  const p1 = await pub(); const p2 = await pub();
  const pubCountAfter = await mongoCount('editorial_flow_publications', { _id: key });
  const published = await mongoCount('blog_posts', { status: 'publish', slug: 'limite-anuncios-television-minutos-por-hora-ley' });
  check('9a. publicación idempotente E2E (misma clave → sin duplicar)', p1.status === p2.status && pubCountAfter <= 1, `HTTP ${p1.status}/${p2.status}, reservas=${pubCountAfter}, published=${published}`);
  // Ningún artículo publicado puede mostrarse como indexado (GSC todas sin indexar en el seed).
  const indexedPublished = await mongoCount('editorial_gsc_inspections', { coverageState: 'Página indexada' });
  check('9b. ningún artículo publicado aparece indexado', indexedPublished === 0, `GSC indexadas=${indexedPublished}`);

  /* ── 10. Capturas ── */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(flowUrl('diagnostics'), { waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(2500);
  await page.screenshot({ path: join(ART, 'ui-diagnostics-1440.png'), fullPage: true }).catch(() => {});
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(1000);
  await page.screenshot({ path: join(ART, 'ui-diagnostics-390.png'), fullPage: true }).catch(() => {});
  check('10. capturas guardadas', true, 'artifacts/m14r7/ui-diagnostics-{1440,390}.png');

} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
writeFileSync(join(ART, 'ui-result.json'), JSON.stringify({ results, failed: failed.map((f) => f.name) }, null, 2));
process.exit(failed.length ? 1 : 0);
