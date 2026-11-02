#!/usr/bin/env node
// Bounded internal-link graph audit (M10). Breadth-first from `/` over raw SSR HTML (no JS), so depth is the
// real minimum click depth among the pages fetched. Reports broken links, redirects, links to noindex or
// non-canonical URLs, parameterised links, anchor quality, and sitemap URLs not reached within the bound.
// It is a bounded sample, not proof a URL is orphaned site-wide: "not reached" means "not within --max pages".
//
// M10-D: `--skip-traverse <regex>` leaves a page family unexpanded (it is still recorded as a destination, class
// EXCLUDED_BY_POLICY). With `^/contenido/` the ephemeral airing pages — 91 % of the graph, `noindex`, keyed by
// airing id and gone the next day — stop consuming the budget, so the evergreen graph can be exhausted and the
// depth of every sitemap URL becomes a measured fact instead of an unknown. The scope is recorded in the output
// and narrows what the result may claim: see `reachability`.
//
// Usage: node scripts/seo-link-graph.mjs [baseUrl] [--max 1200] [--concurrency 3] [--out file.json]
//                                        [--skip-traverse '^/contenido/']
//   The graph is held in memory and nothing is written until the crawl ends, so give node room above a few
//   thousand pages: `node --max-old-space-size=8192 scripts/seo-link-graph.mjs … --max 10000`.
//        node scripts/seo-link-graph.mjs --compare before.json after.json
//        node scripts/seo-link-graph.mjs --reachability file.json [--urls urls.txt]
//        node scripts/seo-link-graph.mjs --urls-from file.json > urls.txt   (fixed population, see §B4)
//        node scripts/seo-link-graph.mjs --probe-skipped file.json [--sample 150]
//        node scripts/seo-link-graph.mjs --self-check
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
  : ENTITIES[e.toLowerCase()] ?? m));
const text = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const ASSET = /\.(?:png|jpe?g|webp|avif|gif|svg|ico|css|js|mjs|json|xml|txt|pdf|woff2?)$/i;
const GENERIC = /^(?:ver m[aá]s|m[aá]s|leer m[aá]s|m[aá]s informaci[oó]n|aqu[ií]|click|pincha aqu[ií]|ver|detalles)$/i;

/** Internal anchors of an SSR document: [{ path, query, text }] (hash dropped, assets and other hosts skipped). */
export function extractLinks(html, pageUrl, host) {
  const body = html.replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, '');
  const links = [];
  for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const raw = m[1].match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1];
    if (!raw || /^(?:mailto|tel|javascript|data):/i.test(raw) || raw.startsWith('#')) continue;
    let u;
    try { u = new URL(decode(raw), pageUrl); } catch { continue; }
    if (u.host !== host || ASSET.test(u.pathname)) continue;
    const label = m[1].match(/\baria-label\s*=\s*["']([^"']*)["']/i)?.[1];
    const alt = m[2].match(/<img[^>]+alt\s*=\s*["']([^"']*)["']/i)?.[1];
    links.push({ path: u.pathname.replace(/(.)\/$/, '$1'), query: u.search, text: text(m[2]) || decode(label ?? alt ?? '').trim() });
  }
  return links;
}

export const family = (path) => {
  const s = path.split('/').filter(Boolean);
  if (!s.length) return '/';
  if (['canales', 'programas', 'peliculas', 'series', 'contenido', 'detalles'].includes(s[0])) return s.length > 1 ? `/${s[0]}/:slug` : `/${s[0]}`;
  if (s[0] === 'guias') return s.length === 1 ? '/guias' : s[1] === 'categoria' ? '/guias/categoria/:slug' : '/guias/:slug';
  if (s[0] === 'deportes') return s.length <= 2 ? `/${s.join('/')}` : `/deportes/futbol/${s[2]}${s.length > 3 ? '/:slug' : ''}`;
  return `/${s[0]}`;
};

