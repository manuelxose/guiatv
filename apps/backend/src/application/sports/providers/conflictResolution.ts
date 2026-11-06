/**
 * Field-level conflict resolution (M05-A).
 *
 * Merges one provider's records for a single match identity into an
 * `EnrichedMatch` where every critical field carries provenance. Rules:
 *  - capability tier first (live_score outranks fixtures-only for score);
 *  - then newer `sourceTimestamp` for the same tier;
 *  - then confidence and provider id (deterministic tie-break);
 *  - disagreements are NEVER "last-wins": the rejected value(s) are kept in
 *    `conflicts[]` and the chosen field is flagged `conflict: true`.
 *
 * Events get extra handling: cross-provider dedupe within ±1 minute, removal
 * of goals absent from a provider's newer response (VAR-disallowed), and
 * penalty shootouts kept separate from the regulation score.
 */

import { FootballMatchStatus, FootballScore } from '../../../domain/sports/football/types';
import {
  AuditRecord,
  ConflictRecord,
  EnrichedMatch,
  FieldProvenance,
  FieldVerification,
  PlatformMatchRecord,
  ProviderMatchEvent,
  ProviderMatchRecord,
  ProviderId,
  ProvenancedValue,
} from '../../../domain/sports/football/provider-types';
import { DEFAULT_KICKOFF_WINDOW_MS, computeIdentityKey } from './IdentityReconciler';

export interface FieldResolutionOptions {
  now?: () => Date;
  kickoffWindowMs?: number;
  identityKey?: string;
}

interface Candidate<T> {
  value: T;
  provenance: FieldProvenance;
  strength: number;
  provider: ProviderId;
  sourceTimestampMs: number;
}

function verificationRank(verification: FieldVerification): number {
  switch (verification) {
    case 'verified':
      return 3;
    case 'derived':
      return 2;
    case 'single_source':
      return 1;
    case 'inferred':
      return 0;
  }
}

function verificationFor(capabilities: string[]): FieldVerification {
  if (capabilities.includes('live_score') || capabilities.includes('live_minute')) return 'verified';
  if (capabilities.includes('results') || capabilities.includes('events')) return 'verified';
  return 'single_source';
}

function confidenceFor(field: string, capabilities: string[]): number {
  if (capabilities.includes('live_score') || capabilities.includes('live_minute')) return 1;
  if (capabilities.includes('results')) return 0.95;
  if (capabilities.includes('events')) return 0.9;
  if (field === 'venue' && capabilities.includes('venue')) return 0.9;
  if (field === 'referee' && capabilities.includes('referee')) return 0.9;
  return 0.7;
}

/** Capability + confidence compressed into one comparable strength number. */
function strengthFor(field: string, capabilities: string[]): number {
  return verificationRank(verificationFor(capabilities)) * 1000 + Math.round(confidenceFor(field, capabilities) * 100);
}

function strengthForProvenance(provenance: FieldProvenance): number {
  return verificationRank(provenance.verification) * 1000 + Math.round(provenance.confidence * 100);
}

function provenanceFor(field: string, record: ProviderMatchRecord, now: () => Date): FieldProvenance {
  return {
    provider: record.providerId,
    sourceTimestamp: record.sourceTimestamp,
    ingestedAt: now().toISOString(),
    verification: verificationFor(record.capabilities),
    confidence: confidenceFor(field, record.capabilities),
    conflict: false,
  };
}

function collect<T>(
  field: string,
  records: ProviderMatchRecord[],
  get: (record: ProviderMatchRecord) => T | undefined,
  previous: EnrichedMatch | undefined,
  prevGet: (match: EnrichedMatch) => ProvenancedValue<T> | undefined,
  now: () => Date
): Candidate<T>[] {
  const candidates: Candidate<T>[] = [];
  for (const record of records) {
    const value = get(record);
    if (value === undefined) continue;
    candidates.push({
      value,
      provenance: provenanceFor(field, record, now),
      strength: strengthFor(field, record.capabilities),
      provider: record.providerId,
      sourceTimestampMs: record.sourceTimestamp ? Date.parse(record.sourceTimestamp) : Number.NEGATIVE_INFINITY,
    });
  }
  if (previous) {
    const provenanced = prevGet(previous);
    if (provenanced) {
      candidates.push({
        value: provenanced.value,
        provenance: provenanced.provenance,
        strength: strengthForProvenance(provenanced.provenance),
        provider: provenanced.provenance.provider,
        sourceTimestampMs: provenanced.provenance.sourceTimestamp
          ? Date.parse(provenanced.provenance.sourceTimestamp)
          : Number.NEGATIVE_INFINITY,
      });
    }
  }
  return candidates;
}

