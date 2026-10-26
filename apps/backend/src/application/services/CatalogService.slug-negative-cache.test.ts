import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogService } from './CatalogService';
import { InMemoryCache } from '@/infrastructure/cache/InMemoryCache';
import { NotFoundError } from '@/shared/errors';
import { TVReadAiringModel } from '@/infrastructure/database/models/TVReadAiring.model';

/**
 * Regression test for the OOM crash-loop caused by /v2/catalog/slug/:contentType/:slug
 * falling through to a live, uncached TMDB search on every single request for a slug
 * that doesn't exist (mostly bot traffic, userAgent "node", ~90% resulting in 404s).
 *
 * Proves:
 *  1. First lookup of a genuinely non-existent slug hits TMDB (slow path).
 *  2. A second identical lookup within the negative-cache TTL short-circuits and does
 *     NOT hit TMDB again.
 *  3. Concurrent identical lookups for the same not-yet-cached slug are de-duped into
 *     a single TMDB call instead of each independently paying the TMDB round trip.
 */

function buildService(tmdbCallCounter: { count: number }, cache: InMemoryCache) {
  const fakeTmdbService = {
    searchMovies: async (_query: string, _options?: { page?: number; limit?: number }) => {
      tmdbCallCounter.count += 1;
      // Simulate the slow TMDB round trip observed in production (bounded here so the
      // test stays fast, but long enough to prove concurrent calls actually overlap).
      await new Promise((resolve) => setTimeout(resolve, 25));
      return []; // genuinely no match -> "not found"
    },
    searchTV: async () => {
      tmdbCallCounter.count += 1;
      return [];
    },
  };

  return new CatalogService(
    {} as any, // channelRepository - unused on the not-found path
    cache,
    fakeTmdbService as any,
    {} as any, // streamingProvidersService - unused on the not-found path
    {} as any, // interactionRepository - unused on the not-found path
    {} as any // tvReadQueryService - unused for contentType 'movie'
  );
}

/**
 * The movie/series not-found path now falls back to a bounded TV-read
 * candidate query (EPG serials without a TMDB entry) before negative-caching.
 * Stub the static model so these tests stay hermetic; the test that asserts
 * the bounded-query shape overrides this with its own spy.
 */
function stubTvReadFind(): void {
  (TVReadAiringModel as any).distinct = () => ({ exec: async () => [] });
}

test('getBySlug: first lookup of a missing slug hits TMDB, second identical lookup is served from the negative cache', async () => {
  const tmdbCallCounter = { count: 0 };
  const cache = new InMemoryCache();
  const service = buildService(tmdbCallCounter, cache);
  stubTvReadFind();

  try {
    await cache.set('catalog:slug:notfound:program:programa-inexistente-distinto', true, 300);
    await assert.rejects(
      () => service.getBySlug('movie', 'this-movie-does-not-exist', undefined),
      NotFoundError
    );
    assert.equal(tmdbCallCounter.count, 1, 'first lookup should hit TMDB exactly once');

    const start = Date.now();
    await assert.rejects(
      () => service.getBySlug('movie', 'this-movie-does-not-exist', undefined),
      NotFoundError
    );
    const elapsedMs = Date.now() - start;

    assert.equal(
      tmdbCallCounter.count,
      1,
      'second identical lookup must be served from the negative cache, not TMDB'
    );
    assert.ok(
      elapsedMs < 25,
      `cached negative lookup should be near-instant, took ${elapsedMs}ms`
    );
  } finally {
    cache.destroy();
  }
});

test('getBySlug: concurrent identical lookups for a not-yet-cached slug are de-duped into a single TMDB call', async () => {
  const tmdbCallCounter = { count: 0 };
  const cache = new InMemoryCache();
  const service = buildService(tmdbCallCounter, cache);
  stubTvReadFind();

  try {
    const results = await Promise.allSettled([
      service.getBySlug('movie', 'concurrent-missing-slug', undefined),
      service.getBySlug('movie', 'concurrent-missing-slug', undefined),
      service.getBySlug('movie', 'concurrent-missing-slug', undefined),
      service.getBySlug('movie', 'concurrent-missing-slug', undefined),
      service.getBySlug('movie', 'concurrent-missing-slug', undefined),
    ]);

    assert.ok(
      results.every((result) => result.status === 'rejected'),
      'all concurrent lookups for a missing slug should reject with NotFoundError'
    );
    assert.equal(
      tmdbCallCounter.count,
      1,
      '5 concurrent requests for the same missing slug should trigger exactly 1 TMDB call'
    );

    // The negative cache should now be populated for subsequent requests too.
    await assert.rejects(
      () => service.getBySlug('movie', 'concurrent-missing-slug', undefined),
      NotFoundError
    );
    assert.equal(tmdbCallCounter.count, 1, 'follow-up lookup should still be cached');
  } finally {
    cache.destroy();
  }
});

test('getBySlug: distinct missing slugs are cached independently', async () => {
  const tmdbCallCounter = { count: 0 };
  const cache = new InMemoryCache();
  const service = buildService(tmdbCallCounter, cache);
  stubTvReadFind();

  try {
    await assert.rejects(() => service.getBySlug('movie', 'slug-one', undefined), NotFoundError);
    await assert.rejects(() => service.getBySlug('movie', 'slug-two', undefined), NotFoundError);

    assert.equal(
      tmdbCallCounter.count,
      2,
      'two distinct missing slugs should each hit TMDB once'
    );
  } finally {
    cache.destroy();
  }
});

