import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelFeedAliasResolver, feedAliasCandidates, feedKeys, schedulesAgree } from './ChannelFeedAliases';
import { invalidateSitemapCache, SitemapController } from '../../presentation/controllers/SitemapController';

// M10-C: the production directory of 2026-10-29 (abridged): the provider's `.es` and `.TV` feeds of one channel, and
// channels whose own name ends in "TV".
const ch = (id: string, name: string, sourceIds: string[], group = 'autonomico') => ({ id, name, normalizedName: id, sourceIds, group });
const telemadrid = ch('telemadrid', 'Telemadrid', ['telemadrid', 'telemadrid_es', 'Telemadrid.es']);
const telemadridTv = ch('telemadrid_tv', 'Telemadrid.TV', ['telemadrid_tv', 'Telemadrid.TV']);
const aPunt = ch('a_punt', 'À Punt', ['a_punt', 'apunt_es', 'APunt.es']);
const apuntTv = ch('apunt_tv', 'APUNT.TV', ['apunt_tv', 'APUNT.TV']);
const aragon = ch('aragon_tv', 'Aragón TV', ['aragon_tv', 'aragontv_es', 'AragonTV.es']);
const aragonTv = ch('aragontv_tv', 'AragonTV.TV', ['aragontv_tv', 'AragonTV.TV']);
const andalucia = ch('andalucia_tv', 'Andalucía TV', ['andalucia_tv', 'andaluciatv_es', 'AndaluciaTV.es']);
const cmm = ch('cmm_tv', 'CMM TV', ['cmm_tv', 'CMM TV', 'CMM.TV']);
const castilla = ch('castilla_la_mancha_tv', 'Castilla la Mancha TV', ['castilla_la_mancha_tv', 'castillalamanchatv_es', 'CastillalaManchaTV.es']);
const sx3 = ch('sx3_tv', 'SX3.TV', ['sx3_tv', 'SX3.TV']);
const canariasTv = ch('canarias_tv', 'Canarias.TV', ['canarias_tv', 'Canarias.TV']);
const tvCanaria = ch('tv_canaria', 'TV Canaria', ['tv_canaria', 'tvcanaria_es', 'TVCanaria.es']);
const telemadridInt = ch('telemadridint_tv', 'TeleMadridInt.TV', ['telemadridint_tv', 'TeleMadridInt.TV']);
const directory = [telemadrid, telemadridTv, aPunt, apuntTv, aragon, aragonTv, andalucia, cmm, castilla, sx3, canariasTv, tvCanaria, telemadridInt];

const at = (hhmm: string) => `2026-10-29T${hhmm}:00.000Z`;
const item = (channelId: string, start: string, title: string) => ({ id: `${channelId}-${start}`, channel: { id: channelId }, airing: { start: at(start) }, program: { title } }) as any;
const schedule = (channelId: string, rows: Array<[string, string]>) => rows.map(([s, t]) => item(channelId, s, t));
const madridRows: Array<[string, string]> = [['00:32', 'El análisis: el diario de la noche'], ['01:45', 'Yo soy de aquí'], ['02:34', 'Sabor a Madrid'], ['06:00', 'Buenos días, Madrid']];

test('M10-C feed keys: only the dotted feed ids, compared without accents, case or separators', () => {
  assert.deepEqual(feedKeys(telemadridTv, 'tv'), ['telemadrid']);
  assert.deepEqual(feedKeys(aPunt, 'es'), ['apunt']);
  assert.deepEqual(feedKeys(cmm, 'tv'), ['cmm']);
  assert.deepEqual(feedKeys(aragon, 'tv'), [], '"Aragón TV" is a name, not a feed id');
});

test('M10-C candidates: a ".TV" feed pairs with the one channel carrying the same ".es" key; names ending in TV never do', () => {
  const c = feedAliasCandidates(directory);
  assert.deepEqual([...c].map(([alias, target]) => [alias, target.id]).sort(), [
    ['apunt_tv', 'a_punt'], ['aragontv_tv', 'aragon_tv'], ['canarias_tv', 'tv_canaria'], ['cmm_tv', 'castilla_la_mancha_tv'], ['telemadrid_tv', 'telemadrid'],
  ]);
  // No `.es` counterpart: stays its own channel (documented as unresolved, not guessed). The international feed
  // shares much of Telemadrid's schedule but is another channel: no id pairs it.
  assert.ok(!c.has('sx3_tv') && !c.has('telemadridint_tv'));
  // Distinct channels with similar titles are not paired.
  assert.ok(!c.has('andalucia_tv') && !c.has('castilla_la_mancha_tv') && !c.has('aragon_tv'));
  // Two channels claiming the same `.es` key: ambiguous, no pair.
  const twin = ch('telemadrid_hd', 'Telemadrid HD', ['Telemadrid.es']);
  assert.ok(!feedAliasCandidates([...directory, twin]).has('telemadrid_tv'));
});

