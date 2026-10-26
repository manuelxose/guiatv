// Compare affected SSR metadata directly; browser initialization can briefly expose shell defaults.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const origins = (process.env.M08_COMPARE_ORIGINS || 'https://guiaprogramaciontv.com,http://127.0.0.1:4382').split(',');
assert.equal(origins.length, 2);
const paths = ['/', '/programacion-tv/en-directo', '/canales', '/programacion-tv/que-ver-hoy', '/programacion-tv/peliculas', '/programacion-tv/series', '/deportes/futbol', '/deportes/futbol/competiciones', '/deportes/futbol/partidos-hoy', '/guias', '/perfil', '/iniciar-sesion', '/registro'];
const results = [];
for (const path of paths) {
  const samples = [];
  for (const origin of origins) {
    const response = await fetch(`${origin}${path}`);
    const html = await response.text();
    const robotsTag = html.match(/<meta\b[^>]*name=["']robots["'][^>]*>/i)?.[0];
    const canonicalTag = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i)?.[0];
    samples.push({ status: response.status, robots: robotsTag?.match(/content=["']([^"']*)/i)?.[1] ?? null, headerRobots: response.headers.get('x-robots-tag'), canonical: canonicalTag?.match(/href=["']([^"']*)/i)?.[1] ?? null });
  }
  assert.equal(samples[0].status, 200, path);
  assert.deepEqual(samples[0], samples[1], path);
  results.push({ path, ...samples[0] });
}
await writeFile(new URL('./seo-parity.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), origins, results }, null, 2));
console.log('SSR canonical, robots meta/header and status parity:', results.length, 'routes');