// M10: the guide links work slugs a local catalogue row resolves; a miss cached before that row existed must not 404 them.
test('getBySlug: a cached miss is ignored once a local catalogue row resolves the slug, and still served otherwise', async () => {
  const tmdbCallCounter = { count: 0 };
  const cache = new InMemoryCache();
  const service = buildService(tmdbCallCounter, cache);
  stubTvReadFind();
  (service as any).mediaCatalogService = {
    findKnownMatchesForTitles: async (titles: string[]) =>
      titles.includes('heat') ? [{ tmdbId: 949, tmdbType: 'movie', title: 'Heat' }] : [],
  };
  (service as any).getTmdbDetail = async (tmdbId: number) => ({ catalogId: `tmdb:movie:${tmdbId}`, tmdbId, title: 'Heat', slug: 'heat' });

  try {
    await cache.set('catalog:slug:notfound:movie:heat', true, 300);
    await cache.set('catalog:slug:notfound:movie:no-such-film', true, 300);
    assert.equal((await service.getBySlug('movie', 'heat', undefined)).tmdbId, 949);
    await assert.rejects(() => service.getBySlug('movie', 'no-such-film', undefined), NotFoundError);
    assert.equal(tmdbCallCounter.count, 0, 'neither lookup may reach TMDB');
  } finally {
    cache.destroy();
  }
});

function stubTvReadSlug(
  titlesByToken: Record<string, string[]>,
  observed: Record<string, unknown>[] = []
): () => void {
  const originalDistinct = TVReadAiringModel.distinct;
  const originalFindOne = TVReadAiringModel.findOne;
  (TVReadAiringModel as any).distinct = (_field: string, query: Record<string, unknown>) => {
    observed.push(query);
    return { exec: async () => titlesByToken[String(query.searchTokens)] || [] };
  };
  (TVReadAiringModel as any).findOne = (query: { 'program.title': string }) => ({
    sort: () => ({
      lean: () => ({ exec: async () => ({ id: 'airing-1', program: { title: query['program.title'] } }) }),
    }),
  });
  return () => {
    TVReadAiringModel.distinct = originalDistinct;
    TVReadAiringModel.findOne = originalFindOne;
  };
}

test('getBySlug: missing program slugs use bounded indexed token lookups instead of hydrating the day view', async () => {
  const cache = new InMemoryCache();
  const tmdbCallCounter = { count: 0 };
  const service = buildService(tmdbCallCounter, cache);
  const observed: Record<string, unknown>[] = [];
  const restore = stubTvReadSlug({}, observed);

  try {
    await assert.rejects(
      () => service.getBySlug('program', 'programa-inexistente-distinto', undefined),
      NotFoundError
    );

    assert.equal(observed.length, 6, 'each indexed token is checked for today and tomorrow');
    observed.forEach((query, index) => {
      assert.equal(query.searchTokens, ['inexistente', 'programa', 'distinto'][index % 3]);
      assert.match(String(query.date), /^\d{8}$/);
    });
    assert.equal(tmdbCallCounter.count, 0, 'program lookup must not call TMDB');
  } finally {
    restore();
    cache.destroy();
  }
});

test('program slug lookup is not crowded out by common search tokens', async () => {
  const cache = new InMemoryCache();
  const service = buildService({ count: 0 }, cache);
  const title = 'The Gentlemen: Los señores de la mafia';
  const restore = stubTvReadSlug({
    gentlemen: [title],
    mafia: Array.from({ length: 2000 }, (_, index) => `Common result ${index}`),
  });

  try {
    const found = await (service as any).findTvReadItemBySlug(
      'the gentlemen los seores de la mafia',
      'the-gentlemen-los-seores-de-la-mafia',
      '20260831'
    );
    assert.equal(found?.id, 'airing-1');
  } finally {
    restore();
    cache.destroy();
  }
});

test('program slug "deportes" resolves although the category token tags thousands of airings', async () => {
  const cache = new InMemoryCache();
  const service = buildService({ count: 0 }, cache);
  const restore = stubTvReadSlug({
    deportes: [...Array.from({ length: 900 }, (_, index) => `Deportes ${index + 2}`), 'Deportes'],
  });

  try {
    const found = await (service as any).findTvReadItemBySlug('deportes', 'deportes', '20261020');
    assert.equal(found?.program.title, 'Deportes');
  } finally {
    restore();
    cache.destroy();
  }
});

// 2D-2C.2: the exact-title fetch walked the whole day (prod: 11,697 docs, 499 ms) without the token that found it.
test('program slug lookup narrows the airing fetch by the title token that found it', async () => {
  const cache = new InMemoryCache();
  const service = buildService({ count: 0 }, cache);
  const fetched: Record<string, unknown>[] = [];
  const restore = stubTvReadSlug({ joe: ['G.I. Joe'], syfy: ['Joe Night'] });
  const stubbedFindOne = TVReadAiringModel.findOne;
  (TVReadAiringModel as any).findOne = (query: Record<string, unknown>) => {
    fetched.push(query);
    return (stubbedFindOne as any)(query);
  };

  try {
    assert.equal((await (service as any).findTvReadItemBySlug('g i joe', 'gi-joe', '20261021'))?.program.title, 'G.I. Joe');
    assert.deepEqual(fetched[0], { date: '20261021', searchTokens: 'joe', 'program.title': 'G.I. Joe' });

    // A token that is not part of the title (here a channel name) may be missing on some of its airings: no narrowing.
    await (service as any).findTvReadItemBySlug('syfy', 'joe-night', '20261021');
    assert.deepEqual(fetched[1], { date: '20261021', 'program.title': 'Joe Night' });
  } finally {
    restore();
    cache.destroy();
  }
});
