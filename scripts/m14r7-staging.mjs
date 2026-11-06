#!/usr/bin/env node
/**
 * M14-R7 local staging (isolated, no production deployment, no real credentials).
 * Spawns the cached mongod binary DIRECTLY and seeds data COPIED from the production
 * snapshot (tmp-storage/m14r7/prod-probe2..6.txt). No credential value is printed.
 *
 *   node scripts/m14r7-staging.mjs start|stop|status|verify|seed|mongod
 *
 * Ports (distinct): MongoDB 27139 (db guiatv_m14r7) · Backend 3329 · Integrity 4339.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const ART = join(ROOT, 'artifacts', 'm14r7');
const LOGS = join(ART, 'logs');
const STATE_FILE = join(ART, 'state.json');
const MONGO_DATA = join(ART, 'mongo-data');
const ENV_FILE = join(ROOT, '.env.m14r7');
const SCRIPT = join(HERE, 'm14r7-staging.mjs');

const MONGOD_BIN = process.env.M14R7_MONGOD || 'C:/Users/Admin/.cache/mongodb-binaries/mongod-x64-win32-7.0.24.exe';
const PORTS = { mongo: 27139, api: 3329, ssr: 4329, integrity: 4339 };
const DB_NAME = 'guiatv_m14r7';
const MONGO_URI = `mongodb://127.0.0.1:${PORTS.mongo}/${DB_NAME}`;
const API_ORIGIN = `http://127.0.0.1:${PORTS.api}`;
const INTEGRITY_ORIGIN = `http://127.0.0.1:${PORTS.integrity}`;
const SSR_ORIGIN = `http://127.0.0.1:${PORTS.ssr}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[m14r7-staging ${new Date().toISOString()}]`, ...a);
const fail = (m, e) => { console.error(`[m14r7-staging] ERROR: ${m}`); if (e) console.error(e?.stack ?? String(e)); process.exit(1); };
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function httpGet(url, { timeoutMs = 10_000, headers = {} } = {}) {
  return new Promise((res) => {
    const req = http.get(url, { headers, timeout: timeoutMs }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => res({ status: 0, headers: {}, body: '', error: e.message }));
  });
}

/* ---------------------------------------------------------- seed (production copy) */

