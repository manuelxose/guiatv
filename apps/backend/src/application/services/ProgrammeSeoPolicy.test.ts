import assert from 'node:assert/strict';
import test from 'node:test';
import { programmeCanonicalSlug, programmeDisposition, programmePolicyApplies, programmeSeo } from './ProgrammeSeoPolicy';

const ON = { PROGRAMME_SEO_POLICY: 'on' } as NodeJS.ProcessEnv;
const OFF = {} as NodeJS.ProcessEnv;
const LONG = 'Una historia de amistad y venganza en la Roma imperial, con batallas en el Coliseo y un general que lo pierde todo antes de volver.';

test('verified movie and series twins declare their work page; nothing else is merged', () => {
  assert.deepEqual(programmeSeo('gladiator', { title: 'Gladiator', tmdbId: 98, workPath: '/peliculas/gladiator' }, ON),
    { disposition: 'work', applied: true, canonicalPath: '/peliculas/gladiator' });
  assert.equal(programmeSeo('la-promesa', { title: 'La promesa', tmdbId: 7, workPath: '/series/la-promesa' }, ON).canonicalPath, '/series/la-promesa');
  // Same title, different work (remake, another year): only the verified workPath counts, never the title.
  assert.equal(programmeSeo('la-momia', { title: 'La momia', tmdbId: 564, workPath: '/peliculas/la-momia-1999' }, ON).canonicalPath, '/peliculas/la-momia-1999');
  // A TMDB id the M10 gate did not verify: isolated, no target guessed, robots untouched.
  assert.deepEqual(programmeSeo('furia', { title: 'Furia', tmdbId: 228150 }, ON), { disposition: 'ambiguous', applied: true, canonicalPath: '/programas/furia' });
});

test('invalid work metadata never becomes a canonical target', () => {
  for (const workPath of ['https://example.com/peliculas/x', '/peliculas/../admin', '/programas/x', '/peliculas/X', '/peliculas/']) {
    const seo = programmeSeo('x', { title: 'X', tmdbId: 1, workPath }, ON);
    assert.equal(seo.disposition, 'ambiguous', workPath);
    assert.equal(seo.canonicalPath, '/programas/x', workPath);
  }
});

test('an episode airing is noindex at its own slug, but the work slug of the same airing is the series page', () => {
  const airing = { title: 'Fallen T1 E3', tmdbId: 5, workPath: '/series/fallen', synopsis: LONG };
  assert.deepEqual(programmeSeo('fallen-t1-e3', airing, ON), { disposition: 'episode', applied: true, canonicalPath: '/programas/fallen-t1-e3', robots: 'noindex, follow' });
  assert.equal(programmeSeo('fallen', airing, ON).canonicalPath, '/series/fallen');
  assert.equal(programmeDisposition('episodio-812', { title: 'Episodio 812', synopsis: LONG }), 'episode');
});

test('a programme without TMDB identity is standalone only with a description of its own', () => {
  assert.equal(programmeDisposition('desmontando-la-ciudad', { title: 'Desmontando la ciudad', synopsis: LONG }), 'standalone');
  assert.equal(programmeSeo('creadoras', { title: 'Creadoras', synopsis: 'sin descripción.' }, ON).robots, 'noindex, follow');
  assert.equal(programmeSeo('el-escenario', { title: 'El escenario', synopsis: 'Programación Alacantí TV.' }, ON).disposition, 'thin');
  assert.equal(programmeSeo('el-escenario', { title: 'El escenario' }, ON).disposition, 'thin');
});

test('accented titles: the legacy slug maps to the folded one; other slugs are already canonical', () => {
  assert.equal(programmeCanonicalSlug('el-ltimo-sol', 'El último sol'), 'el-ultimo-sol');
  assert.equal(programmeCanonicalSlug('el-ultimo-sol', 'El último sol'), 'el-ultimo-sol');
  assert.equal(programmeCanonicalSlug('espaa-directo', 'España directo'), 'espana-directo');
  assert.equal(programmeCanonicalSlug('com-si-fos-ahir', 'Com si fos ahir'), 'com-si-fos-ahir');
  assert.equal(programmeCanonicalSlug('aqu-non-hai-quen-viva', 'Aquí non hai quen viva'), 'aqui-non-hai-quen-viva');
  // Unicode: precomposed (NFC) and decomposed (NFD) spellings of one title give one canonical slug.
  assert.equal(programmeSeo('ms-all', { title: 'Más allá' }, OFF).canonicalPath, '/programas/mas-alla');
  assert.equal(programmeSeo('mas-alla', { title: 'Más allá' }, OFF).canonicalPath, '/programas/mas-alla');
  // Collision: "Papá" and "Papa" fold to one slug; the canonical is deterministic, the resolver picks the row.
  assert.equal(programmeCanonicalSlug('pap', 'Papá'), 'papa');
  assert.equal(programmeCanonicalSlug('papa', 'Papa'), 'papa');
});

test('off: only the folded canonical changes; no work canonical, no noindex', () => {
  assert.deepEqual(programmeSeo('gladiator', { title: 'Gladiator', tmdbId: 98, workPath: '/peliculas/gladiator' }, OFF),
    { disposition: 'work', applied: false, canonicalPath: '/programas/gladiator' });
  assert.equal(programmeSeo('fallen-t1-e3', { title: 'Fallen T1 E3' }, OFF).robots, undefined);
  assert.equal(programmeSeo('creadoras', { title: 'Creadoras' }, { PROGRAMME_SEO_POLICY: 'yes' } as NodeJS.ProcessEnv).applied, false);
});

test('canary: a stable cohort of slugs; an invalid percentage applies nowhere', () => {
  const slugs = Array.from({ length: 2000 }, (_, i) => `programa-${i}`);
  const at = (percent: string) => slugs.filter((s) => programmePolicyApplies(s, { PROGRAMME_SEO_POLICY: 'canary', PROGRAMME_SEO_CANARY_PERCENT: percent } as NodeJS.ProcessEnv));
  const ten = at('10');
  assert.ok(ten.length > 120 && ten.length < 280, `10% cohort size ${ten.length}`);
  assert.deepEqual(at('10'), ten, 'deterministic');
  assert.ok(ten.every((s) => at('25').includes(s)), 'a wider cohort contains the narrower one');
  assert.equal(at('100').length, slugs.length);
  for (const bad of ['0', '101', '5.5', '', 'x']) assert.equal(at(bad).length, 0, bad);
});
