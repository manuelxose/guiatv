import assert from 'node:assert/strict';
import test from 'node:test';
import { workContentPasses, workDisposition, workPolicyApplies, workSeo, type WorkRow } from './WorkSeoPolicy';
import { programmeSeo } from './ProgrammeSeoPolicy';

const SYNOPSIS = 'Una joven huérfana vive con su madrastra y sus dos hermanastras, que la tratan como a una criada. '.repeat(4);
const row = (over: Partial<WorkRow> = {}): WorkRow => ({
  tmdbId: 150689, tmdbType: 'movie', title: 'Cenicienta', normalizedTitle: 'cenicienta', synopsis: SYNOPSIS, year: '2015',
  runtimeMinutes: 105, posterPath: '/abc12.jpg', tmdbGenres: [{ id: 1, name: 'Romance' }], directors: ['Kenneth Branagh'],
  castSummary: [], lastEnrichedAt: new Date('2026-10-01'), ...over,
});

test('M09-C: a verified, complete film is indexable without any broadcast; nothing about airings is read', () => {
  assert.deepEqual(workSeo('movie', 'cenicienta', 150689, [row()]), { disposition: 'indexable', applied: true, canonicalPath: '/peliculas/cenicienta' });
});

test('M09-C: a series keeps the same verdict and canonical between EPG updates (same rows, same answer)', () => {
  const series = row({ tmdbId: 1399, tmdbType: 'tv', title: 'La promesa', normalizedTitle: 'la promesa', year: undefined, runtimeMinutes: undefined });
  const first = workSeo('series', 'la-promesa', 1399, [series]);
  assert.deepEqual(first, { disposition: 'indexable', applied: true, canonicalPath: '/series/la-promesa' });
  assert.deepEqual(workSeo('series', 'la-promesa', 1399, [series]), first);
});

test('M09-C: low-value works stay noindex, follow', () => {
  for (const over of [
    { synopsis: 'Corta.' }, { lastEnrichedAt: undefined }, { tmdbGenres: [] }, { posterPath: undefined },
    { directors: [], castSummary: [{}, {}] }, { year: undefined }, { runtimeMinutes: undefined },
  ] as Partial<WorkRow>[]) {
    assert.deepEqual(workSeo('movie', 'cenicienta', 150689, [row(over)]).robots, 'noindex, follow', JSON.stringify(over));
  }
  // A current broadcast is first-party value: a thin work stays indexable while it airs, and only then.
  assert.deepEqual(workSeo('movie', 'cenicienta', 150689, [row({ synopsis: 'Corta.' })], true), { disposition: 'airing', applied: true, canonicalPath: '/peliculas/cenicienta' });
  // ...but a broadcast never makes an unproven identity indexable.
  assert.equal(workSeo('movie', 'cenicienta', 999, [row()], true).robots, 'noindex, follow');
  // Three cast members stand in for a director; a series needs neither year nor runtime.
  assert.equal(workContentPasses(row({ directors: [], castSummary: [{}, {}, {}] }), 'movie'), true);
});

test('M09-D: a verified film is indexable with upcoming broadcasts and stays so when they end', () => {
  assert.equal(workSeo('movie', 'cenicienta', 150689, [row()], true).disposition, 'indexable');
  assert.equal(workSeo('movie', 'cenicienta', 150689, [row()], false).robots, undefined);
});

