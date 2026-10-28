import assert from 'node:assert/strict';
import test from 'node:test';
import { CatalogService } from './CatalogService';
import { TVReadAiringModel } from '@/infrastructure/database/models/TVReadAiring.model';
import { airingDetailSlug, programDetailPath } from '@/domain/services/detailPath';

const catalog = new CatalogService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

const tvRead = (title: string, editorialCategory: string) => ({
  id: 'airing-1',
  program: { title, editorialCategory, genre: editorialCategory },
  airing: { start: '2026-10-22T20:00:00.000Z', end: '2026-10-22T22:00:00.000Z', durationMinutes: 120, liveNow: false },
  assets: { fallbackChain: [] },
  sourceProvenance: { schedule: [], metadata: [], assets: [] },
  timingContext: { liveNow: false },
  channel: { id: 'la_1', name: 'La 1', aliases: [], sourceIds: [], group: 'tdt' },
});

const paths = (title: string, category: string) => [
  (catalog as any).mapTvReadItemToCatalogItem(tvRead(title, category)).detailPath,
  (catalog as any).mapTvReadItemToAiring(tvRead(title, category)).detailPath,
];

// Production 2026-10-22: hub cards linked /peliculas/atmica and /series/friends-t3-e1-… (404); these resolve.
test('film and series airings link to their known airing instead of guessing a work route', () => {
  const knownPath = ['/contenido/program:airing-1', '/contenido/program:airing-1'];
  assert.deepEqual(paths('Atómica', 'Cine'), knownPath);
  assert.deepEqual(paths('Friends T3 E1 El de la fantasía de la princesa Leia', 'Series'), knownPath);
  assert.deepEqual(paths('Camino a la perdición', 'Series'), knownPath);
  assert.deepEqual(paths('Agatha Christie: Poirot', 'Series'), knownPath);
  assert.equal(airingDetailSlug('movie', 'Atómica'), 'atomica');
  assert.equal(airingDetailSlug('series', 'Friends T3 E1 El de la fantasía de la princesa Leia'), 'friends');
  assert.equal(programDetailPath('source/unsafe?#'), '/contenido/program:source%2Funsafe%3F%23');
});

test('programme airings use known ids and the folded slug (M09-B); the legacy slug still resolves (below)', () => {
  assert.deepEqual(paths('España directo', 'Magacín'), ['/contenido/program:airing-1', '/contenido/program:airing-1']);
  assert.equal(airingDetailSlug('program', 'España directo'), 'espana-directo');
});

// QA on this change: with no TMDB match the slug falls back to the TV read model, which must accept every slug
// airingDetailSlug links, or a film/series without a TMDB entry would 404 (and be negative-cached).
test('the TV read slug fallback resolves the slugs airing links now use', async () => {
  const titles = ['Él Sueño', 'Serie Local T1 E3', 'España directo'];
  const original = { distinct: TVReadAiringModel.distinct, findOne: TVReadAiringModel.findOne };
  (TVReadAiringModel as any).distinct = () => ({ exec: async () => titles });
  (TVReadAiringModel as any).findOne = (filter: { 'program.title': string }) => ({
    sort: () => ({ lean: () => ({ exec: async () => ({ id: filter['program.title'] }) }) }),
  });
  try {
    const find = (text: string, slug: string) => (catalog as any).findTvReadItemBySlug(text, slug, '20261022');
    assert.equal((await find('el sueno', 'el-sueno'))?.id, 'Él Sueño');
    assert.equal((await find('serie local', 'serie-local'))?.id, 'Serie Local T1 E3');
    assert.equal((await find('espaa directo', 'espaa-directo'))?.id, 'España directo');
    assert.equal((await find('espana directo', 'espana-directo'))?.id, 'España directo');
    assert.equal(await find('otro titulo', 'otro-titulo'), null);
  } finally {
    Object.assign(TVReadAiringModel, original);
  }
});

test('a series slug cannot fall back to a homonymous movie airing', async () => {
  const original = { distinct: TVReadAiringModel.distinct, findOne: TVReadAiringModel.findOne };
  (TVReadAiringModel as any).distinct = () => ({ exec: async () => ['Camino a la perdición'] });
  (TVReadAiringModel as any).findOne = () => ({
    sort: () => ({ lean: () => ({ exec: async () => tvRead('Camino a la perdición', 'Cine') }) }),
  });
  try {
    const find = (type: string) => (catalog as any).findTvReadItemBySlug('camino a la perdicion', 'camino-a-la-perdicion', '20261022', type);
    assert.equal(await find('series'), null);
    assert.equal((await find('movie'))?.id, 'airing-1');
  } finally {
    Object.assign(TVReadAiringModel, original);
  }
});
