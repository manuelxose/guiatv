/**
 * M06-R1 captain verification of the claimed F03 / F05 / F07 fixes.
 *
 * These are ADVERSARIAL checks written against the code as it stands at the start
 * of M06-R1. They exist to test the *claimed* fixes, not to make them pass: a
 * failing expectation here is the finding.
 *
 * The independent review's exact claims being re-tested:
 *   F03 — "anySuccess is set before the empty check, so an all-empty run is recorded
 *          as success with lastSuccessAt and health ok".
 *   F03b— the run schema excludes `empty` (models.ts), so an empty run cannot be
 *          persisted truthfully.
 *   F05 — the ingestion factory constructs OpenLigaDbAdapter directly, bypassing
 *          `assertEligible`; blocking the provider would not stop ingestion.
 *   F07 — a factory built without a ready Mongo connection silently selects the
 *          process-local budget and lock.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { FootballIngestionService } from '@/application/sports/ingestion/FootballIngestionService';
import { InMemoryLock } from '@/application/sports/ingestion/Lock';
import { RequestBudget, RequestBudgetConfig } from '@/application/sports/ingestion/RequestBudget';
import { buildSnapshots } from '@/application/sports/ingestion/snapshots';
import type { FootballMatch } from '@/domain/sports/football/types';

const CONFIG: RequestBudgetConfig = {
  dailyBudget: 100,
  liveReserve: 0,
  perRunCap: 10,
  throttleBackoffMs: 1000,
};

function emptyBudget(): RequestBudget {
  return new RequestBudget(CONFIG, { initiallyDisabled: false });
}

interface Recorded {
  runs: Array<Record<string, unknown>>;
  syncStates: Array<Record<string, unknown>>;
}

/**
 * A persistence double that records every write, so the assertions can be about
 * what the service actually tried to persist.
 */
function recordingPersistence(recorded: Recorded) {
  return {
    async upsertSnapshots(): Promise<number> {
      return 0;
    },
    async updateSyncState(_provider: string, state: Record<string, unknown>): Promise<void> {
      recorded.syncStates.push(state);
    },
    async recordRun(run: Record<string, unknown>): Promise<void> {
      recorded.runs.push(run);
    },
    async countSnapshots(): Promise<number> {
      return 0;
    },
  } as never;
}

function match(overrides: Partial<FootballMatch> = {}): FootballMatch {
  const now = new Date('2026-11-06T12:00:00.000Z').toISOString();
  return {
    id: '111',
    slug: 'bayern-dortmund-2026-11-06',
    providerIds: { openligadb: '111' },
    competition: { slug: 'bundesliga', name: 'Bundesliga' },
    homeTeam: { id: 'a', name: 'Bayern', slug: 'bayern' },
    awayTeam: { id: 'b', name: 'Dortmund', slug: 'dortmund' },
    kickoffAt: now,
    status: 'finished',
    score: { home: 2, away: 1 },
    events: [],
    lastUpdatedAt: now,
    ...overrides,
  } as unknown as FootballMatch;
}

function serviceWith(fetchMatches: () => Promise<FootballMatch[]>, recorded: Recorded) {
  return new FootballIngestionService({
    providerId: 'openligadb',
    competitions: [{ shortcuts: ['bl1'], season: '2026' }],
    adapter: { fetchMatches },
    persistence: recordingPersistence(recorded),
    lock: new InMemoryLock(),
    budget: emptyBudget(),
    clock: () => Date.parse('2026-11-06T12:00:00.000Z'),
  } as never);
}

// ─────────────────────────────────────────────────────────────────── F03

test('F03: an ALL-EMPTY run must not advance lastSuccessAt or report healthy', async () => {
  const recorded: Recorded = { runs: [], syncStates: [] };
  const service = serviceWith(async () => [], recorded);

  const result = await service.runTick();
  const diagnostics = service.diagnostics();
  const provider = diagnostics.providers[0] as unknown as Record<string, unknown>;

  // The run must not claim success...
  assert.notEqual(result.outcome, 'success', 'an all-empty run must never be reported as success');
  // ...and must not advance the success clock or flip health to ok.
  assert.equal(provider['lastSuccessAt'], undefined, 'lastSuccessAt must stay unset after an all-empty run');
  assert.notEqual(provider['health'], 'ok', 'health must not be ok after an all-empty run');
  // A success timestamp must not be written to the sync state either.
  for (const state of recorded.syncStates) {
    assert.equal(state['lastSuccessAt'], undefined, 'sync state must not record lastSuccessAt for an empty run');
  }
});

