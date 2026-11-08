import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderMatchRecord } from '../../../domain/sports/football/provider-types';
import { resolveMatchFields } from './conflictResolution';

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

test('live_score outranks fixtures-only and the disagreement is kept as a conflict', () => {
  const rich = rec({
    capabilities: ['fixtures', 'results', 'live_score'],
    score: { home: 2, away: 1 },
    sourceTimestamp: '2026-11-01T20:00:00Z',
  });
  const fixturesOnly = rec({
    providerId: 'epg',
    providerMatchId: 'm2',
    capabilities: ['fixtures'],
    score: { home: 1, away: 1 },
    sourceTimestamp: '2026-11-01T21:00:00Z',
  });
  const resolved = resolveMatchFields([rich, fixturesOnly]);
  assert.equal(resolved.score?.value.home, 2);
  assert.equal(resolved.score?.provenance.conflict, true);
  const conflict = resolved.conflicts.find((c) => c.field === 'score');
  assert.ok(conflict);
  assert.equal((conflict!.chosen as { home: number }).home, 2);
  assert.equal((conflict!.rejected[0].value as { home: number }).home, 1);
});

test('a newer sourceTimestamp outranks an older one for the same capability tier', () => {
  const older = rec({
    capabilities: ['results'],
    score: { home: 1, away: 0 },
    sourceTimestamp: '2026-11-01T20:00:00Z',
  });
  const newer = rec({
    providerMatchId: 'm2',
    capabilities: ['results'],
    score: { home: 2, away: 0 },
    sourceTimestamp: '2026-11-01T21:00:00Z',
  });
  const resolved = resolveMatchFields([older, newer]);
  assert.equal(resolved.score?.value.home, 2);
  assert.equal(resolved.score?.provenance.conflict, true);
});

test('status disagreement is recorded as a conflict, not last-wins', () => {
  const live = rec({ capabilities: ['live_score'], status: 'live' });
  const scheduled = rec({ providerId: 'epg', providerMatchId: 'm2', capabilities: ['fixtures'], status: 'scheduled' });
  const resolved = resolveMatchFields([live, scheduled]);
  assert.equal(resolved.status?.value, 'live');
  assert.equal(resolved.status?.provenance.conflict, true);
});

test('a goal absent from the newer response of the same provider is removed and audited', () => {
  const older = rec({
    capabilities: ['events'],
    events: [{ type: 'goal', minute: 45, player: 'Müller' }],
    sourceTimestamp: '2026-11-01T19:00:00Z',
  });
  const newer = rec({
    providerMatchId: 'm2',
    capabilities: ['events'],
    events: [],
    sourceTimestamp: '2026-11-01T20:00:00Z',
  });
  const resolved = resolveMatchFields([older, newer]);
  assert.equal(resolved.events?.value.length, 0);
  assert.ok(resolved.audit.some((a) => a.kind === 'removed_event'));
});

test('duplicate events within ±1 minute are deduplicated', () => {
  const a = rec({
    capabilities: ['events'],
    events: [{ type: 'goal', minute: 45, player: 'Müller' }],
  });
  const b = rec({
    providerId: 'epg',
    providerMatchId: 'm2',
    capabilities: ['events'],
    events: [{ type: 'goal', minute: 46, player: 'Müller' }],
  });
  const resolved = resolveMatchFields([a, b]);
  assert.equal(resolved.events?.value.length, 1);
  assert.ok(resolved.audit.some((entry) => entry.kind === 'deduplicated_event'));
});

test('penalty shootouts stay separate from the regulation score', () => {
  const match = rec({
    capabilities: ['results'],
    score: { home: 1, away: 1 },
    penaltyScore: { home: 4, away: 3 },
  });
  const resolved = resolveMatchFields([match]);
  assert.deepEqual(resolved.score?.value, { home: 1, away: 1 });
  assert.deepEqual(resolved.penaltyScore?.value, { home: 4, away: 3 });
});

test('a failing provider never downgrades a rich score to a fixtures-only record', () => {
  const rich = rec({
    capabilities: ['fixtures', 'results', 'live_score'],
    score: { home: 2, away: 1 },
    sourceTimestamp: '2026-11-01T20:00:00Z',
  });
  const previous = resolveMatchFields([rich]);

  const fixturesOnly = rec({
    providerId: 'epg',
    providerMatchId: 'm2',
    capabilities: ['fixtures'],
    score: undefined,
  });
  const resolved = resolveMatchFields([fixturesOnly], previous);
  assert.deepEqual(resolved.score?.value, { home: 2, away: 1 });
  assert.equal(resolved.score?.provenance.provider, 'openligadb');
});

test('a newer final score corrects the previous snapshot and is audited', () => {
  const first = rec({ capabilities: ['results'], score: { home: 1, away: 1 }, sourceTimestamp: '2026-11-01T20:00:00Z' });
  const previous = resolveMatchFields([first]);
  const correction = rec({
    providerMatchId: 'm2',
    capabilities: ['results'],
    score: { home: 2, away: 1 },
    sourceTimestamp: '2026-11-01T21:00:00Z',
  });
  const resolved = resolveMatchFields([correction], previous);
  assert.deepEqual(resolved.score?.value, { home: 2, away: 1 });
  assert.ok(resolved.audit.some((a) => a.kind === 'score_correction'));
});
