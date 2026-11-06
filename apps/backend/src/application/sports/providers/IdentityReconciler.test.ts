import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderMatchRecord } from '../../../domain/sports/football/provider-types';
import { canMerge, reconcile } from './IdentityReconciler';

const rec = (overrides: Partial<ProviderMatchRecord> = {}): ProviderMatchRecord => ({
  providerId: 'openligadb',
  providerMatchId: 'm1',
  competitionSlug: 'bl1',
  season: '2026',
  kickoff: '2026-11-01T18:00:00Z',
  home: { name: 'FC Bayern München' },
  away: { name: 'Borussia Dortmund' },
  capabilities: ['fixtures'],
  ...overrides,
});

test('refuses a name-only merge when the competition differs', () => {
  const a = rec();
  const b = rec({ providerMatchId: 'm2', competitionSlug: 'laliga' });
  assert.deepEqual(canMerge(a, b), { canMerge: false, reason: 'different_competition' });
});

test('blocks men-vs-women merges', () => {
  const women = rec({
    home: { name: 'FC Barcelona Femení' },
    away: { name: 'Real Madrid Femenino' },
  });
  const men = rec({ home: { name: 'FC Barcelona' }, away: { name: 'Real Madrid' } });
  assert.equal(canMerge(women, men).reason, 'gender_conflict');
  assert.equal(canMerge(women, men).canMerge, false);
});

test('blocks first-team-vs-reserve merges', () => {
  const reserve = rec({ home: { name: 'Real Madrid B' }, away: { name: 'Sevilla FC' } });
  const first = rec({ home: { name: 'Real Madrid' }, away: { name: 'Sevilla FC' } });
  assert.equal(canMerge(reserve, first).reason, 'reserve_team_conflict');
});

test('blocks different-season merges', () => {
  assert.equal(canMerge(rec(), rec({ providerMatchId: 'm2', season: '2025' })).reason, 'different_season');
});

test('two legs weeks apart stay separate fixtures', () => {
  const groups = reconcile([
    rec({ kickoff: '2026-11-01T18:00:00Z' }),
    rec({ providerMatchId: 'm2', kickoff: '2026-11-12T18:00:00Z' }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups.every((g) => !g.quarantined && !g.rescheduled), true);
});

test('a postponed fixture rescheduled within the window is a move, not a duplicate', () => {
  const groups = reconcile([
    rec({ kickoff: '2026-11-01T18:00:00Z' }),
    rec({ providerMatchId: 'm2', kickoff: '2026-11-02T20:00:00Z' }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rescheduled, true);
  assert.equal(groups[0].movedFromKickoffs.length, 1);
  assert.equal(groups[0].quarantined, false);
});

test('ambiguous candidates (between two fixtures) are quarantined, never merged', () => {
  const groups = reconcile([
    rec({ kickoff: '2026-11-01T00:00:00Z' }),
    rec({ providerMatchId: 'm2', kickoff: '2026-11-04T00:00:00Z' }),
    rec({ providerMatchId: 'm3', kickoff: '2026-11-07T00:00:00Z' }),
  ]);
  const quarantined = groups.filter((g) => g.quarantined);
  assert.ok(quarantined.length > 0);
  assert.ok(quarantined[0].quarantineReason?.includes('ambiguous'));
});
