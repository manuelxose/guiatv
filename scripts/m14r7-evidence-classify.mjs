#!/usr/bin/env node
/**
 * M14-R7 — Clasificación individual de los 19 fallos de evidencia (insufficient-evidence).
 * Lee los datos de producción ya capturados (tmp-storage/m14r7/prod-probe3.txt) y produce
 * artifacts/m14r7/evidence-classification.json + resumen por clase.
 *
 * Clases (contrato): url-rota · http-recuperacion · documento-javascript · extraccion-pobre ·
 * relevancia-incorrecta · cobertura-insuficiente · independencia-requerida · falta-real.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = process.env.M14R7_PROBE3 || 'C:/Users/Admin/Documents/workspace/guiatv/tmp-storage/m14r7/prod-probe3.txt';

// Clasificación por tema (slug, clase, detalle observado en prod-probe3).
const CLASSIFIED = [
  ['compartir-cuenta-netflix-hogar-normas', 'documento-javascript', 'netflix node 8/11 + netflix termsofuse "página sin texto legible (¿SPA?)": la segunda fuente es una SPA sin SSR, no aporta texto'],
  ['derecho-desistimiento-suscripciones-streaming-espana', 'extraccion-pobre', 'boe 6/10 + netflix 2/10 + primevideo 1/10: texto recuperado pero baja coincidencia de términos con el tema'],
  ['minutos-publicidad-planes-con-anuncios-streaming', 'url-rota', 'disneyplus.com/es-es/help HTTP 404 (además netflix 3/10 y primevideo 1/10)'],
  ['reglamento-var-laliga-como-funciona', 'url-rota', 'rfef.es/es/arbitros HTTP 404 + laliga.com/es-ES/var HTTP 404 (fifa 4/8)'],
  ['normas-estadio-entradas-reventa-laliga', 'url-rota', 'laliga.com/es-ES/clubes HTTP 404 (boe 5/9)'],
  ['apple-tv-airplay-ajustes-imagen-television', 'independencia-requerida', 'una sola entidad editora entre las fuentes semilla (support.apple.com ×2): hacen falta dos editores independientes'],
  ['descargar-series-peliculas-netflix-disneyplus', 'documento-javascript', 'disneyplus-downloads "página sin texto legible (¿SPA?)" + disneyplus-supported-devices HTTP 0 (netflix 5/13)'],
  ['ajustar-calidad-reproduccion-datos-netflix-disneyplus', 'url-rota', 'netflix node/10084 HTTP 404 + disneyplus-video-quality SPA (netflix 6/13)'],
  ['requisitos-ver-4k-uhd-hdr-netflix-disneyplus', 'http-recuperacion', 'disneyplus-supported-devices HTTP 0 + disneyplus-video-quality SPA (netflix 8/11)'],
  ['ver-netflix-apple-tv-plus-airplay', 'url-rota', 'support.apple.com HT202180 HTTP 404 + HT207057 HTTP 404 (netflix 7/12)'],
  ['ver-canales-tdt-directo-internet-rtve-mitele-atresplayer', 'documento-javascript', 'atresplayer.com/directos "página sin texto legible (¿SPA?)" (rtve 4/9, mitele 1/9)'],
  ['cambiar-idioma-subtitulos-netflix-disneyplus', 'url-rota', 'netflix node/14189 HTTP 404 + netflix node/10084 HTTP 404 + disneyplus-subtitles HTTP 0'],
  ['copa-del-rey-2026-27-rfef-rtve', 'extraccion-pobre', 'rfef 1/11 + rtve 2/11 + rtve 4/11: una sola entidad editora con texto poco coincidente'],
  ['formato-champions-league-2026-27-uefa', 'url-rota', 'uefa.com format HTTP 404 (dos URLs de uefa) (rtve 6/11)'],
  ['cancelar-netflix-prime-video-espana', 'url-rota', 'primevideo help?nodeId=G202029060 HTTP 404 + disneyplus-cancel HTTP 0 (netflix 5/10)'],
  ['cambiar-contrasena-netflix-prime-video', 'url-rota', 'primevideo help?nodeId=G202025230 HTTP 404 + disneyplus-password HTTP 0 (netflix 2/10)'],
  ['canjear-tarjetas-regalo-netflix-disney', 'http-recuperacion', 'disneyplus-gift-card HTTP 0 (netflix 4/8): una fuente no recuperable y solo dos candidatas'],
  ['gestionar-perfiles-netflix-disney', 'documento-javascript', 'disneyplus-profiles "página sin texto legible (¿SPA?)" (netflix 3/10)'],
  ['decidir-edad-recomendada-peliculas-series', 'relevancia-incorrecta', 'boe 5/8 + cnmc 1/8: la fuente CNMC puntúa 1/8 aun siendo fuente primaria autoritativa del tema'],
];

const CLASS_LABELS = {
  'url-rota': 'URL rota (HTTP 404 en la fuente semilla)',
  'http-recuperacion': 'Problema HTTP de recuperación (HTTP 0 / sin respuesta)',
  'documento-javascript': 'Documento renderizado por JavaScript (SPA sin texto legible)',
  'extraccion-pobre': 'Extracción de texto pobre (baja coincidencia de términos)',
  'relevancia-incorrecta': 'Puntuación de relevancia incorrecta (fuente autoritativa mal puntuada)',
  'cobertura-insuficiente': 'Cobertura de afirmaciones insuficiente',
  'independencia-requerida': 'Independencia de fuentes genuinamente requerida (un solo editor)',
  'falta-real': 'Falta real de evidencia (no hay fuente oficial que sostenga la afirmación)',
};

const byClass = {};
for (const [, cls] of CLASSIFIED) byClass[cls] = (byClass[cls] ?? 0) + 1;

const report = {
  schema: 'm14r7-evidence-classification/1',
  generatedAt: new Date().toISOString(),
  source: PROBE,
  totalInsufficientEvidence: CLASSIFIED.length,
  byClass: Object.fromEntries(Object.entries(byClass).sort((a, b) => b[1] - a[1])),
  classLabels: CLASS_LABELS,
  topics: CLASSIFIED.map(([slug, cls, evidence]) => ({ slug, class: cls, classLabel: CLASS_LABELS[cls], evidence })),
};

const outFile = join(ROOT, 'artifacts', 'm14r7', 'evidence-classification.json');
writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ total: report.totalInsufficientEvidence, byClass: report.byClass }, null, 2));
console.log(`escrito en artifacts/m14r7/evidence-classification.json`);
