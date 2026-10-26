#!/usr/bin/env node
// Read-only programme-page quality classifier (M11-A). For every /programas/ URL in sitemap-programs.xml it records what
// the page serves (status, robots, canonical), what the public API knows (upcoming airings, synopsis, TMDB twin), and the
// crawl depth from the M10 link graph, then derives a treatment recommendation (A-D, or E for an engineering defect).
// Usage: node scripts/programme-page-quality.mjs [baseUrl] [--out file.json] [--limit N] [--graph file.json] | --self-check
// Bounded: up to 5 GETs per sitemap URL (page, programme API, movie/series twins, workPath twin), paced at ~230/minute.
import { readFileSync, writeFileSync } from 'node:fs';
import { classify } from './seo-ownership-classify.mjs';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? 'https://guiaprogramaciontv.com').replace(/\/$/, '');
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const limit = Number(opt('--limit') ?? Infinity);


export const THRESHOLDS = {
  minDescriptionWords: 20, // below this the page is a schedule stub: the synopsis cannot carry its own search intent
  recurringAirings: 4, // a programme without TMDB identity airing this often in the today/tomorrow window is a strip/bulletin
};
// Titles that name a slot rather than a work (title start). Only applied without a TMDB identity: a work called "Noticias de un secuestro" is not a slot.
const GENERIC = /^(telediario|informativo|noticias|teletienda|televenta|telecompra|cierre de emisi[oó]n|fin de emisi[oó]n|programaci[oó]n|avance|el tiempo|tiempo|meteo|misa|sorteo|loter[ií]a|tarot|videoclips?|m[uú]sica|minuto|resumen)\b/i;

export const words = (s) => (s ?? '').trim().split(/\s+/).filter(Boolean).length;
export const isGeneric = (title) => GENERIC.test((title ?? '').trim());

/** First matching rule wins; returns [treatment, reason]. Reasons are the evidence quoted in the report. */
export function treat(r, t = THRESHOLDS) {
  if (r.status !== 200) return ['E', `served ${r.status}`];
  if (/noindex/i.test(r.robots)) return ['E', 'sitemap URL serves noindex'];
  if (r.canonical !== r.url) return ['E', `canonical ${r.canonical ?? 'missing'}`];
  if (r.ownership === 'duplicate-indexable-twin') {
    // Both URLs are proven to be one work; a missing reverse link is a navigation gap M10 already intends to close.
    if (r.linksToWork !== r.workLinksBack) return ['C', r.linksToWork ? 'twin does not link back' : 'programme does not link its twin'];
    return ['D', r.linksToWork ? 'indexable twin, linked both ways' : 'indexable twin, not linked by the site'];
  }
  if (r.upcoming === 0) return ['B', 'no upcoming airing'];
  if (!r.tmdbId && isGeneric(r.title)) return ['B', 'generic slot title'];
  if (!r.tmdbId && r.airings >= t.recurringAirings) return ['B', `recurring (${r.airings} airings, no TMDB identity)`];
  if (r.descWords < t.minDescriptionWords) return ['B', r.descWords ? `short description (${r.descWords} words)` : 'no description'];
  if (r.descDuplicateOf?.length) return ['B', 'description identical to another programme'];
  return ['A', 'upcoming schedule + distinctive description'];
}

if (args.includes('--self-check')) {
  const ok = { status: 200, robots: 'index, follow', url: 'u', canonical: 'u', ownership: 'programme-only', upcoming: 1, airings: 1, title: 'Malas lenguas', descWords: 30 };
  assert.equal(classify({ prog: { tmdbId: 1 }, movie: { tmdbId: 1, airings: 2 } }), 'duplicate-indexable-twin');
  assert.equal(treat(ok)[0], 'A');
  assert.equal(treat({ ...ok, status: 404 })[0], 'E');
  assert.equal(treat({ ...ok, robots: 'noindex, nofollow' })[0], 'E');
  assert.equal(treat({ ...ok, canonical: 'v' })[0], 'E');
  assert.equal(treat({ ...ok, ownership: 'duplicate-indexable-twin', linksToWork: true, workLinksBack: true })[0], 'D');
  assert.equal(treat({ ...ok, ownership: 'duplicate-indexable-twin', linksToWork: false, workLinksBack: false })[0], 'D');
  assert.equal(treat({ ...ok, ownership: 'duplicate-indexable-twin', linksToWork: true, workLinksBack: false })[0], 'C');
  assert.equal(treat({ ...ok, upcoming: 0 })[0], 'B');
  assert.equal(treat({ ...ok, title: 'Telediario 2' })[0], 'B');
  assert.equal(treat({ ...ok, title: 'Noticias de un secuestro', tmdbId: 7 })[0], 'A');
  assert.equal(treat({ ...ok, airings: 4 })[0], 'B');
  assert.equal(treat({ ...ok, airings: 4, tmdbId: 7 })[0], 'A');
  assert.equal(treat({ ...ok, descWords: 0 })[1], 'no description');
  assert.equal(treat({ ...ok, descDuplicateOf: ['x'] })[0], 'B');
  assert.equal(words('  una  frase corta '), 3);
  console.log('self-check ok');
  process.exit(0);
}