if (args.includes('--self-check')) {
  const html = `<a href="/canales/la-1">La 1</a><a href="https://x.test/peliculas/gladiator/?utm=a#t"><span>Gladiator</span></a>
    <a href="https://other.test/a">ext</a><a href="mailto:a@b">m</a><a href="/logo.png">i</a><a href="#top">t</a>
    <a aria-label="Ver La 2" href="/canales/la-2"><img alt="logo"></a><a href="/series/x"><img alt="Serie X"></a>
    <script>"<a href='/nope'>n</a>"</script><a href="/guias?c=1&amp;d=2">Guías &amp; m&#225;s</a>`;
  const got = extractLinks(html, 'https://x.test/', 'x.test');
  assert.deepEqual(got.map((l) => l.path), ['/canales/la-1', '/peliculas/gladiator', '/canales/la-2', '/series/x', '/guias']);
  assert.deepEqual(got.map((l) => l.text), ['La 1', 'Gladiator', 'Ver La 2', 'Serie X', 'Guías & más']);
  assert.equal(got[1].query, '?utm=a');
  assert.equal(got[4].query, '?c=1&d=2');
  assert.equal(family('/'), '/');
  assert.equal(family('/programas/chicago-pd'), '/programas/:slug');
  assert.equal(family('/guias/categoria/cine'), '/guias/categoria/:slug');
  assert.equal(family('/deportes/futbol/equipos/real-madrid'), '/deportes/futbol/equipos/:slug');
  assert.equal(family('/deportes/futbol'), '/deportes/futbol');
  assert.ok(GENERIC.test('Ver más') && !GENERIC.test('Ver La 1'));
  // Depths 0-1 fully fetched, depth 2 partly: depth <= 2 is exact, depth 3 is an upper bound, missing URLs unknown.
  const graph = { pages: { '/': { d: 0, s: 200 }, '/a': { d: 1, s: 200 }, '/b': { d: 2, s: 200 }, '/c': { d: 2 }, '/d': { d: 3 } },
    sitemap: { '/a': 's', '/b': 's', '/d': 's', '/z': 's' } };
  const r = reachability(graph);
  assert.equal(r.exactThroughDepth, 2);
  assert.deepEqual([r.within3, r.deeperThanMeasured, r.omittedByCrawlLimit, r.confirmedOrphans], [2, 1, 1, 0]);
  const fullyFetched = { ...graph, complete: true, pages: {
    ...graph.pages, '/c': { d: 2, s: 200 }, '/d': { d: 3, s: 200 },
  } };
  assert.equal(reachability(fullyFetched).confirmedOrphans, 1, 'only an exhaustive, error-free crawl confirms an orphan');
  assert.equal(reachability(graph, ['/a', '/q']).urls, 2);

  // M10-D graph semantics. A truncated crawl never produces a VERIFIED_ORPHAN, whatever else it reports.
  assert.deepEqual(r.classes, { REACHED_WITHIN_3: 2, REACHED_DEEPER: 1, VERIFIED_ORPHAN: 0, ORPHAN_IN_SCOPE: 0,
    UNMEASURED: 1, EXCLUDED_BY_POLICY: 0, TEMPORARY_FETCH_FAILURE: 0, INVALID_DESTINATION: 0 });
  assert.equal(reachability(fullyFetched).classes.VERIFIED_ORPHAN, 1);
  const failedTraversal = { ...fullyFetched, pages: { ...fullyFetched.pages, '/c': { d: 2, s: 'error fetch failed' } } };
  assert.equal(reachability(failedTraversal).classes.VERIFIED_ORPHAN, 0);
  assert.equal(reachability(failedTraversal).classes.UNMEASURED, 1, 'a failed source can hide links');
  assert.equal(reachabilityGate(reachability(failedTraversal), reachability(failedTraversal, ['/a'])).status, 'INCONCLUSIVE');
  assert.equal(reachabilityGate(reachability(graph), reachability(graph, ['/a'])).status, 'INCONCLUSIVE');
  assert.equal(reachabilityGate(reachability(fullyFetched), reachability(fullyFetched, ['/a'])).status, 'PASS');
  assert.equal(reachabilityGate(reachability(fullyFetched), reachability(fullyFetched, ['/z'])).status, 'FAIL');
  // Exhausted but with a family left unexpanded: orphaned in scope only, never "verified".
  const scoped = reachability({ ...fullyFetched, skipTraverse: '^/contenido/' });
  assert.deepEqual([scoped.classes.VERIFIED_ORPHAN, scoped.classes.ORPHAN_IN_SCOPE], [0, 1]);
  assert.equal(scoped.scope, 'excludes ^/contenido/');
  // Retryable failures, invalid destinations, cycles, redirects/aliases, duplicates and sitemap-only URLs.
  const mixed = { complete: true, skipTraverse: '^/contenido/',
    pages: { '/': { d: 0, s: 200 }, '/cycle': { d: 1, s: 200 }, '/dup': { d: 1, s: 200 },
      '/alias': { d: 1, s: 301 }, '/canonical': { d: 1, s: 200 }, '/gone': { d: 2, s: 404 },
      '/flaky': { d: 2, s: 'error fetch failed' }, '/contenido/program:1': { d: 1 }, '/deep': { d: 9, s: 200 } },
    sitemap: { '/cycle': 's', '/dup': 's', '/canonical': 's', '/gone': 's', '/flaky': 's',
      '/contenido/program:1': 's', '/deep': 's', '/never-linked': 's' } };
  assert.deepEqual(reachability(mixed).classes, { REACHED_WITHIN_3: 3, REACHED_DEEPER: 1, VERIFIED_ORPHAN: 0,
    ORPHAN_IN_SCOPE: 0, UNMEASURED: 1, EXCLUDED_BY_POLICY: 1, TEMPORARY_FETCH_FAILURE: 1, INVALID_DESTINATION: 1 });
  assert.equal(reachability(mixed).confirmedOrphans, 0);
  assert.equal(reachability({ ...fullyFetched, skipTraverse: '^/contenido/' }).scopedOrphans, 1);
  // Every sitemap URL lands in exactly one class.
  for (const g of [r, reachability(fullyFetched), reachability(failedTraversal), scoped, reachability(mixed)]) {
    assert.equal(Object.values(g.classes).reduce((a, b) => a + b, 0), g.urls, 'classes must partition the sitemap');
  }
  console.log('self-check ok');
  process.exit(0);
}

