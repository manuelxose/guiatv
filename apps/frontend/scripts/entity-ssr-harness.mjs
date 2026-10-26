// Test harness shared by the entity SSR tests and the entity Playwright spec: the real SSR entrypoint on a free
// loopback port in front of a fake API that answers /v2/entities/resolve from a table of pages.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

/** Starts the production SSR entrypoint on a free loopback port against `backendOrigin`. */
export async function launchSsr(backendOrigin) {
  // Obtain a free loopback port before starting the existing production SSR entrypoint.
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const proc = spawn(process.execPath, ['scripts/ssr-server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), API_ORIGIN: backendOrigin, SSR_API_BASE_URL: backendOrigin },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  proc.stdout.on('data', chunk => { output = (output + chunk).slice(-8000); });
  proc.stderr.on('data', chunk => { output = (output + chunk).slice(-8000); });
  const where = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (proc.exitCode !== null) throw new Error(`SSR exited ${proc.exitCode}: ${output}`);
    try { if ((await fetch(`${where}/healthz`)).ok) break; } catch { /* Startup only. */ }
    await delay(100);
  }
  return { origin: where, proc, logs: () => output, stop: async () => { if (proc.exitCode === null) { proc.kill('SIGTERM'); await once(proc, 'exit'); } } };
}

/** The public entity shape the API returns for an enriched, certified film (apps/backend `entities.enriched.test` pins it). */
export function entityFixture(over = {}) {
  return {
    entityId: 'ce_0000000000000000000000000A', kind: 'movie', title: 'La cura del bienestar', canonicalPath: '/peliculas/la-cura-del-bienestar', originalTitle: 'A Cure for Wellness', year: 2017,
    synopsis: 'Un joven ejecutivo viaja a un centro de bienestar en los Alpes suizos. Pronto sospecha que los milagrosos tratamientos que allí tienen lugar no son lo que parecen.',
    genres: ['Terror', 'Misterio'], runtimeMinutes: 147,
    images: { poster: 'https://image.tmdb.org/t/p/w500/k4XZ47wFZF1aUv7bjLM4Pae2TYm.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/uXx9wjfJEzLlfqB8GW67SYBrhVT.jpg' },
    credits: { directors: ['Gore Verbinski'], cast: [{ name: 'Dane DeHaan', character: 'Lockhart' }, { name: 'Jason Isaacs', character: 'Volmer' }, { name: 'Mia Goth', character: 'Hannah' }] },
    attribution: { source: 'tmdb', updatedAt: '2026-10-21T23:15:00.000Z', notice: 'Datos e imágenes de TMDB. Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB.' },
    broadcasts: { status: 'ok', generatedAt: new Date().toISOString(), timeZone: 'Europe/Madrid', items: [
      { airingId: 'a1', channel: { id: 'amc', name: 'AMC', path: '/canales/amc' }, programmeTitle: 'La cura del bienestar', start: '2027-01-10T01:30:00.000Z', end: '2027-01-10T03:50:00.000Z', startLocal: '2027-01-10T02:30:00+01:00', localDate: '2027-01-10', localTime: '02:30', durationMinutes: 140 },
      { airingId: 'a2', channel: { id: 'la_1', name: 'La 1', path: '/canales/la-1' }, programmeTitle: 'La cura del bienestar (2017)', start: '2027-01-13T20:00:00.000Z', end: '2027-01-13T22:20:00.000Z', startLocal: '2027-01-13T21:00:00+01:00', localDate: '2027-01-13', localTime: '21:00', durationMinutes: 140 },
    ] }, ...over,
  };
}

/**
 * `pages` maps a request path to an entity (200), or to `{ status, code }` for an error answer. Anything else is a
 * 404 ENTITY_NOT_FOUND (`{ status: 404, code: 'ENTITY_PUBLIC_READ_DISABLED' }` is the legacy fallback signal). `api` adds exact-path answers; the rest answers 404.
 */
export async function startBackend(pages, api = {}) {
  const backend = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Content-Type', 'application/json');
    // Other API answers by exact path (Phase 3E: the legacy catalogue payload). A function is called with the request; `{ status, code }` is an error.
    const other = api[url.pathname];
    if (other !== undefined) {
      const body = typeof other === 'function' ? other(url) : other;
      if (body && body.status) { res.writeHead(body.status); res.end(JSON.stringify({ success: false, error: { code: body.code } })); return; }
      res.writeHead(200); res.end(JSON.stringify({ success: true, data: body })); return;
    }
    const hit = url.pathname === '/v2/entities/resolve' ? pages[url.searchParams.get('path')] : undefined;
    if (hit && hit.status) { res.writeHead(hit.status); res.end(JSON.stringify({ success: false, error: { code: hit.code } })); return; }
    res.writeHead(hit ? 200 : 404);
    res.end(JSON.stringify(hit ? { success: true, data: hit } : { success: false, error: { code: 'ENTITY_NOT_FOUND' } }));
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  return {
    origin: `http://127.0.0.1:${backend.address().port}`,
    stop: async () => { backend.closeAllConnections(); await new Promise((resolve) => backend.close(resolve)); },
  };
}