// editorial_queue_snapshot: [id, category, state, score, attempts, reason, title]
const QUEUE = [
  ['compartir-cuenta-netflix-hogar-normas', 'Streaming', 'rejected', 0, 0, 'insufficient-evidence: menos de dos entidades editoras verificadas', 'Compartir cuenta de Netflix en España: qué es el hogar y qué normas hay'],
  ['derecho-desistimiento-suscripciones-streaming-espana', 'Streaming', 'rejected', 0, 0, 'insufficient-evidence: menos de dos entidades editoras verificadas', 'Cancelar una suscripción de streaming en España: derechos del consumidor'],
  ['minutos-publicidad-planes-con-anuncios-streaming', 'Streaming', 'rejected', 0, 0, 'insufficient-evidence: menos de dos entidades editoras verificadas', 'Planes con anuncios en streaming: qué cambia frente al plan sin publicidad'],
  ['cnmc-derechos-audiovisuales-accesibilidad-plataformas', 'Streaming', 'held', 67, 2, 'blocked: agotados los ciclos de revisión (5)', 'Quién vigila las plataformas de streaming en España: CNMC y obligaciones'],
  ['proteccion-menores-control-parental-plataformas', 'Tecnología', 'rejected', 0, 0, 'invalid-candidate: slug', 'Control parental en Netflix, Disney+ y Prime Video: cómo configurarlo'],
  ['reglamento-var-laliga-como-funciona', 'Fútbol', 'rejected', 0, 0, 'insufficient-evidence: menos de dos entidades editoras verificadas', 'Cómo funciona el VAR en el fútbol español: reglas y qué se puede revisar'],
  ['normas-estadio-entradas-reventa-laliga', 'Deportes', 'rejected', 0, 0, 'insufficient-evidence: menos de dos entidades editoras verificadas', 'Entradas y normas de acceso al estadio en el fútbol español'],
  ['apple-tv-airplay-ajustes-imagen-television', 'Tecnología', 'rejected', 0, 0, 'insufficient-evidence: una sola entidad editora entre las fuentes semilla (hacen falta dos)', 'Apple TV+ y AirPlay: cómo ver contenido en tu televisor'],
  ['descargar-series-peliculas-netflix-disneyplus', 'Streaming', 'rejected', 0, 0, 'insufficient-evidence: menos de dos entidades editoras verificadas', 'Cómo descargar películas y series en Netflix y Disney+ para ver sin conexión'],
  ['ajustar-calidad-reproduccion-datos-netflix-disneyplus', 'Streaming', 'rejected', 0, 0, 'insufficient-evidence: menos de dos entidades editoras verificadas', 'Cómo ajustar la calidad de reproducción y el consumo de datos en Netflix y Disney+'],
  ['requisitos-ver-4k-uhd-hdr-netflix-disneyplus', 'Tecnología', 'rejected', 0, 0, 'insufficient-evidence: menos de dos entidades editoras verificadas', 'Requisitos para ver Netflix y Disney+ en 4K UHD y HDR en España'],
  ['ver-netflix-apple-tv-plus-airplay', 'Tecnología', 'rejected', 0, 0, 'insufficient-evidence: menos de dos entidades editoras verificadas', 'Cómo ver Netflix y Apple TV+ en un televisor con Apple TV o AirPlay'],
  ['ver-canales-tdt-directo-internet-rtve-mitele-atresplayer', 'Televisión', 'rejected', 0, 0, 'insufficient-evidence: menos de dos entidades editoras verificadas', 'Cómo ver los canales de TDT en directo por internet en España'],
  ['cambiar-idioma-subtitulos-netflix-disneyplus', 'Streaming', 'rejected', 0, 0, 'insufficient-evidence: menos de dos entidades editoras verificadas', 'Cómo cambiar el idioma y activar subtítulos en Netflix y Disney+'],
  ['copa-del-rey-2026-27-rfef-rtve', 'Fútbol', 'rejected', 0, 0, 'insufficient-evidence: menos de dos entidades editoras verificadas', 'Cómo seguir la Copa del Rey 2026-27 en España: TV, online y radio'],
  ['formato-champions-league-2026-27-uefa', 'Fútbol', 'rejected', 0, 0, 'insufficient-evidence: menos de dos entidades editoras verificadas', 'Cómo funciona el formato de la Champions League 2026-27'],
  ['control-parental-netflix-prime-video', 'Streaming', 'rejected', 0, 0, 'duplicate: misma intención que protección-menores-control-parental-plataformas (0.47)', 'Control parental en Netflix y Prime Video: PIN, perfiles y límites'],
  ['cancelar-netflix-prime-video-espana', 'Streaming', 'rejected', 0, 0, 'insufficient-evidence: menos de dos entidades editoras verificadas', 'Cancelar Netflix y Prime Video en España: pasos, plazos y facturación'],
  ['cambiar-contrasena-netflix-prime-video', 'Tecnología', 'rejected', 0, 0, 'insufficient-evidence: menos de dos entidades editoras verificadas', 'Cambiar o recuperar la contraseña en Netflix y Prime Video'],
  ['canjear-tarjetas-regalo-netflix-disney', 'Streaming', 'rejected', 0, 0, 'insufficient-evidence: menos de dos entidades editoras verificadas', 'Canjear tarjetas regalo de Netflix y Disney+ en España'],
  ['gestionar-perfiles-netflix-disney', 'Streaming', 'rejected', 0, 0, 'insufficient-evidence: menos de dos entidades editoras verificadas', 'Cómo crear, gestionar y borrar perfiles en Netflix y Disney+'],
  ['decidir-edad-recomendada-peliculas-series', 'Cine', 'rejected', 0, 0, 'insufficient-evidence: menos de dos entidades editoras verificadas', 'Cómo se decide la edad recomendada de una película o serie en España'],
];

// blog_posts legacy: [slug, title, metaTitle, metaDescription, publishedAt]
const LEGACY = [
  ['limite-anuncios-television-minutos-por-hora-ley', 'Límites de publicidad en televisión: Ley 13/2022', 'Límites de publicidad en televisión: Ley 13/2022', 'Topes de anuncios por franja (144 y 72 minutos), qué no computa, cada cuánto se puede cortar una película y reglas en las retransmisiones deportivas.', '2026-10-27T23:33:34.628Z'],
  ['horario-proteccion-menores-television-calificacion-por-edades', 'Horario de contenidos para adultos en la TV española', 'Horario de contenidos para adultos en la TV española', 'Los programas no recomendados para menores de dieciocho años solo pueden emitirse en abierto entre las 22:00 y las 6:00.', '2026-10-27T23:33:33.798Z'],
  ['subtitulos-audiodescripcion-lengua-de-signos-television-obligaciones', 'Subtítulos, audiodescripción y signos en TV: Ley 13/2022', 'Subtítulos, audiodescripción y signos en TV: Ley 13/2022', 'Mínimos de subtitulado, audiodescripción y lengua de signos por tipo de televisión según la Ley 13/2022.', '2026-10-27T23:33:35.583Z'],
  ['descargar-series-netflix-grabar-tele-copia-privada', 'Grabar la tele y guardar descargas de Netflix: qué es legal', 'Grabar la tele y guardar descargas de Netflix: qué es legal', 'Qué permiten las condiciones de Netflix sobre descargas y qué dice la Ley de Propiedad Intelectual.', '2026-10-28T10:40:24.394Z'],
];

