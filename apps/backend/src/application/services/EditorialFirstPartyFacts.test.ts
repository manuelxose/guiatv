import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelFacts, buildScheduleFacts, factsAsText, madridDay, parseFactsQuery } from './EditorialFirstPartyFacts';

const NOW = new Date('2026-10-25T08:00:00Z');
const FEED_A = 'https://iptv-epg.org/files/epg-es.xml.gz';
const FEED_B = 'https://www.tdtchannels.com/epg/TV.xml.gz';
const la1 = { id: 'la_1', name: 'La 1', normalizedName: 'la_1', group: 'tdt', provenance: { classification: 'registry' } };
const airing = (id: string, title: string, start: string, end: string | undefined, extra: Record<string, any> = {}) => ({
  channel: la1,
  program: { title, normalizedTitle: title.toLowerCase(), isResolvedTitle: true, year: 1999, director: 'Inventado', tmdbId: 1, ...extra.program },
  airing: { id, start, end },
  sourceProvenance: { schedule: extra.upstream ?? [FEED_A] },
  trustDecision: { confidence: 'high', consumerSuppressed: false, ...extra.trust },
  updatedAt: extra.updatedAt ?? '2026-10-25T07:30:00Z',
});

test('local day and times follow Spanish peninsular time across the October DST change', () => {
  assert.equal(madridDay('2026-10-24T22:30:00Z'), '2026-10-25', '00:30 CEST is already Sunday');
  assert.equal(madridDay('2026-10-25T22:30:00Z'), '2026-10-25', '23:30 CET is still Sunday');
  const [f] = buildScheduleFacts([airing('a1', 'Telediario', '2026-10-25T13:00:00Z', '2026-10-25T14:00:00Z')], '2026-10-25', NOW);
  assert.equal(f.statement, 'La 1 emite «Telediario» el domingo, 25 de octubre de 2026 de 14:00 a 15:00 (hora peninsular)');
  assert.deepEqual([f.eligible, f.freshness, f.timezone, f.validUntil], [true, 'fresh', 'Europe/Madrid', '2026-10-25T14:00:00.000Z']);
  // A slot whose UTC date is the previous day belongs to the requested local day; one on the next local day does not.
  const rows = [airing('early', 'Noticias 24', '2026-10-24T22:30:00Z', '2026-10-24T23:00:00Z'), airing('next', 'Mañana', '2026-10-25T23:30:00Z', '2026-10-26T00:30:00Z')];
  assert.deepEqual(buildScheduleFacts(rows, '2026-10-25', new Date('2026-10-24T20:00:00Z')).map((x) => x.entityId), ['early']);
});

test('only current, refreshed, high-confidence, uncontested slots are eligible; film metadata never becomes a fact', () => {
  const facts = buildScheduleFacts([
    airing('done', 'Ya emitido', '2026-10-25T05:00:00Z', '2026-10-25T06:00:00Z'),
    airing('stale', 'Viejo', '2026-10-25T15:00:00Z', '2026-10-25T16:00:00Z', { updatedAt: '2026-10-24T20:00:00Z' }),
    airing('low', 'Dudoso', '2026-10-25T16:00:00Z', '2026-10-25T17:00:00Z', { trust: { confidence: 'medium' } }),
    airing('hidden', 'Oculto', '2026-10-25T17:00:00Z', '2026-10-25T18:00:00Z', { trust: { consumerSuppressed: true } }),
    airing('raw', 'Sin resolver', '2026-10-25T18:00:00Z', '2026-10-25T18:30:00Z', { program: { isResolvedTitle: false } }),
    airing('x1', 'Ocean\'s 13', '2026-10-25T20:00:00Z', '2026-10-25T22:00:00Z'),
    airing('x2', 'Ocean\'s 8', '2026-10-25T21:00:00Z', '2026-10-25T23:00:00Z', { upstream: [FEED_B] }),
    airing('dup1', 'Cine de barrio', '2026-10-25T10:00:00Z', '2026-10-25T12:00:00Z'),
    airing('dup2', 'Cine de barrio', '2026-10-25T10:00:00Z', '2026-10-25T12:00:00Z', { upstream: [FEED_A, FEED_B] }),
  ], '2026-10-25', NOW);
  const by = (id: string) => facts.find((f) => f.entityId === id)!;
  assert.deepEqual([by('done').freshness, by('done').eligible], ['expired', false]);
  assert.deepEqual([by('stale').freshness, by('stale').eligible], ['stale', false]);
  assert.match(by('low').reason!, /confianza medium/);
  assert.match(by('hidden').reason!, /oculta/);
  assert.match(by('raw').reason!, /sin resolver/);
  // Two feeds disagree on what airs in the same slot: neither is stated (the M11-E Ocean's 8/13 confusion).
  assert.ok(!by('x1').eligible && !by('x2').eligible && /solapa/.test(by('x1').reason!));
  // The same programme from two rows is not a conflict; its upstream count is recorded, the publisher stays GuíaTV.
  assert.ok(by('dup1').eligible && by('dup2').eligible);
  assert.deepEqual([by('dup2').verification, by('dup2').provenance.publisher, by('dup2').provenance.upstream], ['multi-upstream', 'GuíaTV', [FEED_A, FEED_B]]);
  for (const f of facts) assert.doesNotMatch(f.statement, /1999|Inventado|tmdb/i);
  assert.deepEqual(by('dup1').relatedEntities, [], 'no entity from a title or a TMDB id');
  const linked = buildScheduleFacts([airing('e', 'Con ficha', '2026-10-25T12:00:00Z', '2026-10-25T13:00:00Z', { program: { entityId: 'ent_abc', canonicalPath: '/peliculas/con-ficha' } })], '2026-10-25', NOW);
  assert.deepEqual(linked[0].relatedEntities, [{ type: 'content-entity', id: 'ent_abc', url: 'https://guiaprogramaciontv.com/peliculas/con-ficha' }]);

  const text = factsAsText({ query: { kind: 'schedule', channel: 'la_1', day: '2026-10-25' }, generatedAt: NOW.toISOString(), facts });
  assert.match(text, /Cine de barrio/);
  assert.doesNotMatch(text, /Ocean|Viejo|Dudoso|Oculto|Ya emitido|Sin resolver/);
  assert.match(text, /iptv-epg\.org/);
});

