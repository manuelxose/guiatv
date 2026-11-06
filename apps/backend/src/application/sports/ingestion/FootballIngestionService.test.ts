import test from 'node:test';
import assert from 'node:assert/strict';
import { FootballMatch } from '@/domain/sports/football/types';
import {
  FootballIngestionService,
  MatchFetcher,
  computeFieldCoverage,
  countActive,
} from './FootballIngestionService';
import { RequestBudget } from './RequestBudget';
import { InMemoryLock, LockEntry, LockPort } from './Lock';
import {
  FootballPersistencePort,
  FootballSnapshotWrite,
  IngestionRunRecord,
  ProviderSyncState,
} from './types';

const T0 = Date.parse('2026-11-06T12:00:00Z');
const NOW = '2026-11-06T00:00:00Z';

function match(id: string, home: string, away: string, kickoff: string, extra: Partial<FootballMatch> = {}): FootballMatch {
  return {
    id,
    slug: `${home}-${away}-2026-08-14`,
    providerIds: { openligadb: id },
    competition: { id: 'catalog:bundesliga', slug: 'bundesliga', name: 'Bundesliga', shortName: 'Bundesliga' },
    kickoffAt: kickoff,
    status: 'scheduled',
    homeTeam: { id: `t:${home}`, slug: home, name: home, aliases: [], providerIds: {}, lastUpdatedAt: NOW },
    awayTeam: { id: `t:${away}`, slug: away, name: away, aliases: [], providerIds: {}, lastUpdatedAt: NOW },
    score: { home: null, away: null },
    broadcasts: [],
    sourceProvenance: { source: 'openligadb', externalId: id, confidence: 'high' },
    lastUpdatedAt: NOW,
    ...extra,
  };
}

class FakePersistence implements FootballPersistencePort {
  snapshots = new Map<string, FootballSnapshotWrite>();
  runs: IngestionRunRecord[] = [];
  states = new Map<string, ProviderSyncState>();

  async upsertSnapshots(snaps: FootballSnapshotWrite[]): Promise<number> {
    let written = 0;
    for (const s of snaps) {
      this.snapshots.set(`${s.providerId}:${s.canonicalKey}`, s);
      written += 1;
    }
    return written;
  }
  async countSnapshots(_providerId?: string): Promise<number> {
    return this.snapshots.size;
  }
  async getSyncState(provider: string): Promise<ProviderSyncState | null> {
    return this.states.get(provider) ?? null;
  }
  async updateSyncState(provider: string, patch: Partial<ProviderSyncState>): Promise<void> {
    const prev =
      this.states.get(provider) ??
      ({ provider, consecutiveFailures: 0, quotaConsumedToday: 0, circuitState: 'closed' } as ProviderSyncState);
    this.states.set(provider, { ...prev, ...patch });
  }
  async recordRun(run: IngestionRunRecord): Promise<void> {
    this.runs.push(run);
  }
  async getLastSuccessfulRun(provider: string): Promise<IngestionRunRecord | null> {
    return [...this.runs].reverse().find((r) => r.providerId === provider && r.outcome === 'success') ?? null;
  }
}

const fakeAdapter = (matches: FootballMatch[]): MatchFetcher => ({
  fetchMatches: async () => matches,
});

interface ServiceOptions {
  adapter?: MatchFetcher;
  persistence?: FootballPersistencePort;
  lock?: LockPort;
  budget?: RequestBudget;
}

function makeService(opts: ServiceOptions = {}) {
  const clock = () => T0;
  return new FootballIngestionService({
    providerId: 'openligadb',
    leagueShortcut: 'bl1',
    season: '2026',
    adapter: opts.adapter ?? fakeAdapter([]),
    persistence: opts.persistence ?? new FakePersistence(),
    lock: opts.lock ?? new InMemoryLock(),
    budget:
      opts.budget ??
      new RequestBudget(
        { dailyBudget: 100, liveReserve: 0, perRunCap: 10, throttleBackoffMs: 0 },
        { clock, resetAt: T0 + 24 * 60 * 60 * 1000 }
      ),
    clock,
  });
}

test('running a tick twice creates no duplicate snapshots', async () => {
  const persistence = new FakePersistence();
  const adapter = fakeAdapter([
    match('1', 'a', 'b', '2026-08-14T19:30:00Z'),
    match('2', 'c', 'd', '2026-08-14T17:30:00Z'),
  ]);
  const service = makeService({ adapter, persistence });

  const first = await service.runTick();
  assert.equal(first.outcome, 'success');
  assert.equal(first.snapshotsWritten, 2);
  assert.equal(persistence.snapshots.size, 2);

  const second = await service.runTick();
  assert.equal(second.outcome, 'success');
  assert.equal(persistence.snapshots.size, 2); // still two — no duplicates
});

