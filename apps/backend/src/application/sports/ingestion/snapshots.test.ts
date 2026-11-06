import test from 'node:test';
import assert from 'node:assert/strict';
import { FootballMatch } from '@/domain/sports/football/types';
import {
  buildCanonicalKey,
  buildSnapshotContentHash,
  buildSnapshots,
  dedupeSnapshots,
  resolveProviderMatchId,
  stableSerialize,
} from './snapshots';
import { FootballSnapshotWrite } from './types';

const now = '2026-11-06T00:00:00Z';

function match(id: string, home: string, away: string, kickoff: string, extra: Partial<FootballMatch> = {}): FootballMatch {
  return {
    id,
    slug: `${home}-${away}-2026-08-14`,
    providerIds: { openligadb: id },
    competition: { id: 'catalog:bundesliga', slug: 'bundesliga', name: 'Bundesliga', shortName: 'Bundesliga' },
    kickoffAt: kickoff,
    status: 'scheduled',
    homeTeam: { id: `t:${home}`, slug: home, name: home, aliases: [], providerIds: {}, lastUpdatedAt: now },
    awayTeam: { id: `t:${away}`, slug: away, name: away, aliases: [], providerIds: {}, lastUpdatedAt: now },
    score: { home: null, away: null },
    broadcasts: [],
    sourceProvenance: { source: 'openligadb', externalId: id, confidence: 'high' },
    lastUpdatedAt: now,
    ...extra,
  };
}

function write(key: string, id: string): FootballSnapshotWrite {
  const m = match(id, 'a', 'b', '2026-08-14T19:30:00Z');
  return {
    canonicalKey: key,
    providerId: 'openligadb',
    matchId: id,
    competitionSlug: 'bundesliga',
    match: m,
    sourceTimestamp: now,
    ingestedAt: now,
    contentHash: buildSnapshotContentHash(key, m),
  };
}

test('stableSerialize sorts keys so the same content yields the same hash', () => {
  assert.equal(
    stableSerialize({ b: 1, a: [2, { d: 4, c: 3 }] }),
    '{"a":[2,{"c":3,"d":4}],"b":1}'
  );
});

