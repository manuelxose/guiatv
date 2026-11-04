/**
 * M12-G3C: read-only follow-up of the history capture. Prints counts only (no titles): collection size, docs with rev>1,
 * and per archived Madrid day the observations vs the read model's own rows (unique channel+start whose start falls on that day).
 * Same guard, pool and run recipe as m03l2-cross-type.cjs:
 *
 *   cd /var/www/guiatv/current/apps/backend && systemd-run --wait --pipe -p EnvironmentFile=/etc/guiatv/api.env \
 *     -p WorkingDirectory=/var/www/guiatv/current/apps/backend -p Nice=19 -E MONGODB_MAX_POOL_SIZE=2 \
 *     node /path/to/m12g3c-followup.cjs [--days 14]
 *
 * Run times/CPU of the timer: journalctl -u guiatv-history-archive --since <date> and
 * systemctl show guiatv-history-archive.service -p ExecMainStartTimestamp,ExecMainExitTimestamp,CPUUsageNSec,MemoryPeak.
 */
const path = require('node:path');
const root = process.cwd();
const dist = (p) => require(path.join(root, 'dist', p));
const mongoose = require(require.resolve('mongoose', { paths: [root] }));
const { installReadOnlyGuard } = dist('scripts/readOnlyGuard.js');
const { connectMongoDB, disconnectMongoDB } = dist('config/mongodb.js');

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const madrid = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });

async function main() {
  const guard = installReadOnlyGuard();
  await connectMongoDB();
  try {
    const db = mongoose.connection.db;
    const obs = db.collection('tv_broadcast_observations');
    const stats = await db.command({ collStats: 'tv_broadcast_observations' });
    const byDay = new Map((await obs.aggregate([{ $group: { _id: '$madridDate', n: { $sum: 1 } } }]).toArray()).map((d) => [d._id, d.n]));
    const revised = await obs.countDocuments({ rev: { $gt: 1 } });
    const days = [...byDay.keys()].sort().slice(-Number(arg('--days', 14)));
    const perDay = [];
    for (const iso of days) {
      const compact = iso.replace(/-/g, '');
      const rows = await db.collection('tv_read_airings').find({ date: compact }, { projection: { 'channel.id': 1, 'airing.start': 1 } }).toArray();
      const own = new Set(rows.filter((r) => madrid.format(new Date(r.airing.start)) === iso).map((r) => `${r.channel.id}|${r.airing.start}`));
      perDay.push({ day: iso, observations: byDay.get(iso), readModelOwnUnique: own.size, readModelRows: rows.length, missing: Math.max(0, own.size - byDay.get(iso)) });
    }
    const report = {
      generatedAt: new Date().toISOString(),
      collection: { count: stats.count, avgObjSize: stats.avgObjSize, storageSize: stats.storageSize, totalIndexSize: stats.totalIndexSize },
      docsWithRevGt1: revised, perDay, readOnlyGuard: guard.summary(),
    };
    console.log(JSON.stringify(report));
  } finally { await disconnectMongoDB(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
