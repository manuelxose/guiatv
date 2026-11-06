/**
 * Canonical match identity (M05-A).
 *
 * A match is identified by competition + season + home + away + kickoff
 * (within a window) + optional venue. Two records are NEVER merged on team
 * names alone. Guards block men-vs-women and first-team-vs-reserve merges;
 * a postponed fixture that is rescheduled to a new kickoff within the
 * reschedule window is a MOVE (with audit), not a duplicate; and a record
 * ambiguous between two or more fixtures is quarantined, never merged.
 */

import { ProviderMatchRecord } from '../../../domain/sports/football/provider-types';

export const DEFAULT_KICKOFF_WINDOW_MS = 2 * 60 * 60 * 1000;
export const DEFAULT_RESCHEDULE_WINDOW_MS = 72 * 60 * 60 * 1000;

export interface IdentityReconcilerOptions {
  kickoffWindowMs?: number;
  rescheduleWindowMs?: number;
  now?: () => number;
}

export interface ReconciledMatchGroup {
  identityKey: string;
  records: ProviderMatchRecord[];
  quarantined: boolean;
  quarantineReason?: string;
  rescheduled: boolean;
  movedFromKickoffs: string[];
}

export interface MergeVerdict {
  canMerge: boolean;
  reason: string;
}

export function normalizeTeamKey(name: string): string {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const WOMEN_RE =
  /\b(?:women|womens|woman|femenino|femenina|feminino|feminina|féminin|feminine|frauen|damen)\b/i;

export function isWomenTeam(name: string): boolean {
  return WOMEN_RE.test(String(name || ''));
}

/** A reserve side is signalled by a trailing "II", "B" or "2" token. */
export function isReserveTeam(name: string): boolean {
  const tokens = String(name || '').trim().split(/\s+/);
  const last = tokens[tokens.length - 1] ?? '';
  return /^(II|B|2)$/i.test(last) || /\breserves?\b/i.test(String(name || ''));
}

export type TeamGender = 'men' | 'women' | 'unknown';

export function genderOfTeams(home: string, away: string): TeamGender {
  if (isWomenTeam(home) || isWomenTeam(away)) return 'women';
  return 'unknown';
}

type TeamSide = { home: { name: string }; away: { name: string } };

export function genderConflict(a: TeamSide, b: TeamSide): boolean {
  const ga = genderOfTeams(a.home.name, a.away.name);
  const gb = genderOfTeams(b.home.name, b.away.name);
  return ga !== gb && (ga === 'women' || gb === 'women');
}

export function reserveConflict(a: TeamSide, b: TeamSide): boolean {
  const aReserve = isReserveTeam(a.home.name) || isReserveTeam(a.away.name);
  const bReserve = isReserveTeam(b.home.name) || isReserveTeam(b.away.name);
  return aReserve !== bReserve;
}

function kickoffMs(record: ProviderMatchRecord): number {
  return Date.parse(record.kickoff);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function baseSignature(record: ProviderMatchRecord): string {
  return [
    normalizeTeamKey(record.competitionSlug),
    normalizeTeamKey(record.season ?? ''),
    genderOfTeams(record.home.name, record.away.name),
    normalizeTeamKey(record.home.name),
    normalizeTeamKey(record.away.name),
  ].join('|');
}

export function computeIdentityKey(record: ProviderMatchRecord): string {
  const kickoff = kickoffMs(record);
  const day = Number.isNaN(kickoff) ? 'unknown' : iso(kickoff).slice(0, 10);
  return `${baseSignature(record)}|${day}`;
}

/**
 * Refuses name-only merges and blocks gender/reserve/season/team mismatches.
 * Gender and reserve guards run before team-name equality so a clearly
 * different-gender or reserve side is rejected with a precise reason.
 */
export function canMerge(
  a: ProviderMatchRecord,
  b: ProviderMatchRecord,
  options: IdentityReconcilerOptions = {}
): MergeVerdict {
  if (normalizeTeamKey(a.competitionSlug) !== normalizeTeamKey(b.competitionSlug)) {
    return { canMerge: false, reason: 'different_competition' };
  }
  if ((a.season ?? '') !== (b.season ?? '')) {
    return { canMerge: false, reason: 'different_season' };
  }
  if (genderConflict(a, b)) {
    return { canMerge: false, reason: 'gender_conflict' };
  }
  if (reserveConflict(a, b)) {
    return { canMerge: false, reason: 'reserve_team_conflict' };
  }
  const sameTeams =
    normalizeTeamKey(a.home.name) === normalizeTeamKey(b.home.name) &&
    normalizeTeamKey(a.away.name) === normalizeTeamKey(b.away.name);
  if (!sameTeams) {
    return { canMerge: false, reason: 'different_teams' };
  }
  const aKickoff = kickoffMs(a);
  const bKickoff = kickoffMs(b);
  if (Number.isNaN(aKickoff) || Number.isNaN(bKickoff)) {
    return { canMerge: false, reason: 'invalid_kickoff' };
  }
  const window = options.rescheduleWindowMs ?? DEFAULT_RESCHEDULE_WINDOW_MS;
  if (Math.abs(aKickoff - bKickoff) > window) {
    return { canMerge: false, reason: 'different_fixture' };
  }
  return { canMerge: true, reason: 'same_match' };
}

export function reconcile(
  records: ProviderMatchRecord[],
  options: IdentityReconcilerOptions = {}
): ReconciledMatchGroup[] {
  const rescheduleWindowMs = options.rescheduleWindowMs ?? DEFAULT_RESCHEDULE_WINDOW_MS;
  const kickoffWindowMs = options.kickoffWindowMs ?? DEFAULT_KICKOFF_WINDOW_MS;

  const baseGroups = new Map<string, ProviderMatchRecord[]>();
  for (const record of records) {
    const key = baseSignature(record);
    const existing = baseGroups.get(key) ?? [];
    existing.push(record);
    baseGroups.set(key, existing);
  }

  const groups: ReconciledMatchGroup[] = [];

  for (const [signature, groupRecords] of baseGroups) {
    const sorted = [...groupRecords].sort((a, b) => kickoffMs(a) - kickoffMs(b));
    const clusters: ProviderMatchRecord[][] = [];

    for (const record of sorted) {
      const k = kickoffMs(record);
      const overlapping = clusters.filter((cluster) =>
        cluster.some((member) => Math.abs(kickoffMs(member) - k) <= rescheduleWindowMs)
      );
      if (overlapping.length === 0) {
        clusters.push([record]);
      } else if (overlapping.length === 1) {
        overlapping[0].push(record);
      } else {
        groups.push({
          identityKey: `${signature}|quarantine:${normalizeTeamKey(record.providerMatchId)}`,
          records: [record],
          quarantined: true,
          quarantineReason: `ambiguous: within the reschedule window of ${overlapping.length} distinct fixtures`,
          rescheduled: false,
          movedFromKickoffs: [],
        });
      }
    }

    for (const cluster of clusters) {
      const kickoffs = cluster.map(kickoffMs).filter((ms) => Number.isFinite(ms));
      if (kickoffs.length === 0) {
        groups.push({
          identityKey: computeIdentityKey(cluster[0]),
          records: cluster,
          quarantined: false,
          rescheduled: false,
          movedFromKickoffs: [],
        });
        continue;
      }
      const min = Math.min(...kickoffs);
      const max = Math.max(...kickoffs);
      const span = max - min;
      if (span > rescheduleWindowMs) {
        groups.push({
          identityKey: `${signature}|quarantine:${span}`,
          records: cluster,
          quarantined: true,
          quarantineReason: `ambiguous: kickoff span ${span}ms exceeds the ${rescheduleWindowMs}ms reschedule window`,
          rescheduled: false,
          movedFromKickoffs: [],
        });
        continue;
      }
      const rescheduled = kickoffs.length > 1 && span > kickoffWindowMs;
      const latest = cluster.reduce((acc, record) => (kickoffMs(record) >= kickoffMs(acc) ? record : acc));
      groups.push({
        identityKey: computeIdentityKey(latest),
        records: cluster,
        quarantined: false,
        rescheduled,
        movedFromKickoffs: rescheduled ? kickoffs.filter((ms) => ms !== max).map(iso) : [],
      });
    }
  }

  return groups;
}
