/**
 * M12-G3D: pure, per-day reconciliation of the archive against the read model by the actual observation identity
 * (channel + start instant), not by row counts. Equal counts with different keys are reported as missing + extra.
 * Writes nothing; the caller supplies one bounded day of each side.
 */
import { observationId, toObservation, type RejectReason } from './BroadcastObservation';

export interface ArchivedKey {
  _id: string;
  channelId: string;
  startUtc: Date;
  workRef?: string;
  rev?: number;
}

export interface DayReconciliation {
  day: string;
  /** `not-reconcilable`: the read model no longer holds this day, so there is no independent source to compare with. */
  status: 'reconciled' | 'not-reconcilable';
  expected: number;
  archived: number;
  /** Ids the read model owns for this Madrid day that the archive lacks. */
  missing: string[];
  /** Archived ids with no read-model counterpart: a retained revision of a since-removed row, or a defect. */
  extra: string[];
  /** Read-model rows that share a (channel, start) with an earlier row (collapsed into one observation). */
  duplicateSourceRows: number;
  /** Of those, rows whose title differs from the first one (the archive keeps whichever the cursor returned first). */
  conflictingSourceRows: number;
  /** Archived documents sharing (channel, start) under different ids, or whose _id is not the identity hash. */
  archiveIdentityDefects: number;
  /** Read-model rows whose Madrid start date is another day: owned by that day's run, not missing here. */
  outOfDay: number;
  /** Those rows' ids and owning day, so the caller can verify the owning day's archive actually holds them. */
  outOfDayRows: { id: string; madridDate: string }[];
  rejected: Record<RejectReason, number>;
  /** Evidence only: archived rows with no verified work identity (never inferred from the title). */
  archivedWithoutWorkRef: number;
  archivedRevised: number;
}

export function reconcileDay(day: string, readRows: any[], archived: ArchivedKey[], now: Date = new Date()): DayReconciliation {
  const rejected: Record<RejectReason, number> = { 'no-channel': 0, 'invalid-time': 0, 'no-title': 0, 'no-source': 0 };
  const expected = new Map<string, string>(); // id -> title of the first row
  let duplicateSourceRows = 0, conflictingSourceRows = 0, outOfDay = 0;
  const outOfDayRows: { id: string; madridDate: string }[] = [];
  for (const row of readRows) {
    const r = toObservation(row, now);
    if (!r.ok) { rejected[r.reason]++; continue; }
    if (r.obs.madridDate !== day) { outOfDay++; outOfDayRows.push({ id: r.obs._id, madridDate: r.obs.madridDate }); continue; }
    const first = expected.get(r.obs._id);
    if (first === undefined) expected.set(r.obs._id, r.obs.title);
    else { duplicateSourceRows++; if (first !== r.obs.title) conflictingSourceRows++; }
  }

  const archivedIds = new Set<string>();
  const byInstant = new Set<string>();
  let archiveIdentityDefects = 0, archivedWithoutWorkRef = 0, archivedRevised = 0;
  for (const a of archived) {
    const instant = `${a.channelId}|${new Date(a.startUtc).getTime()}`;
    if (byInstant.has(instant) || a._id !== observationId(a.channelId, new Date(a.startUtc))) archiveIdentityDefects++;
    byInstant.add(instant);
    archivedIds.add(a._id);
    if (!a.workRef) archivedWithoutWorkRef++;
    if ((a.rev ?? 1) > 1) archivedRevised++;
  }

  return {
    day,
    status: readRows.length ? 'reconciled' : 'not-reconcilable',
    expected: expected.size,
    archived: archivedIds.size,
    missing: readRows.length ? [...expected.keys()].filter((id) => !archivedIds.has(id)) : [],
    extra: readRows.length ? [...archivedIds].filter((id) => !expected.has(id)) : [],
    duplicateSourceRows, conflictingSourceRows, archiveIdentityDefects, outOfDay, outOfDayRows, rejected, archivedWithoutWorkRef, archivedRevised,
  };
}
