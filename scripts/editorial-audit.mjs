#!/usr/bin/env node
// Machine-checkable editorial quality gate over the PUBLIC corpus (read-only, no credentials).
// Flags: thin body, no external sources, template-only structure, near-duplicate clusters,
// stale dated events, metadata defects. A low score is a prompt for editorial review, not proof of quality.
// Usage: node scripts/editorial-audit.mjs [baseUrl] [--json out.json]   (exit 1 if any post has blocking findings)
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? 'https://guiaprogramaciontv.com').replace(/\/$/, '');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : undefined;
const T = { minWords: 250, minWordsAi: 600, dupJaccard: 0.35, staleDays: 45, metaTitle: 70, metaDesc: 170 }; // minWords = same floor as apps/backend EditorialReviewPolicy

const text = (html) => String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z0-9#]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const words = (t) => t.split(/\s+/).filter((w) => w.length > 1);
const shingles = (t, n = 4) => { const w = words(t.toLowerCase()); const s = new Set(); for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(' ')); return s; };
const jaccard = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`${base}/v2/blog?limit=0`)).json();
const posts = [];
for (const p of list) {
  const d = (await (await fetch(`${base}/v2/blog?slug=${encodeURIComponent(p.slug)}`)).json())[0];
  if (d) posts.push(d); // a post unpublished while the cached list is still warm has no detail
  await sleep(200);
}

// Every distinct internal destination, resolved once without following redirects: a 3xx/4xx is a link defect.
const internalPaths = (html) => [...html.matchAll(/href="(?:https?:\/\/guiaprogramaciontv\.com)?(\/[^"]*)"/g)].map((m) => m[1]);
const linkStatus = new Map();
for (const p of posts) for (const path of internalPaths(String(p.content?.rendered ?? p.content ?? ''))) linkStatus.set(path, 0);
for (const path of linkStatus.keys()) {
  linkStatus.set(path, (await fetch(`${base}${path}`, { redirect: 'manual' }).catch(() => ({ status: 'error' }))).status);
  await sleep(200);
}

const rows = posts.map((p) => {
  const html = String(p.content?.rendered ?? p.content ?? '');
  const badLinks = [...new Set(internalPaths(html))].filter((path) => linkStatus.get(path) !== 200);
  const body = text(html);
  const links = [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]).filter((u) => !u.includes('guiaprogramaciontv.com'));
  const internal = (html.match(/href="(\/|https?:\/\/guiaprogramaciontv\.com)/g) ?? []).length;
  const ageDays = (Date.now() - new Date(p.modified || p.date)) / 864e5;
  const dated = /\b(202[4-9])\b/.test(`${p.title?.rendered ?? p.title} ${p.slug}`) || /\b(esta semana|hoy|anoche|este fin de semana)\b/i.test(p.title?.rendered ?? String(p.title));
  const blocking = [];
  const warn = [];
  const origin = p.origin || 'unknown';
  const wc = words(body).length;
  if (wc < T.minWords) blocking.push(`thin body (${wc} words < ${T.minWords})`);
  else if (origin !== 'human' && wc < T.minWordsAi) warn.push(`short for non-human origin (${wc})`);
  if (origin !== 'human' && links.length === 0) blocking.push('no external source link (non-human origin)');
  if (!p.seo?.metaTitle && !p.seo?.title) warn.push('no seo.metaTitle'); else if ((p.seo.metaTitle || p.seo.title).length > T.metaTitle) warn.push('metaTitle too long');
  if (!p.seo?.metaDescription && !p.seo?.description) warn.push('no seo.metaDescription'); else if ((p.seo.metaDescription || p.seo.description).length > T.metaDesc) warn.push('metaDescription too long');
  if (dated && ageDays > T.staleDays) warn.push(`time-bound title not updated for ${Math.round(ageDays)} days`);
  if (/\*\*[^*<>\n]+\*\*|<p>\s*#{1,6}\s/.test(html)) blocking.push('raw markdown tokens in HTML');
  if (/\*\*|<p>\s*#{1,6}\s/.test(String(p.excerpt?.rendered ?? p.excerpt ?? ''))) blocking.push('raw markdown tokens in excerpt');
  if (/…$/.test(p.seo?.metaTitle || '') || /…$/.test(p.seo?.metaDescription || '')) warn.push('auto-truncated seo metadata (ends with …)');
  if (/auctorio\.com/i.test(JSON.stringify(p.seo?.ogImage || '') + JSON.stringify(p.featured_image || ''))) warn.push('hotlinked image on auctorio.com (no own copy/licence record)');
  if (!(p.author?.name)) blocking.push('no author');
  if (internal === 0) warn.push('no internal links');
  for (const path of badLinks) blocking.push(`internal link answers ${linkStatus.get(path)}: ${path}`);
  return { slug: p.slug, origin, words: wc, sources: links.length, internal, badLinks, ageDays: Math.round(ageDays), shingles: shingles(body), blocking, warn, dupes: [] };
});

for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
  const sim = jaccard(rows[i].shingles, rows[j].shingles);
  if (sim >= T.dupJaccard) { rows[i].dupes.push([rows[j].slug, +sim.toFixed(2)]); rows[j].dupes.push([rows[i].slug, +sim.toFixed(2)]); }
}
for (const r of rows) if (r.dupes.length) r.warn.push(`near-duplicate (4-gram Jaccard >= ${T.dupJaccard}) of ${r.dupes.length} post(s)`);

const clean = rows.map(({ shingles: _s, ...r }) => r);
const fail = clean.filter((r) => r.blocking.length);
console.log(`posts: ${rows.length} | blocking findings: ${fail.length} | with warnings: ${clean.filter((r) => r.warn.length).length}`);
const count = {};
for (const r of clean) for (const m of [...r.blocking, ...r.warn].map((x) => x.replace(/[\d.]+/g, 'N').replace(/of N post.*/, ''))) count[m] = (count[m] ?? 0) + 1;
for (const [k, v] of Object.entries(count).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
const clusters = clean.filter((r) => r.dupes.length).sort((a, b) => b.dupes.length - a.dupes.length).slice(0, 12);
for (const r of clusters) console.log(`dup: ${r.slug} ~ ${r.dupes.map(([s, v]) => `${s}(${v})`).join(', ')}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ base, at: new Date().toISOString(), thresholds: T, posts: clean }, null, 1));
process.exit(fail.length ? 1 : 0);