test('F03b: the persisted run record must be able to express `empty`', async () => {
  const recorded: Recorded = { runs: [], syncStates: [] };
  const service = serviceWith(async () => [], recorded);
  await service.runTick();

  assert.equal(recorded.runs.length, 1, 'exactly one run record must be written');
  // The outcome persisted for an all-empty run must not be a success-ish state.
  const outcome = recorded.runs[0]['outcome'];
  assert.ok(
    outcome === 'empty' || outcome === 'skipped',
    `an all-empty run must persist outcome "empty", got "${String(outcome)}"`
  );
});

test('F03c: a MIXED run (one success, one empty) keeps the success semantics', async () => {
  const recorded: Recorded = { runs: [], syncStates: [] };
  let call = 0;
  const service = new FootballIngestionService({
    providerId: 'openligadb',
    competitions: [
      { shortcuts: ['bl1'], season: '2026' },
      { shortcuts: ['ucl'], season: '2026' },
    ],
    adapter: {
      fetchMatches: async () => {
        call += 1;
        return call === 1 ? [match()] : [];
      },
    },
    persistence: recordingPersistence(recorded),
    lock: new InMemoryLock(),
    budget: emptyBudget(),
    clock: () => Date.parse('2026-11-06T12:00:00.000Z'),
  } as never);

  const result = await service.runTick();
  assert.equal(result.outcome, 'partial', 'one real competition plus one empty is a partial success');
  const provider = service.diagnostics().providers[0] as unknown as Record<string, unknown>;
  assert.ok(provider['lastSuccessAt'], 'a run that ingested real matches must advance lastSuccessAt');
});

// ─────────────────────────────────────────────────────────────────── F04

test('F04: snapshot identity must not depend on batch order', () => {
  // Three fixtures between the SAME two teams on the same day: the provider gives
  // them distinct ids, but the derived slug is identical for all of them.
  const shared = { kickoffAt: '2026-11-06T18:00:00.000Z', lastUpdatedAt: '2026-11-06T20:00:00.000Z' };
  const a = match({ id: '111', slug: 'bayern-dortmund-2026-11-06', ...shared });
  const b = match({ id: '222', slug: 'bayern-dortmund-2026-11-06', ...shared });
  const c = match({ id: '333', slug: 'bayern-dortmund-2026-11-06', ...shared });

  const forward = buildSnapshots([a, b, c], 'openligadb', '2026-11-06T20:00:00.000Z');
  const reversed = buildSnapshots([c, b, a], 'openligadb', '2026-11-06T20:00:00.000Z');

  const keyById = (snaps: typeof forward.snapshots) =>
    Object.fromEntries(snaps.map((s) => [s.matchId, s.canonicalKey]));

  assert.deepEqual(
    keyById(forward.snapshots),
    keyById(reversed.snapshots),
    'the same provider match must get the same canonical key regardless of batch order'
  );
});

test('F04b: a single-match batch and a multi-match batch agree on identity', () => {
  const a = match({ id: '111', slug: 'bayern-dortmund-2026-11-06' });
  const b = match({ id: '222', slug: 'bayern-dortmund-2026-11-06' });

  const alone = buildSnapshots([b], 'openligadb', '2026-11-06T20:00:00.000Z');
  const together = buildSnapshots([a, b], 'openligadb', '2026-11-06T20:00:00.000Z');

  const bAlone = alone.snapshots[0].canonicalKey;
  const bTogether = together.snapshots.find((s) => s.matchId === '222')!.canonicalKey;
  assert.equal(bAlone, bTogether, 'identity must not change because another fixture was in the batch');
});


