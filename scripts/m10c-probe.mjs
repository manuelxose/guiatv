#!/usr/bin/env node
// M10-C production probe (read-only GETs). Prints JSON sections to stdout:
//  - channels: every /canales URL of sitemap-channels.xml whose slug ends in `-tv`, compared with the URL without the
//    suffix (API channel identity of both, SSR status/canonical/robots of both, schedule overlap);
//  - rails: work links (/peliculas|/series) on programme and airing pages, split into "in sitemap-works" (verified,
//    indexable set) and "outside it";
//  - links: status of every internal link on the editorial hubs (/guias, /plataformas, listings);
//  - identities: Cine/Series airings of today and tomorrow with a TMDB id but no verified work link, classified with
//    public evidence only (TMDB record of that id as the catalogue serves it, shared ids, missing records);
//  - health: /v2/health (release identifier).
// Usage: node scripts/m10c-probe.mjs [baseUrl] [--section channels|rails|links|identities|health]
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? 'https://guiaprogramaciontv.com').replace(/\/$/, '');
const only = args.includes('--section') ? args[args.indexOf('--section') + 1] : undefined;
const host = new URL(base).host;
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; guiatv-m10c-probe/1.0)' };
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function get(path, { json = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(path.startsWith('http') ? path : base + path, { redirect: 'manual', headers: UA, signal: AbortSignal.timeout(30000) });
      if ((r.status === 429 || r.status >= 502) && attempt === 0) { await r.arrayBuffer(); await pause(3000); continue; }
      const body = await r.text();
      return { status: r.status, location: r.headers.get('location') ?? undefined, xRobots: r.headers.get('x-robots-tag') ?? undefined, body, json: json ? safeJson(body) : undefined };
    } catch (e) {
      if (attempt === 0) { await pause(3000); continue; }
      return { status: `error ${e.message}`, body: '' };
    }
  }
}
const safeJson = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
const attr = (html, re) => html.match(re)?.[1];
const seo = (r) => ({
  status: r.status,
  location: r.location,
  canonical: attr(r.body, /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)/i),
  robots: attr(r.body, /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']+)/i),
  xRobots: r.xRobots,
});
const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
const pathOf = (u) => new URL(u, base).pathname.replace(/(.)\/$/, '$1');
const links = (html) => {
  const body = html.replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, '');
  const out = [];
  for (const m of body.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u; try { u = new URL(m[1].replace(/&amp;/g, '&'), base); } catch { continue; }
    if (u.host !== host || /\.(png|jpe?g|webp|svg|xml|txt|css|js)$/i.test(u.pathname)) continue;
    out.push({ path: u.pathname.replace(/(.)\/$/, '$1'), text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) });
  }
  return out;
};
const sitemapPaths = async (file) => new Set(locs((await get(`/${file}`)).body).map(pathOf));
const print = (section, data) => console.log(JSON.stringify({ section, at: new Date().toISOString(), ...data }));

const channelSummary = (payload) => {
  const d = payload?.data ?? payload;
  const c = d?.channel;
  if (!c) return { found: false };
  const items = d.scheduleItems ?? [];
  return {
    found: true, id: c.id, name: c.name, normalizedName: c.normalizedName, group: c.group, type: c.type, region: c.region,
    aliases: c.aliases, sourceIds: c.sourceIds, items: items.length,
    airingIds: items.map((i) => i.id).slice(0, 400),
    firstTitles: items.slice(0, 3).map((i) => `${i.airing?.start ?? i.start} ${i.program?.title ?? i.title}`),
  };
};

if (!only || only === 'health') {
  const h = await get('/v2/health', { json: true });
  print('health', { status: h.status, body: h.json ?? h.body.slice(0, 400) });
}

