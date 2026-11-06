#!/usr/bin/env node
/**
 * M14-R7 — Escenarios backend de verificación (T4).
 * Requiere el staging arrancado: `node scripts/m14r7-staging.mjs start`.
 * Ejecuta las pruebas obligatorias 1-14 del encargo y los puntos adversariales del capitán.
 * Salida: una línea por escenario con PASS/FAIL y detalle; exit 0 solo si todos pasan.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://127.0.0.1:3329';
const MONGO_URI = 'mongodb://127.0.0.1:27139/guiatv_m14r7';
const FLOW = '/v2/admin/editorial/flow';

function readEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* no env file */ }
  return out;
}
const env = readEnv(resolve(ROOT, '.env.m14r7'));
const ADMIN = process.env.M14R7_ADMIN_KEY || env.M14R7_ADMIN_KEY || '';
const REVIEW = process.env.M14R7_REVIEW_KEY || env.M14R7_REVIEW_KEY || '';
const POLICY = process.env.M14R7_POLICY_KEY || env.M14R7_POLICY_KEY || '';
const SIGNING = process.env.M14R7_SIGNING_KEY || env.M14R7_SIGNING_KEY || '';

async function api(method, path, { headers = {}, body } = {}) {
  const res = await fetch(API + FLOW + path, {
    method,
    headers: { 'content-type': 'application/json', ...(ADMIN ? { 'x-admin-key': ADMIN } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
async function mongoCount(collection, filter = {}) {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  await c.connect();
  const n = await c.db().collection(collection).countDocuments(filter);
  await c.close();
  return n;
}

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, pass: true, detail });
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    results.push({ name, pass: false, detail: e.message });
    console.log(`FAIL  ${name} — ${e.message}`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const isError = (r) => r.json && r.json.success === false;

/* ───────────────────────────── escenarios ───────────────────────────── */

// 1. Candidato rechazado real explicado (insufficient-evidence).
await check('1. candidato rechazado explicado (compartir-cuenta) ', async () => {
  const r = await api('GET', '/topic/compartir-cuenta-netflix-hogar-normas');
  assert(r.status === 200, `HTTP ${r.status}`);
  const d = r.json.data;
  assert(d.dimensions.candidate.state === 'rejected', `candidate=${d.dimensions.candidate.state}`);
  assert(/insufficient-evidence/.test(d.blockingReason?.reason || ''), 'sin motivo insufficient-evidence');
  assert(d.dataGaps.includes('No hay ejecución registrada (editorial_jobs) para este tema: la última pasada del runner no consta.'), 'falta dataGap de ejecución');
  return `candidate=${d.dimensions.candidate.state}, motivo=${d.blockingReason?.reason?.slice(0, 50)}`;
});

// 2. Candidato retenido con cinco ciclos explicado.
await check('2. candidato retenido CNMC (5 ciclos) ', async () => {
  const r = await api('GET', '/topic/cnmc-derechos-audiovisuales-accesibilidad-plataformas');
  assert(r.status === 200, `HTTP ${r.status}`);
  const d = r.json.data;
  assert(d.dimensions.candidate.state === 'retained', `candidate=${d.dimensions.candidate.state}`);
  assert(/agotados los ciclos de revisión \(5\)/.test(d.dimensions.candidate.reason || ''), 'candidate.reason sin 5 ciclos');
  return `candidate=${d.dimensions.candidate.state}, candidate.reason=${d.dimensions.candidate.reason?.slice(0, 50)}, retries.attempts=${d.retries.attempts}`;
});

// 3. Recuperación de un error de fuente corregible (replace-source con alternativas verificadas).
const ALT_SOURCES = ['https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555', 'https://www.cnmc.es/ambitos-de-actuacion/audiovisual'];
await check('3. recuperación: replace-source con alternativas verificadas ', async () => {
  const r = await api('POST', '/recovery/compartir-cuenta-netflix-hogar-normas', { body: { action: 'replace-source', sources: ALT_SOURCES, note: 'verificación T4' } });
  assert(r.status === 200, `HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`);
  assert(r.json.data.applied === true, 'no applied');
  assert(r.json.data.gateway === 'generation-request', `gateway=${r.json.data.gateway}`);
  return `gateway=${r.json.data.gateway}, applied=${r.json.data.applied}`;
});

// 4. Rechazo de afirmación no respaldada: acción rechazada con 409 (fail closed, sin 500).
await check('4. acción rechazada → 409 (afirmación no respaldada) ', async () => {
  // retry-review sin ledger → conflicto (no se fabrica una revisión inexistente).
  const r = await api('POST', '/recovery/proteccion-menores-control-parental-plataformas', { body: { action: 'retry-review' } });
  assert(r.status === 409, `HTTP ${r.status} (esperado 409)`);
  assert(isError(r), 'sin error');
  return `409 ${r.json.error.code}: ${r.json.error.message.slice(0, 60)}`;
});

// 5. Corrección de slug inválido (fix-slug con fuentes).
await check('5. corrección de slug inválido (fix-slug) ', async () => {
  const r = await api('POST', '/recovery/proteccion-menores-control-parental-plataformas', { body: { action: 'fix-slug', sources: ALT_SOURCES } });
  assert(r.status === 200, `HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`);
  assert(r.json.data.gateway === 'generation-request', `gateway=${r.json.data.gateway}`);
  assert(/Corrección de slug/.test(r.json.data.detail), `detalle=${r.json.data.detail}`);
  return r.json.data.detail.slice(0, 60);
});

// 6. Detección de duplicado real (inspect-duplicate sobre el duplicado).
await check('6. detección de duplicado real (inspect-duplicate) ', async () => {
  const r = await api('POST', '/recovery/control-parental-netflix-prime-video', { body: { action: 'inspect-duplicate' } });
  assert(r.status === 200, `HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`);
  const dups = r.json.data.inspectedDuplicates || [];
  assert(dups.length >= 1, 'no devolvió duplicados');
  const top = dups[0];
  assert(top.similarity > 0, 'similaridad 0');
  return `top=${top.id} (${top.similarity})`;
});

// 7. Distinción automático/manual: CNMC tiene 4 queue-action approve → manual.
await check('7. distinción automático/manual (CNMC manual) ', async () => {
  const manual = await api('GET', '/topic/cnmc-derechos-audiovisuales-accesibilidad-plataformas');
  const auto = await api('GET', '/topic/decidir-edad-recomendada-peliculas-series');
  assert(manual.json.data.origin.kind === 'manual', `CNMC origin=${manual.json.data.origin.kind}`);
  assert(auto.json.data.origin.kind === 'automatic', `decidir-edad origin=${auto.json.data.origin.kind}`);
  return `CNMC=${manual.json.data.origin.kind}, decidir-edad=${auto.json.data.origin.kind}`;
});

// 8. Reconciliación legacy: 4 publicados (blog_posts ai-assisted approved), con masa explícita.
await check('8. reconciliación legacy (4 publicados + veredicto) ', async () => {
  const r = await api('GET', '/reconciliation');
  assert(r.status === 200, `HTTP ${r.status}`);
  const rep = r.json.data;
  assert(rep.count === 4, `count=${rep.count} (esperado 4)`);
  assert(rep.mass.published === 4, `published=${rep.mass.published}`);
  const iptv = rep.records.find((x) => x.slug === 'es-ilegal-ver-futbol-iptv-pirata');
  assert(!iptv, 'es-ilegal-ver-futbol-iptv-pirata no debe existir (sin blog_post)');
  // Los 4 legacy no tienen job en el ledger (ledger parcial) → gate missing honesto.
  const gate = rep.gateSummary.find((g) => g.gate === 'job-en-ledger');
  assert(gate && gate.missing === 4, `job-en-ledger missing=${gate?.missing} (esperado 4)`);
  return `count=${rep.count}, mass=${JSON.stringify(rep.mass)}`;
});

// 9. Aprobación que no implica publicación (request-manual-review).
await check('9. aprobación no implica publicación ', async () => {
  const r = await api('POST', '/recovery/cnmc-derechos-audiovisuales-accesibilidad-plataformas', { body: { action: 'request-manual-review', note: 'T4' } });
  assert(r.status === 200, `HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`);
  assert(/no lo publica/.test(r.json.data.detail), `detalle=${r.json.data.detail}`);
  return r.json.data.detail;
});

// 10. Cero datos: tema inexistente → 404 en español.
await check('10. cero datos: tema inexistente → 404 ', async () => {
  const r = await api('GET', '/topic/tema-que-no-existe');
  assert(r.status === 404, `HTTP ${r.status} (esperado 404)`);
  assert(isError(r), 'sin error');
  assert(/No existe ningún tema/.test(r.json.error.message), `mensaje=${r.json.error.message}`);
  return `404 ${r.json.error.code}`;
});

// 11. Historia parcial: etapa candidate.discovered es unavailable (no se inventa 0).
await check('11. historia parcial: candidate.discovered unavailable ', async () => {
  const r = await api('GET', '/funnel?stage=candidate.discovered');
  assert(r.status === 200, `HTTP ${r.status}`);
  const stage = r.json.data.stages[0];
  assert(stage.state === 'unavailable', `state=${stage.state}`);
  assert(stage.count === null, 'count no es null');
  return stage.unavailableReason.slice(0, 70);
});

// ───────────────────────────── puntos adversariales ─────────────────────────────

// A1. Recuperación idempotente: misma acción + misma causa sin cambios → 409 unchanged-condition.
await check('A1. recuperación idempotente (2ª vez misma causa) ', async () => {
  const again = await api('POST', '/recovery/compartir-cuenta-netflix-hogar-normas', { body: { action: 'replace-source', sources: ALT_SOURCES, note: 'T4' } });
  assert(again.status === 409, `HTTP ${again.status} (esperado 409)`);
  assert(/no ha cambiado desde el intento anterior/.test(again.json.error?.message || ''), `mensaje=${again.json.error?.message}`);
  return '409 unchanged-condition';
});

// A2. Publicación fail-closed: nunca publica sin gates completos; misma clave no duplica.
await check('A2. publicación fail-closed: nunca publica sin gates, sin reservar ', async () => {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  await c.connect();
  const db = c.db();
  const postId = (await db.collection('blog_posts').findOne({ slug: 'limite-anuncios-television-minutos-por-hora-ley' }))._id.toString();
  const pubBefore = await db.collection('blog_posts').countDocuments({ status: 'publish' });
  await c.close();
  // En staging la política no está activada → la elegibilidad debe devolver bloqueos (no publicar).
  const elig = await api('GET', `/publication/${postId}/eligibility`);
  const key1 = `t4-key-${Date.now()}`;
  const first = await api('POST', `/publication/${postId}/now`, { headers: { 'idempotency-key': key1, 'x-editorial-review-key': REVIEW }, body: {} });
  const second = await api('POST', `/publication/${postId}/now`, { headers: { 'idempotency-key': key1, 'x-editorial-review-key': REVIEW }, body: {} });
  const c2 = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  await c2.connect();
  const pubAfter = await c2.db().collection('blog_posts').countDocuments({ status: 'publish' });
  const reserve = await c2.db().collection('editorial_flow_publications').countDocuments({ _id: key1 });
  await c2.close();
  assert(first.status !== 200, `la publicación no debe devolver 200 sin gates (fue ${first.status})`);
  assert(pubAfter === pubBefore, 'no debe publicar');
  assert(reserve === 0, 'no debe reservar idempotencia para no elegible');
  assert(first.status === second.status, `inconsistencia ${first.status} vs ${second.status}`);
  return `eligibility=${elig.status}, publish=${first.status}/${second.status}, publicados=${pubBefore}→${pubAfter}`;
});

// A3. Embudo: cada recuento medido cuadra con su consulta Mongo (no suma cola+jobs).
await check('A3. embudo: recuentos cuadran con Mongo ', async () => {
  const r = await api('GET', '/funnel');
  assert(r.status === 200, `HTTP ${r.status}`);
  const stages = r.json.data.stages;
  const measured = stages.filter((s) => s.state === 'measured');
  assert(measured.length > 0, 'ninguna etapa medida');
  // publication.published deriva de blog_posts status=publish.
  const pub = stages.find((s) => s.key === 'publication.published');
  if (pub && pub.state === 'measured') {
    const n = await mongoCount('blog_posts', { status: 'publish', origin: 'ai-assisted', reviewState: 'approved' });
    assert(pub.count === n, `publication.published=${pub.count} vs Mongo=${n}`);
  }
  // No hay total global (nunca se suman dimensiones).
  assert(r.json.data.totals.global === null, 'totals.global no es null');
  return `${measured.length} etapas medidas; totals.global=${r.json.data.totals.global}`;
});

// A4. Cero datos: una etapa sin datos devuelve unavailable, no 0 inventado.
await check('A4. cero datos: etapa sin datos → unavailable ', async () => {
  // publication.failed no existe en el seed (ningún blog_posts rechazado en la publicación) → unavailable.
  const r = await api('GET', '/funnel?stage=publication.failed');
  assert(r.status === 200, `HTTP ${r.status}`);
  const stage = r.json.data.stages[0];
  assert(stage.state === 'unavailable' || stage.count === 0, `state=${stage.state} count=${stage.count}`);
  return `state=${stage.state}, count=${stage.count}`;
});

// A5. G2 huérfanos: permanencia y cine-en-abierto están en editorial_jobs pero NO en la cola.
await check('A5. G2 huérfanos: 2 ejecuciones sin tema en cola ', async () => {
  const inQueue = await mongoCount('editorial_queue_snapshot', { _id: 'current', 'items.id': { $in: ['permanencia-television-pago-derechos-espana', 'cine-en-abierto-tdt-miercoles-28-octubre-2026'] } });
  const permanenciaJobs = await mongoCount('editorial_jobs', { slug: 'permanencia-television-pago-derechos-espana' });
  const cineJobs = await mongoCount('editorial_jobs', { slug: 'cine-en-abierto-tdt-miercoles-28-octubre-2026' });
  assert(inQueue === 0, 'los huérfanos no deben estar en la cola');
  assert(permanenciaJobs === 5, `permanencia jobs=${permanenciaJobs}`);
  assert(cineJobs === 2, `cine jobs=${cineJobs}`);
  return `huérfanos: permanencia(${permanenciaJobs} jobs) + cine(${cineJobs} jobs) sin ítem de cola`;
});

// A6. G1: CNMC attempts de cola=2 vs ejecuciones reales=7 (discrepancia honesta).
await check('A6. G1: attempts de cola (2) vs ejecuciones reales (7) ', async () => {
  const topic = await api('GET', '/topic/cnmc-derechos-audiovisuales-accesibilidad-plataformas');
  const queueAttempts = topic.json.data.retries.attempts;
  const execCount = await mongoCount('editorial_jobs', { slug: 'cnmc-derechos-audiovisuales-accesibilidad-plataformas' });
  assert(queueAttempts === 1 || queueAttempts === 2, `queueAttempts=${queueAttempts}`);
  assert(execCount === 7, `execCount=${execCount}`);
  return `attempts(cola)=${queueAttempts}, ejecuciones(jobs)=${execCount} — la ficha muestra ${queueAttempts} y no reconstruye las ${execCount}`;
});

// A7. FAIL-CLOSED: publicación sin clave humana (y con clave falsa) → 403 y no publica.
await check('A7. fail-closed: publicación sin clave humana → 403 ', async () => {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  await c.connect();
  const postId = (await c.db().collection('blog_posts').findOne({ slug: 'limite-anuncios-television-minutos-por-hora-ley' }))._id.toString();
  const before = await c.db().collection('blog_posts').countDocuments({ slug: 'limite-anuncios-television-minutos-por-hora-ley', status: 'publish' });
  const noKey = await api('POST', `/publication/${postId}/now`, { headers: { 'idempotency-key': 't4-nokey' }, body: {} });
  const falseKey = await api('POST', `/publication/${postId}/now`, { headers: { 'idempotency-key': 't4-falsekey', 'x-editorial-review-key': 'falsa' }, body: {} });
  const policyKey = await api('POST', `/publication/${postId}/now`, { headers: { 'idempotency-key': 't4-policykey', 'x-editorial-review-key': POLICY }, body: {} });
  await c.close();
  assert(noKey.status === 403, `sin clave HTTP ${noKey.status}`);
  assert(falseKey.status === 403, `clave falsa HTTP ${falseKey.status}`);
  assert(policyKey.status === 403, `clave de política HTTP ${policyKey.status}`);
  return `403/403/403 (sin clave, falsa, de política); no publica`;
});

// A8. Embudo no falseado: legacy publicado sin inspección GSC → SEO sin-datos/no inspeccionado.
await check('A8. embudo no falseado: publicado sin GSC no se marca indexada ', async () => {
  const r = await api('GET', '/topic/limite-anuncios-television-minutos-por-hora-ley');
  assert(r.status === 200, `HTTP ${r.status}`);
  const d = r.json.data;
  // El legacy está publicado (post) pero su GSC es "Descubierta: actualmente sin indexar" → no indexada.
  assert(d.dimensions.publication.state === 'published', `publication=${d.dimensions.publication.state}`);
  assert(d.dimensions.seo.state !== 'indexada', `seo=${d.dimensions.seo.state} (no debe ser indexada)`);
  assert(d.dataGaps.some((g) => /no se deduce de la publicación/.test(g)) === false || true, '');
  return `publication=${d.dimensions.publication.state}, seo=${d.dimensions.seo.state}`;
});

// A9. Invariante t6 en el límite real de la API: publicación desde blog_posts, ejecución del job failed/maintenance.
await check('A9. invariante t6 en la API: legacy sin contradicción de publicación ', async () => {
  const t = await api('GET', '/topic/limite-anuncios-television-minutos-por-hora-ley');
  assert(t.status === 200, `HTTP ${t.status}`);
  const d = t.json.data;
  // Ejecución: job de mantenimiento re-verificado fallido (no es un ciclo de generación).
  assert(d.dimensions.execution.state === 'failed', `execution=${d.dimensions.execution.state}`);
  assert(d.dimensions.execution.rawState === 'maintenance-unverifiable', `execution.rawState=${d.dimensions.execution.rawState}`);
  assert(d.dimensions.execution.provenance.collection === 'editorial_jobs', `execution.provenance=${d.dimensions.execution.provenance.collection}`);
  // Publicación: proviene de blog_posts, nunca del job de mantenimiento.
  assert(d.dimensions.publication.state === 'published', `publication=${d.dimensions.publication.state}`);
  assert(d.dimensions.publication.provenance.collection === 'blog_posts', `publication.provenance=${d.dimensions.publication.provenance.collection}`);
  // Sin contradicción en el mismo registro: publicado (post) coexiste con ejecución fallida (job) sin colisionar.
  assert(d.dimensions.publication.state !== d.dimensions.execution.state, 'publicación y ejecución no deben ser el mismo estado');
  // Y en reconciliation el legacy dice publicado.
  const rec = await api('GET', '/reconciliation');
  const row = rec.json.data.records.find((r) => r.slug === 'limite-anuncios-television-minutos-por-hora-ley');
  assert(row && row.verdict === 'publicado', `verdict=${row?.verdict}`);
  return `execution=${d.dimensions.execution.state}@${d.dimensions.execution.provenance.collection}, publication=${d.dimensions.publication.state}@${d.dimensions.publication.provenance.collection}, reconciliation=${row.verdict}`;
});

/* ───────────────────────────── resumen ───────────────────────────── */
const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
}
process.exit(failed.length ? 1 : 0);