const SUMMARY_KEYS = ['fetched', 'discovered', 'brokenTargets', 'brokenLinkInstances', 'redirectTargets', 'redirectChains',
  'linkInstancesToRedirects', 'noindexTargetsLinked', 'nonCanonicalTargetsLinked', 'parameterisedTargets',
  'emptyAnchors', 'genericAnchors', 'sitemapUrls', 'sitemapReached', 'sitemapNotReached', 'programmeToWorkLinks',
  'workToProgrammeLinks', 'workToChannelLinks', 'programmeToChannelLinks', 'edgeInjectedTargets',
  'excludedByPolicy', 'fetchFailures'];

/**
 * M10-C/M10-D: reachability of the sitemap URLs from `/` in a saved crawl, without overstating it.
 *
 * Each sitemap URL gets exactly one class (`classes`), and the class says what the evidence supports:
 * - `REACHED_WITHIN_3` / `REACHED_DEEPER`: discovered by a real SSR anchor at a measured minimum click depth.
 *   Below the last fully fetched BFS level the depth is only an upper bound, so such a URL is `REACHED_DEEPER`.
 * - `INVALID_DESTINATION`: reached, but the page answers 4xx/5xx.
 * - `TEMPORARY_FETCH_FAILURE`: reached, but this crawl could not read it (network/timeout). Never an orphan.
 * - `EXCLUDED_BY_POLICY`: inside the `--skip-traverse` family, deliberately not expanded.
 * - `VERIFIED_ORPHAN`: no internal path exists. Claimed only with an exhausted, error-free full crawl.
 * - `ORPHAN_IN_SCOPE`: an error-free crawl was exhausted, but a page family was left unexpanded, so the URL is orphaned
 *   within the crawled scope only. Upgrading this to `VERIFIED_ORPHAN` needs evidence about the skipped family.
 * - `UNMEASURED`: the crawl stopped at `--max` with a frontier left; reachability is simply unknown.
 *
 * The sitemap is never an edge: it only says which URLs to look for. `urls` narrows to a fixed URL set so two
 * crawls taken at different times can be compared on the same population (§B4 temporal normalization).
 */
