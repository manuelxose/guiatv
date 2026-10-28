// M10-B. Build first: npm run build:ssr; then node --test scripts/m10b-links-ssr.test.mjs.
// The compiled SSR bundle, in front of a fake catalogue API, with no client JavaScript: the links M10-B adds are plain
// anchors in the server HTML, and canonical, meta robots and X-Robots-Tag agree for an unverified programme identity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchSsr, startBackend } from './entity-ssr-harness.mjs';

const hrefs = (html) => [...html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]);
const canonical = (html) => [...html.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((m) => m[1]);
const robots = (html) => html.match(/<meta name="robots" content="([^"]*)"/)?.[1];
const base = { genres: [], primaryPlatforms: [], synopsis: 'Tres familias emparentadas en Los Ángeles.', airings: [] };
const relatedWork = (id, slug) => ({ ...base, catalogId: `tmdb:tv:${id}`, source: 'tmdb', contentType: 'series', title: slug, slug, detailPath: `/series/${slug}`, tmdbId: id });

async function withSsr(entityPaths, api, fn) {
  const backend = await startBackend(Object.fromEntries(entityPaths.map((p) => [p, { status: 404, code: 'ENTITY_PUBLIC_READ_DISABLED' }])), api);
  const ssr = await launchSsr(backend.origin);
  try { await fn(ssr); } finally { await ssr.stop(); await backend.stop(); }
}

test('M10-B: Modern Family. The unverified programme page is noindex, follow with its own canonical; the work page stays index', { timeout: 120000 }, async () => {
  const programme = { ...base, catalogId: 'program:20261028_comedy_central_x', source: 'program', contentType: 'series', title: 'Modern Family', slug: 'modern-family',
    detailPath: '/contenido/program:20261028_comedy_central_x', tmdbId: 1421, channel: { id: 'comedy_central', name: 'Comedy Central', normalizedName: 'comedy-central' },
    airings: [{ channelId: 'comedy_central', channelName: 'Comedy Central', start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 5_400_000).toISOString(),
      title: 'Modern Family', catalogId: 'program:20261028_comedy_central_x', detailPath: '/contenido/program:20261028_comedy_central_x' }],
    seo: { disposition: 'ambiguous', applied: true, canonicalPath: '/programas/modern-family', robots: 'noindex, follow' } };
  const work = { ...base, catalogId: 'tmdb:tv:1421', source: 'tmdb', contentType: 'series', title: 'Modern Family', slug: 'modern-family', detailPath: '/series/modern-family',
    tmdbId: 1421, enrichmentPending: true, programmePath: '/programas/modern-family', seo: { disposition: 'indexable', applied: true, canonicalPath: '/series/modern-family' } };
  await withSsr(['/programas/modern-family', '/series/modern-family'], {
    '/v2/catalog/slug/program/modern-family': programme,
    '/v2/catalog/slug/series/modern-family': work,
    '/v2/catalog/tmdb%3Atv%3A1421/enrichment': { related: [relatedWork(2, 'malcolm'), relatedWork(3, 'friends')] },
  }, async (ssr) => {
    const p = await fetch(`${ssr.origin}/programas/modern-family`);
    const ph = await p.text();
    assert.equal(p.status, 200, ssr.logs());
    assert.equal(robots(ph), 'noindex, follow');
    assert.equal(p.headers.get('x-robots-tag'), 'noindex, follow');
    assert.deepEqual(canonical(ph), ['https://guiaprogramaciontv.com/programas/modern-family'], 'no canonical asserted to the work');
    assert.ok(!hrefs(ph).includes('/series/modern-family'), 'no "ficha completa" link without a verified workPath');
    assert.ok(hrefs(ph).includes('/canales/comedy-central') && hrefs(ph).includes('/programas/modern-family#emisiones'), 'EPG navigation kept');

    const w = await fetch(`${ssr.origin}/series/modern-family`);
    const wh = await w.text();
    assert.equal(w.status, 200, ssr.logs());
    assert.match(robots(wh), /^index, follow/);
    assert.doesNotMatch(w.headers.get('x-robots-tag') ?? '', /noindex/);
    assert.deepEqual(canonical(wh), ['https://guiaprogramaciontv.com/series/modern-family']);
    // The rail is server-rendered from the API's verified works, never from a popular-titles query.
    assert.ok(hrefs(wh).includes('/series/malcolm') && hrefs(wh).includes('/series/friends'), hrefs(wh).join(' '));
    assert.ok(hrefs(wh).includes('/programas/modern-family'), 'schedule link to the self-canonical programme page kept');
  });
});

test('M10-B: an airing page links its standalone programme page in the server HTML', { timeout: 60000 }, async () => {
  const detailPath = '/contenido/program:m10b-fixture';
  const airing = { ...base, catalogId: 'program:m10b-fixture', source: 'program', contentType: 'program', title: 'La revuelta', slug: 'la-revuelta', detailPath,
    programmePath: '/programas/la-revuelta', channel: { id: 'la_1', name: 'La 1', normalizedName: 'la-1' } };
  await withSsr([], { '/v2/catalog/program%3Am10b-fixture': airing, '/v2/content/program%3Am10b-fixture': airing }, async (ssr) => {
    const r = await fetch(`${ssr.origin}${detailPath}`);
    const html = await r.text();
    assert.equal(r.status, 200, ssr.logs());
    assert.ok(hrefs(html).includes('/programas/la-revuelta'), hrefs(html).join(' '));
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, follow', 'the airing page itself stays out of the index');
  });
});
