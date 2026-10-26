#!/usr/bin/env node
// M10 release parity snapshot (read-only GETs): status, canonical, robots, X-Robots-Tag, bytes per key URL,
// plus sitemap URL counts. Usage: node scripts/m10-surface.mjs [baseUrl] > surface.tsv
const base = (process.argv[2] ?? 'https://guiaprogramaciontv.com').replace(/\/$/, '');
const paths = [
  '/', '/canales', '/canales/la-1', '/canales/discovery', '/canales/dmax', '/programas/chicago-pd', '/peliculas/gladiator',
  '/programacion-tv/en-directo', '/programacion-tv/peliculas', '/guias', '/guias/rankings', '/guias/categoria/rankings',
  '/deportes/futbol', '/sitemap', '/v2/docs', '/v2/health', '/robots.txt',
];
const attr = (html, re) => html.match(re)?.[1] ?? '-';
console.log(['path', 'status', 'location', 'canonical', 'robots', 'x-robots', 'bytes'].join('\t'));
for (const p of paths) {
  const t = Date.now();
  const r = await fetch(base + p, { redirect: 'manual', headers: { 'user-agent': 'guiatv-m10-surface/1.0' } });
  const body = await r.text();
  console.log([p, r.status, r.headers.get('location') ?? '-',
    attr(body, /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)/i),
    attr(body, /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']+)/i),
    r.headers.get('x-robots-tag') ?? '-', body.length, `${Date.now() - t}ms`].join('\t'));
  await new Promise((ok) => setTimeout(ok, 500));
}
const locs = async (u) => [...(await (await fetch(u)).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
for (const child of await locs(`${base}/sitemap.xml`)) console.log(`sitemap\t${child.split('/').pop()}\t${(await locs(child)).length}`);
