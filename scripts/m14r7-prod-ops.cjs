#!/usr/bin/env node
/**
 * M14-R7 — Operaciones controladas en PRODUCCIÓN (lecturas de diagnóstico y escrituras acotadas).
 * Lee las claves de ~/.guiatv/runner.env; nunca imprime el valor de ninguna credencial.
 *
 *   node scripts/m14r7-prod-ops.cjs read
 *   node scripts/m14r7-prod-ops.cjs topic <id>
 *   node scripts/m14r7-prod-ops.cjs fixslug <id> <nuevo-slug>
 *   node scripts/m14r7-prod-ops.cjs retry <id>
 *   node scripts/m14r7-prod-ops.cjs publish <postId> [clave]
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const BASE = process.env.M14R7_BASE || 'https://guiaprogramaciontv.com';

function loadEnv() {
  const out = {};
  const file = path.join(os.homedir(), '.guiatv', 'runner.env');
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const ENV = loadEnv();
const HEADERS = { 'content-type': 'application/json', 'x-admin-key': ENV.ANALYTICS_ADMIN_KEY || '' };

async function call(method, urlPath, body, extra = {}) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: { ...HEADERS, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* respuesta no JSON */ }
  return { status: res.status, json, text: text.slice(0, 300) };
}

const brief = (v) => JSON.stringify(v).slice(0, 320);

(async () => {
  const [mode, a, b] = process.argv.slice(2);
  if (!ENV.ANALYTICS_ADMIN_KEY) {
    console.error('falta ANALYTICS_ADMIN_KEY en ~/.guiatv/runner.env');
    process.exit(2);
  }

  if (!mode || mode === 'read') {
    const s = await call('GET', '/v2/admin/editorial/flow/scheduler');
    console.log('scheduler', s.status, brief(s.json?.data?.generation ?? s.json));
    const r = await call('GET', '/v2/admin/editorial/flow/reconciliation');
    console.log('reconciliation', r.status, 'legacy records =', r.json?.data?.count);
    return;
  }

  if (mode === 'topic') {
    const t = await call('GET', `/v2/admin/editorial/flow/topic/${encodeURIComponent(a)}`);
    console.log('topic', t.status, brief(t.json?.data ?? t.json));
    return;
  }

  if (mode === 'fixslug') {
    const r = await call('POST', `/v2/admin/editorial/flow/recovery/${encodeURIComponent(a)}`, { action: 'fix-slug', slug: b });
    console.log('fix-slug', r.status, brief(r.json?.data ?? r.json));
    return;
  }

  if (mode === 'retry') {
    const r = await call('POST', `/v2/admin/editorial/flow/recovery/${encodeURIComponent(a)}`, { action: 'replace-source' });
    console.log('retry', r.status, brief(r.json?.data ?? r.json));
    return;
  }

  if (mode === 'publish') {
    const key = b || `m14r7-${Date.now()}`;
    const human = ENV.EDITORIAL_REVIEW_KEY;
    if (!human) {
      console.error('sin EDITORIAL_REVIEW_KEY no se publica (fail-closed correcto)');
      process.exit(2);
    }
    for (const label of ['publish', 'publish-again']) {
      const r = await call('POST', `/v2/admin/editorial/flow/publication/${encodeURIComponent(a)}/now`, { idempotencyKey: key }, { 'x-editorial-review-key': human });
      console.log(label, r.status, brief(r.json?.data ?? r.json));
    }
    return;
  }

  console.error(`modo desconocido: ${mode}`);
  process.exit(2);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