test('M09-D: a complete record with a short synopsis is indexable on a recorded broadcast, never on the EPG of the day', () => {
  const SHORT = 'Indiana Jones vuelve en 1957 a buscar una calavera de cristal, perseguido por agentes soviéticos que quieren su poder.'.padEnd(200, '.');
  const shortFilm = row({ synopsis: SHORT });
  const shortSeries = row({ tmdbType: 'tv', title: 'La promesa', normalizedTitle: 'la promesa', synopsis: SHORT, year: undefined, runtimeMinutes: undefined });
  // GuíaTV broadcast it once (any date): indexable with or without a current airing.
  assert.equal(workSeo('movie', 'cenicienta', 150689, [shortFilm], false, true).disposition, 'indexable');
  assert.equal(workSeo('series', 'la-promesa', 150689, [shortSeries], false, true).disposition, 'indexable');
  // Never broadcast: the short text alone is not enough; a current airing only gives the transient `airing`.
  assert.equal(workSeo('movie', 'cenicienta', 150689, [shortFilm]).robots, 'noindex, follow');
  assert.equal(workSeo('movie', 'cenicienta', 150689, [shortFilm], true).disposition, 'airing');
  // Below Phase 3B's thin line, or any other gap, a broadcast record does not help.
  for (const over of [{ synopsis: SHORT.slice(0, 149) }, { synopsis: SHORT, lastEnrichedAt: undefined }, { synopsis: SHORT, tmdbGenres: [] },
    { synopsis: SHORT, posterPath: undefined }, { synopsis: SHORT, directors: [] }, { synopsis: SHORT, runtimeMinutes: undefined }] as Partial<WorkRow>[]) {
    assert.equal(workSeo('movie', 'cenicienta', 150689, [row(over)], false, true).disposition, 'thin', JSON.stringify(over).slice(0, 80));
  }
  // Boundaries: 150 is the short tier's floor, 300 needs no broadcast record.
  assert.equal(workSeo('movie', 'cenicienta', 150689, [row({ synopsis: 'x'.repeat(150) })], false, true).disposition, 'indexable');
  assert.equal(workSeo('movie', 'cenicienta', 150689, [row({ synopsis: 'x'.repeat(299) })]).disposition, 'thin');
  assert.equal(workSeo('movie', 'cenicienta', 150689, [row({ synopsis: 'x'.repeat(300) })]).disposition, 'indexable');
  // ...and never proves an identity: a namesake keeps the page noindex.
  assert.equal(workSeo('movie', 'cenicienta', 150689, [shortFilm, row({ tmdbId: 11224 })], true, true).disposition, 'ambiguous');
});

test('M09-C: different works with the same title are never merged; a wrong association is rejected', () => {
  const remake = row({ tmdbId: 11224, year: '1950' });
  assert.equal(workDisposition('cenicienta', 150689, 'movie', [row(), remake]), 'ambiguous');
  // The page resolved to an id no local row of this kind holds (live TMDB search): no proof.
  assert.equal(workDisposition('cenicienta', 999, 'movie', [row()]), 'ambiguous');
  // A series row with the same id and title is not this film.
  assert.equal(workDisposition('cenicienta', 150689, 'movie', [row({ tmdbType: 'tv' })]), 'ambiguous');
  // TMDB movie and tv ids share one number space: a namesake of the other kind does not make a film ambiguous.
  assert.equal(workDisposition('cenicienta', 150689, 'movie', [row(), row({ tmdbId: 5, tmdbType: 'tv' })]), 'indexable');
});

test('M09-C: the legacy accent-dropping slug is not the indexable variant', () => {
  const r = row({ title: 'El último sol', normalizedTitle: 'el ultimo sol' });
  assert.equal(workDisposition('el-ultimo-sol', 150689, 'movie', [r]), 'indexable');
  assert.equal(workDisposition('el-ltimo-sol', 150689, 'movie', [r]), 'variant');
});

test('M09-C: off by default; canary applies to a stable cohort; on applies everywhere', () => {
  assert.equal(workPolicyApplies('cenicienta', {} as NodeJS.ProcessEnv), false);
  assert.equal(workPolicyApplies('cenicienta', { WORK_SEO_POLICY: 'on' } as NodeJS.ProcessEnv), true);
  assert.equal(workPolicyApplies('cenicienta', { WORK_SEO_POLICY: 'canary', WORK_SEO_CANARY_PERCENT: '0' } as NodeJS.ProcessEnv), false);
  const env = { WORK_SEO_POLICY: 'canary', WORK_SEO_CANARY_PERCENT: '10' } as NodeJS.ProcessEnv;
  const cohort = Array.from({ length: 1000 }, (_, i) => `obra-${i}`).filter((s) => workPolicyApplies(s, env));
  assert.ok(cohort.length > 50 && cohort.length < 150, String(cohort.length));
  assert.deepEqual(cohort.filter((s) => workPolicyApplies(s, env)), cohort);
});

test('M09-C: a programme never declares a noindex work page as its canonical', () => {
  const ON = { PROGRAMME_SEO_POLICY: 'on' } as NodeJS.ProcessEnv;
  const page = { title: 'Gladiator', tmdbId: 98, workPath: '/peliculas/gladiator' };
  assert.deepEqual(programmeSeo('gladiator', { ...page, workIndexable: false }, ON),
    { disposition: 'work', applied: true, canonicalPath: '/programas/gladiator', robots: 'noindex, follow' });
  assert.equal(programmeSeo('gladiator', { ...page, workIndexable: true }, ON).canonicalPath, '/peliculas/gladiator');
  // Not evaluated (work policy off, or the catalogue could not be read): the M09-B canonical stands.
  assert.equal(programmeSeo('gladiator', page, ON).canonicalPath, '/peliculas/gladiator');
});