test('contentHash is deterministic and key-sensitive', () => {
  const a = buildSnapshotContentHash('k1', match('1', 'a', 'b', '2026-08-14T19:30:00Z'));
  const b = buildSnapshotContentHash('k1', match('1', 'a', 'b', '2026-08-14T19:30:00Z'));
  const c = buildSnapshotContentHash('k2', match('1', 'a', 'b', '2026-08-14T19:30:00Z'));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('dedupeSnapshots removes duplicate provider+canonicalKey writes', () => {
  const one = write('key', '1');
  const dup = write('key', '1');
  assert.equal(dedupeSnapshots([one, dup]).length, 1);
  assert.equal(dedupeSnapshots([one, write('key2', '2')]).length, 2);
});

test('M06: contentHash ignores volatile timestamps so unchanged football data hashes identically', () => {
  const base = match('1', 'fc-bayern', 'bvb', '2026-08-14T19:30:00Z');
  const first = buildSnapshotContentHash('k1', { ...base, lastUpdatedAt: '2026-11-06T10:00:00Z' });
  const second = buildSnapshotContentHash('k1', { ...base, lastUpdatedAt: '2026-11-06T11:00:00Z' });
  const teamTouched = buildSnapshotContentHash('k1', {
    ...base,
    lastUpdatedAt: '2026-11-06T10:00:00Z',
    homeTeam: { ...base.homeTeam, lastUpdatedAt: '2026-11-06T12:00:00Z' },
  });
  assert.equal(first, second, 'a new ingestion timestamp must not change the content hash');
  assert.equal(first, teamTouched, 'a new team enrichment timestamp must not change the content hash');
});

test('M06: contentHash DOES change when the football content changes', () => {
  const base = match('1', 'fc-bayern', 'bvb', '2026-08-14T19:30:00Z');
  const scheduled = buildSnapshotContentHash('k1', base);
  const finished = buildSnapshotContentHash('k1', { ...base, status: 'finished', score: { home: 2, away: 1 } });
  assert.notEqual(scheduled, finished, 'a real result change must change the content hash');
});

// ─────────────────────────────────────────────────────────────────── F04

test('F04: canonicalKey is a pure function of providerId + provider match id', () => {
  assert.equal(buildCanonicalKey('openligadb', '222'), 'openligadb:222');
  assert.equal(resolveProviderMatchId(match('222', 'a', 'b', '2026-08-14T19:30:00Z'), 'openligadb'), '222');
  // Falls back to the internal id when providerIds lacks the provider entry.
  const bare = { ...match('222', 'a', 'b', '2026-08-14T19:30:00Z'), providerIds: {} } as FootballMatch;
  assert.equal(resolveProviderMatchId(bare, 'openligadb'), '222');
});

test('F04: reversed batches give the same identity for the same match', () => {
  const shared = { kickoffAt: '2026-11-06T18:00:00.000Z', lastUpdatedAt: '2026-11-06T20:00:00.000Z' };
  const a = match('111', 'bayern', 'dortmund', shared.kickoffAt, { slug: 'bayern-dortmund-2026-11-06', ...shared });
  const b = match('222', 'bayern', 'dortmund', shared.kickoffAt, { slug: 'bayern-dortmund-2026-11-06', ...shared });
  const c = match('333', 'bayern', 'dortmund', shared.kickoffAt, { slug: 'bayern-dortmund-2026-11-06', ...shared });

  const forward = buildSnapshots([a, b, c], 'openligadb', now);
  const reversed = buildSnapshots([c, b, a], 'openligadb', now);
  const keyById = (snaps: typeof forward.snapshots) =>
    Object.fromEntries(snaps.map((s) => [s.matchId, s.canonicalKey]));

  assert.deepEqual(
    keyById(forward.snapshots),
    keyById(reversed.snapshots),
    'the same provider match must get the same canonical key regardless of batch order'
  );
  assert.equal(forward.identityConflicts, 0);
  assert.equal(reversed.identityConflicts, 0);
});

test('F04: a single-match batch and a multi-match batch agree on identity', () => {
  const a = match('111', 'bayern', 'dortmund', '2026-11-06T18:00:00Z', { slug: 'bayern-dortmund-2026-11-06' });
  const b = match('222', 'bayern', 'dortmund', '2026-11-06T18:00:00Z', { slug: 'bayern-dortmund-2026-11-06' });

  const alone = buildSnapshots([b], 'openligadb', now);
  const together = buildSnapshots([a, b], 'openligadb', now);

  const bAlone = alone.snapshots[0].canonicalKey;
  const bTogether = together.snapshots.find((s) => s.matchId === '222')!.canonicalKey;
  assert.equal(bAlone, bTogether, 'identity must not change because another fixture was in the batch');
});

test('F04: duplicate fixtures between the same teams on the same day stay distinct', () => {
  const a = match('111', 'bayern', 'dortmund', '2026-11-06T18:00:00Z', { slug: 'bayern-dortmund-2026-11-06' });
  const b = match('222', 'bayern', 'dortmund', '2026-11-06T18:00:00Z', { slug: 'bayern-dortmund-2026-11-06' });
  assert.equal(a.slug, b.slug);

  const { snapshots, identityConflicts } = buildSnapshots([a, b], 'openligadb', now);
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].canonicalKey, 'openligadb:111');
  assert.equal(snapshots[1].canonicalKey, 'openligadb:222');
  assert.notEqual(snapshots[0].canonicalKey, snapshots[1].canonicalKey);
  assert.equal(identityConflicts, 0, 'distinct provider ids are distinct identities, never a conflict');
});

