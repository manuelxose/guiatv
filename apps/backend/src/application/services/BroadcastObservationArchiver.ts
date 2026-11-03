/**
 * M12-G3B: archives one CLOSED Madrid day of the read model into tv_broadcast_observations.
 * Off unless HISTORY_CAPTURE_ENABLED=true. Not called from any request path, rebuild or cron: a CLI/job must invoke it.
 * Idempotent (stable _id, content hash), restart-safe (re-run = no-op), bounded (per-run and total caps, batches),
 * and race-safe (insert dup-keys and rev-guarded updates that lose a race are counted, never thrown).
 */
import { TVReadAiringModel } from '@/infrastructure/database/models/TVReadAiring.model';
import { TVBroadcastObservationModel, TV_BROADCAST_OBSERVATION_INDEX } from '@/infrastructure/database/models/TVBroadcastObservation.model';
import { madridDate, plan, toObservation, type RejectReason } from '@/domain/services/BroadcastObservation';

export const BATCH_SIZE = 1000;
export const DEFAULT_MAX_PER_RUN = Infinity; // owner decision: no cap; env HISTORY_CAPTURE_MAX_* are optional overrides
export const DEFAULT_MAX_TOTAL = Infinity;

export interface ArchiveResult {
  status: 'disabled' | 'not-closed' | 'capped' | 'done';
  read: number;
  inserted: number;
  revised: number;
  unchanged: number;
  raced: number;
  rejected: Record<RejectReason, number>;
}

const empty = (status: ArchiveResult['status']): ArchiveResult => ({
  status, read: 0, inserted: 0, revised: 0, unchanged: 0, raced: 0,
  rejected: { 'no-channel': 0, 'invalid-time': 0, 'no-title': 0, 'no-source': 0 },
});

export interface ArchiveOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

/** `date` is the read-model key YYYYMMDD (Madrid day). */
export async function archiveDay(date: string, opts: ArchiveOptions = {}): Promise<ArchiveResult> {
  const env = opts.env ?? process.env;
  const now = (opts.now ?? (() => new Date()))();
  if (env.HISTORY_CAPTURE_ENABLED !== 'true') return empty('disabled');
  if (!/^\d{8}$/.test(date)) throw new Error(`invalid date ${date}`);
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`;
  if (iso >= madridDate(now)) return empty('not-closed');

  const maxRun = Number(env.HISTORY_CAPTURE_MAX_PER_RUN) || DEFAULT_MAX_PER_RUN;
  const maxTotal = Number(env.HISTORY_CAPTURE_MAX_TOTAL) || DEFAULT_MAX_TOTAL;
  const res = empty('done');
  let room = Math.min(maxRun, maxTotal - (await TVBroadcastObservationModel.estimatedDocumentCount()));
  if (room <= 0) return empty('capped');
  await TVBroadcastObservationModel.collection.createIndex(TV_BROADCAST_OBSERVATION_INDEX.key, TV_BROADCAST_OBSERVATION_INDEX.options);

  const cursor = TVReadAiringModel.find({ date }, { channel: 1, program: 1, airing: 1, sourceProvenance: 1 }).sort({ id: 1 }).lean().cursor();
  let batch: any[] = [];
  const flush = async () => {
    if (!batch.length) return;
    const obs = [];
    for (const a of batch) {
      res.read++;
      const r = toObservation(a, now);
      if (r.ok) obs.push(r.obs); else res.rejected[r.reason]++;
    }
    batch = [];
    const stored = new Map((await TVBroadcastObservationModel.find({ _id: { $in: obs.map((o) => o._id) } }, { rev: 1, contentHash: 1, title: 1, endUtc: 1 }).lean()).map((s: any) => [s._id as string, s]));
    const ops: any[] = [];
    for (const o of obs) {
      const s = stored.get(o._id) as any;
      const action = plan(o, s);
      if (action === 'unchanged') { res.unchanged++; continue; }
      if (action === 'insert') {
        if (room <= 0) { res.status = 'capped'; continue; }
        room--;
        ops.push({ insertOne: { document: o } });
      } else {
        ops.push({ updateOne: {
          filter: { _id: o._id, rev: s.rev },
          update: { $set: { endUtc: o.endUtc, title: o.title, titleKey: o.titleKey, sources: o.sources, contentHash: o.contentHash, lastSeenAt: o.lastSeenAt, rev: s.rev + 1, prev: { title: s.title, endUtc: s.endUtc, contentHash: s.contentHash }, ...(o.workRef ? { workRef: o.workRef } : {}) }, $inc: { seenCount: 1 } },
        } });
      }
    }
    if (!ops.length) return;
    try {
      const w = await TVBroadcastObservationModel.bulkWrite(ops, { ordered: false });
      res.inserted += w.insertedCount; res.revised += w.modifiedCount;
      res.raced += ops.length - w.insertedCount - w.modifiedCount;
    } catch (err: any) {
      const errs = err?.writeErrors ?? [];
      if (!errs.length || errs.some((e: any) => (e.err?.code ?? e.code) !== 11000)) throw err;
      const w = err.result ?? {};
      const ins = w.insertedCount ?? 0, mod = w.modifiedCount ?? 0;
      res.inserted += ins; res.revised += mod; res.raced += ops.length - ins - mod;
    }
  };
  for await (const a of cursor) {
    batch.push(a);
    if (batch.length >= BATCH_SIZE) await flush();
    if (res.status === 'capped') break;
  }
  await flush();
  return res;
}
