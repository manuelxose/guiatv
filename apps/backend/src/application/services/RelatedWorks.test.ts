import assert from 'node:assert/strict';
import test from 'node:test';
import { RelatedWorkGraph, RelatedWorkIndex } from './RelatedWorks';
import type { IndexableWork } from './WorkSeoPolicy';

const work = (kind: 'movie' | 'tv', tmdbId: number, genreIds: number[]): IndexableWork =>
  ({ kind, tmdbId, genreIds, title: `T${tmdbId}`, path: `/${kind === 'movie' ? 'peliculas' : 'series'}/t${tmdbId}` });

// 600 films over 6 genres (1-3 genres each), 300 series; ids are disjoint only by kind (TMDB reuses numbers).
const films = Array.from({ length: 600 }, (_, i) => work('movie', i + 1, [i % 6, ...(i % 3 ? [(i + 1) % 6] : []), ...(i % 5 ? [] : [(i + 3) % 6])]));
const series = Array.from({ length: 300 }, (_, i) => work('tv', i + 1, [100 + (i % 4)]));
const graph = new RelatedWorkGraph([...films, ...series]);

test('M10-B: related works are of the set, same kind, never the work itself, at most 8, deterministic', () => {
  for (const w of films.slice(0, 50)) {
    const got = graph.related('movie', w.tmdbId);
    assert.equal(got.length, 8);
    assert.ok(got.every((r) => r.kind === 'movie' && r.tmdbId !== w.tmdbId && r.path.startsWith('/peliculas/')));
    assert.equal(new Set(got.map((r) => r.path)).size, 8, 'no duplicates');
    // Genre rings come first: the first picks share a genre with the work.
    assert.ok(got.slice(0, w.genreIds.length).every((r) => r.genreIds.some((g) => w.genreIds.includes(g))));
    assert.deepEqual(graph.related('movie', w.tmdbId).map((r) => r.path), got.map((r) => r.path));
  }
  // Series 7 and film 7 share a number, not an identity: each gets its own kind.
  assert.ok(graph.related('tv', 7).every((r) => r.kind === 'tv'));
});

test('M10-B: every work of the set is linked from another work of the set (no new orphan)', () => {
  const linked = new Set<string>();
  for (const w of [...films, ...series]) for (const r of graph.related(w.kind, w.tmdbId)) linked.add(r.path);
  assert.deepEqual([...films, ...series].filter((w) => !linked.has(w.path)).map((w) => w.path), []);
});

test('M10-B: link depth: from one entry work the whole kind is reached in a few clicks, not along a chain', () => {
  const depth = new Map<string, number>([[films[0].path, 0]]);
  for (let frontier = [films[0]], d = 1; frontier.length; d++) {
    const next: IndexableWork[] = [];
    for (const w of frontier) for (const r of graph.related('movie', w.tmdbId)) if (!depth.has(r.path)) { depth.set(r.path, d); next.push(r); }
    frontier = next;
  }
  assert.equal(depth.size, films.length, 'every film reachable');
  assert.ok(Math.max(...depth.values()) <= 6, `max depth ${Math.max(...depth.values())}`);
});

test('M10-B: a work outside the set uses its detail genres; an unknown kind or an empty set links nothing', () => {
  const got = graph.related('movie', 99999, [2]);
  assert.equal(got.length, 8);
  assert.ok(got[0].genreIds.includes(2));
  assert.deepEqual(new RelatedWorkGraph([]).related('movie', 1, [1]), []);
  assert.deepEqual(new RelatedWorkGraph([work('movie', 1, [1])]).related('movie', 1), [], 'alone: nothing to link');
});

test('M10-B: a request never waits for the catalogue read; refresh in the background, keep the last good set, back off', async () => {
  let now = 0;
  let calls = 0;
  let fail = false;
  let release!: () => void;
  const gate = new Promise<void>((ok) => { release = ok; });
  const index = new RelatedWorkIndex(async () => { calls += 1; await gate; if (fail) throw new Error('db down'); return films; }, 1000, () => now);
  const [a, b] = await Promise.all([index.get(), index.get()]);
  assert.equal(a, undefined, 'cold: no rail, no wait');
  assert.equal(b, undefined);
  assert.equal(calls, 1, 'one read in flight');
  release();
  await new Promise((ok) => setImmediate(ok));
  const g = await index.get();
  assert.equal(g?.size, 600);
  now = 2000; fail = true;
  assert.equal(await index.get(), g, 'stale set served while refreshing');
  await new Promise((ok) => setImmediate(ok));
  assert.equal(calls, 2);
  assert.equal(await index.get(), g, 'failed refresh keeps the last good set');
  assert.equal(calls, 2, 'backs off for a minute after a failure');

  const cold = new RelatedWorkIndex(async () => { calls += 1; throw new Error('db down'); }, 1000, () => now);
  calls = 0;
  assert.equal(await cold.get(), undefined, 'no set: nothing, never an unverified fallback');
  await new Promise((ok) => setImmediate(ok));
  assert.equal(await cold.get(), undefined);
  assert.equal(calls, 1, 'backs off for a minute after a failure');
  now += 61_000;
  await cold.get();
  assert.equal(calls, 2);
});

test('M10-B: works without genres and works with many genres still get an inlink; the rail stays mostly on genre', () => {
  const set = [
    ...Array.from({ length: 200 }, (_, i) => work('movie', i + 1, [i % 3])),
    ...Array.from({ length: 20 }, (_, i) => work('movie', 1000 + i, [])),                          // no genre ids
    ...Array.from({ length: 20 }, (_, i) => work('movie', 2000 + i, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])), // more than 8
  ];
  const g = new RelatedWorkGraph(set);
  const linked = new Set<string>();
  for (const w of set) for (const r of g.related(w.kind, w.tmdbId)) linked.add(r.path);
  assert.deepEqual(set.filter((w) => !linked.has(w.path)).map((w) => w.path), []);
  const single = g.related('movie', 1);
  assert.ok(single.filter((r) => r.genreIds.includes(0)).length >= 6, 'a single-genre work: mostly the same genre');
});