// editorial_gsc_inspections: [slug, coverageState]
const GSC = [
  ['subtitulos-audiodescripcion-lengua-de-signos-television-obligaciones', 'Google no reconoce esta URL'],
  ['limite-anuncios-television-minutos-por-hora-ley', 'Descubierta: actualmente sin indexar'],
  ['horario-proteccion-menores-television-calificacion-por-edades', 'Google no reconoce esta URL'],
  ['mejores-series-y-peliculas-movistar-plus-espana', 'Google no reconoce esta URL'],
  ['mejores-series-y-peliculas-hbo-max-espana', 'Google no reconoce esta URL'],
  ['mejores-series-y-peliculas-disney-plus-espana', 'Descubierta: actualmente sin indexar'],
  ['mejores-series-y-peliculas-prime-video-espana', 'Descubierta: actualmente sin indexar'],
  ['mejores-series-y-peliculas-netflix-espana', 'Descubierta: actualmente sin indexar'],
  ['netflix-hbo-max-disney-prime-video-que-plan-elegir', 'Google no reconoce esta URL'],
  ['precios-plataformas-streaming-espana', 'Descubierta: actualmente sin indexar'],
  ['donde-ver-laliga-2026-27-espana', 'Descubierta: actualmente sin indexar'],
  ['donde-ver-champions-league-2026-27-espana', 'Descubierta: actualmente sin indexar'],
  ['movistar-plus-vs-dazn', 'Google no reconoce esta URL'],
  ['descargar-series-netflix-grabar-tele-copia-privada', 'Google no reconoce esta URL'],
];