function pickBest<T>(
  field: string,
  candidates: Candidate<T>[],
  conflicts: ConflictRecord[],
  equals: (a: T, b: T) => boolean
): ProvenancedValue<T> | undefined {
  if (candidates.length === 0) return undefined;
  const sorted = [...candidates].sort((a, b) => {
    if (a.strength !== b.strength) return b.strength - a.strength;
    if (a.sourceTimestampMs !== b.sourceTimestampMs) return b.sourceTimestampMs - a.sourceTimestampMs;
    if (a.provenance.confidence !== b.provenance.confidence) {
      return b.provenance.confidence - a.provenance.confidence;
    }
    return a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0;
  });
  const chosen = sorted[0];
  const rejected: { value: unknown; provenance: FieldProvenance }[] = [];
  for (const candidate of sorted.slice(1)) {
    if (!equals(chosen.value, candidate.value)) {
      rejected.push({ value: candidate.value, provenance: candidate.provenance });
    }
  }
  if (rejected.length > 0) {
    conflicts.push({ field, chosen: chosen.value, rejected, reason: 'value_disagreement' });
  }
  return { value: chosen.value, provenance: { ...chosen.provenance, conflict: rejected.length > 0 } };
}

function scoreEquals(a: FootballScore, b: FootballScore): boolean {
  return a.home === b.home && a.away === b.away;
}

function scorePresent(score: FootballScore | undefined): score is FootballScore {
  return score !== undefined && !(score.home === null && score.away === null);
}

function minutePresent(minute: number | null | undefined): minute is number {
  return typeof minute === 'number';
}

