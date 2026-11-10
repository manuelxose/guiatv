import test from 'node:test';
import assert from 'node:assert/strict';
import { attachVerifiedWorkBackdrops } from './TvReadModelBuilder';

const poster = { kind: 'poster', role: 'primary', source: 'epg_program_image', url: 'https://epg.test/poster.jpg' };

const airing = (program: Record<string, unknown>) => ({
  program,
  assets: { primary: poster, poster, fallbackChain: [poster], candidates: [poster] } as Record<string, any>,
  sourceProvenance: { assets: ['epg_program_image'] } as { assets: string[] },
});

test('adds the verified work backdrop as a fallback asset and keeps the poster primary', () => {
  const row = airing({ workBackdropUrl: 'https://image.tmdb.org/t/p/w1280/heat.jpg' });

  attachVerifiedWorkBackdrops([row]);

  assert.equal(row.assets.backdrop?.url, 'https://image.tmdb.org/t/p/w1280/heat.jpg');
  assert.equal(row.assets.backdrop?.kind, 'backdrop');
  assert.equal(row.assets.primary, poster);
  assert.equal(row.assets.poster, poster);
  assert.deepEqual(row.assets.fallbackChain.map((asset: any) => asset.url), [poster.url, 'https://image.tmdb.org/t/p/w1280/heat.jpg']);
  assert.deepEqual(row.sourceProvenance.assets, ['epg_program_image', 'tmdb_backdrop']);
});

test('leaves an airing without a verified backdrop untouched', () => {
  const row = airing({});

  attachVerifiedWorkBackdrops([row]);

  assert.equal(row.assets.backdrop, undefined);
  assert.deepEqual(row.assets.fallbackChain, [poster]);
  assert.deepEqual(row.sourceProvenance.assets, ['epg_program_image']);
});

test('is idempotent when the same backdrop is attached twice', () => {
  const row = airing({ workBackdropUrl: 'https://image.tmdb.org/t/p/w1280/heat.jpg' });

  attachVerifiedWorkBackdrops([row]);
  attachVerifiedWorkBackdrops([row]);

  assert.equal(row.assets.fallbackChain.length, 2);
  assert.deepEqual(row.sourceProvenance.assets, ['epg_program_image', 'tmdb_backdrop']);
});