// editorial_jobs: [jobId, slug, state, reason]
const JOBS = [
  ['2026-11-05T15:06:37.898Z-cnmc-derechos-audiovisuales-accesibilidad-plataformas', 'cnmc-derechos-audiovisuales-accesibilidad-plataformas', 'blocked', 'error: editorial: answer truncated at max_tokens'],
  ['2026-11-03T08:33:36.237Z-maint-limite-anuncios-television-minutos-por-hora-ley', 'limite-anuncios-television-minutos-por-hora-ley', 'maintenance-unverifiable', 'sin el fichero de ejecución de la versión publicada: no se puede re-verificar'],
  ['2026-11-03T08:33:36.295Z-maint-horario-proteccion-menores-television-calificacion-por-edades', 'horario-proteccion-menores-television-calificacion-por-edades', 'maintenance-unverifiable', 'sin el fichero de ejecución de la versión publicada: no se puede re-verificar'],
  ['2026-11-03T08:38:59.081Z-discovery', 'discovery', 'discovery', '8 propuestos, 1 en cola, 7 descartados'],
  ['2026-11-03T08:39:42.873Z-cnmc-derechos-audiovisuales-accesibilidad-plataformas', 'cnmc-derechos-audiovisuales-accesibilidad-plataformas', 'blocked', 'error: editorial: ninguna ruta disponible'],
  ['2026-11-03T08:42:57.780Z-cnmc-derechos-audiovisuales-accesibilidad-plataformas', 'cnmc-derechos-audiovisuales-accesibilidad-plataformas', 'blocked', 'agotados los ciclos de revisión (5)'],
  ['2026-11-05T13:44:14.555Z-cnmc-derechos-audiovisuales-accesibilidad-plataformas', 'cnmc-derechos-audiovisuales-accesibilidad-plataformas', 'blocked', 'error: Connection error.'],
  ['2026-11-05T14:02:43.090Z-cnmc-derechos-audiovisuales-accesibilidad-plataformas', 'cnmc-derechos-audiovisuales-accesibilidad-plataformas', 'blocked', 'error: research: 401 Authentication Fails'],
  ['2026-11-05T14:21:39.118Z-discovery', 'discovery', 'discovery', '8 propuestos, 0 en cola, 8 descartados'],
  ['2026-11-03T08:33:36.184Z-maint-subtitulos-audiodescripcion-lengua-de-signos-television-obligaciones', 'subtitulos-audiodescripcion-lengua-de-signos-television-obligaciones', 'maintenance-unverifiable', 'sin el fichero de ejecución de la versión publicada: no se puede re-verificar'],
  ['2026-11-05T15:23:05.084Z-cnmc-derechos-audiovisuales-accesibilidad-plataformas', 'cnmc-derechos-audiovisuales-accesibilidad-plataformas', 'blocked', "error: Cannot read properties of undefined (reading 'length')"],
  ['2026-11-05T18:36:10.676Z-permanencia-television-pago-derechos-espana', 'permanencia-television-pago-derechos-espana', 'blocked', 'error: research: Unexpected non-whitespace character after JSON'],
  ['2026-11-05T18:52:39.132Z-permanencia-television-pago-derechos-espana', 'permanencia-television-pago-derechos-espana', 'blocked', "error: Cannot read properties of undefined (reading 'map')"],
  ['2026-11-05T18:57:12.630Z-permanencia-television-pago-derechos-espana', 'permanencia-television-pago-derechos-espana', 'blocked', 'error: editorial: no JSON block in the answer'],
  ['2026-11-05T19:16:38.375Z-permanencia-television-pago-derechos-espana', 'permanencia-television-pago-derechos-espana', 'blocked', 'agotados los ciclos de revisión (2)'],
  ['2026-11-05T19:41:22.798Z-permanencia-television-pago-derechos-espana', 'permanencia-television-pago-derechos-espana', 'blocked', 'agotados los ciclos de revisión (2)'],
  ['2026-11-06T00:08:36.857Z-cnmc-derechos-audiovisuales-accesibilidad-plataformas', 'cnmc-derechos-audiovisuales-accesibilidad-plataformas', 'blocked', 'agotados los ciclos de revisión (5)'],
  ['2026-11-06T05:11:06.140Z-discovery', 'discovery', 'discovery', '6 propuestos, 0 en cola, 6 descartados'],
  ['2026-10-28T10:21:18.987Z-maint-limite-anuncios-television-minutos-por-hora-ley', 'limite-anuncios-television-minutos-por-hora-ley', 'maintenance-verified', '22 afirmaciones verificadas'],
  ['2026-10-27T16:21:20.987Z-cine-en-abierto-tdt-miercoles-28-octubre-2026', 'cine-en-abierto-tdt-miercoles-28-octubre-2026', 'blocked', 'agotados los ciclos de revisión'],
  ['2026-10-27T18:33:55.849Z-horario-proteccion-menores-television-calificacion-por-edades', 'horario-proteccion-menores-television-calificacion-por-edades', 'blocked', 'agotados los ciclos de revisión'],
  ['2026-10-27T20:21:33.075Z-horario-proteccion-menores-television-calificacion-por-edades', 'horario-proteccion-menores-television-calificacion-por-edades', 'published', null],
  ['2026-10-27T20:21:33.075Z-limite-anuncios-television-minutos-por-hora-ley', 'limite-anuncios-television-minutos-por-hora-ley', 'published', null],
  ['2026-10-27T20:21:33.075Z-subtitulos-audiodescripcion-lengua-de-signos-television-obligaciones', 'subtitulos-audiodescripcion-lengua-de-signos-television-obligaciones', 'published', null],
  ['2026-10-28T09:52:30.523Z-discovery', 'discovery', 'discovery', '7 propuestos, 5 en cola, 2 descartados'],
  ['2026-10-28T09:54:19.544Z-discovery', 'discovery', 'discovery', '6 propuestos, 4 en cola, 2 descartados'],
  ['2026-10-28T10:21:18.505Z-maint-subtitulos-audiodescripcion-lengua-de-signos-television-obligaciones', 'subtitulos-audiodescripcion-lengua-de-signos-television-obligaciones', 'maintenance-verified', '33 afirmaciones verificadas'],
  ['2026-10-27T16:21:05.383Z-cine-en-abierto-tdt-miercoles-28-octubre-2026', 'cine-en-abierto-tdt-miercoles-28-octubre-2026', 'blocked', 'límite: sin margen para otra llamada a claude-opus-5-5 (2.56 USD) dentro del límite 2.197599'],
  ['2026-10-28T10:21:20.622Z-es-ilegal-ver-futbol-iptv-pirata', 'es-ilegal-ver-futbol-iptv-pirata', 'blocked', 'agotados los ciclos de revisión (5)'],
  ['2026-10-28T10:36:14.712Z-discovery', 'discovery', 'discovery', '4 propuestos, 1 en cola, 3 descartados'],
  ['2026-10-28T10:37:15.613Z-maint-horario-proteccion-menores-television-calificacion-por-edades', 'horario-proteccion-menores-television-calificacion-por-edades', 'maintenance-verified', '25 afirmaciones verificadas'],
  ['2026-10-28T10:37:17.478Z-descargar-series-netflix-grabar-tele-copia-privada', 'descargar-series-netflix-grabar-tele-copia-privada', 'published', null],
  ['2026-10-28T13:00:07.427Z-maint-descargar-series-netflix-grabar-tele-copia-privada', 'descargar-series-netflix-grabar-tele-copia-privada', 'maintenance-verified', '23 afirmaciones verificadas'],
  ['2026-10-28T14:59:07.830Z-descargar-series-netflix-grabar-tele-copia-privada', 'descargar-series-netflix-grabar-tele-copia-privada', 'blocked', 'agotados los ciclos de revisión (5)'],
  ['2026-11-03T08:33:36.108Z-maint-descargar-series-netflix-grabar-tele-copia-privada', 'descargar-series-netflix-grabar-tele-copia-privada', 'maintenance-unverifiable', 'sin el fichero de ejecución de la versión publicada: no se puede re-verificar'],
];