function eventPlayerKey(player: string | undefined): string {
  return String(player || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function isDuplicateEvent(a: ProviderMatchEvent, b: ProviderMatchEvent): boolean {
  if (a.type !== b.type) return false;
  if (eventPlayerKey(a.player) !== eventPlayerKey(b.player)) return false;
  if (a.minute === undefined || b.minute === undefined) return true;
  return Math.abs(a.minute - b.minute) <= 1;
}

function eventKey(event: ProviderMatchEvent): string {
  return `${event.type}|${event.minute ?? '?'}|${eventPlayerKey(event.player)}`;
}

function resolveEvents(
  records: ProviderMatchRecord[],
  audit: AuditRecord[],
  now: () => Date
): ProvenancedValue<ProviderMatchEvent[]> | undefined {
  const byProvider = new Map<ProviderId, ProviderMatchRecord[]>();
  for (const record of records) {
    if (record.events === undefined) continue;
    const list = byProvider.get(record.providerId) ?? [];
    list.push(record);
    byProvider.set(record.providerId, list);
  }
  if (byProvider.size === 0) return undefined;

  const kept: ProviderMatchEvent[] = [];
  const providers = new Set<ProviderId>();

  for (const [providerId, providerRecords] of byProvider) {
    providers.add(providerId);
    const newest = [...providerRecords].sort(
      (a, b) =>
        (b.sourceTimestamp ? Date.parse(b.sourceTimestamp) : Number.NEGATIVE_INFINITY) -
        (a.sourceTimestamp ? Date.parse(a.sourceTimestamp) : Number.NEGATIVE_INFINITY)
    )[0];
    const newestEvents = newest.events ?? [];
    const newestKeys = new Set(newestEvents.map(eventKey));
    for (const older of providerRecords) {
      if (older === newest) continue;
      for (const event of older.events ?? []) {
        if (event.type === 'goal' && !newestKeys.has(eventKey(event))) {
          audit.push({
            kind: 'removed_event',
            field: 'events',
            detail: `goal ${eventKey(event)} absent from the newer response of ${providerId}`,
            at: now().toISOString(),
            provider: providerId,
            before: event,
            after: undefined,
          });
        }
      }
    }
    for (const event of newestEvents) {
      if (kept.some((existing) => isDuplicateEvent(existing, event))) {
        audit.push({
          kind: 'deduplicated_event',
          field: 'events',
          detail: `duplicate event ${eventKey(event)}`,
          at: now().toISOString(),
          provider: providerId,
        });
        continue;
      }
      kept.push(event);
    }
  }

  const representative = [...byProvider.values()][0][0];
  return {
    value: kept,
    provenance: provenanceFor('events', representative, now),
  };
}

function emptyMatch(identityKey: string, now: () => Date): EnrichedMatch {
  return {
    identityKey,
    matchId: identityKey,
    providerIds: [],
    conflicts: [],
    audit: [],
    quarantined: false,
    lastUpdatedAt: now().toISOString(),
  };
}

export function resolveMatchFields(
  records: ProviderMatchRecord[],
  previous?: EnrichedMatch,
  options: FieldResolutionOptions = {}
): EnrichedMatch {
  const now = options.now ?? (() => new Date());
  const conflicts: ConflictRecord[] = [];
  const audit: AuditRecord[] = [];

  if (records.length === 0) {
    return previous ?? emptyMatch('unresolved', now);
  }

  const latest = records.reduce((acc, record) =>
    Date.parse(record.kickoff) >= Date.parse(acc.kickoff) ? record : acc
  );
  const identityKey = options.identityKey ?? computeIdentityKey(latest);

  const kickoffWindowMs = options.kickoffWindowMs ?? DEFAULT_KICKOFF_WINDOW_MS;

  const competition = pickBest(
    'competition',
    collect('team', records, (r) => r.competitionSlug, previous, (m) => m.competition, now),
    conflicts,
    (a, b) => a === b
  );
  const season = pickBest(
    'season',
    collect('team', records, (r) => r.season, previous, (m) => m.season, now),
    conflicts,
    (a, b) => a === b
  );
  const kickoff = pickBest(
    'kickoff',
    collect('kickoff', records, (r) => r.kickoff, previous, (m) => m.kickoff, now),
    conflicts,
    (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) <= kickoffWindowMs
  );
  const status = pickBest<FootballMatchStatus>(
    'status',
    collect('status', records, (r) => r.status, previous, (m) => m.status, now),
    conflicts,
    (a, b) => a === b
  );
  const homeTeam = pickBest(
    'homeTeam',
    collect('team', records, (r) => r.home.name, previous, (m) => m.homeTeam, now),
    conflicts,
    (a, b) => a === b
  );
  const awayTeam = pickBest(
    'awayTeam',
    collect('team', records, (r) => r.away.name, previous, (m) => m.awayTeam, now),
    conflicts,
    (a, b) => a === b
  );
  const score = pickBest(
    'score',
    collect('score', records, (r) => (scorePresent(r.score) ? r.score : undefined), previous, (m) => m.score, now),
    conflicts,
    scoreEquals
  );
  const penaltyScore = pickBest(
    'penaltyScore',
    collect(
      'score',
      records,
      (r) => (scorePresent(r.penaltyScore) ? r.penaltyScore : undefined),
      previous,
      (m) => m.penaltyScore,
      now
    ),
    conflicts,
    scoreEquals
  );
  const minute = pickBest<number | null>(
    'minute',
    collect('minute', records, (r) => (minutePresent(r.minute) ? r.minute : undefined), previous, (m) => m.minute, now),
    conflicts,
    (a, b) => a === b
  );
  const venue = pickBest(
    'venue',
    collect('venue', records, (r) => r.venue, previous, (m) => m.venue, now),
    conflicts,
    (a, b) => a === b
  );
  const referee = pickBest(
    'referee',
    collect('referee', records, (r) => r.referee, previous, (m) => m.referee, now),
    conflicts,
    (a, b) => a === b
  );
  const statistics = pickBest(
    'statistics',
    collect('statistics', records, (r) => r.statistics, previous, (m) => m.statistics, now),
    conflicts,
    (a, b) => JSON.stringify(a) === JSON.stringify(b)
  );
  const lineups = pickBest(
    'lineups',
    collect('lineups', records, (r) => r.lineups, previous, (m) => m.lineups, now),
    conflicts,
    (a, b) => a === b
  );
  const events = resolveEvents(records, audit, now) ?? previous?.events;

  // Final-score correction audit: a newer source changed a previously kept score.
  if (previous?.score && score && !scoreEquals(previous.score.value, score.value)) {
    audit.push({
      kind: 'score_correction',
      field: 'score',
      detail: 'final score corrected by newer source',
      at: now().toISOString(),
      provider: score.provenance.provider,
      before: previous.score.value,
      after: score.value,
    });
  }

  const providerIds: ProviderId[] = [];
  for (const record of records) {
    if (!providerIds.includes(record.providerId)) providerIds.push(record.providerId);
  }

  const merged: PlatformMatchRecord = {
    identityKey,
    competition,
    season,
    kickoff,
    status,
    homeTeam,
    awayTeam,
    score,
    penaltyScore,
    minute,
    venue,
    referee,
    events,
    statistics,
    lineups,
    conflicts,
    audit,
    lastUpdatedAt: now().toISOString(),
  };

  return {
    ...merged,
    matchId: identityKey,
    providerIds,
    quarantined: false,
  };
}
