// Copies MapLibre's worker into src/assets/maplibre with a `.js` extension (generated, gitignored).
// The worker is an ES module, so browsers load it only when served with a JavaScript MIME type; nginx versions whose
// mime.types lack `.mjs` serve it as application/octet-stream and the admin map never loads. A `.js` name is served
// correctly by every server. The worker file is self-contained (maplibre-gl-shared.mjs is empty).
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('maplibre-gl/package.json'));
const source = join(pkgDir, 'dist', 'maplibre-gl-worker.mjs');
const outDir = join(here, '..', 'src', 'assets', 'maplibre');
const shared = readFileSync(join(pkgDir, 'dist', 'maplibre-gl-shared.mjs'), 'utf8');
if (shared.trim()) throw new Error('maplibre-gl-shared.mjs is no longer empty: the worker is not self-contained any more');
mkdirSync(outDir, { recursive: true });
copyFileSync(source, join(outDir, 'maplibre-gl-worker.js'));
console.log(`[maplibre] worker copied to ${join('src', 'assets', 'maplibre', 'maplibre-gl-worker.js')}`);
