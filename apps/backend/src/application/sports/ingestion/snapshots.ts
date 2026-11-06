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
 * Stable snapshot identity (F04).
 *
 * The canonical key is a PURE function of the stable external provider
 * identifier — never the mutable display slug, never the batch order, never an
 * array position. The human-readable `match.slug` stays a DISPLAY-ONLY value on
 * the stored match and must never be used as the persistent identity, because a
 * team rename, a reschedule (date moves in the slug), a reordered provider
 * response or a restart would silently create a second record for the same
 * logical match.
 *
 * Uniqueness assumption (documented so it can be audited): a provider's own
 * match id is unique within that provider and immutable for the life of the
 * match. OpenLigaDB's `matchID` satisfies this (the captain's probe confirms a
 * stable numeric id). Two different providers can never collide because the
 * provider id is part of the key; two different matches of the same provider can
 * never collide because they have distinct provider match ids.
 *
 * Format: `${providerId}:${providerMatchId}` (e.g. `openligadb:222`). This is an
 * INTERNAL identifier; it must not leak into public URLs (public routes use the
 * display slug — see `SnapshotFootballDataProvider.getMatch`).
 */
export function buildCanonicalKey(providerId: string, providerMatchId: string): string {
  return `${providerId}:${providerMatchId}`;
}

/** The provider's own stable identifier for a match; falls back to the internal id. */
export function resolveProviderMatchId(match: FootballMatch, providerId: string): string {
  return match.providerIds?.[providerId] ?? match.id;
}

/**
 * Builds idempotent snapshot writes for a set of mapped matches. Identity is
 * deterministic, so `identityConflicts` is only ever non-zero when the provider
 * itself returned the SAME provider match id twice in one batch (a duplicate
 * fixture) — a genuine data-quality signal, never a collision caused by our key
 * scheme. The duplicate is still emitted and collapsed by `dedupeSnapshots`.
 */
export function buildSnapshots(
  matches: FootballMatch[],
  providerId: string,
  ingestedAt: string
): { snapshots: FootballSnapshotWrite[]; identityConflicts: number } {
  const seenKeys = new Set<string>();
  const snapshots: FootballSnapshotWrite[] = [];
  let identityConflicts = 0;

  for (const match of matches) {
    const canonicalKey = buildCanonicalKey(providerId, resolveProviderMatchId(match, providerId));
    if (seenKeys.has(canonicalKey)) {
      identityConflicts += 1;
    }
    seenKeys.add(canonicalKey);
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
