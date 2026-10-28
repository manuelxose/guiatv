// Phase 3E. Build first: npm run build:ssr; then node --test scripts/legacy-enrichment-ssr.test.mjs.
// The compiled SSR bundle renders one legacy film page from a fake catalogue API three ways (no enrichment, verified
// enrichment, unreadable schedule). The SEO surface (status, robots header and meta, canonical, title, description) must be
// identical in all three; only the body gains content, and a hostile title cannot break out of the JSON-LD.
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchSsr, startBackend } from './entity-ssr-harness.mjs';

const SLUG = 'la-cura-del-bienestar';
const fixtureNow = Date.now();
const hours = (n) => new Date(fixtureNow + n * 3_600_000).toISOString();
const airing = (channelId, at) => ({ channelId, channelName: channelId.toUpperCase(), start: hours(at), end: hours(at + 2), title: 'La cura del bienestar', catalogId: `program:${channelId}`, detailPath: `/peliculas/${SLUG}` });
const broadcast = (channelId, at, title = 'La cura del bienestar') => ({
  airingId: `b-${channelId}`, channel: { id: channelId, name: channelId.toUpperCase(), path: `/canales/${channelId}` }, programmeTitle: title,
  start: hours(at), end: hours(at + 2), startLocal: hours(at).replace('Z', '+00:00'), localDate: hours(at).slice(0, 10), localTime: '21:30', durationMinutes: 120,
});
const legacy = (enrichment) => ({
  catalogId: 'tmdb:movie:340837', source: 'tmdb', contentType: 'movie', title: 'La cura del bienestar', slug: SLUG, detailPath: `/peliculas/${SLUG}`,
  synopsis: 'Texto editorial propio de la ficha.', genres: [], tmdbId: 340837, releaseYear: 2016, primaryPlatforms: [],
  airings: [airing('amc', 30), airing('tcm', 50)], ...(enrichment ? { enrichment } : {}),
});
const verified = (extra = {}) => ({
  version: 1,
  metadata: { originalTitle: 'A Cure for Wellness', runtimeMinutes: 147, genres: ['Terror'] },
  broadcasts: { status: 'ok', windowDays: 7, generatedAt: new Date().toISOString(), timeZone: 'Europe/Madrid', items: [broadcast('amc', 30), broadcast('la_1', 80)] },
  attribution: { notice: 'Datos e imágenes de TMDB. Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB.', updatedAt: '2026-10-01T00:00:00.000Z' },
  ...extra,
});

async function render(payload) {
  const backend = await startBackend(
    { [`/peliculas/${SLUG}`]: { status: 404, code: 'ENTITY_PUBLIC_READ_DISABLED' } },
    { [`/v2/catalog/slug/movie/${SLUG}`]: payload }
  );
  const ssr = await launchSsr(backend.origin);
  try {
    const response = await fetch(`${ssr.origin}/peliculas/${SLUG}`);
    const html = await response.text();
    return { response, html, logs: ssr.logs() };
  } finally {
    await ssr.stop();
    await backend.stop();
  }
}

const surface = ({ response, html }) => ({
  status: response.status,
  xRobots: response.headers.get('x-robots-tag'),
  robots: html.match(/<meta name="robots" content="([^"]*)"/)?.[1],
  canonical: [...html.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((m) => m[1]),
  title: html.match(/<title>([^<]*)<\/title>/)?.[1],
  description: html.match(/<meta name="description" content="([^"]*)"/)?.[1],
});
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => [JSON.parse(m[1])].flat());

test('verified enrichment adds content to the legacy page and changes nothing SEO-relevant', { timeout: 120000 }, async () => {
  const plain = await render(legacy());
  const enriched = await render(legacy(verified()));
  const unreadable = await render(legacy(verified({ broadcasts: { status: 'unavailable', windowDays: 7, generatedAt: new Date().toISOString(), timeZone: 'Europe/Madrid', items: [] } })));

  assert.equal(plain.response.status, 200, plain.logs);
  assert.match(plain.html, /index, follow/, 'the legacy page with airings is indexable');
  assert.deepEqual(surface(enriched), surface(plain));
  assert.deepEqual(surface(unreadable), surface(plain));
  assert.equal(surface(enriched).canonical.length, 1);

  // Plain: untouched legacy schedule. Enriched: shared broadcast list, original title, attribution, legacy-only airing kept.
  assert.match(plain.html, /<app-entity-broadcast-list/);
  assert.match(enriched.html, /<app-entity-broadcast-list/);
  assert.match(enriched.html, /href="\/canales\/amc"/);
  assert.match(enriched.html, /href="\/canales\/la_1"|href="\/canales\/la-1"/);
  assert.match(enriched.html, /Título original: <\/span><i[^>]*>A Cure for Wellness/);
  assert.match(enriched.html, /Texto editorial propio de la ficha\./);
  assert.match(enriched.html, /themoviedb\.org/);
  assert.match(enriched.html, /TCM/, 'a legacy airing the verification did not confirm is still listed');
  assert.match(enriched.html, /<time[^>]*datetime=/);
  assert.match(unreadable.html, /<app-entity-broadcast-list/);

  const movies = jsonLd(enriched.html).filter((d) => d['@type'] === 'Movie');
  assert.equal(movies.length, 1, 'one Movie entity per page');
  assert.equal(movies[0].alternateName, 'A Cure for Wellness');
  assert.equal(movies[0].publication.length, 2);
  assert.equal(jsonLd(plain.html).filter((d) => d['@type'] === 'Movie').length, 1);
});

