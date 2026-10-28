/**
 * M09-C: the sitemap's work paths and the page's own verdict read the same rows the same way. Runs only with
 * TEST_MONGO_URI (throwaway database, dropped afterwards).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MediaCatalogModel } from '@/infrastructure/database/models/MediaCatalogEntry.model';
import { TVReadAiringModel } from '@/infrastructure/database/models/TVReadAiring.model';
import { indexableWorkPaths, readWorkRows, workSeo } from './WorkSeoPolicy';

const mongoUri = process.env.TEST_MONGO_URI;
const SYNOPSIS = 'Una joven huérfana vive con su madrastra y sus dos hermanastras, que la tratan como a una criada. '.repeat(4);
const work = (tmdbId: number, tmdbType: 'movie' | 'tv', title: string, over: Record<string, unknown> = {}) => ({
  tmdbId, tmdbType, contentType: tmdbType === 'movie' ? 'movie' : 'series', title,
  normalizedTitle: title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
  normalizedIdentity: `${tmdbType}:${tmdbId}`, synopsis: SYNOPSIS, year: '2015', runtimeMinutes: 100, posterPath: '/abc12.jpg',
  tmdbGenres: [{ id: 1, name: 'Drama' }], directors: ['Alguien'], castSummary: [], lastEnrichedAt: new Date('2026-10-01'), ...over,
});
const aired = (id: string, tmdbId: number, category: 'Cine' | 'Series', date = '20260410') => ({ id, date, program: { title: id, tmdbId, editorialCategory: category } });

test('M09-C: sitemap work paths = indexable, aired at least once (any date), in the cohort; same verdict as the page', { skip: !mongoUri }, async () => {
  await mongoose.connect(mongoUri as string, { dbName: `guiatv_test_m09c_${process.pid}` });
  try {
    await MediaCatalogModel.collection.insertMany([
      work(1, 'movie', 'Cenicienta'),
      work(2, 'tv', 'La promesa', { year: undefined, runtimeMinutes: undefined }),
      work(3, 'movie', 'La huella'), work(4, 'movie', 'La huella', { year: '1972' }),   // namesakes: never merged
      work(5, 'movie', 'Corta', { synopsis: 'Breve.' }),                                    // thin
      work(6, 'movie', 'Nunca emitida'),                                                    // no GuíaTV broadcast
      work(7, 'tv', 'Cenicienta'),                                                          // other kind, same title
    ]);
    // Old broadcasts only (March/April): the broadcast ended long ago and still counts. tmdb 7 aired as a film
    // category would not make the series eligible: the category decides the kind.
    await TVReadAiringModel.collection.insertMany([aired('a1', 1, 'Cine'), aired('a2', 2, 'Series'), aired('a3', 3, 'Cine'), aired('a4', 5, 'Cine'), aired('a5', 7, 'Cine', '20260320')]);

    const on = await indexableWorkPaths({ WORK_SEO_POLICY: 'on' } as NodeJS.ProcessEnv);
    assert.deepEqual(on, ['/peliculas/cenicienta', '/series/la-promesa']);
    assert.deepEqual(await indexableWorkPaths({} as NodeJS.ProcessEnv), [], 'off: nothing');
    assert.deepEqual(await indexableWorkPaths({ WORK_SEO_POLICY: 'canary', WORK_SEO_CANARY_PERCENT: 'x' } as NodeJS.ProcessEnv), [], 'invalid canary: nothing');

    // The page's verdict on the same rows agrees with the sitemap.
    assert.equal(workSeo('movie', 'cenicienta', 1, await readWorkRows('cenicienta')).disposition, 'indexable');
    assert.equal(workSeo('movie', 'la-huella', 3, await readWorkRows('la-huella')).disposition, 'ambiguous');
    assert.equal(workSeo('movie', 'nunca-emitida', 6, await readWorkRows('nunca-emitida')).disposition, 'indexable', 'indexable page, just not a sitemap entry');
  } finally {
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
  }
});
