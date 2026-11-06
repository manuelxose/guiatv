import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FootballProviderOrchestrator,
  FootballProviderUnavailableError,
  OrchestratorProviderSource,
} from '../services/FootballProviderOrchestrator';
import { ProviderMatchRecord } from '../../../domain/sports/football/provider-types';
import { resolveMatchFields } from './conflictResolution';

const match = (): ProviderMatchRecord => ({
  providerId: 'openligadb',
  providerMatchId: 'm1',
  competitionSlug: 'bl1',
  season: '2026',
  kickoff: '2026-11-01T18:00:00Z',
  home: { name: 'FC Bayern München' },
  away: { name: 'Borussia Dortmund' },
  status: 'finished',
  score: { home: 2, away: 1 },
  capabilities: ['fixtures', 'results', 'events', 'venue', 'team_metadata'],
  sourceTimestamp: '2026-11-01T20:00:00Z',
});

const source = (overrides: Partial<OrchestratorProviderSource> = {}): OrchestratorProviderSource => ({
  providerId: 'openligadb',
  capabilities: ['fixtures', 'results', 'events', 'venue', 'team_metadata'],
  competitions: [],
  priority: 1,
  fetchFixtures: async () => [match()],
  ...overrides,
});

const down = () => {
  throw Object.assign(new Error('upstream down'), { status: 503 });
};

test('never selects a prototype provider when the only approved provider fails', async () => {
  let prototypeCalls = 0;
  let blockedCalls = 0;
  const orchestrator = new FootballProviderOrchestrator({ maxRetries: 0 });
  const sources: OrchestratorProviderSource[] = [
    source({ fetchFixtures: async () => down() }),
    {
      providerId: 'football-data-org',
      capabilities: ['fixtures'],
      competitions: [],
      priority: 1,
      fetchFixtures: async () => {
        prototypeCalls += 1;
        return [match()];
      },
    },
    {
      providerId: 'google-search',
      capabilities: ['fixtures'],
      competitions: [],
      priority: 1,
      fetchFixtures: async () => {
        blockedCalls += 1;
        return [match()];
      },
    },
  ];

  await assert.rejects(() => orchestrator.getMatches('fixtures', sources), FootballProviderUnavailableError);
  assert.equal(prototypeCalls, 0);
  assert.equal(blockedCalls, 0);
});

test('returns the preserved previous snapshot when all approved providers fail', async () => {
  const snapshot = [resolveMatchFields([match()])];
  const orchestrator = new FootballProviderOrchestrator({ maxRetries: 0, initialSnapshot: snapshot });
  const result = await orchestrator.getMatches('fixtures', [source({ fetchFixtures: async () => down() })]);
  assert.deepEqual(result, snapshot);
});

test('keeps a rich record instead of degrading after a later total failure', async () => {
  const orchestrator = new FootballProviderOrchestrator({ maxRetries: 0 });
  const first = await orchestrator.getMatches('fixtures', [source()]);
  assert.equal(first.length, 1);
  assert.equal(first[0].score?.value.home, 2);

  const second = await orchestrator.getMatches('fixtures', [source({ fetchFixtures: async () => down() })]);
  assert.equal(second.length, 1);
  assert.equal(second[0].score?.value.home, 2);
});

test('enriches a merged match with per-field provenance and provider ids', async () => {
  const orchestrator = new FootballProviderOrchestrator({ maxRetries: 0 });
  const result = await orchestrator.getMatches('fixtures', [source()]);
  assert.equal(result[0].score?.provenance.provider, 'openligadb');
  assert.equal(result[0].providerIds.includes('openligadb'), true);
  assert.equal(result[0].quarantined, false);
});