// The public API allows 300 requests/minute per client: pace below it, honour 429 Retry-After, retry a transient 5xx.
let nextSlot = 0;
const req = async (path, init) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = Math.max(0, (nextSlot = Math.max(nextSlot, Date.now()) + 260) - 260 - Date.now());
    await new Promise((resolve) => setTimeout(resolve, wait));
    const r = await fetch(base + path, { ...init, signal: AbortSignal.timeout(30000) });
    if (r.status === 429 || (r.status >= 500 && attempt < 2)) {
      await new Promise((resolve) => setTimeout(resolve, (Number(r.headers.get('retry-after')) || (r.status === 429 ? 30 : 5)) * 1000));
      continue;
    }
    return r;
  }
  throw new Error(`${path} -> still rate limited`);
};
const api = async (path) => {
  const r = await req(path);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return (await r.json()).data;
};
const slim = (d) => d && { tmdbId: d.tmdbId, airings: d.airings?.length ?? 0, programmePath: d.programmePath };
const attr = (html, re) => html.match(re)?.[1]?.replace(/&amp;/g, '&');

const graph = JSON.parse(readFileSync(opt('--graph') ?? new URL('../artifacts/m10/link-graph-rebuilt.json', import.meta.url), 'utf8'));
const xml = await (await fetch(`${base}/sitemap-programs.xml`)).text();
const slugs = [...xml.matchAll(/<loc>[^<]*\/programas\/([^<]+)<\/loc>/g)].map((m) => m[1]).slice(0, limit);
const runAt = new Date();
const rows = [];
const queue = [...slugs];
await Promise.all(Array.from({ length: 3 }, async () => {
  for (let slug = queue.shift(); slug; slug = queue.shift()) {
    const path = `/programas/${slug}`;
    const page = await req(path, { redirect: 'manual' });
    const html = page.status === 200 ? await page.text() : '';
    const prog = await api(`/v2/catalog/slug/program/${slug}`);
    let [movie, series] = prog?.tmdbId ? (await Promise.all(['movie', 'series'].map((t) => api(`/v2/catalog/slug/${t}/${slug}`)))).map(slim) : [null, null];
    // M09 only looked for a twin at the same slug; a verified workPath can point at a different one.
    const wp = prog?.workPath?.match(/^\/(peliculas|series)\/(.+)$/);
    if (wp && wp[2] !== slug) {
      const twin = slim(await api(`/v2/catalog/slug/${wp[1] === 'peliculas' ? 'movie' : 'series'}/${wp[2]}`));
      if (wp[1] === 'peliculas') movie = twin; else series = twin;
    }
    const twin = [movie, series].find((t) => t?.tmdbId && t.tmdbId === prog?.tmdbId);
    const upcoming = (prog?.airings ?? []).filter((a) => new Date(a.end) > runAt);
    const node = graph.pages[path];
    rows.push({
      slug,
      url: base + path,
      status: page.status,
      robots: [attr(html, /<meta name="robots" content="([^"]*)"/), page.headers.get('x-robots-tag')].filter(Boolean).join(' | ') || null,
      canonical: attr(html, /<link rel="canonical" href="([^"]*)"/) ?? null,
      ownership: classify({ prog: slim(prog), movie, series }),
      title: prog?.title ?? null,
      contentType: prog?.contentType ?? null,
      tmdbId: prog?.tmdbId ?? null,
      airings: prog?.airings?.length ?? 0,
      upcoming: upcoming.length,
      channels: [...new Set(upcoming.map((a) => a.channelName))],
      synopsis: prog?.synopsis ?? '',
      descWords: words(prog?.synopsis),
      workPath: prog?.workPath ?? null,
      linksToWork: Boolean(prog?.workPath && twin),
      workLinksBack: twin?.programmePath === path,
      depth: node ? node.d : 'not reached',
      inlinks: node?.in ?? 0,
    });
  }
}));

// Duplication is only knowable once every synopsis is in hand.
const bySynopsis = new Map();
for (const r of rows) if (r.descWords) bySynopsis.set(r.synopsis.trim().toLowerCase(), [...(bySynopsis.get(r.synopsis.trim().toLowerCase()) ?? []), r.slug]);
const counts = { treatment: {}, reason: {}, ownership: {}, depth: {}, signal: { upcoming0: 0, noDescription: 0, shortDescription: 0, duplicateDescription: 0, generic: 0, linksToWork: 0, workLinksBack: 0 } };
const inc = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
for (const r of rows.sort((a, b) => a.slug.localeCompare(b.slug))) {
  r.descDuplicateOf = (bySynopsis.get(r.synopsis.trim().toLowerCase()) ?? []).filter((s) => s !== r.slug);
  [r.treatment, r.reason] = treat(r);
  r.synopsis = r.synopsis.slice(0, 160); // evidence excerpt; the full text stays on the page
  inc(counts.treatment, r.treatment); inc(counts.reason, `${r.treatment}: ${r.reason.replace(/\d+/g, 'n')}`);
  inc(counts.ownership, r.ownership); inc(counts.depth, r.depth);
  const s = counts.signal;
  s.upcoming0 += r.upcoming === 0; s.noDescription += r.descWords === 0; s.shortDescription += r.descWords > 0 && r.descWords < THRESHOLDS.minDescriptionWords;
  s.duplicateDescription += r.descDuplicateOf.length > 0; s.generic += !r.tmdbId && isGeneric(r.title); s.linksToWork += r.linksToWork; s.workLinksBack += r.workLinksBack;
}
console.log(`sitemap-programs URLs: ${slugs.length}`, JSON.stringify(counts, null, 1));
if (opt('--out')) writeFileSync(opt('--out'), JSON.stringify({ base, at: runAt.toISOString(), graph: graph.at, thresholds: THRESHOLDS, generic: GENERIC.source, counts, rows }, null, 1));
