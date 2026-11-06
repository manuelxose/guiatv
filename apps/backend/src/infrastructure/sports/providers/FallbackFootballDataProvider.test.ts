import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FallbackFootballDataProvider } from './FallbackFootballDataProvider';

const m = (comp: string, id: string, at: string) => ({ id, slug: id, competition: { slug: comp }, kickoffAt: at }) as any;
const prov = (matches: any[] | Error) =>
  ({ key: 'x', name: 'x', getMatches: async () => { if (matches instanceof Error) throw matches; return matches; }, getLiveMatches: async () => [] }) as any;

test('adds EPG fixtures only for competitions the primary does not return', async () => {
  const p = new FallbackFootballDataProvider(
    prov([m('laliga', 'a', '2026-11-05T19:00:00Z')]),
    prov([m('laliga', 'a2', '2026-11-05T19:00:00Z'), m('europa-league', 'celta', '2026-11-05T18:45:00Z')])
  );
  assert.deepEqual((await p.getMatches({})).map((x) => x.id), ['celta', 'a']);
});

test('uses the EPG alone when the primary fails', async () => {
  const p = new FallbackFootballDataProvider(prov(new Error('429')), prov([m('europa-league', 'celta', 'x')]));
  assert.equal((await p.getMatches({})).length, 1);
});

test('competitions: primary entries win and catalog-only ones are appended', async () => {
  const c = (slug: string, name: string) => ({ slug, name }) as any;
  const p = new FallbackFootballDataProvider(
    { ...prov([]), getCompetitions: async () => [c('laliga', 'Primary')] } as any,
    { ...prov([]), getCompetitions: async () => [c('laliga', 'Catalog'), c('europa-league', 'EL')] } as any
  );
  assert.deepEqual((await p.getCompetitions()).map((x) => x.name), ['Primary', 'EL']);
});
