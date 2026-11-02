import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogService } from './CatalogService';
import type { FeedAliasTarget } from './ChannelFeedAliases';

/**
 * M10-D: a work page used to name the airing's own channel, so an airing of a verified second feed linked
 * `/canales/etb2-tv`, which answers 301. Measured on production 2026-11-02: 4 such targets, 19 link instances.
 * The airing is kept - the two feeds carry the same schedule, which is what made the pair a verified alias -
 * but it is presented under the channel GuíaTV publishes.
 */
const aliases = new Map<string, FeedAliasTarget>([
  ['etb2_tv', { id: 'etb_2', name: 'ETB 2', normalizedName: 'etb_2' }],
  // A reviewed pair whose canonical feed has no display name of its own.
  ['veo7_tv', { id: 'veo7', normalizedName: 'veo7' }],
]);

const channel = (id: string, name: string, normalizedName: string) => ({
  id, name, normalizedName, icon: `${id}.png`, aliases: [], sourceIds: [`${name}.TV`], group: 'autonomico', region: 'es',
});

const item = (ch: ReturnType<typeof channel>) => ({
  id: `${ch.id}-slot`,
  channel: ch,
  program: { title: 'NAVY: Investigación criminal', editorialCategory: 'Series' },
  airing: { start: '2026-11-02T20:00:00Z', end: '2026-11-02T21:00:00Z', durationMinutes: 60, liveNow: false },
  assets: {},
});

function serviceWith(current?: () => Map<string, FeedAliasTarget>) {
  return new CatalogService(
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    undefined, undefined, undefined, current ? ({ current } as never) : undefined
  ) as never as {
    mapTvReadItemToAiring(item: unknown): { channelId: string; channelNormalizedName: string; channelName: string };
    canonicalChannelOf(channel: unknown): { id: string; name: string; normalizedName: string };
  };
}

test('an airing of a verified second feed is named after the channel the site publishes', () => {
  const service = serviceWith(() => aliases);

  const aliased = service.mapTvReadItemToAiring(item(channel('etb2_tv', 'ETB2.TV', 'etb2_tv')));
  assert.equal(aliased.channelNormalizedName, 'etb_2', 'the link must not point at a URL that answers 301');
  assert.equal(aliased.channelId, 'etb_2');
  assert.equal(aliased.channelName, 'ETB 2');

  // No display name on the target: the alias keeps its own rather than showing nothing.
  const unnamed = service.canonicalChannelOf(channel('veo7_tv', 'Veo7.TV', 'veo7_tv'));
  assert.deepEqual([unnamed.id, unnamed.normalizedName, unnamed.name], ['veo7', 'veo7', 'Veo7.TV']);
});

test('a channel that is not an alias is untouched, including the .TV channels M10-C kept', () => {
  const service = serviceWith(() => aliases);
  // ETB1.TV is in the sitemap as its own channel (44 % schedule match: M10-C refused to call it a duplicate).
  for (const ch of [channel('etb1_tv', 'ETB1.TV', 'etb1_tv'), channel('la_1', 'La 1', 'la_1')]) {
    const airing = service.mapTvReadItemToAiring(item(ch));
    assert.equal(airing.channelNormalizedName, ch.normalizedName, ch.name);
    assert.equal(airing.channelId, ch.id, ch.name);
  }
});

test('without an alias list, or when it throws, every airing is served as itself', () => {
  for (const current of [undefined, () => { throw new Error('directory down'); }]) {
    const service = serviceWith(current as (() => Map<string, FeedAliasTarget>) | undefined);
    const airing = service.mapTvReadItemToAiring(item(channel('etb2_tv', 'ETB2.TV', 'etb2_tv')));
    assert.equal(airing.channelNormalizedName, 'etb2_tv', 'a page must never fail over the alias list');
  }
});
