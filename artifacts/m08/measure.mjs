// Initial asset bytes and read-only SEO/health checks; excludes lazy-route chunks and images.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const origin = process.env.M08_ORIGIN || 'https://guiaprogramaciontv.com';
const label = process.env.M08_LABEL || 'before';
assert.match(label, /^[a-z0-9-]+$/);
const response = await fetch(origin);
assert.equal(response.status, 200);
const html = await response.text();
const tags = html.match(/<(?:script|link)\b[^>]*>/g) || [];
const paths = [...new Set(tags.filter(tag => /<script\b/.test(tag) || /rel="(?:stylesheet|modulepreload)"/.test(tag)).flatMap(tag => [...tag.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1])).filter(path => new URL(path, origin).origin === new URL(origin).origin))];
assert(paths.some(path => path.endsWith('.js')));
const assets = [];
for (const path of paths) {
  const asset = await fetch(new URL(path, origin));
  assert.equal(asset.status, 200, path);
  assets.push({ path, bytes: (await asset.arrayBuffer()).byteLength });
}
const checks = [];
for (const path of ['/v2/health', '/robots.txt', '/sitemap.xml', '/deportes/futbol/en-directo']) {
  const result = await fetch(new URL(path, origin), { redirect: 'manual' });
  checks.push({ path, status: result.status, location: result.headers.get('location'), robots: result.headers.get('x-robots-tag'), body: path === '/robots.txt' ? await result.text() : undefined });
}
const report = { origin, at: new Date().toISOString(), initialBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0), assets, checks };
await writeFile(new URL(`./measure-${label}.json`, import.meta.url), JSON.stringify(report, null, 2));
console.log(label, report.initialBytes, 'initial asset bytes', checks.map(check => `${check.path}:${check.status}`).join(' '));