if (!only || only === 'channels') {
  const urls = locs((await get('/sitemap-channels.xml')).body).map(pathOf);
  const directory = (await get('/v2/tv/read/channels?date=today', { json: true })).json;
  const dirChannels = (directory?.data?.channels ?? directory?.channels ?? []).map((e) => e.channel);
  print('channels-directory', {
    sitemapChannelUrls: urls.length,
    sitemapTvSuffix: urls.filter((p) => /-tv$/.test(p)).length,
    directory: dirChannels.map((c) => [c.id, c.name, c.normalizedName, c.group, (c.sourceIds ?? []).slice(0, 3)]),
  });
  for (const p of urls.filter((u) => /-tv$/.test(u))) {
    const slug = p.split('/').pop();
    const baseSlug = slug.replace(/-tv$/, '');
    const pair = {};
    for (const [key, s] of [['tv', slug], ['base', baseSlug]]) {
      const api = await get(`/v2/tv/surface/channels/${encodeURIComponent(s)}?date=today`, { json: true });
      const page = await get(`/canales/${s}`);
      const summary = channelSummary(api.json);
      pair[key] = { slug: s, apiStatus: api.status, ...summary, airingIds: undefined, page: seo(page) };
      pair[`${key}Ids`] = summary.airingIds ?? [];
      await pause(300);
    }
    const a = new Set(pair.tvIds), b = new Set(pair.baseIds);
    const shared = [...a].filter((x) => b.has(x)).length;
    print('channel-pair', {
      path: p,
      tv: pair.tv, base: pair.base,
      sameChannelId: pair.tv.found && pair.base.found && pair.tv.id === pair.base.id,
      airings: { tv: a.size, base: b.size, shared },
    });
  }
}

if (!only || only === 'rails') {
  const works = new Set([...await sitemapPaths('sitemap-works.xml')]);
  const programmes = [...await sitemapPaths('sitemap-programs.xml')];
  const seeds = ['/', '/programacion-tv/peliculas', '/programacion-tv/series', '/programacion-tv/que-ver-hoy', '/programacion-tv/en-directo'];
  const extra = new Set();
  for (const s of seeds) {
    for (const l of links((await get(s)).body)) if (/^\/(programas|contenido)\/[^/]+$/.test(l.path)) extra.add(l.path);
  }
  const sample = [...new Set([...programmes, ...[...extra].slice(0, 80)])];
  const rows = [];
  const outside = new Map();
  for (const p of sample) {
    const r = await get(p);
    const s = seo(r);
    const workLinks = links(r.body).filter((l) => /^\/(peliculas|series)\/[^/]+$/.test(l.path));
    const uniq = [...new Map(workLinks.map((l) => [l.path, l.text])).entries()];
    const notVerified = uniq.filter(([w]) => !works.has(w));
    for (const [w] of notVerified) outside.set(w, [...(outside.get(w) ?? []), p].slice(0, 3));
    rows.push([p, s.status, s.robots ?? '-', s.canonical ? pathOf(s.canonical) : '-', uniq.length, notVerified.length, notVerified.slice(0, 4).map(([w, t]) => `${w} «${t}»`)]);
    await pause(200);
  }
  print('rails', {
    sampled: rows.length,
    pagesWithWorkLinks: rows.filter((r) => r[4] > 0).length,
    workLinks: rows.reduce((n, r) => n + r[4], 0),
    workLinksOutsideSitemapWorks: rows.reduce((n, r) => n + r[5], 0),
    pagesWithUnverifiedWorkLinks: rows.filter((r) => r[5] > 0).length,
    distinctUnverifiedTargets: outside.size,
    rows,
  });
}

if (!only || only === 'links') {
  const hubs = ['/guias', '/plataformas', '/programacion-tv/series', '/programacion-tv/peliculas', '/programacion-tv/que-ver-hoy', '/sobre-nosotros', '/prensa', '/developers', '/avisolegal', '/politica-editorial'];
  const status = new Map();
  const broken = [];
  for (const h of hubs) {
    const page = await get(h);
    const targets = [...new Map(links(page.body).map((l) => [l.path, l.text])).entries()];
    for (const [t, text] of targets) {
      if (!status.has(t)) { status.set(t, (await get(t)).status); await pause(150); }
      const s = status.get(t);
      if (typeof s !== 'number' || s >= 400) broken.push({ from: h, to: t, text, status: s });
    }
    print('hub', { hub: h, status: page.status, links: targets.length });
  }
  print('broken-links', { checkedTargets: status.size, broken });
}

