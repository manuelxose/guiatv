/**
 * Snapshot construction: canonical keys, deterministic content hashes, and
 * idempotent dedupe. Content hashing uses a stable (key-sorted) serialization
 * so the same mapped payload always yields the same hash.
 */

import { createHash } from 'node:crypto';
import { FootballMatch } from '@/domain/sports/football/types';
import { FootballSnapshotWrite } from './types';

export function stableSerialize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = sortKeys(record[key]);
    }
    return out;
  }
  return value;
}

/**
 * Fields that legitimately change on every ingestion while the football content
 * stays identical. Excluded from the content hash so the hash answers the only
 * question it is used for: "did the match data actually change?".
 *
 * M06 defect fixed here: hashing the whole match produced a new hash on every run
 * for unchanged football data, making real-change detection impossible.
 */
const VOLATILE_CONTENT_KEYS = new Set(['lastUpdatedAt', 'ingestedAt']);

function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      if (VOLATILE_CONTENT_KEYS.has(key)) continue;
      out[key] = stripVolatile(record[key]);
    }
    return out;
  }
  return value;
}

export function buildSnapshotContentHash(canonicalKey: string, match: FootballMatch): string {
  return createHash('sha256')
    .update(stableSerialize({ canonicalKey, match: stripVolatile(match) }))
    .digest('hex');
}

export function snapshotIdentity(snapshot: Pick<FootballSnapshotWrite, 'canonicalKey' | 'providerId'>): string {
  return `${snapshot.providerId}:${snapshot.canonicalKey}`;
}

/** Removes duplicate writes for the same (provider, canonicalKey) pair. */
export function dedupeSnapshots(snapshots: FootballSnapshotWrite[]): FootballSnapshotWrite[] {
  const seen = new Set<string>();
  const out: FootballSnapshotWrite[] = [];
  for (const snapshot of snapshots) {
    const key = snapshotIdentity(snapshot);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(snapshot);
  }
  return out;
}

/**
 * Builds idempotent snapshot writes for a set of mapped matches. A slug
 * collision (two different provider ids on the same day/slug) is an identity
 * conflict: the second is disambiguated by appending `-<providerId>-<matchId>`
 * and the conflict count is returned for diagnostics.
 */
export function buildSnapshots(
  matches: FootballMatch[],
  providerId: string,
  ingestedAt: string
): { snapshots: FootballSnapshotWrite[]; identityConflicts: number } {
  const seenSlugs = new Set<string>();
  const snapshots: FootballSnapshotWrite[] = [];
  let identityConflicts = 0;

  for (const match of matches) {
    let canonicalKey = match.slug;
    if (seenSlugs.has(canonicalKey)) {
      identityConflicts += 1;
      canonicalKey = `${match.slug}-${providerId}-${match.id}`;
    }
    seenSlugs.add(canonicalKey);
    snapshots.push({
      canonicalKey,
      providerId,
      matchId: match.id,
      competitionSlug: match.competition?.slug ?? 'unknown',
      match,
      sourceTimestamp: match.lastUpdatedAt,
      ingestedAt,
      contentHash: buildSnapshotContentHash(canonicalKey, match),
    });
  }

  return { snapshots, identityConflicts };
}
