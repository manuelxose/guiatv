// M03-A public checks, paced GETs only: resolve each candidate's /peliculas path, require 200, one self canonical,
// robots index+follow, same TMDB id, no genres and no runtime in the legacy payload, title identity key equal.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const D = fileURLToPath(new URL('./', import.meta.url));
const raw = JSON.parse(readFileSync(D + 'candidates-raw.json', 'utf8'));
const origin = 'https://guiaprogramaciontv.com';
const UA = 'GuiaTV-rollout-check/1.0 (owner-run, public pages only)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const out = [];
let failures = 0;
for (const c of raw.candidates) {
  const r = { tmdbId: c.tmdbId, title: c.title, releaseYear: c.releaseYear, datesBeyondLegacyWindow: c.datesBeyondLegacyWindow, ok: false, why: [] };
  try {
    const cat = await fetch(`${origin}/v2/catalog/${encodeURIComponent(`tmdb:movie:${c.tmdbId}`)}`, { headers: { 'user-agent': UA } });
    if (cat.status !== 200) { r.why.push(`catalog ${cat.status}`); out.push(r); await sleep(1500); continue; }
    const d = (await cat.json()).data;
    r.path = d.detailPath;
    if (!/^\/peliculas\//.test(r.path ?? '')) r.why.push(`path ${r.path}`);
    await sleep(1500);
    const leg = await fetch(`${origin}/v2/catalog/slug/movie/${r.path.split('/').pop()}`, { headers: { 'user-agent': UA } });
    if (leg.status !== 200) { r.why.push(`legacy ${leg.status}`); } else {
      const l = (await leg.json()).data;
      r.apiGenres = (l.genres ?? []).length; r.apiRuntime = l.durationMinutes ?? null; r.apiAirings = (l.airings ?? []).length; r.legacyTmdb = l.tmdbId ?? null;
      if (r.apiGenres) r.why.push('has genres');
      if (r.apiRuntime) r.why.push('has runtime');
      if (!l.synopsis) r.why.push('no synopsis');
      if (r.legacyTmdb !== c.tmdbId) r.why.push(`tmdb ${r.legacyTmdb}`);
      if (key(l.title) !== key(c.title)) r.why.push(`title ${l.title}`);
    }
    await sleep(1500);
    const page = await fetch(origin + r.path, { headers: { 'user-agent': UA }, redirect: 'manual' });
    const html = page.status === 200 ? await page.text() : '';
    const robots = /<meta[^>]*name="robots"[^>]*content="([^"]+)"/i.exec(html)?.[1] ?? page.headers.get('x-robots-tag') ?? '';
    const canon = [...html.matchAll(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/gi)].map((m) => m[1]);
    r.status = page.status; r.robots = robots; r.canonicals = canon.length;
    if (page.status !== 200) r.why.push(`page ${page.status}`);
    if (!/index/i.test(robots) || /noindex/i.test(robots) || !/follow/i.test(robots) || /nofollow/i.test(robots)) r.why.push(`robots ${robots}`);
    if (canon.length !== 1 || new URL(canon[0], origin).pathname !== r.path) r.why.push('canonical');
    failures = 0;
  } catch (e) { r.why.push(`error ${e.cause?.code ?? e.message}`); failures++; }
  r.ok = r.why.length === 0;
  out.push(r);
  if (failures >= 3) { console.log('3 consecutive failures: stopping'); break; }
  await sleep(1500);
}
writeFileSync(D + 'candidates-checked.json', JSON.stringify(out, null, 1));
const reasons = {};
for (const r of out) for (const w of r.why) reasons[w.replace(/ .*/, '')] = (reasons[w.replace(/ .*/, '')] || 0) + 1;
console.log('checked', out.length, 'ok', out.filter((r) => r.ok).length, JSON.stringify(reasons));
