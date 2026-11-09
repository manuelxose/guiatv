import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FootballMatch } from '../../../domain/sports/football/types';
import { boundLive, mergeProviderMatches, sameTeam } from './FootballMatchMerge';

const NOW = Date.parse('2026-11-09T10:00:00Z');

function m(source: string, id: string, home: string, away: string, kickoffAt: string, extra: Partial<FootballMatch> = {}): FootballMatch {
  const team = (name: string) => ({ id: `${source}:${name}`, slug: name.toLowerCase().replace(/\W+/g, '-'), name, aliases: [], providerIds: { [source]: name }, crest: null, lastUpdatedAt: '' });
  return {
    id, slug: `${home}-${away}`.toLowerCase().replace(/\W+/g, '-'), providerIds: { [source]: id },
    competition: { id: 'catalog:laliga', slug: 'laliga', name: 'LaLiga' },
    kickoffAt, status: 'scheduled', homeTeam: team(home), awayTeam: team(away), score: { home: null, away: null },
    broadcasts: [], sourceProvenance: { source, confidence: 'high' }, lastUpdatedAt: '2026-10-01T00:00:00Z', ...extra,
  } as FootballMatch;
}

test('sameTeam matches provider spellings and German exonyms, not different clubs', () => {
  assert.ok(sameTeam({ name: 'FC Sevilla' }, { name: 'Sevilla FC' }));
  assert.ok(sameTeam({ name: 'FC Villareal' }, { name: 'Villarreal' }));
  assert.ok(sameTeam({ name: 'Deportivo Alaves' }, { name: 'Deportivo Alavés' }));
  assert.ok(sameTeam({ name: 'AC Mailand' }, { name: 'AC Milan' }));
  assert.ok(sameTeam({ name: 'Brighton & Hove Albion' }, { name: 'Brighton and Hove Albion' }));
  assert.equal(sameTeam({ name: 'Real Sociedad' }, { name: 'Rayo Vallecano' }), false);
});

test('a confirmed result from one provider replaces a stale clock-inferred "live" from another', () => {
  const stale = m('openligadb', '1', 'Atlético Madrid', 'FC Barcelona', '2026-11-08T20:00:00Z', { status: 'live', events: [{ x: 1 }] });
  const done = m('footballdata-io', 'footballdata-io:9', 'Atlético Madrid', 'FC Barcelona', '2026-11-08T20:00:00Z', {
    status: 'finished', score: { home: 1, away: 2 }, statistics: { 'Córners': { home: 4, away: 2 } },
    homeTeam: { id: 'x', slug: 'atletico-madrid', name: 'Atlético Madrid', aliases: [], providerIds: { 'footballdata-io': '109' }, crest: 'https://img/atm.png', lastUpdatedAt: '' },
  });
  const [merged, ...rest] = mergeProviderMatches([stale, done], NOW);
  assert.equal(rest.length, 0, 'one fixture, one public match');
  assert.equal(merged.id, '1', 'base identity (and URL) kept from the first provider');
  assert.equal(merged.slug, stale.slug);
  assert.equal(merged.status, 'finished');
  assert.deepEqual(merged.score, { home: 1, away: 2 });
  assert.equal(merged.homeTeam.crest, 'https://img/atm.png', 'crest gap filled');
  const withBoth = mergeProviderMatches([
    { ...stale, homeTeam: { ...stale.homeTeam, crest: 'https://upload.wikimedia.org/atm.svg' } },
    done,
  ], NOW)[0];
  assert.equal(withBoth.homeTeam.crest, 'https://upload.wikimedia.org/atm.svg', 'the first provider crest wins when it has one');
  const dataUri = mergeProviderMatches([{ ...stale, homeTeam: { ...stale.homeTeam, crest: 'data:image/png;base64,AAAA' } }, done], NOW)[0];
  assert.equal(dataUri.homeTeam.crest, 'https://img/atm.png', 'an inline data: crest yields to a real URL');
  assert.deepEqual(merged.statistics, { 'Córners': { home: 4, away: 2 } });
  assert.equal(merged.events, undefined, 'events whose score disagrees are dropped, never shown beside another score');
  assert.equal(merged.providerIds['footballdata-io'], 'footballdata-io:9');
});

test('different fixtures are never merged', () => {
  const a = m('openligadb', '1', 'Celta Vigo', 'Levante UD', '2026-11-08T17:30:00Z');
  const b = m('footballdata-io', '2', 'Villarreal', 'Getafe CF', '2026-11-08T17:30:00Z');
  assert.equal(mergeProviderMatches([a, b], NOW).length, 2);
});

test('an unconfirmed live past the window is not live; a live with a minute stays live', () => {
  const old = m('openligadb', '1', 'A', 'B', '2026-11-06T20:00:00Z', { status: 'live' });
  assert.equal(boundLive(old, NOW).status, 'scheduled');
  const fresh = m('openligadb', '1', 'A', 'B', '2026-11-09T09:00:00Z', { status: 'live' });
  assert.equal(boundLive(fresh, NOW).status, 'live');
  const withMinute = m('footballdata-io', '1', 'A', 'B', '2026-11-09T06:00:00Z', { status: 'live', minute: 95 });
  assert.equal(boundLive(withMinute, NOW).status, 'live');
});

test('a provider minute beats a clock-inferred live, and no provider is promoted beyond its claim', () => {
  const inferred = m('openligadb', '1', 'Sunderland', 'Chelsea FC', '2026-11-09T09:00:00Z', { status: 'live' });
  const clock = m('footballdata-io', '2', 'Sunderland', 'Chelsea', '2026-11-09T09:00:00Z', { status: 'live', minute: 61, score: { home: 1, away: 0 } });
  const [merged] = mergeProviderMatches([inferred, clock], NOW);
  assert.equal(merged.minute, 61);
  assert.deepEqual(merged.score, { home: 1, away: 0 });
  const [solo] = mergeProviderMatches([m('openligadb', '3', 'X', 'Y', '2026-11-12T20:00:00Z')], NOW);
  assert.equal(solo.status, 'scheduled');
  assert.equal('minute' in solo, false);
});