test('a slot without an end time is stated by its start; without upstream provenance it is withheld', () => {
  const [open] = buildScheduleFacts([airing('o', 'Abierto', '2026-10-25T19:00:00Z', undefined)], '2026-10-25', NOW);
  assert.match(open.statement, /a las 20:00 \(hora peninsular\)$/);
  const [orphan] = buildScheduleFacts([airing('p', 'Sin origen', '2026-10-25T19:00:00Z', '2026-10-25T20:00:00Z', { upstream: [] })], '2026-10-25', NOW);
  assert.equal(orphan.eligible, false);
});

test('channel facts: registry channels only, with the sitemap URL; heuristic channels are withheld', () => {
  const rows = [
    airing('a', 'X', '2026-10-25T10:00:00Z', '2026-10-25T11:00:00Z'),
    { ...airing('b', 'Y', '2026-10-25T10:00:00Z', '2026-10-25T11:00:00Z'), channel: { id: 'antena_3', name: 'Antena 3', normalizedName: 'antena_3', group: 'tdt', provenance: { classification: 'registry' } } },
    { ...airing('c', 'Z', '2026-10-25T10:00:00Z', '2026-10-25T11:00:00Z'), channel: { id: 'local_x', name: 'Local X', normalizedName: 'local_x', group: 'tdt', provenance: { classification: 'heuristic' } } },
    { ...airing('d', 'W', '2026-10-25T10:00:00Z', '2026-10-25T11:00:00Z'), channel: { id: 'tv3', name: 'TV3', group: 'autonomico' } },
  ];
  const facts = buildChannelFacts(rows, 'tdt');
  assert.equal(facts[0].statement, 'GuíaTV publica la programación de 2 canales de la TDT nacional: Antena 3, La 1');
  assert.ok(!facts.some((f) => f.entityId === 'tv3'), 'other groups are not mixed in');
  const local = facts.find((f) => f.entityId === 'local_x')!;
  assert.deepEqual([local.eligible, local.verification], [false, 'heuristic']);
  assert.match(facts.find((f) => f.entityId === 'la_1')!.canonicalUrl!, /^https:\/\/guiaprogramaciontv\.com\/canales\//);
});

test('the public query is parsed strictly', () => {
  const now = new Date('2026-10-28T10:00:00Z');
  assert.deepEqual(parseFactsQuery({ kind: 'channels', group: 'tdt' }, now), { kind: 'channels', group: 'tdt' });
  assert.deepEqual(parseFactsQuery({ kind: 'schedule', channel: 'la_1' }, now), { kind: 'schedule', channel: 'la_1', day: '2026-10-28' });
  assert.deepEqual(parseFactsQuery({ kind: 'schedule', channel: 'la_1', date: '2026-10-31' }, now), { kind: 'schedule', channel: 'la_1', day: '2026-10-31' });
  for (const bad of [{ kind: 'channels', group: 'online' }, { kind: 'schedule', channel: '$where' }, { kind: 'schedule', channel: 'la_1', date: '2026-10-27' },
    { kind: 'schedule', channel: 'la_1', date: '2026-11-01' }, { kind: 'schedule', channel: 'la_1', date: '28/10/2026' }, { kind: 'films' }, { kind: 'schedule', channel: ['la_1'] }]) {
    assert.equal(typeof parseFactsQuery(bad as Record<string, unknown>, now), 'string', JSON.stringify(bad));
  }
});