test('F04: a team rename changes the display slug but keeps the same identity', () => {
  const before = match('222', 'bayern', 'dortmund', '2026-11-06T18:00:00Z', { slug: 'bayern-dortmund-2026-11-06' });
  const after = match('222', 'bayern-munich', 'dortmund', '2026-11-06T18:00:00Z', {
    slug: 'bayern-munich-dortmund-2026-11-06',
  });

  const b = buildSnapshots([before], 'openligadb', now).snapshots[0];
  const a = buildSnapshots([after], 'openligadb', now).snapshots[0];
  assert.equal(b.canonicalKey, a.canonicalKey, 'a rename must not change the persistent identity');
  assert.notEqual(b.match.slug, a.match.slug, 'the display slug is refreshed but stays display-only');
});

test('F04: a reschedule changes the date in the slug but keeps the same identity', () => {
  const before = match('222', 'bayern', 'dortmund', '2026-11-06T18:00:00Z', { slug: 'bayern-dortmund-2026-11-06' });
  const after = match('222', 'bayern', 'dortmund', '2026-11-07T18:00:00Z', { slug: 'bayern-dortmund-2026-11-07' });

  const b = buildSnapshots([before], 'openligadb', now).snapshots[0];
  const a = buildSnapshots([after], 'openligadb', now).snapshots[0];
  assert.equal(b.canonicalKey, a.canonicalKey, 'a reschedule must not change the persistent identity');
  assert.notEqual(b.match.slug, a.match.slug);
});

test('F04: repeated syncs of the same match produce one identity that dedupes', () => {
  const m = match('222', 'bayern', 'dortmund', '2026-11-06T18:00:00Z', { slug: 'bayern-dortmund-2026-11-06' });
  const first = buildSnapshots([m], 'openligadb', now);
  const second = buildSnapshots([m], 'openligadb', now);
  assert.equal(first.snapshots[0].canonicalKey, second.snapshots[0].canonicalKey);
  assert.equal(dedupeSnapshots([...first.snapshots, ...second.snapshots]).length, 1);
});

test('F04: different matches never collide, including cross-provider', () => {
  const a = match('111', 'bayern', 'dortmund', '2026-11-06T18:00:00Z', { slug: 'bayern-dortmund-2026-11-06' });
  const b = match('222', 'bayern', 'dortmund', '2026-11-06T18:00:00Z', { slug: 'bayern-dortmund-2026-11-06' });
  const keys = buildSnapshots([a, b], 'openligadb', now).snapshots.map((s) => s.canonicalKey);
  assert.equal(new Set(keys).size, keys.length, 'two distinct provider matches never share a key');

  // Same provider match id under a DIFFERENT provider is a different identity.
  const p2 = {
    ...match('111', 'bayern', 'dortmund', '2026-11-06T18:00:00Z', { slug: 'bayern-dortmund-2026-11-06' }),
    providerIds: { 'football-data-org': '111' },
  } as FootballMatch;
  const kOpen = buildSnapshots([match('111', 'bayern', 'dortmund', '2026-11-06T18:00:00Z', { slug: 'bayern-dortmund-2026-11-06' })], 'openligadb', now).snapshots[0].canonicalKey;
  const kFdo = buildSnapshots([p2], 'football-data-org', now).snapshots[0].canonicalKey;
  assert.notEqual(kOpen, kFdo);
});

test('F04: a duplicate provider match id in ONE batch is flagged as a data-quality conflict', () => {
  const a = match('111', 'bayern', 'dortmund', '2026-11-06T18:00:00Z', { slug: 'bayern-dortmund-2026-11-06' });
  const b = match('111', 'bayern', 'dortmund', '2026-11-06T18:00:00Z', { slug: 'bayern-dortmund-2026-11-06' });
  const { snapshots, identityConflicts } = buildSnapshots([a, b], 'openligadb', now);
  assert.equal(identityConflicts, 1, 'the same provider id twice is the only genuine conflict');
  assert.equal(snapshots.length, 2);
  assert.equal(dedupeSnapshots(snapshots).length, 1, 'the duplicate collapses to one record');
});