test('a provider failure keeps the last good snapshots (never downgrades)', async () => {
  const persistence = new FakePersistence();
  let fail = false;
  const adapter: MatchFetcher = {
    fetchMatches: async () => {
      if (fail) throw new Error('provider down');
      return [match('1', 'a', 'b', '2026-08-14T19:30:00Z')];
    },
  };
  const service = makeService({ adapter, persistence });

  assert.equal((await service.runTick()).outcome, 'success');
  assert.equal(persistence.snapshots.size, 1);

  fail = true;
  const stale = await service.runTick();
  assert.equal(stale.outcome, 'partial'); // last good served, marked stale
  assert.equal(persistence.snapshots.size, 1); // no loss, no duplicates
  assert.equal(service.diagnostics().providers[0].health, 'degraded');
  assert.equal(service.diagnostics().providers[0].staleCount, 1);
});

test('a cold-start provider failure is recorded as failed and writes nothing', async () => {
  const persistence = new FakePersistence();
  const adapter: MatchFetcher = {
    fetchMatches: async () => {
      throw new Error('provider down');
    },
  };
  const service = makeService({ adapter, persistence });
  const result = await service.runTick();
  assert.equal(result.outcome, 'failed');
  assert.equal(result.snapshotsWritten, 0);
  assert.equal(persistence.snapshots.size, 0);
});

test('the lock prevents two ingesters with the same key from both writing', async () => {
  const store = new Map<string, LockEntry>();
  const serviceLock = new InMemoryLock(store, () => T0, 'ingester-a');
  const otherLock = new InMemoryLock(store, () => T0, 'ingester-b');

  let calls = 0;
  const adapter: MatchFetcher = {
    fetchMatches: async () => {
      calls += 1;
      return [match('1', 'a', 'b', '2026-08-14T19:30:00Z')];
    },
  };
  const persistence = new FakePersistence();
  const service = makeService({ adapter, persistence, lock: serviceLock });

  await otherLock.acquire('football:ingestion:openligadb', 60_000);
  const result = await service.runTick();
  assert.equal(result.outcome, 'skipped');
  assert.equal(result.reason, 'lock_held');
  assert.equal(calls, 0);
  assert.equal(persistence.snapshots.size, 0);

  await otherLock.release('football:ingestion:openligadb');
  assert.equal((await service.runTick()).outcome, 'success');
  assert.equal(calls, 1);
});

test('the emergency disable switch skips the tick without an upstream call', async () => {
  let calls = 0;
  const adapter: MatchFetcher = {
    fetchMatches: async () => {
      calls += 1;
      return [];
    },
  };
  const budget = new RequestBudget(
    { dailyBudget: 100, liveReserve: 0, perRunCap: 10, throttleBackoffMs: 0 },
    { clock: () => T0, resetAt: T0 + 24 * 60 * 60 * 1000 }
  );
  const service = makeService({ adapter, budget });
  budget.disable();

  const result = await service.runTick();
  assert.equal(result.outcome, 'skipped');
  assert.equal(result.reason, 'emergency_disabled');
  assert.equal(calls, 0);
});

test('diagnostics redacts credentials and keyed URLs', async () => {
  const adapter: MatchFetcher = {
    fetchMatches: async () => {
      throw new Error('GET https://api.example.com/matches?api_key=SUPERSECRET123 failed');
    },
  };
  const service = makeService({ adapter });
  await service.runTick();

  const report = service.diagnostics();
  const json = JSON.stringify(report);
  assert.equal(json.includes('SUPERSECRET123'), false);
  assert.match(json, /api_key=REDACTED/);
  assert.equal(report.providers[0].health, 'degraded');
  assert.ok(report.providers[0].lastErrorAt);
});

test('field coverage and active matches are computed honestly', () => {
  const live = match('1', 'a', 'b', '2026-08-14T19:30:00Z', {
    status: 'live',
    venue: 'Camp Nou',
    score: { home: 1, away: 0 },
  });
  const bare = match('2', 'c', 'd', '2026-08-14T17:30:00Z');
  assert.equal(countActive([live, bare]), 1);
  // live has venue + score (2/4), bare has none: 2/8 = 0.25
  assert.equal(computeFieldCoverage([live, bare]), 0.25);
});

test('the tick reports bucket counts and a next poll interval', async () => {
  const live = match('1', 'a', 'b', '2026-08-14T19:30:00Z', { status: 'live' });
  const service = makeService({ adapter: fakeAdapter([live]) });
  const result = await service.runTick();
  assert.equal(result.outcome, 'success');
  assert.equal(result.buckets?.live, 1);
  assert.equal(result.nextPollIntervalMs, 30_000);
});