// editorial_job_ledger: [_id, jobId, slug, state]
const LEDGER = [
  ['2026-11-05T18:36:11.105Z-permanencia-television-pago-derechos-espana', '2026-11-05T18:36:11.105Z-permanencia-television-pago-derechos-espana', 'permanencia-television-pago-derechos-espana', 'blocked'],
  ['2026-11-05T18:52:39.290Z-permanencia-television-pago-derechos-espana', '2026-11-05T18:52:39.290Z-permanencia-television-pago-derechos-espana', 'permanencia-television-pago-derechos-espana', 'blocked'],
  ['2026-11-05T18:57:12.798Z-permanencia-television-pago-derechos-espana', '2026-11-05T18:57:12.798Z-permanencia-television-pago-derechos-espana', 'permanencia-television-pago-derechos-espana', 'blocked'],
  ['2026-11-05T19:16:38.515Z-permanencia-television-pago-derechos-espana', '2026-11-05T19:16:38.515Z-permanencia-television-pago-derechos-espana', 'permanencia-television-pago-derechos-espana', 'blocked'],
  ['2026-11-05T19:41:23.137Z-permanencia-television-pago-derechos-espana', '2026-11-05T19:41:23.137Z-permanencia-television-pago-derechos-espana', 'permanencia-television-pago-derechos-espana', 'blocked'],
  ['2026-11-06T00:08:37.256Z-cnmc-derechos-audiovisuales-accesibilidad-plataformas', '2026-11-06T00:08:37.256Z-cnmc-derechos-audiovisuales-accesibilidad-plataformas', 'cnmc-derechos-audiovisuales-accesibilidad-plataformas', 'blocked'],
];

// editorial_generation_requests (4 CNMC approvals): [createdAt, createdBy]
const APPROVALS = [
  ['2026-11-05T13:44:01.361Z', 'manuelxgon@gmail.com'],
  ['2026-11-05T14:29:15.828Z', 'admin-key'],
  ['2026-11-05T15:01:11.732Z', 'admin-key'],
  ['2026-11-05T15:28:45.860Z', 'admin-key'],
];

