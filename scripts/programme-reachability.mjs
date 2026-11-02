// M10-E: for every URL in sitemap-programs.xml, the evergreen channel pages whose raw SSR HTML (no JS) carries a real
// `<a href="/programas/<slug>">`. Channel pages are the ones the /canales directory links (an evergreen page at depth 1).
// Sequential and slow on purpose (production): one request at a time, backoff on 429/5xx, stops if /v2/health degrades.
//
// Usage: node scripts/programme-reachability.mjs [baseUrl] [--out file.json] [--delay 300]
//   The sitemap is read twice (start and end): a result is only a same-snapshot result if both reads list the same URLs.
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const base = (args.find((a) => /^https?:\/\//.test(a)) || 'https://guiaprogramaciontv.com').replace(/\/$/, '');
const out = flag('--out');
const delay = Number(flag('--delay', '300'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(base + path, { redirect: 'manual', headers: { 'user-agent': 'guiatv-m10e-reachability' } });
    if (res.status !== 429 && res.status < 500) return res;
    await sleep(3000 * (attempt + 1));
  }
  throw new Error(`no answer: ${path}`);
}
async function healthy() {
  const res = await get('/v2/health').catch(() => null);
  return !!res && res.ok;
}
const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(base, ''));
const attr = (html, re) => (html.match(re) || [])[1];

const sitemapBefore = locs(await (await get('/sitemap-programs.xml')).text());
const directory = await (await get('/canales')).text();
const channels = [...new Set([...directory.matchAll(/href="(\/canales\/[a-z0-9-]+)"/g)].map((m) => m[1]))];
const linkedFrom = new Map(sitemapBefore.map((p) => [p, []]));
const otherProgrammeLinks = new Map();
let redirects = 0;
for (const [i, path] of channels.entries()) {
  if (i % 25 === 0 && !(await healthy())) throw new Error(`health degraded after ${i} channel pages: stopped`);
  const res = await get(path);
  await sleep(delay);
  if (res.status !== 200) { redirects++; continue; } // an alias (301) is not a page of its own
  const html = await res.text();
  for (const m of html.matchAll(/<a\b[^>]*\bhref="(\/programas\/[^"#?]+)"/g)) {
    if (linkedFrom.has(m[1])) { if (!linkedFrom.get(m[1]).includes(path)) linkedFrom.get(m[1]).push(path); }
    else otherProgrammeLinks.set(m[1], path);
  }
}
const sitemapAfter = locs(await (await get('/sitemap-programs.xml')).text());
const sameSnapshot = sitemapBefore.length === sitemapAfter.length && sitemapBefore.every((p) => sitemapAfter.includes(p));

// Each destination: status, robots, canonical (a link to a redirect, a noindex or a non-canonical page fails).
const destinations = {};
for (const p of new Set([...sitemapBefore, ...otherProgrammeLinks.keys()])) {
  const res = await get(p);
  await sleep(delay);
  const html = res.status === 200 ? await res.text() : '';
  destinations[p] = {
    status: res.status,
    robots: attr(html, /<meta name="robots" content="([^"]*)"/),
    canonical: attr(html, /<link rel="canonical" href="([^"]*)"/)?.replace(base, ''),
    channels: (linkedFrom.get(p) || []).slice(0, 5),
    inSitemap: sitemapBefore.includes(p),
  };
}
const unlinked = sitemapBefore.filter((p) => !linkedFrom.get(p).length);
const badLinks = [...otherProgrammeLinks.keys(), ...sitemapBefore.filter((p) => linkedFrom.get(p).length)]
  .filter((p) => { const d = destinations[p]; return d.status !== 200 || /noindex/.test(d.robots || '') || d.canonical !== p; });
const result = {
  at: new Date().toISOString(), base, channelPages: channels.length, channelRedirectsSkipped: redirects,
  sitemapProgrammes: sitemapBefore.length, sameSnapshot, linked: sitemapBefore.length - unlinked.length, unlinked,
  programmeLinksOutsideSitemap: [...otherProgrammeLinks.keys()], badLinks, destinations,
};
if (out) writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, destinations: undefined }, null, 2));
process.exitCode = sameSnapshot && !unlinked.length && !badLinks.length ? 0 : 1;
