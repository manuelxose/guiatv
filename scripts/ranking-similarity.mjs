#!/usr/bin/env node
// M11-B1: reproducible duplication measure of the platform-ranking cluster, read from the PUBLIC API (no credentials).
// Shared prose = prose lines (tables excluded) identical in every post once the platform name is a placeholder,
// the M11-A method. Jaccard = 4-gram, the same measure as the near-duplicate gate (EditorialReviewPolicy, 0.35 / 0.8).
// Usage: node scripts/ranking-similarity.mjs [baseUrl] [--json out.json] [--candidate netflix=draft.html]
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const base = (args.find((a) => /^https?:/.test(a)) || 'https://guiaprogramaciontv.com').replace(/\/$/, '');
const PLATFORMS = { netflix: 'Netflix', 'prime-video': 'Prime Video', 'disney-plus': 'Disney+', 'hbo-max': 'HBO Max', 'movistar-plus': 'Movistar Plus+' };

const words = (t) => t.split(/\s+/).filter((w) => w.length > 1);
const shingles = (t, n = 4) => { const w = words(t.toLowerCase()); const s = new Set(); for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(' ')); return s; };
const jaccard = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); };
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const lines = (html) => html.replace(/<table[\s\S]*?<\/table>/g, '').split(/<\/(?:p|h\d|li)>/).map(text).filter(Boolean);
const titles = (html) => [...html.matchAll(/<tr>\s*<td[^>]*>\d+<\/td>\s*<td[^>]*>([^<]+)<\/td>/g)].map((m) => m[1].trim());

const posts = {};
for (const [key, name] of Object.entries(PLATFORMS)) {
  const slug = `mejores-series-y-peliculas-${key}-espana`;
  const post = (await (await fetch(`${base}/v2/blog?slug=${slug}`)).json())[0];
  if (!post) throw new Error(`${slug} not found at ${base}`);
  posts[key] = { name, slug, html: post.content.rendered, modified: post.modified };
}
// A candidate rewrite replaces its live post in the measure, so the draft is judged against the other four.
const candidate = flag('--candidate');
if (candidate) { const [key, file] = candidate.split('='); posts[key] = { ...posts[key], html: readFileSync(file, 'utf8'), candidate: true }; }

const keys = Object.keys(posts);
const placeholder = (key, line) => line.split(posts[key].name).join('{P}');
const proseOf = Object.fromEntries(keys.map((k) => [k, lines(posts[k].html).map((l) => placeholder(k, l))]));
const rows = keys.map((k) => {
  const others = keys.filter((o) => o !== k);
  const prose = proseOf[k];
  const proseWords = words(prose.join(' ')).length;
  // Shared with all the others (M11-A) and with at least one other (a looser, per-page view).
  const sharedAll = prose.filter((l) => others.every((o) => proseOf[o].includes(l)));
  const sharedAny = prose.filter((l) => others.some((o) => proseOf[o].includes(l)));
  const html = posts[k].html;
  const t = titles(html);
  const externalLinks = [...new Set([...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]).filter((u) => !u.includes('guiaprogramaciontv.com')))];
  return {
    platform: posts[k].name, slug: posts[k].slug, candidate: !!posts[k].candidate,
    words: words(text(html)).length, proseWords,
    sharedProseAll: +(words(sharedAll.join(' ')).length / (proseWords || 1)).toFixed(3),
    sharedProseAny: +(words(sharedAny.join(' ')).length / (proseWords || 1)).toFixed(3),
    tableTitles: t.length, titlesInOtherLists: t.filter((x) => others.some((o) => titles(posts[o].html).includes(x))).length,
    externalLinks, headings: [...html.matchAll(/<h[23][^>]*>([^<]+)</g)].map((m) => m[1].trim()),
    verifiedOn: (text(html).match(/verificado el ([^.]+)\./) || [])[1] ?? null,
  };
});
const pairs = [];
for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
  pairs.push({ a: posts[keys[i]].name, b: posts[keys[j]].name, jaccard4: +jaccard(shingles(text(posts[keys[i]].html)), shingles(text(posts[keys[j]].html))).toFixed(3) });
}
const allTitles = keys.flatMap((k) => titles(posts[k].html));
const report = { base, measuredAt: new Date().toISOString(), rows, pairs, tableSlots: allTitles.length, distinctTitles: new Set(allTitles).size, thresholds: { nearDuplicate: 0.35, nearIdentical: 0.8 } };

const out = flag('--json');
if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
for (const r of rows) console.log(`${r.platform.padEnd(15)} words ${r.words} prose ${r.proseWords} shared(all) ${(r.sharedProseAll * 100).toFixed(0)}% shared(any) ${(r.sharedProseAny * 100).toFixed(0)}% titles-elsewhere ${r.titlesInOtherLists}/${r.tableTitles}${r.candidate ? ' [candidate]' : ''}`);
for (const p of pairs) console.log(`  ${p.a} ~ ${p.b}: ${p.jaccard4}`);
console.log(`table slots ${report.tableSlots}, distinct titles ${report.distinctTitles}`);
