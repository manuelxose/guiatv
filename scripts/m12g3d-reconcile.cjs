/**
 * M12-G3D: read-only follow-up of the history archive. Prints counts and ids only (no titles).
 * Replaces m12g3c-followup.cjs, which compared row counts and so could not see a missing observation hidden by an extra one.
 *
 * Per closed Madrid day of the last --days (integer 1..14, default 7; days with NO archive are included and reported as missing) it loads that day of tv_read_airings and of tv_broadcast_observations
 * and compares the stable keys (channel + start instant) with the same contract as the archiver (reconcileDay).
 * A day the read model no longer holds is reported `not-reconcilable`, never as parity.
 * KEYS ONLY: a title/end correction the archive never applied is not detected. `verdict` is PASS only with missing, extra, identity defects
 * and unarchived out-of-day rows all zero; `extra` mixes 'row removed upstream' with 'defect', so any extra needs a look.
 * Also: collection size, revision distribution, freshness, MongoDB version/topology, opcounters and fs usage (diff two snapshots for load).
 * Same guard, pool and run recipe as m03l2-cross-type.cjs; any write command aborts the process (exit 97):
 *
 *   cd /var/www/guiatv/current/apps/backend && systemd-run --wait --pipe -p EnvironmentFile=/etc/guiatv/api.env \
 *     -p WorkingDirectory=/var/www/guiatv/current/apps/backend -p Nice=19 -E MONGODB_MAX_POOL_SIZE=2 -E MONGODB_MIN_POOL_SIZE=0 \
 *     node /path/to/m12g3d-reconcile.cjs [--days 7]
 *
 * Timer evidence: journalctl -u guiatv-history-archive --since <date>, and
 * systemctl show guiatv-history-archive.service -p Result,ExecMainStatus,ExecMainStartTimestamp,ExecMainExitTimestamp,CPUUsageNSec,MemoryPeak.
 * shortcut: the observations side is read by madridDate, which has no index (collection scan of ~5 MB at 3 days); add a hint/index only if the collection grows past ~1M documents.
 */
const path = require('node:path');
const root = process.cwd();
const dist = (p) => require(path.join(root, 'dist', p));
const mongoose = require(require.resolve('mongoose', { paths: [root] }));
const { installReadOnlyGuard } = dist('scripts/readOnlyGuard.js');
const { connectMongoDB, disconnectMongoDB } = dist('config/mongodb.js');
const { reconcileDay } = dist('domain/services/BroadcastObservationReconcile.js');

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const SAMPLE = 5;
const T = { maxTimeMS: 30000 };
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });
/** The last n closed Madrid days (YYYY-MM-DD), stepped by calendar date so a 23h/25h day is neither skipped nor repeated. */
const closedDays = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(`${fmt.format(new Date())}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - (n - i)); return d.toISOString().slice(0, 10); });
const opt = (p) => p.catch(() => null); // monitor commands need clusterMonitor; a plain readWrite URI must not lose the whole report

async function main() {
  const guard = installReadOnlyGuard();
  await connectMongoDB();
  try {
    const db = mongoose.connection.db;
    const obs = db.collection('tv_broadcast_observations');
    const admin = db.admin();
    const [stats, dbStats, build, hello, status] = await Promise.all([
      db.command({ collStats: 'tv_broadcast_observations', maxTimeMS: 30000 }), opt(db.command({ dbStats: 1 })),
      admin.command({ buildInfo: 1 }), admin.command({ hello: 1 }), opt(admin.command({ serverStatus: 1 })),
    ]);
    const byDay = new Map((await obs.aggregate([{ $group: { _id: '$madridDate', n: { $sum: 1 } } }], T).toArray()).map((d) => [d._id, d.n]));
    const revisions = Object.fromEntries((await obs.aggregate([{ $group: { _id: '$rev', n: { $sum: 1 } } }, { $sort: { _id: 1 } }], T).toArray()).map((d) => [d._id, d.n]));
    const [lastSeen] = await obs.aggregate([{ $group: { _id: null, lastSeenAt: { $max: '$lastSeenAt' } } }], T).toArray();
    const allDays = [...byDay.keys()].filter(Boolean).sort();
    const n = Number(arg('--days', 7));
    if (!Number.isInteger(n) || n < 1 || n > 14) throw new Error('--days must be an integer from 1 to 14');
    const days = closedDays(n);
    const today = fmt.format(new Date());
    const perDay = [];
    for (const iso of days) {
      const readRows = await db.collection('tv_read_airings').find({ date: iso.replace(/-/g, '') }, { projection: { channel: 1, program: 1, airing: 1, sourceProvenance: 1 }, maxTimeMS: 30000 }).toArray();
      const archived = await obs.find({ madridDate: iso }, { projection: { channelId: 1, startUtc: 1, workRef: 1, rev: 1 }, maxTimeMS: 30000 }).toArray();
      const r = reconcileDay(iso, readRows, archived);
      // rows that start on another Madrid day must be held by THAT day's archive, or neither run claimed them
      const owned = r.outOfDayRows.filter((o) => o.madridDate < today);
      const have = new Set((await obs.find({ _id: { $in: owned.map((o) => o.id) } }, { projection: { _id: 1 }, maxTimeMS: 30000 }).toArray()).map((d) => d._id));
      const outOfDayUnarchived = owned.filter((o) => !have.has(o.id)).length;
      const { outOfDayRows, ...rest } = r;
      const clean = r.missing.length + r.extra.length + r.archiveIdentityDefects + outOfDayUnarchived === 0;
      perDay.push({ ...rest, outOfDayUnarchived, verdict: r.status === 'not-reconcilable' ? 'NOT-RECONCILABLE' : clean ? 'PASS' : 'FAIL', missingCount: r.missing.length, extraCount: r.extra.length, missing: r.missing.slice(0, SAMPLE), extra: r.extra.slice(0, SAMPLE) });
    }
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      mongo: { version: build.version, setName: hello.setName ?? null, isWritablePrimary: hello.isWritablePrimary, topology: hello.setName ? 'replica-set' : 'standalone', connections: status?.connections ?? null, opcounters: status?.opcounters ?? null },
      disk: { fsUsedSize: dbStats?.fsUsedSize ?? null, fsTotalSize: dbStats?.fsTotalSize ?? null },
      collection: { count: stats.count, avgObjSize: stats.avgObjSize, storageSize: stats.storageSize, totalIndexSize: stats.totalIndexSize, indexSizes: stats.indexSizes },
      freshness: { newestArchivedDay: allDays[allDays.length - 1] ?? null, lastSeenAt: lastSeen?.lastSeenAt ?? null },
      revisionDistribution: revisions, observationsByDay: Object.fromEntries([...byDay].sort()),
      perDay, readOnlyGuard: guard.summary(),
    }));
  } finally { await disconnectMongoDB(); }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
