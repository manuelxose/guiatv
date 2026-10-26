#!/usr/bin/env node
// Read-only canonical-ownership measurement (M09). For every /programas/ URL in sitemap-programs.xml it asks the public
// catalogue API what the URL resolves to and whether the same work also has an indexable /peliculas|/series URL.
// Usage: node scripts/seo-ownership-audit.mjs [baseUrl] [--out file.json] [--limit N]
// Bounded: up to 3 GETs per sitemap URL, paced at ~230 requests/minute. No writes, no crawling beyond the sitemap.
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { classify } from './seo-ownership-classify.mjs';

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? 'https://guiaprogramaciontv.com').replace(/\/$/, '');
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const limit = Number(opt('--limit') ?? Infinity);

if (args.includes('--self-check')) {
  assert.equal(classify({ prog: null }), 'unresolvable');
  assert.equal(classify({ prog: { tmdbId: 1 }, movie: { tmdbId: 1, airings: 2 } }), 'duplicate-indexable-twin');
  assert.equal(classify({ prog: { tmdbId: 1 }, series: { tmdbId: 1, airings: 0 } }), 'twin-noindex');
  assert.equal(classify({ prog: { tmdbId: 1 }, movie: { tmdbId: 2, airings: 1 } }), 'tmdb-work-single-url');
  assert.equal(classify({ prog: {} }), 'programme-only');
  console.log('self-check ok');
  process.exit(0);
}

// The public API allows 300 requests/minute per client: pace below it and retry a 429, never count one as a 404.
let nextSlot = 0;
const get = async (path) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = Math.max(0, (nextSlot = Math.max(nextSlot, Date.now()) + 260) - 260 - Date.now());
    await new Promise((resolve) => setTimeout(resolve, wait));
    const r = await fetch(base + path, { signal: AbortSignal.timeout(30000) });
    if (r.status === 429) { await new Promise((resolve) => setTimeout(resolve, (Number(r.headers.get('retry-after')) || 30) * 1000)); continue; }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${path} -> ${r.status}`);
    const d = (await r.json()).data;
    return { tmdbId: d.tmdbId, airings: d.airings?.length ?? 0, contentType: d.contentType };
  }
  throw new Error(`${path} -> still rate limited`);
};
const xml = await (await fetch(`${base}/sitemap-programs.xml`)).text();
const slugs = [...xml.matchAll(/<loc>[^<]*\/programas\/([^<]+)<\/loc>/g)].map((m) => m[1]).slice(0, limit);
const rows = [];
const queue = [...slugs];
await Promise.all(Array.from({ length: 3 }, async () => {
  for (let slug = queue.shift(); slug; slug = queue.shift()) {
    const prog = await get(`/v2/catalog/slug/program/${slug}`);
    const [movie, series] = prog?.tmdbId ? await Promise.all(['movie', 'series'].map((t) => get(`/v2/catalog/slug/${t}/${slug}`))) : [null, null];
    rows.push({ slug, class: classify({ prog, movie, series }), contentType: prog?.contentType });
  }
}));
const counts = {};
for (const row of rows) counts[row.class] = (counts[row.class] ?? 0) + 1;
console.log(`sitemap-programs URLs: ${slugs.length}`, counts);
if (opt('--out')) writeFileSync(opt('--out'), JSON.stringify({ base, at: new Date().toISOString(), counts, rows }, null, 1));