export function reachability(data, urls) {
  const pages = data.pages ?? {};
  const sitemap = urls ?? Object.keys(data.sitemap ?? {});
  const skip = data.skipTraverse ? new RegExp(data.skipTraverse) : undefined;
  const byDepth = new Map();
  for (const [path, p] of Object.entries(pages)) {
    // A page left unexpanded by policy was never meant to be fetched: it does not make its level incomplete.
    if (skip?.test(path)) continue;
    const level = byDepth.get(p.d) ?? { total: 0, fetched: 0 };
    level.total += 1;
    if (p.s !== undefined && p.s !== null) level.fetched += 1;
    byDepth.set(p.d, level);
  }
  // Depth d is exact while every page at depths < d was fetched (BFS is level-synchronous).
  let exactThrough = -1;
  for (let d = 0; byDepth.has(d) && byDepth.get(d).fetched === byDepth.get(d).total; d++) exactThrough = d + 1;
  const complete = data.complete === true;
  // An exhausted queue is not an exhaustive graph when a source fails: that page could contain a unique link.
  // 404/410 have no valid public page to traverse; other HTTP failures are inconclusive for traversal.
  const traversalGaps = Object.entries(pages).filter(([path, p]) => !skip?.test(path) &&
    (p.s == null || typeof p.s !== 'number' || (p.s >= 400 && p.s !== 404 && p.s !== 410))).map(([path]) => path);
  const reliable = complete && traversalGaps.length === 0 && !(data.summary?.fetchFailures > 0);
  const classes = { REACHED_WITHIN_3: 0, REACHED_DEEPER: 0, VERIFIED_ORPHAN: 0, ORPHAN_IN_SCOPE: 0,
    UNMEASURED: 0, EXCLUDED_BY_POLICY: 0, TEMPORARY_FETCH_FAILURE: 0, INVALID_DESTINATION: 0 };
  const out = { urls: sitemap.length, exactThroughDepth: exactThrough, crawlComplete: complete,
    crawlReliable: reliable, traversalGaps: traversalGaps.length,
    scope: data.skipTraverse ? `excludes ${data.skipTraverse}` : 'full', classes, measured: {}, within3: 0,
    deeperThanMeasured: 0, omittedByCrawlLimit: 0, confirmedOrphans: 0, scopedOrphans: 0,
    orphanSample: [], unknownSample: [] };
  const sample = (key, path) => { const a = key === 'orphanSample' ? out.orphanSample : out.unknownSample; if (a.length < 20) a.push(path); };
  for (const path of sitemap) {
    const p = pages[path];
    if (!p) {
      // Unreached. Which of the three it is depends on how complete the crawl was, never on the sitemap.
      if (!reliable) { classes.UNMEASURED += 1; out.omittedByCrawlLimit += 1; sample('unknownSample', path); }
      else if (skip) { classes.ORPHAN_IN_SCOPE += 1; out.scopedOrphans += 1; sample('orphanSample', path); }
      else { classes.VERIFIED_ORPHAN += 1; out.confirmedOrphans += 1; sample('orphanSample', path); }
      continue;
    }
    // Legacy depth counters (unchanged, read by --compare and CI) cover every reached URL.
    const exact = p.d <= exactThrough;
    if (exact) {
      out.measured[p.d] = (out.measured[p.d] ?? 0) + 1;
      if (p.d <= 3) out.within3 += 1;
    } else out.deeperThanMeasured += 1;
    // One class per URL. A not-yet-fetched page is still *reached* (an anchor pointed at it), so only a page
    // this crawl actually read can be reported as a failing or invalid destination.
    const unread = p.s === undefined || p.s === null;
    if (skip?.test(path)) classes.EXCLUDED_BY_POLICY += 1;
    else if (!unread && typeof p.s !== 'number') classes.TEMPORARY_FETCH_FAILURE += 1;
    else if (!unread && p.s >= 400) classes.INVALID_DESTINATION += 1;
    else if (exact && p.d <= 3) classes.REACHED_WITHIN_3 += 1;
    else classes.REACHED_DEEPER += 1;
  }
  out.beyond3 = out.urls - out.within3;
  return out;
}

/** Required-URL gate. Inconclusive evidence is never a successful verification. */
export function reachabilityGate(all, required) {
  if (!all.crawlComplete || !all.crawlReliable ||
      required.classes.UNMEASURED || required.classes.TEMPORARY_FETCH_FAILURE) {
    return { status: 'INCONCLUSIVE', exitCode: 2 };
  }
  if (required.classes.INVALID_DESTINATION ||
      required.classes.VERIFIED_ORPHAN || required.classes.ORPHAN_IN_SCOPE) {
    return { status: 'FAIL', exitCode: 1 };
  }
  return { status: 'PASS', exitCode: 0 };
}

if (args.includes('--reachability')) {
  const data = JSON.parse(readFileSync(opt('--reachability'), 'utf8'));
  const urls = opt('--urls') ? readFileSync(opt('--urls'), 'utf8').split(/\s+/).filter(Boolean) : undefined;
  const all = reachability(data, urls);
  const bySitemap = {};
  for (const file of new Set(Object.values(data.sitemap ?? {}))) {
    const subset = Object.entries(data.sitemap).filter(([, f]) => f === file).map(([p]) => p);
    const r = reachability(data, subset);
    bySitemap[file] = { urls: r.urls, within3: r.within3, deeperThanMeasured: r.deeperThanMeasured,
      omittedByCrawlLimit: r.omittedByCrawlLimit, confirmedOrphans: r.confirmedOrphans,
      scopedOrphans: r.scopedOrphans, classes: r.classes };
  }
  console.log(JSON.stringify({ at: data.at, observation: data.observation, max: data.max,
    fetched: data.summary?.fetched, ...all, bySitemap }, null, 1));
  // M10-D regression gate: a sitemap file whose URLs must all have an internal path (AC-05/AC-08). It fails only on
  // evidence — an unreached URL in an exhausted crawl — never on a crawl that simply ran out of budget.
  const gate = opt('--require-reached');
  if (gate) {
    const r = bySitemap[gate];
    if (!r) { console.error(`--require-reached: ${gate} is not in this crawl's sitemap`); process.exit(2); }
    const result = reachabilityGate(all, r);
    const reasons = { crawlComplete: all.crawlComplete, crawlReliable: all.crawlReliable,
      traversalGaps: all.traversalGaps, requiredClasses: r.classes, scope: all.scope };
    console.error(`--require-reached: ${result.status} ${gate} ${JSON.stringify(reasons)}`);
    process.exit(result.exitCode);
  }
  process.exit(0);
}