export async function seedDatabase(mongoUri, dbName) {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 15_000 });
  await client.connect();
  const db = client.db(dbName);
  const now = Date.now();

  await db.collection('editorial_queue_snapshot').deleteMany({});
  await db.collection('editorial_queue_snapshot').updateOne(
    { _id: 'current' },
    { $set: { updatedAt: new Date('2026-11-06T09:11:03Z'), items: QUEUE.map(([id, category, state, score, attempts, reason, title]) => ({ id, title, category, state, score, attempts, reason, sources: [], pinned: false, intent: title, explanation: [], createdAt: new Date(now - 86_400_000), updatedAt: new Date(now) })) } },
    { upsert: true }
  );

  await db.collection('blog_posts').deleteMany({});
  await db.collection('blog_posts').createIndex({ slug: 1 }, { unique: true });
  await db.collection('blog_posts').insertMany(LEGACY.map(([slug, title, metaTitle, metaDescription, publishedAt]) => ({
    slug, title, status: 'publish', origin: 'ai-assisted', reviewState: 'approved', contentType: 'guide',
    publishedAt: new Date(publishedAt), createdAt: new Date(publishedAt), updatedAt: new Date(publishedAt),
    excerpt: metaDescription, content: `<h2>${title}</h2>`,
    editorial: { pipelineVersion: 'm11g-2', state: 'published', bundle: { topic: title, intent: title, researchQuestions: [], sources: [], claims: [], conflicts: [], createdAt: publishedAt }, bundleHash: 'seed', draftHash: 'seed', backend: 'replay' },
    seo: { metaTitle, metaDescription, canonicalUrl: `/guias/${slug}` },
  })));

  await db.collection('editorial_gsc_inspections').deleteMany({});
  await db.collection('editorial_gsc_inspections').createIndex({ url: 1 }, { unique: true });
  await db.collection('editorial_gsc_inspections').insertMany(GSC.map(([slug, coverageState]) => ({ url: `https://guiaprogramaciontv.com/guias/${slug}`, slug, coverageState, indexingState: 'INDEXING_STATE_UNSPECIFIED', inspectedAt: new Date('2026-11-05T17:22:53.785Z') })));

  await db.collection('editorial_jobs').deleteMany({});
  await db.collection('editorial_jobs').createIndex({ jobId: 1 }, { unique: true });
  await db.collection('editorial_jobs').insertMany(JOBS.map(([jobId, slug, state, reason]) => ({ jobId, slug, state, reason: reason ?? null, startedAt: new Date(jobId.slice(0, 24)), receivedAt: new Date(now) })));

  await db.collection('editorial_job_ledger').deleteMany({});
  await db.collection('editorial_job_ledger').insertMany(LEDGER.map(([_id, jobId, slug, state]) => ({ _id, jobId, slug, state, attempt: 1, maxAttempts: 3, stages: [] })));

  await db.collection('editorial_generation_requests').deleteMany({});
  await db.collection('editorial_generation_requests').insertMany(APPROVALS.map(([createdAt, createdBy]) => ({ id: randomBytes(16).toString('hex'), kind: 'queue-action', status: 'completed', queueAction: { action: 'approve', topicId: 'cnmc-derechos-audiovisuales-accesibilidad-plataformas', reason: '' }, createdAt: new Date(createdAt), createdBy, reason: 'cnmc-derechos-audiovisuales-accesibilidad-plataformas: aprobado a mano' })));

  await db.collection('editorial_settings').updateOne({ _id: 'policy' }, { $set: { paused: false, dailyLimit: 10, activatedAt: new Date('2026-10-27T20:21:07.600Z'), activatedBy: 'Propietario' } }, { upsert: true });
  await db.collection('editorial_settings').updateOne({ _id: 'generation' }, { $set: { settings: { enabled: false, scheduleHours: 3, topicsPerCycle: 1, sourceDomains: ['netflix.com', 'hbomax.com', 'max.com', 'disneyplus.com', 'primevideo.com', 'movistarplus.es', 'movistar.es', 'dazn.com', 'apple.com', 'filmin.es', 'skyshowtime.com', 'atresplayer.com', 'rtve.es', 'mitele.es', 'laliga.com', 'uefa.com', 'rfef.es', 'boe.es', 'cnmc.es', 'fifa.com'] } } }, { upsert: true });
  await db.collection('editorial_runner').updateOne({ _id: 'current' }, { $set: { status: 'ready', capabilities: { providers: ['deepseek'], webSearch: true }, version: 'm11g-2', lastSeenAt: new Date('2026-11-06T08:11:01.776Z'), lastError: '' } }, { upsert: true });

  const summary = { queueItems: QUEUE.length, legacyPosts: LEGACY.length, gscUrls: GSC.length, jobs: JOBS.length, ledger: LEDGER.length, approvals: APPROVALS.length };
  await client.close();
  return summary;
}

/* ----------------------------------------------------------------- mongod (direct) */