test('a hostile title cannot break out of the structured data or the markup', { timeout: 60000 }, async () => {
  const hostile = '</script><img src=x onerror=alert(1)>';
  const { html, response } = await render(legacy(verified({ metadata: { originalTitle: hostile }, broadcasts: { status: 'ok', windowDays: 7, generatedAt: new Date().toISOString(), timeZone: 'Europe/Madrid', items: [broadcast('amc', 30, hostile)] } })));
  assert.equal(response.status, 200);
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.doesNotMatch(html, /<\/script><img/);
  assert.doesNotThrow(() => jsonLd(html));
});

test('known programme IDs render without guessed slugs or redirect loops and stay noindex', { timeout: 60000 }, async () => {
  const detailPath = '/contenido/program:m05-fixture';
  const payload = { ...legacy(), catalogId: 'program:m05-fixture', source: 'program', detailPath };
  const backend = await startBackend({}, {
    '/v2/catalog/program%3Am05-fixture': payload,
    '/v2/content/program%3Am05-fixture': payload,
  });
  const ssr = await launchSsr(backend.origin);
  try {
    const response = await fetch(`${ssr.origin}${detailPath}`);
    const html = await response.text();
    assert.equal(response.status, 200, ssr.logs());
    assert.match(html, /La cura del bienestar/);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, follow');
    assert.match(html, /<meta name="robots" content="noindex, follow"/);
    assert.match(html, /<link rel="canonical" href="https:\/\/guiaprogramaciontv.com\/contenido\/program:m05-fixture"/);
    const encoded = await fetch(`${ssr.origin}/contenido/program%3Am05-fixture`, { redirect: 'manual' });
    assert.equal(encoded.status, 301);
    assert.equal(encoded.headers.get('location'), detailPath);
    const missing = await fetch(`${ssr.origin}/contenido/program%3Am05-missing`);
    assert.equal(missing.status, 404);
  } finally { await ssr.stop(); await backend.stop(); }
});

test('M09-D: verified works without broadcasts render index with one self canonical; thin and ambiguous stay noindex, follow', { timeout: 120000 }, async () => {
  const work = (contentType, slug, disposition, robots) => ({
    ...legacy(), catalogId: `tmdb:${contentType === 'movie' ? 'movie' : 'tv'}:1`, contentType, slug, title: slug, detailPath: `/${contentType === 'movie' ? 'peliculas' : 'series'}/${slug}`,
    airings: [], seo: { disposition, applied: true, canonicalPath: `/${contentType === 'movie' ? 'peliculas' : 'series'}/${slug}`, ...(robots ? { robots } : {}) },
  });
  const paths = ['/peliculas/sin-emision', '/series/serie-sin-emision', '/peliculas/ficha-pobre', '/peliculas/homonimo'];
  const backend = await startBackend(Object.fromEntries(paths.map((p) => [p, { status: 404, code: 'ENTITY_PUBLIC_READ_DISABLED' }])), {
    '/v2/catalog/slug/movie/sin-emision': work('movie', 'sin-emision', 'indexable'),
    '/v2/catalog/slug/series/serie-sin-emision': work('series', 'serie-sin-emision', 'indexable'),
    '/v2/catalog/slug/movie/ficha-pobre': work('movie', 'ficha-pobre', 'thin', 'noindex, follow'),
    '/v2/catalog/slug/movie/homonimo': work('movie', 'homonimo', 'ambiguous', 'noindex, follow'),
  });
  const ssr = await launchSsr(backend.origin);
  try {
    for (const [path, indexable] of paths.map((p, i) => [p, i < 2])) {
      const response = await fetch(`${ssr.origin}${path}`, { redirect: 'manual' });
      const s = surface({ response, html: await response.text() });
      assert.equal(s.status, 200, `${path} ${ssr.logs()}`);
      assert.deepEqual(s.canonical, [`https://guiaprogramaciontv.com${path}`], path);
      if (indexable) {
        assert.match(s.robots, /^index, follow/, path);
        assert.doesNotMatch(s.xRobots ?? '', /noindex/, path);
      } else {
        assert.equal(s.robots, 'noindex, follow', path);
        assert.equal(s.xRobots, 'noindex, follow', path);
      }
    }
  } finally { await ssr.stop(); await backend.stop(); }
});

test('the confirmed EPG film misclassified as a series redirects to its verified movie route', { timeout: 60000 }, async () => {
  const backend = await startBackend({}, {
    '/v2/catalog/slug/movie/camino-a-la-perdicion': legacy(),
  });
  const ssr = await launchSsr(backend.origin);
  try {
    const response = await fetch(`${ssr.origin}/series/camino-a-la-perdicion`, { redirect: 'manual' });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/peliculas/camino-a-la-perdicion');
  } finally { await ssr.stop(); await backend.stop(); }
});