// A fixed URL population, so two crawls taken at different times are compared on the same URLs (§B4).
if (args.includes('--urls-from')) {
  const data = JSON.parse(readFileSync(opt('--urls-from'), 'utf8'));
  const entries = Object.keys(data.sitemap ?? {}).sort().join('\n') + '\n';
  const destination = opt('--out');
  if (destination) writeFileSync(destination, entries);
  else {
    process.stdout.on('error', (err) => { if (err.code === 'EPIPE') process.exit(0); throw err; });
    process.stdout.write(entries);
  }
  process.exit(0);
}

if (args.includes('--compare')) {
  const [a, b] = args.slice(args.indexOf('--compare') + 1).map((f) => JSON.parse(readFileSync(f, 'utf8')));
  console.log(`metric\tbefore (${a.at})\tafter (${b.at})`);
  for (const k of SUMMARY_KEYS) console.log(`${k}\t${a.summary[k]}\t${b.summary[k]}`);
  for (const f of new Set([...Object.keys(a.depthByFamily), ...Object.keys(b.depthByFamily)])) {
    console.log(`depth ${f}\t${JSON.stringify(a.depthByFamily[f] ?? {})}\t${JSON.stringify(b.depthByFamily[f] ?? {})}`);
  }
  process.exit(0);
}

const base = (args.find((a) => /^https?:/.test(a)) ?? 'https://guiaprogramaciontv.com').replace(/\/$/, '');
const host = new URL(base).host;
const max = Number(opt('--max', 1200));
const concurrency = Number(opt('--concurrency', 3));
const out = opt('--out');
// M10-D: pages matching this are recorded as destinations but never fetched or expanded (EXCLUDED_BY_POLICY).
const skipTraverse = opt('--skip-traverse');
const skipRe = skipTraverse ? new RegExp(skipTraverse) : undefined;

const get = async (url) => {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (compatible; guiatv-link-graph/1.0)' }, signal: AbortSignal.timeout(30000) });
    // One retry on transient upstream errors so a cold render is not reported as a broken link.
    if ((r.status === 429 || r.status >= 502) && attempt === 0) { await r.arrayBuffer(); await new Promise((ok) => setTimeout(ok, 3000)); continue; }
    return { r, body: /html|xml/.test(r.headers.get('content-type') ?? '') ? await r.text() : (await r.arrayBuffer(), '') };
  }
};
const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => decode(m[1]));
const readSitemap = async () => {
  const sitemap = new Map();
  for (const child of locs((await get(`${base}/sitemap.xml`)).body)) {
    for (const u of locs((await get(child.replace(/^https?:\/\/[^/]+/, base))).body)) sitemap.set(new URL(u).pathname.replace(/(.)\/$/, '$1'), child.split('/').pop());
  }
  if (!sitemap.size) throw new Error('sitemap returned no URLs');
  return sitemap;
};

// Re-run only the sitemap comparison against a saved crawl (no page fetches).
if (args.includes('--sitemap-check')) {
  const file = opt('--sitemap-check');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const sitemap = await readSitemap();
  const notReached = [...sitemap.keys()].filter((p) => !data.pages[p]);
  data.summary.sitemapUrls = sitemap.size;
  data.summary.sitemapNotReached = notReached.length;
  data.summary.sitemapReached = sitemap.size - notReached.length;
  data.notReached = notReached;
  data.notReachedByFamily = {};
  data.sitemapNotReachedBySitemap = {};
  for (const p of notReached) {
    data.notReachedByFamily[family(p)] = (data.notReachedByFamily[family(p)] ?? 0) + 1;
    data.sitemapNotReachedBySitemap[sitemap.get(p)] = (data.sitemapNotReachedBySitemap[sitemap.get(p)] ?? 0) + 1;
  }
  data.lowInlinkSitemap = [...sitemap.keys()].filter((p) => data.pages[p] && data.pages[p].in <= 1).map((p) => [p, data.pages[p].in, data.pages[p].d]);
  data.sitemapCheckedAt = new Date().toISOString();
  writeFileSync(file, JSON.stringify(data, null, 1));
  console.log(JSON.stringify({ sitemapUrls: sitemap.size, reached: sitemap.size - notReached.length, notReached: notReached.length, byFamily: data.notReachedByFamily, bySitemap: data.sitemapNotReachedBySitemap, lowInlink: data.lowInlinkSitemap.length }));
  process.exit(0);
}
/**
 * M10-D: what the `--skip-traverse` family actually links. An ORPHAN_IN_SCOPE URL is only orphaned within the
 * crawled scope; this samples the skipped pages of a saved crawl and reports which of those URLs they reach, so
 * a matching target is disproved as an orphan; an absent target is NOT proved orphaned by a sample.
 */
