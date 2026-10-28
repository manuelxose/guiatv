// node --test apps/frontend/scripts/ssr-cache.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSsrCache, isEditorialPath, isLivePath } from './ssr-cache.mjs';

const MIN = 60_000;
const setup = () => {
  let t = 0;
  const cache = createSsrCache({ ttlMs: 5 * MIN, staleMs: (p) => (isLivePath(p) ? 10 : 30) * MIN, maxEntries: 3, now: () => t });
  return { cache, tick: (ms) => (t += ms) };
};
const page = (robots = 'index, follow') => `<html><meta name="robots" content="${robots}"></html>`;

test('fresh, then stale until the window, then gone; "on now" pages get the short window', () => {
  const { cache, tick } = setup();
  cache.settle('/guias', { statusCode: 200, html: page(), cacheable: true });
  cache.settle('/programacion-tv/en-directo', { statusCode: 200, html: page(), cacheable: true });
  assert.equal(cache.get('/guias').stale, false);
  tick(6 * MIN);
  assert.equal(cache.get('/guias').stale, true);
  assert.equal(cache.get('/programacion-tv/en-directo').stale, true);
  tick(5 * MIN); // 11 min
  assert.equal(cache.get('/programacion-tv/en-directo'), null, 'live page older than 10 min must not be served');
  assert.equal(cache.get('/guias').stale, true);
  tick(20 * MIN); // 31 min
  assert.equal(cache.get('/guias'), null);
  for (const p of ['/', '/programacion-tv/que-ver-hoy', '/canales/la-1', '/deportes/futbol/partidos-hoy']) assert.ok(isLivePath(p), p);
  for (const p of ['/guias', '/peliculas/x', '/programacion-tv/peliculas', '/canales']) assert.ok(!isLivePath(p), p);
});

test('a confirmed change replaces or evicts a stale 200; a 5xx keeps it', () => {
  const { cache, tick } = setup();
  const stale = (path) => {
    cache.settle(path, { statusCode: 200, html: page(), cacheable: true });
    tick(6 * MIN);
    assert.equal(cache.get(path).stale, true);
  };
  stale('/peliculas/a'); // now redirects
  cache.settle('/peliculas/a', { statusCode: 301, cacheable: false });
  assert.equal(cache.get('/peliculas/a'), null, 'stale 200 survived a 301');

  stale('/peliculas/b'); // removed: rendered 404 page (cacheable)
  cache.settle('/peliculas/b', { statusCode: 404, html: page('noindex, nofollow'), cacheable: true });
  assert.deepEqual({ ...cache.get('/peliculas/b') }, { statusCode: 404, html: page('noindex, nofollow'), stale: false });

  stale('/peliculas/c'); // removed: plain 410, not stored
  cache.settle('/peliculas/c', { statusCode: 410, cacheable: false });
  assert.equal(cache.get('/peliculas/c'), null, 'stale 200 survived a 410');

  stale('/series/d'); // indexing policy changed to noindex
  cache.settle('/series/d', { statusCode: 200, html: page('noindex, follow'), cacheable: true });
  assert.equal(cache.get('/series/d').html, page('noindex, follow'));

  stale('/series/e'); // refresh failed: the stale copy stays until its window ends
  cache.settle('/series/e', { statusCode: 503, html: 'fallback', cacheable: false });
  assert.equal(cache.get('/series/e').statusCode, 200);
  tick(25 * MIN);
  assert.equal(cache.get('/series/e'), null, 'a failing page must not be served stale forever');
});

test('refreshOnce: one refresh per path under concurrency; failure and timeout release it', async () => {
  const { cache } = setup();
  let runs = 0;
  let finish;
  const slow = () => {
    runs++;
    return new Promise((r) => (finish = r));
  };
  const started = Array.from({ length: 20 }, () => cache.refreshOnce('/', slow));
  assert.equal(started.filter(Boolean).length, 1);
  await new Promise(setImmediate);
  assert.equal(runs, 1, 'twenty concurrent stale hits must start one refresh');
  assert.equal(cache.refreshOnce('/canales', async () => undefined), true, 'other paths are independent');
  finish();
  await new Promise(setImmediate);

  assert.equal(cache.refreshOnce('/', async () => Promise.reject(new Error('render failed'))), true, 'recovers after success');
  await new Promise(setImmediate);
  assert.equal(cache.refreshOnce('/', async () => undefined), true, 'a failed refresh does not block the next one');
});

test('bounded size: oldest entry goes first', () => {
  const { cache } = setup();
  for (const p of ['/a', '/b', '/c', '/d']) cache.settle(p, { statusCode: 200, html: 'x', cacheable: true });
  assert.equal(cache.get('/a'), null);
  assert.ok(cache.get('/d'));
});

test('clear drops every rendered page (a rollout state change never serves a mixed set)', () => {
  const { cache } = setup();
  cache.settle('/peliculas/a', { statusCode: 200, html: page(), cacheable: true });
  cache.settle('/series/b', { statusCode: 200, html: page(), cacheable: true });
  cache.clear();
  assert.equal(cache.get('/peliculas/a'), null);
  assert.equal(cache.get('/series/b'), null);
});

test('an editorial change drops only listing and guide pages (M11-F)', () => {
  const { cache } = setup();
  for (const p of ['/guias', '/canales/la-1', '/peliculas/a']) cache.settle(p, { statusCode: 200, html: page(), cacheable: true });
  cache.clear(isEditorialPath);
  assert.equal(cache.get('/guias'), null, 'the guide hub must show a new publication');
  assert.ok(cache.get('/canales/la-1') && cache.get('/peliculas/a'), 'unrelated pages keep their cache');
  for (const p of ['/', '/guias', '/guias/x', '/guias/categoria/television', '/deportes/futbol/noticias']) assert.ok(isEditorialPath(p), p);
  for (const p of ['/canales/la-1', '/guiasx', '/programas/x']) assert.ok(!isEditorialPath(p), p);
});
