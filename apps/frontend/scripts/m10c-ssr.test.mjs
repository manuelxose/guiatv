// M10-C. Build first: npm run build:ssr; then node --test scripts/m10c-ssr.test.mjs.
// The compiled SSR bundle in front of a fake API, without client JavaScript: a verified second-feed channel answers a
// 301 to its channel; a channel whose name ends in "TV" stays a page with its own canonical; the fallback rail of an
// airing page has crawlable anchors and none to an unverified work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchSsr, startBackend } from './entity-ssr-harness.mjs';

const hrefs = (html) => [...html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]);
const canonical = (html) => [...html.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((m) => m[1]);
const robots = (html) => html.match(/<meta name="robots" content="([^"]*)"/)?.[1];

async function withSsr(api, fn) {
  const backend = await startBackend({}, api);
  const ssr = await launchSsr(backend.origin);
  try { await fn(ssr); } finally { await ssr.stop(); await backend.stop(); }
}

const channel = (id, name, sourceIds) => ({ id, name, normalizedName: id, aliases: [id], sourceIds, group: 'autonomico', type: 'Autonomico' });
const surface = (ch, extra = {}) => ({ date: '2026-10-29', channel: ch, tonightItems: [], scheduleItems: [], relatedChannels: [],
  meta: { totalItems: 0, generatedAt: new Date().toISOString() }, ...extra });

test('M10-C: a verified second-feed channel page is a 301 to its channel; a channel named "… TV" stays a page', { timeout: 120000 }, async () => {
  const telemadridTv = channel('telemadrid_tv', 'Telemadrid.TV', ['telemadrid_tv', 'Telemadrid.TV']);
  const aragonTv = channel('aragon_tv', 'Aragón TV', ['aragon_tv', 'aragontv_es', 'AragonTV.es']);
  await withSsr({
    '/v2/tv/surface/channels/telemadrid-tv': surface(telemadridTv, { canonicalChannel: { id: 'telemadrid', name: 'Telemadrid', normalizedName: 'telemadrid' } }),
    '/v2/tv/surface/channels/telemadrid_tv': surface(telemadridTv, { canonicalChannel: { id: 'telemadrid', name: 'Telemadrid', normalizedName: 'telemadrid' } }),
    '/v2/tv/surface/channels/aragon-tv': surface(aragonTv),
    '/v2/tv/surface/channels/aragon_tv': surface(aragonTv), // the page asks with the channel id form
  }, async (ssr) => {
    const alias = await fetch(`${ssr.origin}/canales/telemadrid-tv`, { redirect: 'manual' });
    assert.equal(alias.status, 301, ssr.logs());
    assert.equal(alias.headers.get('location'), '/canales/telemadrid');
    // The day filter survives, and the underscore form reaches the channel in one hop.
    const tomorrow = await fetch(`${ssr.origin}/canales/telemadrid-tv?dia=manana`, { redirect: 'manual' });
    assert.equal(tomorrow.headers.get('location'), '/canales/telemadrid?dia=manana');
    const underscore = await fetch(`${ssr.origin}/canales/telemadrid_tv`, { redirect: 'manual' });
    assert.equal(underscore.status, 301);
    assert.equal(underscore.headers.get('location'), '/canales/telemadrid');

    const own = await fetch(`${ssr.origin}/canales/aragon-tv`, { redirect: 'manual' });
    const html = await own.text();
    assert.equal(own.status, 200, ssr.logs());
    assert.deepEqual(canonical(html), ['https://guiaprogramaciontv.com/canales/aragon-tv']);
    assert.match(robots(html) ?? '', /^index, follow/);
  });
});

test('M10-C: API unavailable for a "-tv" slug: the page renders as before, never a guessed redirect', { timeout: 60000 }, async () => {
  await withSsr({ '/v2/tv/surface/channels/sx3-tv': { status: 503, code: 'UNAVAILABLE' } }, async (ssr) => {
    const r = await fetch(`${ssr.origin}/canales/sx3-tv`, { redirect: 'manual' });
    assert.notEqual(r.status, 301, ssr.logs());
    assert.equal(r.headers.get('location'), null);
  });
});

test('M10-C: airing fallback rail in the server HTML links verified work pages and airing pages only', { timeout: 60000 }, async () => {
  const detailPath = '/contenido/program:m10c-film';
  const film = { catalogId: 'program:m10c-film', source: 'program', contentType: 'movie', title: 'Ben-Hur', slug: 'ben-hur', detailPath,
    genres: ['Drama'], primaryPlatforms: [], airings: [], channel: { id: 'la_1', name: 'La 1', normalizedName: 'la_1' } };
  const airing = (id, title, workPath) => ({ catalogId: `program:${id}`, source: 'program', contentType: 'movie', title, slug: title,
    detailPath: `/contenido/program:${id}`, workPath, genres: ['Drama'], primaryPlatforms: [] });
  const popular = { catalogId: 'tmdb:movie:7', source: 'tmdb', contentType: 'movie', title: 'Spider-Man', slug: 'spider-man-brand-new-day',
    detailPath: '/peliculas/spider-man-brand-new-day', genres: ['Drama'], tmdbId: 7, primaryPlatforms: [] };
  const query = { items: [popular, airing('v1', 'Gladiator', '/peliculas/gladiator'), airing('u1', 'Modern Family')], meta: { page: 1, limit: 8, total: 3, hasMore: false } };
  await withSsr({
    '/v2/catalog/program%3Am10c-film': film,
    '/v2/content/program%3Am10c-film': film,
    '/v2/catalog': query,
  }, async (ssr) => {
    const r = await fetch(`${ssr.origin}${detailPath}`);
    const html = await r.text();
    assert.equal(r.status, 200, ssr.logs());
    const links = hrefs(html);
    assert.ok(links.includes('/peliculas/gladiator'), links.join(' '));
    assert.ok(links.includes('/contenido/program:u1'), links.join(' '));
    assert.ok(!links.includes('/peliculas/spider-man-brand-new-day'), 'no TMDB-search slug in the rail');
  });
});