if (args.includes('--probe-skipped')) {
  const data = JSON.parse(readFileSync(opt('--probe-skipped'), 'utf8'));
  const skip = new RegExp(data.skipTraverse ?? '(?!)');
  const skipped = Object.keys(data.pages ?? {}).filter((p) => skip.test(p));
  const unreached = Object.keys(data.sitemap ?? {}).filter((p) => !data.pages?.[p]);
  const size = Math.min(Number(opt('--sample', 150)), skipped.length);
  // Evenly spaced over the discovery order, so the sample is not one corner of the guide.
  const sample = Array.from({ length: size }, (_, i) => skipped[Math.floor((i * skipped.length) / size)]);
  const reached = new Set();
  const byFamily = {};
  let failures = 0;
  const queue = [...sample];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let p; (p = queue.shift()); ) {
      try {
        const { r, body } = await get(base + p);
        if (r.status !== 200) { failures += 1; continue; }
        for (const l of extractLinks(body, base + p, host)) {
          if (l.query || skip.test(l.path)) continue;
          byFamily[family(l.path)] = (byFamily[family(l.path)] ?? 0) + 1;
          reached.add(l.path);
        }
      } catch { failures += 1; }
    }
  }));
  const rescued = unreached.filter((p) => reached.has(p));
  console.log(JSON.stringify({ skipTraverse: data.skipTraverse, skippedPages: skipped.length, sampled: size,
    failures, distinctDestinations: reached.size, destinationsByFamily: byFamily,
    unreachedSitemapUrls: unreached.length, reachedBySampledSkippedPages: rescued.length,
    sample: rescued.slice(0, 20) }, null, 1));
  process.exit(0);
}

const attr = (html, re) => { const v = html.match(re)?.[1]; return v === undefined ? undefined : decode(v).trim(); };

const pages = new Map(); // path -> { depth, status?, location?, robots?, canonical?, out?: [path] }
const inlinks = new Map(); // path -> Set(source path)
// M10-D: only the first ANCHOR_TEXTS distinct texts per destination are kept. The report asks whether a
// destination is linked under many different anchors, which 5 already answers; keeping every text made the
// crawler hold a string per link instance and run out of heap at a few thousand pages.
const ANCHOR_TEXTS = 5;
const anchors = new Map(); // path -> Set(text), capped
const params = new Set();
let emptyAnchors = 0, genericAnchors = 0;
// M10-C: Cloudflare's email obfuscation rewrites `mailto:` anchors at the edge into `/cdn-cgi/l/email-protection#…`.
// The origin HTML has no such link and the URL is not a page of the site: counted apart, never as a broken page.
const edgeInjected = new Map(); // path -> Set(source path)

const visit = async (path) => {
  const page = pages.get(path);
  try {
    const { r, body } = await get(base + path);
    page.status = r.status;
    page.location = r.headers.get('location') ?? undefined;
    const meta = attr(body, /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']+)/i);
    page.robots = [meta, r.headers.get('x-robots-tag')].filter(Boolean).join(' | ') || undefined;
    page.canonical = attr(body, /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)/i);
    if (r.status >= 300 && r.status < 400 && page.location) {
      const to = new URL(page.location, base + path);
      if (to.host === host) return [{ path: to.pathname.replace(/(.)\/$/, '$1'), depth: page.depth }];
      return [];
    }
    if (r.status !== 200) return [];
    const seen = new Set();
    for (const l of extractLinks(body, base + path, host)) {
      if (!l.text) emptyAnchors++; else if (GENERIC.test(l.text)) genericAnchors++;
      if (l.path.startsWith('/cdn-cgi/')) { (edgeInjected.get(l.path) ?? edgeInjected.set(l.path, new Set()).get(l.path)).add(path); continue; }
      if (l.query) { params.add(l.path + l.query); continue; }
      if (l.path === path || seen.has(l.path)) continue;
      seen.add(l.path);
      (inlinks.get(l.path) ?? inlinks.set(l.path, new Set()).get(l.path)).add(path);
      const a = anchors.get(l.path) ?? anchors.set(l.path, new Set()).get(l.path);
      if (a.size < ANCHOR_TEXTS) a.add(l.text);
    }
    page.out = [...seen];
    return page.out.map((p) => ({ path: p, depth: page.depth + 1 }));
  } catch (e) {
    page.status = `error ${e.message}`;
    return [];
  }
};

