// Fails if sports-v2 imports anything from the legacy app, or if legacy code imports sports-v2
// (other than the single lazy route in app.routes.ts).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../src/app');
const v2 = join(root, 'sports-v2');
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const importRe = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
const problems = [];

for (const file of walk(v2).filter((f) => /\.(ts|scss|html)$/.test(f))) {
  const src = readFileSync(file, 'utf8');
  for (const [, spec] of src.matchAll(importRe)) {
    if (/^(@angular\/|rxjs)/.test(spec)) continue;
    // Shared navigation contract (pure data: where each Guía TV section lives). The only legacy file v2 may read.
    if (file.endsWith('site-nav.ts') && spec === '../../config/portal-navigation.config') continue;
    if (spec.startsWith('.')) {
      const target = resolve(file, '..', spec);
      if (target.startsWith(v2)) continue;
    }
    problems.push(`${relative(root, file)} imports "${spec}"`);
  }
  if (/@use\s+['"](?!\.\.\/styles\/tokens)/.test(src) || /@import/.test(src)) problems.push(`${relative(root, file)} uses a foreign stylesheet`);
}

for (const file of walk(root).filter((f) => f.endsWith('.ts') && !f.startsWith(v2))) {
  if (/sports-v2/.test(readFileSync(file, 'utf8')) && !file.endsWith('app.routes.ts')) problems.push(`legacy file references sports-v2: ${relative(root, file)}`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`sports-v2 isolation OK (${walk(v2).length} files, 0 legacy imports)`);