if (!only || only === 'identities') {
  const key = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\(\s*\d{4}\s*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const airings = [];
  for (const date of ['today', 'tomorrow']) {
    for (const category of ['Cine', 'Series']) {
      const r = await get(`/v2/tv/read?view=day&date=${date}&category=${category}&limit=5000&includeChannels=false`, { json: true });
      const items = r.json?.data?.items ?? r.json?.items ?? [];
      for (const i of items) airings.push({ date, category, id: i.id, title: i.program?.title, tmdbId: i.program?.tmdbId, workPath: i.program?.workPath, channel: i.channel?.name });
      await pause(300);
    }
  }
  const withTmdb = airings.filter((a) => Number.isInteger(a.tmdbId));
  const unverified = withTmdb.filter((a) => !a.workPath);
  // Distinct (title key, TMDB id, kind): one identity decision each.
  const groups = new Map();
  for (const a of unverified) {
    const k = `${key(a.title)}|${a.tmdbId}|${a.category}`;
    const g = groups.get(k) ?? { title: a.title, tmdbId: a.tmdbId, category: a.category, airings: 0, channels: new Set() };
    g.airings += 1; g.channels.add(a.channel); groups.set(k, g);
  }
  const titlesById = new Map();
  for (const a of withTmdb) (titlesById.get(a.tmdbId) ?? titlesById.set(a.tmdbId, new Set()).get(a.tmdbId)).add(key(a.title));
  const classes = {};
  const rows = [];
  for (const g of groups.values()) {
    const type = g.category === 'Cine' ? 'movie' : 'tv';
    const r = await get(`/v2/catalog/tmdb:${type}:${g.tmdbId}`, { json: true });
    const d = r.json?.data ?? r.json;
    const recTitles = [d?.title, d?.originalTitle].filter(Boolean).map(key);
    const year = d?.year ?? d?.releaseYear ?? (String(d?.releaseDate ?? d?.firstAirDate ?? '').slice(0, 4) || undefined);
    const yearInTitle = String(g.title ?? '').match(/\b(19|20)\d{2}\b/)?.[0];
    let cls;
    if (r.status === 404 || r.status === 410) cls = 'invalid_external_id';
    else if (r.status !== 200 || !d) cls = 'record_unreadable';
    else if ((titlesById.get(g.tmdbId)?.size ?? 0) > 1) cls = 'tmdb_id_shared_by_titles';
    else if (!recTitles.includes(key(g.title))) cls = 'title_differs_from_record'; // localized title, remake, or wrong match
    else if (yearInTitle && year && yearInTitle !== String(year)) cls = 'same_title_different_year';
    else cls = 'title_matches_no_persistent_id'; // agreement on the title only: no independent evidence yet
    classes[cls] = (classes[cls] ?? 0) + 1;
    rows.push([cls, g.category, g.tmdbId, g.title, d?.title ?? '-', year ?? '-', g.airings, [...g.channels].slice(0, 2).join(', ')]);
    await pause(150);
  }
  print('identities', {
    airings: airings.length,
    withTmdbId: withTmdb.length,
    verifiedLinked: withTmdb.length - unverified.length,
    unverifiedAirings: unverified.length,
    distinctUnverifiedIdentities: groups.size,
    classes,
    rows: rows.sort((a, b) => a[0].localeCompare(b[0])),
  });
}

if (only === 'feed-pairs') {
  // Investigation only: every `.TV`-feed channel against every other autonomic/TDT channel, by schedule agreement
  // (same title key within 10 minutes), to find second feeds whose key differs from their channel's (`Canarias.TV`).
  const directory = (await get('/v2/tv/read/channels?date=today', { json: true })).json;
  const chans = (directory?.data?.channels ?? []).map((e) => e.channel).filter((c) => c.group === 'autonomico' || c.group === 'tdt');
  const key = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const slots = new Map();
  for (const c of chans) {
    const r = await get(`/v2/tv/surface/channels/${encodeURIComponent(c.id)}?date=today`, { json: true });
    const items = (r.json?.data?.scheduleItems ?? []).filter((i) => i.channel?.id === c.id);
    slots.set(c.id, items.map((i) => [key(i.program?.title), Date.parse(i.airing?.start)]).filter(([k, s]) => k && Number.isFinite(s)));
    await pause(150);
  }
  const isTvFeed = (c) => (c.sourceIds ?? []).some((s) => /\.tv$/i.test(s)) && !(c.sourceIds ?? []).some((s) => /\.es$/i.test(s));
  const rows = [];
  for (const a of chans.filter(isTvFeed)) {
    const mine = slots.get(a.id) ?? [];
    let best = null;
    for (const b of chans) {
      if (b.id === a.id || isTvFeed(b)) continue;
      const theirs = slots.get(b.id) ?? [];
      const shared = mine.filter(([k, s]) => theirs.some(([k2, s2]) => k2 === k && Math.abs(s2 - s) <= 600000)).length;
      if (!best || shared > best.shared) best = { id: b.id, name: b.name, sourceIds: (b.sourceIds ?? []).slice(-1), shared };
    }
    rows.push([a.id, a.name, mine.length, best?.id ?? '-', best?.name ?? '-', best?.sourceIds ?? [], best?.shared ?? 0,
      mine.length ? Math.round(100 * (best?.shared ?? 0) / mine.length) : 0]);
  }
  print('feed-pairs', { rows });
}