test('M10-C schedules: same titles at the same times (within 10 min) for at least 3 and half of the airings', () => {
  assert.equal(schedulesAgree(schedule('telemadrid_tv', madridRows), schedule('telemadrid', madridRows)), true);
  const shifted = madridRows.map(([s, t]) => [s.replace(/^0/, '1'), t] as [string, string]);
  assert.equal(schedulesAgree(schedule('telemadrid_tv', madridRows), schedule('telemadrid', shifted)), false, 'same titles, other hours');
  assert.equal(schedulesAgree(schedule('x', madridRows.slice(0, 2)), schedule('y', madridRows)), false, 'fewer than 3 shared');
  const other = schedule('telemadrid', [['00:32', 'Telenoticias'], ['01:45', 'Cine'], ['02:34', 'Madrid Directo'], ['06:00', 'Buenos días, Madrid']]);
  assert.equal(schedulesAgree(schedule('telemadrid_tv', madridRows), other), false);
});

function reader(schedules: Record<string, any[]>, calls = { n: 0 }) {
  return {
    calls,
    getChannels: async () => { calls.n += 1; return { channels: directory.map((channel) => ({ channel })), meta: {} } as any; },
    // getChannelDetail matches aliases: return both channels' rows to prove the resolver keeps each channel's own.
    getChannelDetail: async (id: string) => ({ items: [...(schedules[id] ?? []), ...schedule('noise', madridRows)] }) as any,
  };
}

test('M10-C resolver: verified aliases only, cached, and a candidate with another schedule stays a channel', async () => {
  const calls = { n: 0 };
  const r = reader({
    telemadrid: schedule('telemadrid', madridRows),
    telemadrid_tv: schedule('telemadrid_tv', madridRows),
    a_punt: schedule('a_punt', madridRows),
    apunt_tv: schedule('apunt_tv', [['09:00', 'Otro'], ['10:00', 'Otro 2'], ['11:00', 'Otro 3']]),
    aragon_tv: [],
    aragontv_tv: schedule('aragontv_tv', madridRows),
  }, calls);
  const resolver = new ChannelFeedAliasResolver(r);
  const aliases = await resolver.resolve('today');
  assert.deepEqual([...aliases.keys()], ['telemadrid_tv']);
  assert.deepEqual(aliases.get('telemadrid_tv'), { id: 'telemadrid', name: 'Telemadrid', normalizedName: 'telemadrid' });
  await resolver.resolve('today');
  assert.equal(calls.n, 1, 'cached');
});

test('M10-C resolver.current: never waits; empty before the first list, then the last list while it refreshes', async () => {
  let clock = 0;
  const calls = { n: 0 };
  const resolver = new ChannelFeedAliasResolver(reader({ telemadrid: schedule('telemadrid', madridRows), telemadrid_tv: schedule('telemadrid_tv', madridRows) }, calls), () => clock);
  assert.equal(resolver.current().size, 0, 'cold: nothing yet, a refresh starts');
  await resolver.resolve();
  assert.equal(calls.n, 1, 'the cold call and resolve shared one load');
  assert.deepEqual([...resolver.current().keys()], ['telemadrid_tv']);
  clock += 11 * 60_000;
  assert.deepEqual([...resolver.current().keys()], ['telemadrid_tv'], 'stale list answered at once');
  await resolver.resolve();
  assert.equal(calls.n, 2, 'refreshed in the background');
});

test('M10-C sitemap-channels.xml: a verified alias is never listed; its channel and same-suffix channels are', async () => {
  invalidateSitemapCache();
  const tv = { getChannels: async () => ({ channels: directory.map((channel) => ({ channel })), meta: {} }) } as any;
  const resolver = new ChannelFeedAliasResolver(reader({ telemadrid: schedule('telemadrid', madridRows), telemadrid_tv: schedule('telemadrid_tv', madridRows) }));
  const controller = new SitemapController({} as any, {} as any, undefined, undefined, tv, undefined, undefined, resolver);
  let xml = '';
  const res: any = { set: () => res, status: () => res, send: (body: string) => { xml = body; } };
  await controller.getChannelsSitemap({} as any, res, ((e: unknown) => { throw e; }) as any);
  const locs = [...xml.matchAll(/<loc>[^<]*\/canales\/([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.includes('telemadrid') && !locs.includes('telemadrid-tv'), locs.join(' '));
  for (const own of ['aragon-tv', 'andalucia-tv', 'castilla-la-mancha-tv', 'sx3-tv', 'apunt-tv', 'telemadridint-tv']) assert.ok(locs.includes(own), own);
  // A paired candidate whose schedule is not checked equal stays listed.
  assert.ok(locs.includes('cmm-tv') && locs.includes('canarias-tv'));
  assert.equal(new Set(locs).size, locs.length, 'no URL twice');

  // The alias list cannot be read: the build fails (the last good sitemap is served), never a list with the alias.
  invalidateSitemapCache();
  const failing = new SitemapController({} as any, {} as any, undefined, undefined, tv, undefined, undefined, { resolve: async () => { throw new Error('down'); } });
  let error: unknown;
  xml = '';
  await failing.getChannelsSitemap({} as any, res, ((e: unknown) => { error = e; }) as any);
  assert.ok(error || /telemadrid</.test(xml) && !/telemadrid-tv</.test(xml), 'never lists the alias');
});