async function mongoReady() {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 2000 });
  try { await c.connect(); await c.close(); return true; } catch { return false; }
}
async function runMongod() {
  if (!existsSync(MONGOD_BIN)) fail(`mongod binary not found: ${MONGOD_BIN}`);
  mkdirSync(MONGO_DATA, { recursive: true }); mkdirSync(LOGS, { recursive: true });
  const fd = openSync(join(LOGS, 'mongod.log'), 'a');
  const child = spawn(MONGOD_BIN, ['--dbpath', MONGO_DATA, '--port', String(PORTS.mongo), '--bind_ip', '127.0.0.1', '--quiet'], { detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
  child.unref(); closeSync(fd);
  log(`mongod pid ${child.pid} on ${MONGO_URI}`);
  await waitFor(mongoReady, { timeoutMs: 60_000, what: 'mongod' });
  setInterval(() => {}, 1 << 30);
}

/* ------------------------------------------------------------------- integrity */

async function runIntegrityChecks() {
  const { MongoClient } = await import('mongodb');
  const report = { checkedAt: new Date().toISOString(), data: {}, http: {}, ok: false };
  try {
    const c = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
    await c.connect();
    const db = c.db(DB_NAME);
    const queue = await db.collection('editorial_queue_snapshot').findOne({ _id: 'current' });
    const posts = await db.collection('blog_posts').find({}).toArray();
    const gsc = await db.collection('editorial_gsc_inspections').find({}).toArray();
    const jobs = await db.collection('editorial_jobs').find({}).toArray();
    const byState = {}; for (const q of queue?.items ?? []) byState[q.state] = (byState[q.state] ?? 0) + 1;
    report.data = {
      queueItems: queue?.items?.length ?? 0, queueByState: byState,
      publishedLegacy: posts.filter((p) => p.status === 'publish').length,
      hasIptvPirataPost: posts.some((p) => p.slug === 'es-ilegal-ver-futbol-iptv-pirata'),
      gscUrls: gsc.length, gscIndexed: gsc.filter((g) => g.coverageState === 'Página indexada').length,
      jobs: jobs.length, jobsBlocked: jobs.filter((j) => j.state === 'blocked').length, jobsPublished: jobs.filter((j) => j.state === 'published').length,
    };
    await c.close();
  } catch (e) { report.data = { error: e.message }; }
  const health = await httpGet(`${API_ORIGIN}/v2/health`);
  report.http.apiHealth = { status: health.status, body: (health.body || '').slice(0, 160) };
  report.ok = report.http.apiHealth.status === 200 && report.data.queueItems === 22 && report.data.publishedLegacy === 4 && report.data.jobs === 35 && report.data.gscUrls === 14 && report.data.hasIptvPirataPost === false;
  return report;
}

/* ------------------------------------------------------------------- modes */

async function waitFor(check, { timeoutMs = 120_000, what = 'condition', intervalMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last; while (Date.now() < deadline) { try { const v = await check(); if (v) return v; } catch (e) { last = e; } await sleep(intervalMs); }
  throw new Error(`timeout waiting for ${what}${last ? `: ${last.message}` : ''}`);
}
function spawnChild(name, args, env, logFile) {
  mkdirSync(LOGS, { recursive: true });
  const fd = openSync(join(LOGS, logFile), 'a');
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
  child.unref(); closeSync(fd);
  return { name, pid: child.pid };
}
function readState() { if (!existsSync(STATE_FILE)) return null; try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return null; } }

async function startAll() {
  const prev = readState(); if (prev?.services?.some((s) => isAlive(s.pid))) {
    for (const s of prev.services) { if (s.pid && isAlive(s.pid)) { if (process.platform === 'win32') spawn('taskkill', ['/PID', String(s.pid), '/T', '/F'], { stdio: 'ignore' }); } }
    await sleep(1500);
  }
  mkdirSync(ART, { recursive: true }); mkdirSync(LOGS, { recursive: true });
  const services = [];
  services.push(spawnChild('mongod', [SCRIPT, 'mongod'], {}, 'mongod-wrapper.log'));
  await waitFor(mongoReady, { timeoutMs: 60_000, what: 'mongod' });
  const seed = await seedDatabase(MONGO_URI, DB_NAME);
  log(`seeded ${JSON.stringify(seed)}`);

  // Four DISTINCT keys: admin, human review, policy, signing. None printed; only env var names.
  const keys = { ADMIN: randomBytes(24).toString('hex'), REVIEW: randomBytes(24).toString('hex'), POLICY: randomBytes(24).toString('hex'), SIGNING: randomBytes(24).toString('hex') };
  writeFileSync(ENV_FILE, `M14R7_ADMIN_KEY=${keys.ADMIN}\nM14R7_REVIEW_KEY=${keys.REVIEW}\nM14R7_POLICY_KEY=${keys.POLICY}\nM14R7_SIGNING_KEY=${keys.SIGNING}\n`, { mode: 0o600 });
  const backendEnv = {
    PORT: String(PORTS.api), MONGODB_URI: MONGO_URI, MONGODB_DB_NAME: DB_NAME,
    ANALYTICS_ADMIN_KEY: keys.ADMIN, JWT_SECRET: keys.ADMIN, JWT_REFRESH_SECRET: keys.ADMIN,
    EDITORIAL_REVIEW_KEY: keys.REVIEW, EDITORIAL_POLICY_KEY: keys.POLICY, EDITORIAL_PIPELINE_SIGNING_KEY: keys.SIGNING,
    DISABLE_SCHEDULED_JOBS: 'true', STORAGE_LOCAL_PATH: join(ART, 'storage'), CORS_ORIGIN: '*',
    DEEPSEEK_API_KEY: 'placeholder-not-a-secret', OPENAI_API_KEY: 'placeholder-not-a-secret', ANTHROPIC_API_KEY: '', TMDB_API_KEY: '', FOOTBALL_DATA_API_KEY: '', AI_API_KEY: '',
  };
  services.push(spawnChild('backend', [join(ROOT, 'apps', 'backend', 'dist', 'server', 'index.js')], backendEnv, 'backend.log'));
  const health = await waitFor(async () => { const r = await httpGet(`${API_ORIGIN}/v2/health`); return r.status === 200 ? r : false; }, { timeoutMs: 120_000, what: 'backend /v2/health' });
  log(`backend health ${health.status}`);

  // SSR (frontend): serves the admin section client-rendered; proxies /v2 to the backend.
  const ssrService = spawnChild('ssr', [join(ROOT, 'apps', 'frontend', 'scripts', 'ssr-server.mjs')], { PORT: String(PORTS.ssr), API_ORIGIN, SSR_CACHE_TTL_MS: '0' }, 'ssr.log');
  services.push(ssrService);
  const ssr = await waitFor(async () => { const r = await httpGet(`${SSR_ORIGIN}/healthz`); return r.status === 200 ? r : false; }, { timeoutMs: 120_000, what: 'ssr /healthz' });
  log(`ssr healthz ${ssr.status}`);

  writeFileSync(STATE_FILE, JSON.stringify({ startedAt: new Date().toISOString(), services: services.map((s) => ({ ...s, alive: isAlive(s.pid) })), ports: PORTS, db: DB_NAME, envFile: ENV_FILE }, null, 2));
  const report = await runIntegrityChecks();
  log(`integrity ok=${report.ok} ${JSON.stringify(report.data)}`);
  writeFileSync(join(ART, 'staging.json'), JSON.stringify({ schema: 'm14r7-staging/1', ports: PORTS, db: DB_NAME, services: services.map((s) => ({ name: s.name, pid: s.pid })), seed, checks: report }, null, 2));
}

async function stopAll() {
  const state = readState(); if (!state?.services?.length) { log('no state: nothing to stop'); return; }
  for (const s of state.services) { if (!s.pid || !isAlive(s.pid)) continue; if (process.platform === 'win32') spawn('taskkill', ['/PID', String(s.pid), '/T', '/F'], { stdio: 'ignore' }); }
  await sleep(1500); log('stopped');
}
async function status() {
  const state = readState(); if (!state) { console.log('no staging state'); return; }
  for (const s of state.services ?? []) console.log(`${s.name}: pid=${s.pid} alive=${isAlive(s.pid)}`);
  const health = await httpGet(`${API_ORIGIN}/v2/health`);
  console.log(`backend /v2/health: ${health.status}`);
}

const mode = process.argv[2] ?? 'status';
if (mode === 'mongod') runMongod();
else if (mode === 'start') startAll().catch((e) => fail('start failed', e));
else if (mode === 'stop') stopAll().catch((e) => fail('stop failed', e));
else if (mode === 'verify') runIntegrityChecks().then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 1); });
else if (mode === 'seed') seedDatabase(MONGO_URI, DB_NAME).then((s) => { console.log(JSON.stringify(s)); process.exit(0); });
else if (mode === 'status') status().catch((e) => fail('status failed', e));
else { console.log('usage: node scripts/m14r7-staging.mjs start|stop|status|verify|seed|mongod'); process.exit(2); }
