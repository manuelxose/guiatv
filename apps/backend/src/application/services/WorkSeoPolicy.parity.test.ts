/**
 * M13-B3b: the bounded, time-sliced selection and graph build give EXACTLY the output of the pre-M13-B3b code
 * (WorkSeoPolicy.selectIndexableWorks and `new RelatedWorkGraph` as of cf19518), including destinations and order.
 * The oracle (WorkSeoPolicy.parity.fixtures.ts) is a literal copy of the cf19518 selection; nothing else computes a verdict.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { RelatedWorkGraph, RelatedWorkIndex } from './RelatedWorks';
import { selectIndexableWorks, selectIndexableWorksSliced, type IndexableWork } from './WorkSeoPolicy';
import { air, ENV, fixture, oracle, prng, row, SYN, type Aired, type Row } from './WorkSeoPolicy.parity.fixtures';
import { TimeSlice } from '@/shared/utils/timeSlice';

const airedSet = (aired: Aired) => new Set(aired.map((a) => `${a._id.c === 'Cine' ? 'movie' : 'tv'}:${a._id.id}`));

test('SEO fixture: the sync reference, the sliced selection and the cf19518 oracle agree exactly (paths, fields, order)', async () => {
  const { rows, aired } = fixture();
  const expected = oracle(rows, aired, ENV);
  assert.deepEqual(selectIndexableWorks(rows, aired, ENV), expected);
  const slice = new TimeSlice(0);
  assert.deepEqual(await selectIndexableWorksSliced(rows, airedSet(aired), ENV, slice), expected);
  assert.ok(slice.yields > 10, `the sliced selection really yielded (${slice.yields})`);
  const paths = expected.map((w) => w.path);
  assert.deepEqual(paths, [...paths].sort());
  // The scenarios behave as designed (so the equality above is not vacuous).
  for (const p of ['/peliculas/cenicienta', '/series/la-promesa', '/peliculas/sinopsis-media', '/peliculas/mismo-id', '/peliculas/duplicada', '/series/historica', '/peliculas/generos-raros']) assert.ok(paths.includes(p), p);
  for (const p of ['/peliculas/la-huella', '/peliculas/tres-caminos', '/peliculas/corta', '/peliculas/sin-poster', '/peliculas/sin-reparto', '/peliculas/sin-ano', '/peliculas/sin-enriquecer',
    '/peliculas/nunca-emitida', '/peliculas/cenicienta-nueva', '/series/otro-mismo-id', '/peliculas/sin-generos', '/peliculas/generos-nulos', '/peliculas/generos-vacios']) assert.ok(!paths.includes(p), `${p} must stay out of the sitemap set`);
  assert.deepEqual(expected.find((w) => w.path === '/peliculas/generos-raros')?.genreIds, [35]);
  assert.ok(expected.filter((w) => w.path === '/peliculas/duplicada').length === 1, 'duplicate rows give one destination');
});


test('property: 4 000 seeded rows from a small vocabulary (frequent namesakes, ids shared across kinds) select identically', async () => {
  for (const seed of [1, 7, 42]) {
    const rnd = prng(seed);
        const rows: Row[] = []; const aired: Aired = [];
    for (let i = 0; i < 4_000; i += 1) {
      const kind = rnd() < 0.5 ? 'movie' : 'tv';
      const id = 1 + Math.floor(rnd() * 900);
      const title = rnd() < 0.03 ? 'Sin título' : rnd() < 0.12 && rows.length ? (rows[Math.floor(rnd() * rows.length)].title as string) : `Título ${kind} ${id}`; // 12% namesakes
      rows.push(row(id, kind, title, {
        synopsis: rnd() < 0.2 ? 'corta' : SYN.slice(0, rnd() < 0.15 ? 200 : 400), posterPath: rnd() < 0.1 ? undefined : '/p.jpg', year: rnd() < 0.1 ? undefined : '2001',
        tmdbGenres: rnd() < 0.1 ? [] : [{ id: 1 + Math.floor(rnd() * 5) }, { id: 6 + Math.floor(rnd() * 5) }], lastEnrichedAt: rnd() < 0.1 ? undefined : new Date(0),
      }));
      if (rnd() < 0.6) aired.push(air(id, kind));
    }
    const expected = oracle(rows, aired, ENV);
    assert.ok(expected.length > 20, `seed ${seed}: ${expected.length} works`);
    assert.deepEqual(selectIndexableWorks(rows, aired, ENV), expected, `sync, seed ${seed}`);
    assert.deepEqual(await selectIndexableWorksSliced(rows, airedSet(aired), ENV, new TimeSlice(0)), expected, `sliced, seed ${seed}`);
  }
});

test('graph: the sliced build equals the synchronous one (rings, size and every related-works answer)', async () => {
  const { rows, aired } = fixture();
  const rnd = prng(3);
  const extra = Array.from({ length: 1_500 }, (_, i) => row(1_000 + i, i % 3 ? 'movie' : 'tv', `Obra ${i}`, { tmdbGenres: Array.from({ length: Math.floor(rnd() * 4) }, () => ({ id: 1 + Math.floor(rnd() * 12) })) }));
  const all = [...rows, ...extra]; const airedAll = [...aired, ...extra.map((r) => air(r.tmdbId as number, r.tmdbType as 'movie' | 'tv'))];
  const works = oracle(all, airedAll, ENV);
  assert.ok(works.length > 1_000);
  const sync = new RelatedWorkGraph(works);
  const slice = new TimeSlice(0);
  const sliced = await RelatedWorkGraph.buildSliced(works, slice);
  assert.ok(slice.yields > 100);
  assert.equal(sliced.size, sync.size);
  assert.deepEqual(JSON.parse(JSON.stringify([...(sliced as any).rings])), JSON.parse(JSON.stringify([...(sync as any).rings])), 'identical rings');
  for (const w of works) {
    for (const limit of [3, 8]) assert.deepEqual(sliced.related(w.kind, w.tmdbId, [], limit), sync.related(w.kind, w.tmdbId, [], limit), `${w.path} limit ${limit}`);
  }
  assert.deepEqual(sliced.related('movie', 999_999, [1, 2, 3]), sync.related('movie', 999_999, [1, 2, 3]), 'a work outside the set');
  // M10-B guarantee on the sliced graph: every work of the set is linked from another work of the set.
  const linked = new Set<string>();
  for (const w of works) for (const r of sliced.related(w.kind, w.tmdbId, [], 8)) linked.add(r.path);
  const orphans = works.filter((w) => w.genreIds.length >= 0 && !linked.has(w.path));
  assert.equal(orphans.length, 0, `orphaned verified works: ${orphans.map((o) => o.path).join(',')}`);
});

test('time slicing yields to the event loop: a timer set before the build runs before the build ends', async () => {
  const works = oracle(fixture().rows, fixture().aired, ENV);
  let timerFired = false;
  setTimeout(() => { timerFired = true; }, 0);
  const slice = new TimeSlice(0);
  await RelatedWorkGraph.buildSliced(works, slice);
  assert.ok(timerFired, 'the timer ran while the graph was being built');
  assert.ok(slice.yields >= works.length);
  const quiet = new TimeSlice(1e9);
  await RelatedWorkGraph.buildSliced(works, quiet);
  assert.equal(quiet.yields, 0, 'a slice with budget left never yields');
});

test('refresh stays atomic: the previous graph is served until the new one is complete; a failed build keeps it', async () => {
  const { rows, aired } = fixture();
  const first = oracle(rows, aired, ENV);
  const second = oracle([...rows, row(777, 'movie', 'Recien llegada')], [...aired, air(777, 'movie')], ENV);
  let clock = 0;
  let step = 0;
  let release!: () => void;
  const index = new RelatedWorkIndex(async () => {
    step += 1;
    if (step === 1) return first;
    if (step === 2) { await new Promise<void>((r) => { release = r; }); return second; }
    return [null] as unknown as IndexableWork[]; // a build that throws
  }, 1_000, () => clock);

  await (index as any).refresh();
  const g1 = await index.get();
  assert.equal(g1?.size, first.length);

  clock = 5_000; // stale: the next get() starts a background refresh and still answers with the old graph
  assert.equal((await index.get())?.size, first.length, 'a request never waits and never sees a partial graph');
  await new Promise((r) => setImmediate(r));
  assert.equal((await index.get())?.size, first.length, 'still the old graph while the new read is in flight');
  release();
  await (index as any).inFlight;
  assert.equal((await index.get())?.size, second.length, 'swapped in whole once complete');

  clock = 20_000;
  await (index as any).refresh(); // step 3: the build throws
  assert.equal((await index.get())?.size, second.length, 'a failed build keeps the last good graph');
});
