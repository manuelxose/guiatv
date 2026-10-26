#!/usr/bin/env node
// Bounded internal-link graph audit (M10). Breadth-first from `/` over raw SSR HTML (no JS), so depth is the
// real minimum click depth among the pages fetched. Reports broken links, redirects, links to noindex or
// non-canonical URLs, parameterised links, anchor quality, and sitemap URLs not reached within the bound.
// It is a bounded sample, not proof a URL is orphaned site-wide: "not reached" means "not within --max pages".
// Usage: node scripts/seo-link-graph.mjs [baseUrl] [--max 1200] [--concurrency 3] [--out file.json]
//        node scripts/seo-link-graph.mjs --compare before.json after.json
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
  console.log('self-check ok');
  process.exit(0);
}

const SUMMARY_KEYS = ['fetched', 'discovered', 'brokenTargets', 'brokenLinkInstances', 'redirectTargets', 'redirectChains',
  'linkInstancesToRedirects', 'noindexTargetsLinked', 'nonCanonicalTargetsLinked', 'parameterisedTargets',
  'emptyAnchors', 'genericAnchors', 'sitemapUrls', 'sitemapReached', 'sitemapNotReached', 'programmeToWorkLinks',
  'workToProgrammeLinks', 'workToChannelLinks', 'programmeToChannelLinks'];

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

const get = async (url) => {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (compatible; guiatv-link-graph/1.0)' }, signal: AbortSignal.timeout(30000) });
    // One retry on transient upstream errors so a cold render is not reported as a broken link.
    if ((r.status === 429 || r.status >= 502) && attempt === 0) { await r.arrayBuffer(); await new Promise((ok) => setTimeout(ok, 3000)); continue; }
    return { r, body: r.headers.get('content-type')?.includes('html') ? await r.text() : (await r.arrayBuffer(), '') };
  }
};
const attr = (html, re) => { const v = html.match(re)?.[1]; return v === undefined ? undefined : decode(v).trim(); };

const pages = new Map(); // path -> { depth, status?, location?, robots?, canonical?, out?: [[path, text]] }
const inlinks = new Map(); // path -> Set(source path)
const anchors = new Map(); // path -> Map(text -> count)
const params = new Set();
let emptyAnchors = 0, genericAnchors = 0;

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
    const seen = new Map();
    for (const l of extractLinks(body, base + path, host)) {
      if (!l.text) emptyAnchors++; else if (GENERIC.test(l.text)) genericAnchors++;
      if (l.query) { params.add(l.path + l.query); continue; }
      if (l.path === path || seen.has(l.path)) continue;
      seen.set(l.path, l.text);
      (inlinks.get(l.path) ?? inlinks.set(l.path, new Set()).get(l.path)).add(path);
      const a = anchors.get(l.path) ?? anchors.set(l.path, new Map()).get(l.path);
      a.set(l.text, (a.get(l.text) ?? 0) + 1);
    }
    page.out = [...seen];
    return page.out.map(([p]) => ({ path: p, depth: page.depth + 1 }));
  } catch (e) {
    page.status = `error ${e.message}`;
    return [];
  }
};

// Level-synchronous BFS so a page's recorded depth is its minimum click depth from `/`.
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
  level = [];
  // A redirect target keeps the redirecting URL's depth (no extra click) but is fetched one pass later.
  for (const n of next) if (!pages.has(n.path)) { pages.set(n.path, { depth: n.depth }); level.push(n.path); }
  console.error(`depth done, fetched ${fetched}, next level ${level.length}`);
}

const sitemap = new Map();
const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => decode(m[1]));
for (const child of locs((await get(`${base}/sitemap.xml`)).body)) {
  for (const u of locs((await get(child.replace(/^https?:\/\/[^/]+/, base))).body)) sitemap.set(new URL(u).pathname.replace(/(.)\/$/, '$1'), child.split('/').pop());
}

const done = [...pages].filter(([, p]) => p.status !== undefined);
const isBroken = (p) => typeof p.status !== 'number' || p.status >= 400;
const isRedirect = (p) => p.status >= 300 && p.status < 400;
const linkCount = (path) => inlinks.get(path)?.size ?? 0;
const canonicalPath = (p) => { try { return new URL(p.canonical).pathname.replace(/(.)\/$/, '$1'); } catch { return undefined; } };
const sumLinks = (pred) => done.reduce((n, [src, p]) => n + (p.out ?? []).filter(([dst]) => pred(src, dst)).length, 0);
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
const inconsistentAnchors = [...anchors].filter(([, m]) => m.size >= 4).map(([p, m]) => [p, [...m.keys()].slice(0, 6)]).slice(0, 25);
const lowInlinkSitemap = [...sitemap.keys()].filter((p) => pages.has(p) && linkCount(p) <= 1).map((p) => [p, linkCount(p), pages.get(p).depth]);

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
};

console.log(JSON.stringify(summary, null, 1));
console.log('depth by family', JSON.stringify(depthByFamily));
console.log('sitemap not reached by family', JSON.stringify(notReachedByFamily));
const show = (label, rows) => { console.log(`${label}: ${rows.length}`); for (const r of rows.slice(0, 12)) console.log('  ', JSON.stringify(r)); };
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
    base, at: new Date().toISOString(), max, summary, depthByFamily, notReachedByFamily,
    broken: broken.map(([p, x]) => ({ path: p, status: x.status, from: [...(inlinks.get(p) ?? [])].slice(0, 5) })),
    redirects: redirects.map(([p, x]) => ({ path: p, status: x.status, location: x.location, inlinks: linkCount(p) })),
    noindexLinked: noindex.map(([p, x]) => ({ path: p, robots: x.robots, inlinks: linkCount(p) })),
    nonCanonicalLinked: nonCanonical.map(([p, x]) => ({ path: p, canonical: x.canonical, inlinks: linkCount(p) })),
    parameterised: [...params], inconsistentAnchors, lowInlinkSitemap, notReached,
    pages: Object.fromEntries([...pages].map(([p, x]) => [p, { d: x.depth, s: x.status, in: linkCount(p), out: x.out?.length }])),
  }, null, 1));
}