// Level-synchronous BFS so a page's recorded depth is its minimum click depth from `/`.
const startedAt = new Date();
let level = ['/'];
pages.set('/', { depth: 0 });
let fetched = 0;
while (level.length && fetched < max) {
  const batch = level.splice(0, max - fetched);
  fetched += batch.length;
  const next = [];
  const queue = [...batch];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let p; (p = queue.shift()); ) next.push(...await visit(p));
  }));
  // M10-D: `splice` already left this level's unfetched remainder in `level`, and it stays there. Clearing it
  // discarded the frontier when `--max` cut a level in half, so a truncated crawl whose last batch happened to
  // discover nothing new ended with an empty frontier and reported `complete: true` — which is what licenses a
  // VERIFIED_ORPHAN. Depths stay correct because each page carries the depth it was discovered at.
  // A redirect target keeps the redirecting URL's depth (no extra click) but is fetched one pass later.
  for (const n of next) {
    if (pages.has(n.path)) continue;
    pages.set(n.path, { depth: n.depth });
    if (!skipRe?.test(n.path)) level.push(n.path);
  }
  console.error(`depth done, fetched ${fetched}, next level ${level.length}`);
}
const excludedByPolicy = skipRe ? [...pages.keys()].filter((p) => skipRe.test(p)).length : 0;

const sitemap = await readSitemap();

const done = [...pages].filter(([, p]) => p.status !== undefined);
const isBroken = (p) => typeof p.status !== 'number' || p.status >= 400;
const isRedirect = (p) => p.status >= 300 && p.status < 400;
const linkCount = (path) => inlinks.get(path)?.size ?? 0;
const canonicalPath = (p) => { try { return new URL(p.canonical).pathname.replace(/(.)\/$/, '$1'); } catch { return undefined; } };
const sumLinks = (pred) => done.reduce((n, [src, p]) => n + (p.out ?? []).filter((dst) => pred(src, dst)).length, 0);
const fam = (re) => (p) => re.test(p);
const isProg = fam(/^\/programas\/[^/]+$/), isWork = fam(/^\/(?:peliculas|series)\/[^/]+$/), isChannel = fam(/^\/canales\/[^/]+$/);

const broken = done.filter(([, p]) => isBroken(p));
const redirects = done.filter(([, p]) => isRedirect(p));
const chains = redirects.filter(([, p]) => { const t = pages.get(new URL(p.location, base).pathname.replace(/(.)\/$/, '$1')); return t && isRedirect(t); });
const noindex = done.filter(([path, p]) => p.status === 200 && /noindex/i.test(p.robots ?? '') && linkCount(path));
const nonCanonical = done.filter(([path, p]) => p.status === 200 && p.canonical && canonicalPath(p) !== path && linkCount(path));
const notReached = [...sitemap.keys()].filter((p) => !pages.has(p));

const depthByFamily = {};
for (const [path, p] of pages) { const d = (depthByFamily[family(path)] ??= {}); d[p.depth] = (d[p.depth] ?? 0) + 1; }
const notReachedByFamily = {};
for (const p of notReached) notReachedByFamily[family(p)] = (notReachedByFamily[family(p)] ?? 0) + 1;
// ">= 4 of the first ANCHOR_TEXTS distinct texts": enough to show a destination linked under varying anchors.
const inconsistentAnchors = [...anchors].filter(([, t]) => t.size >= 4).map(([p, t]) => [p, [...t]]).slice(0, 25);
const lowInlinkSitemap = [...sitemap.keys()].filter((p) => pages.has(p) && linkCount(p) <= 1).map((p) => [p, linkCount(p), pages.get(p).depth]);
// M10-B: minimum click depth of each sitemap URL ('>3' = not discovered within three clicks), per sitemap file.
const depthBucket = (p) => { const d = pages.get(p)?.depth; return d === undefined || d > 3 ? '>3' : String(d); };
const sitemapByDepth = {};
for (const [p, file] of sitemap) { const b = (sitemapByDepth[file] ??= { 0: 0, 1: 0, 2: 0, 3: 0, '>3': 0 }); b[depthBucket(p)] += 1; }

