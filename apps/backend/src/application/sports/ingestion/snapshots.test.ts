import test from 'node:test';
import assert from 'node:assert/strict';
import { FootballMatch } from '@/domain/sports/football/types';
import { buildSnapshotContentHash, buildSnapshots, dedupeSnapshots, stableSerialize } from './snapshots';
import { FootballSnapshotWrite } from './types';

const now = '2026-11-06T00:00:00Z';

function match(id: string, home: string, away: string, kickoff: string): FootballMatch {
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

test('buildSnapshots detects slug identity conflicts and disambiguates the key', () => {
  const a = match('1', 'fc-bayern', 'bvb', '2026-08-14T19:30:00Z');
  const b = match('2', 'fc-bayern', 'bvb', '2026-08-14T19:30:00Z');
  // Both matches share the same slug (same teams + same day).
  assert.equal(a.slug, b.slug);

  const { snapshots, identityConflicts } = buildSnapshots([a, b], 'openligadb', now);
  assert.equal(identityConflicts, 1);
  assert.equal(snapshots.length, 2);
  const keys = snapshots.map((s) => s.canonicalKey);
  assert.equal(new Set(keys).size, 2); // distinct keys, no duplicates
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
