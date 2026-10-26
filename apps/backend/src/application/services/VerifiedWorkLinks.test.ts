import test from 'node:test';
import assert from 'node:assert/strict';
import { LinkRow } from '@/domain/services/catalogueLinker';
import { assignVerifiedWorkPaths, slugLookupKey, SlugRowReader, WorkLinkProgram } from './VerifiedWorkLinks';

const rows: LinkRow[] = [
  { id: 'heat', tmdbId: 949, tmdbType: 'movie', title: 'Heat', originalTitle: 'Heat', normalizedTitle: 'heat' },
  { id: 'atomica', tmdbId: 341013, tmdbType: 'movie', title: 'Atómica', originalTitle: 'Atomic Blonde', normalizedTitle: 'atomica' },
  { id: 'friends', tmdbId: 1668, tmdbType: 'tv', title: 'Friends', originalTitle: 'Friends', normalizedTitle: 'friends' },
  { id: 'psycho-tv', tmdbId: 539, tmdbType: 'tv', title: 'Psicosis', normalizedTitle: 'psicosis' },
  { id: 'twin', tmdbId: 77, tmdbType: 'movie', title: 'Twin', normalizedTitle: 'twin' },
];
const reader = async (ids: number[]) => rows.filter((r) => ids.includes(r.tmdbId as number));
// Rows the detail page could resolve a slug to, keyed by normalizedTitle: "twin" has a homonymous film with another id.
const slugRows = [...rows, { tmdbId: 78, tmdbType: 'movie' as const, title: 'Twin', normalizedTitle: 'twin' }];
const slugReader: SlugRowReader = async (keys) => slugRows.filter((r) => keys.includes(r.normalizedTitle as string));

const film = (title: string, tmdbId: number, mediaId?: string): WorkLinkProgram => ({ title, tmdbId, mediaId, editorialCategory: 'Cine' });

test('links a verified film and a series episode airing to their work page, folding accents like the page resolver', async () => {
  const programs = [film('Heat', 949, 'heat'), film('Atómica', 341013, 'atomica'), { title: 'Friends T3 E1 El de la princesa Leia', tmdbId: 1668, mediaId: 'friends', editorialCategory: 'Series' }];
  const counts = await assignVerifiedWorkPaths(programs, { reader, slugReader });
  assert.deepEqual(programs.map((p) => p.workPath), ['/peliculas/heat', '/peliculas/atomica', '/series/friends']);
  assert.equal(counts.linked, 3);
});

test('rejects every unproven relationship and leaves the airing route in charge', async () => {
  const programs: WorkLinkProgram[] = [
    { title: 'Heat', tmdbId: 949, editorialCategory: 'Documentales' }, // not Cine/Series
    film('Heat', 949), // TMDB id but no mediaId: a derived link is never enough
    film('Psicosis', 539, 'psycho-tv'), // Cine airing on a tv row: wrong kind
    film('Heat', 949, 'atomica'), // mediaId of another TMDB id
    film('Combustión espontánea', 341013, 'atomica'), // shared id, title key differs from the row
    film('Twin', 77, 'twin'), // the slug also resolves to a different film
  ];
  const counts = await assignVerifiedWorkPaths(programs, { reader, slugReader });
  assert.deepEqual(programs.map((p) => p.workPath), [undefined, undefined, undefined, undefined, undefined, undefined]);
  assert.equal(counts.linked, 0);
  assert.equal(counts.not_cine_or_series, 1);
  assert.equal(counts.no_media_id, 1);
  assert.equal(counts.media_id_rejected, 2);
  assert.equal(counts.title_key_mismatch, 1);
  assert.equal(counts.slug_ambiguous, 1);
});

test('a TMDB id carried by two different titles in the build is not linked for either', async () => {
  const programs = [film('Heat', 949, 'heat'), film('Heat 2', 949)];
  const counts = await assignVerifiedWorkPaths(programs, { reader, slugReader });
  assert.equal(programs[0].workPath, undefined);
  assert.equal(counts.tmdb_id_shared_by_other_titles, 1);
});

test('a slug the local lookup cannot find is not linked (the page would fall back to a live search)', async () => {
  const programs = [film('Heat', 949, 'heat')];
  const counts = await assignVerifiedWorkPaths(programs, { reader, slugReader: async () => [] });
  assert.equal(programs[0].workPath, undefined);
  assert.equal(counts.slug_unresolved, 1);
});

test('fails closed: a catalogue read error assigns nothing and clears stale values', async () => {
  const programs = [{ ...film('Heat', 949, 'heat'), workPath: '/peliculas/stale' }];
  const counts = await assignVerifiedWorkPaths(programs, { reader: async () => { throw new Error('down'); }, slugReader });
  assert.equal(programs[0].workPath, undefined);
  assert.equal(counts.errors, 1);
  const again = [film('Heat', 949, 'heat')];
  await assignVerifiedWorkPaths(again, { reader, slugReader: async () => { throw new Error('down'); } });
  assert.equal(again[0].workPath, undefined);
});

test('reads are batched: one slug query for many airings of the same work', async () => {
  let slugQueries = 0;
  const programs = Array.from({ length: 40 }, () => film('Heat', 949, 'heat'));
  await assignVerifiedWorkPaths(programs, { reader, slugReader: async (keys) => { slugQueries += 1; return slugReader(keys); } });
  assert.equal(slugQueries, 1);
  assert.ok(programs.every((p) => p.workPath === '/peliculas/heat'));
});

test('slugLookupKey matches the key getBySlug derives (normalizeTvToken with spaces)', () => {
  assert.equal(slugLookupKey('spider-man-no-way-home'), 'spider man no way home');
  assert.equal(slugLookupKey('atomica'), 'atomica');
});
