// M09-C read-only Search Console checkpoint (URL Inspection of http/https/www variants + Search Analytics per exact
// URL). No Indexing API, no writes. Run on the server with /etc/guiatv/api.env loaded (docs/roadmap/M09C-DELIVERY.md §15):
//   node gsc-canonical-checkpoint.mjs / /deportes/futbol /plataformas /peliculas/cenicienta ...
import { createRequire } from 'module';
const require = createRequire('/var/www/guiatv/current/apps/backend/package.json');
const { GoogleAuth } = require('google-auth-library');
const site = process.env.GSC_SITE_URL.trim();
const t = await (await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/webmasters.readonly'] }).getClient()).getAccessToken();
const H = { Authorization: `Bearer ${t.token ?? t}`, 'Content-Type': 'application/json' };
const api = async (url, body) => (await fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body) })).json();
const paths = process.argv.slice(2);
const variants = (p) => (p === '/' ? ['http://guiaprogramaciontv.com/', 'https://guiaprogramaciontv.com/', 'http://www.guiaprogramaciontv.com/', 'https://www.guiaprogramaciontv.com/'] : [`https://guiaprogramaciontv.com${p}`, `http://guiaprogramaciontv.com${p}`]);
const out = { site, at: new Date().toISOString(), inspections: [], analytics: {} };
for (const p of paths) for (const url of variants(p)) {
  const r = await api('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', { inspectionUrl: url, siteUrl: site, languageCode: 'es' });
  const i = r.inspectionResult?.indexStatusResult || {};
  out.inspections.push({ url, verdict: i.verdict, coverageState: i.coverageState, lastCrawlTime: i.lastCrawlTime, googleCanonical: i.googleCanonical, userCanonical: i.userCanonical, pageFetchState: i.pageFetchState, robotsTxtState: i.robotsTxtState, indexingState: i.indexingState, sitemap: i.sitemap, error: r.error?.message });
}
// Per exact URL (protocol kept apart): the 90 days up to today.
const day = (offset) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
out.analytics.window = [day(90), day(0)];
const sa = await api(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, { startDate: day(90), endDate: day(0), dimensions: ['page'], dataState: 'all', rowLimit: 5000 });
const rows = sa.rows || [];
out.analytics.totalPages = rows.length;
out.analytics.byProtocol = rows.reduce((o, r) => { const k = r.keys[0].split(':')[0]; o[k] = o[k] || { pages: 0, impressions: 0, clicks: 0 }; o[k].pages++; o[k].impressions += r.impressions; o[k].clicks += r.clicks; return o; }, {});
out.analytics.tracked = rows.filter((r) => paths.some((p) => new URL(r.keys[0]).pathname === p)).map((r) => ({ url: r.keys[0], impressions: r.impressions, clicks: r.clicks, position: Math.round(r.position * 10) / 10 }));
out.analytics.workPages = rows.filter((r) => /\/(peliculas|series)\//.test(r.keys[0])).length;
console.log(JSON.stringify(out, null, 1));