const summary = {
  fetched: done.length,
  discovered: pages.size,
  brokenTargets: broken.length,
  brokenLinkInstances: broken.reduce((n, [p]) => n + linkCount(p), 0),
  redirectTargets: redirects.length,
  redirectChains: chains.length,
  linkInstancesToRedirects: redirects.reduce((n, [p]) => n + linkCount(p), 0),
  noindexTargetsLinked: noindex.length,
  nonCanonicalTargetsLinked: nonCanonical.length,
  parameterisedTargets: params.size,
  emptyAnchors,
  genericAnchors,
  sitemapUrls: sitemap.size,
  sitemapReached: sitemap.size - notReached.length,
  sitemapNotReached: notReached.length,
  programmeToWorkLinks: sumLinks((s, d) => isProg(s) && isWork(d)),
  workToProgrammeLinks: sumLinks((s, d) => isWork(s) && isProg(d)),
  workToChannelLinks: sumLinks((s, d) => isWork(s) && isChannel(d)),
  programmeToChannelLinks: sumLinks((s, d) => isProg(s) && isChannel(d)),
  edgeInjectedTargets: edgeInjected.size,
  excludedByPolicy,
  fetchFailures: done.filter(([, p]) => typeof p.status !== 'number').length,
};

// M10-D observation context: EPG-driven links change through the day, so a comparison is only meaningful against
// the window it was taken in. A crawl of thousands of SSR pages spans a good part of an hour, so the window is the
// evidence, not one instant. Madrid is the schedule's own day boundary (the read model rebuilds at 00:15 local).
const observedAt = new Date();
const madrid = (d) => d.toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' });
const observation = {
  at: observedAt.toISOString(),
  startedAt: startedAt.toISOString(),
  madridWindow: `${madrid(startedAt)} .. ${madrid(observedAt)}`,
  elapsedMinutes: Math.round((observedAt - startedAt) / 60000),
  epgDay: observedAt.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }),
  epgDayAtStart: startedAt.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }),
  scope: skipTraverse ? `excludes ${skipTraverse}` : 'full',
  frontierLeft: level.length,
  budgetSpent: `${fetched}/${max}`,
  // Exhausted means two things: nothing left to follow *and* the budget was not the reason we stopped. A crawl
  // that spent its whole budget is never known to be exhausted, and only an exhausted crawl licenses an orphan.
  crawlComplete: level.length === 0 && fetched < max,
};

console.log(JSON.stringify({ observation, ...summary }, null, 1));
console.log('depth by family', JSON.stringify(depthByFamily));
console.log('sitemap not reached by family', JSON.stringify(notReachedByFamily));
console.log('sitemap URLs by click depth', JSON.stringify(sitemapByDepth));
const show = (label, rows) => { console.log(`${label}: ${rows.length}`); for (const r of rows.slice(0, 12)) console.log('  ', JSON.stringify(r)); };
show('edge-injected (Cloudflare, not origin links)', [...edgeInjected].map(([p, from]) => [p, [...from].slice(0, 5)]));
show('broken', broken.map(([p, x]) => [p, x.status, linkCount(p), [...(inlinks.get(p) ?? [])][0]]));
show('redirects', redirects.map(([p, x]) => [p, x.status, x.location, linkCount(p)]));
show('redirect chains', chains.map(([p, x]) => [p, x.location]));
show('noindex linked', noindex.map(([p, x]) => [p, x.robots, linkCount(p)]));
show('non-canonical linked', nonCanonical.map(([p, x]) => [p, x.canonical, linkCount(p)]));
show('parameterised', [...params]);
show('inconsistent anchors (>=4 texts)', inconsistentAnchors);
show('sitemap URLs with <=1 inlink in sample', lowInlinkSitemap);
show('sitemap not reached', notReached);

if (out) {
  writeFileSync(out, JSON.stringify({
    base, at: observation.at, observation, max, concurrency, skipTraverse, summary, depthByFamily, notReachedByFamily,
    broken: broken.map(([p, x]) => ({ path: p, status: x.status, from: [...(inlinks.get(p) ?? [])].slice(0, 5) })),
    edgeInjected: [...edgeInjected].map(([p, from]) => ({ path: p, from: [...from].slice(0, 5) })),
    redirects: redirects.map(([p, x]) => ({ path: p, status: x.status, location: x.location, inlinks: linkCount(p) })),
    noindexLinked: noindex.map(([p, x]) => ({ path: p, robots: x.robots, inlinks: linkCount(p) })),
    nonCanonicalLinked: nonCanonical.map(([p, x]) => ({ path: p, canonical: x.canonical, inlinks: linkCount(p) })),
    parameterised: [...params], inconsistentAnchors, lowInlinkSitemap, notReached, sitemapByDepth,
    complete: observation.crawlComplete, sitemap: Object.fromEntries(sitemap),
    pages: Object.fromEntries([...pages].map(([p, x]) => [p, { d: x.depth, s: x.status, in: linkCount(p), out: x.out?.length }])),
  }, null, 1));
}
