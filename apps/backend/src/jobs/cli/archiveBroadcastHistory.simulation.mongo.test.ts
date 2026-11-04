/**
 * M12-G3D: simulation of consecutive scheduled runs (03:30 Madrid) with the real catch-up and archiver on a scratch MongoDB.
 * Between runs it reproduces what production showed on 2026-11-04: the 06:00 EPG sync rewrites the PREVIOUS day's read model
 * (≈ -2.8 % rows, ≈ +1.4 % rows, 20261103: 328 gone / 161 new of 11 585). Scaled to 300 rows a day.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { runCatchup } from './archiveBroadcastHistory.cli';
import { TVReadAiringModel } from '@/infrastructure/database/models/TVReadAiring.model';
import { TVBroadcastObservationModel } from '@/infrastructure/database/models/TVBroadcastObservation.model';
import { reconcileDay } from '@/domain/services/BroadcastObservationReconcile';

const ON = { HISTORY_CAPTURE_ENABLED: 'true' } as NodeJS.ProcessEnv;
const CHANNELS = 30, SLOTS = 10; // 300 rows a day: a start every 2 h from 00:00 CET on 30 channels
const key = (iso: string) => iso.replace(/-/g, '');
const dayStart = (iso: string) => Date.parse(`${iso}T00:00:00+01:00`); // November: CET
const mk = (iso: string, ch: number, startMs: number, tag = '') => ({
  id: `${key(iso)}-${ch}-${startMs}${tag}`, date: key(iso), viewDate: key(iso), channel: { id: `ch_${ch}` }, program: { title: `P ${ch} ${startMs}${tag}`, normalizedTitle: `p ${ch} ${startMs}${tag}` },
  airing: { start: new Date(startMs).toISOString(), end: new Date(startMs + 3_600_000).toISOString() },
  assets: {}, availability: {}, sourceProvenance: { schedule: ['https://iptv-epg.org/x.xml.gz'] }, timingContext: {}, relevance: {},
});
const fullDay = (iso: string) => Array.from({ length: CHANNELS * SLOTS }, (_, i) => mk(iso, i % CHANNELS, dayStart(iso) + Math.floor(i / CHANNELS) * 7_200_000));

/** The 06:00 sync of D+1 replaces day D with what the sources publish now: 9 rows gone, 4 new (2 shifted 10 min, 2 on a new channel). */
async function rewriteLikeTheSixAmSync(iso: string) {
  const rows = (await TVReadAiringModel.find({ date: key(iso) }).lean()) as any[];
  await TVReadAiringModel.deleteMany({ id: { $in: rows.slice(0, 9).map((r) => r.id) } });
  const shifted = rows.slice(20, 22).map((r) => mk(iso, Number(r.channel.id.slice(3)), Date.parse(r.airing.start) + 600_000, 's'));
  await TVReadAiringModel.insertMany([...shifted, mk(iso, 99, dayStart(iso) + 3_600_000), mk(iso, 99, dayStart(iso) + 10_800_000)]);
}
const total = () => TVBroadcastObservationModel.countDocuments();
const recon = async (iso: string) =>
  reconcileDay(iso, await TVReadAiringModel.find({ date: key(iso) }).lean(), (await TVBroadcastObservationModel.find({ madridDate: iso }, { channelId: 1, startUtc: 1, workRef: 1, rev: 1 }).lean()) as any, new Date());

test('simulated timer runs 04, 05, 06/11 and a missed run', { skip: !process.env.TEST_MONGO_URI }, async (t) => {
  await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName: `guiatv_test_g3d_sim_${process.pid}` });
  try {
    await mongoose.connection.dropDatabase();
    for (const d of ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']) await TVReadAiringModel.insertMany(fullDay(d));
    const at = (iso: string) => new Date(iso);

    await t.test('run 1 (04/11 03:30): archives the three closed days', async () => {
      const r = await runCatchup([], ON, at('2026-11-04T02:30:42Z'), () => {});
      assert.deepEqual(Object.keys(r), ['20261101', '20261102', '20261103']);
      assert.deepEqual(Object.values(r).map((x: any) => x.inserted), [300, 300, 300]);
      assert.equal(await total(), 900);
    });

    await rewriteLikeTheSixAmSync('2026-11-03');

    await t.test('the rewrite shows up as drift (missing 4 / extra 9), exactly the production FAIL pattern, and the archive is intact', async () => {
      const r = await recon('2026-11-03');
      assert.deepEqual([r.expected, r.archived, r.missing.length, r.extra.length], [295, 300, 4, 9]);
    });

    await t.test('run 2 (05/11 03:30): D-1..D-3 catch-up skips the rewritten day, archives only 04/11', async () => {
      const r: any = await runCatchup([], ON, at('2026-11-05T02:31:29Z'), () => {});
      assert.deepEqual(Object.keys(r), ['20261102', '20261103', '20261104']);
      assert.deepEqual([r['20261102'].status, r['20261103'].status, r['20261104'].inserted], ['skipped-already-archived', 'skipped-already-archived', 300]);
      assert.equal(await total(), 1200);
      assert.equal(await TVBroadcastObservationModel.countDocuments({ madridDate: '2026-11-03' }), 300); // nothing added after the rewrite
    });

    await t.test('without the freeze the same run would have contaminated 03/11 with the 4 post-close rows', async () => {
      const r: any = await runCatchup([], { ...ON, HISTORY_CAPTURE_RECAPTURE: 'true' }, at('2026-11-05T02:31:29Z'), () => {});
      assert.equal(r['20261103'].inserted, 4);
      await TVBroadcastObservationModel.deleteMany({ madridDate: '2026-11-03', title: /s$|P 99/ }); // undo the contamination for the next steps
      assert.equal(await TVBroadcastObservationModel.countDocuments({ madridDate: '2026-11-03' }), 300);
    });

    await rewriteLikeTheSixAmSync('2026-11-04');

    await t.test('run 3 (06/11 03:30): archives only 05/11; 03/11 and 04/11 stay as first announced', async () => {
      const r: any = await runCatchup([], ON, at('2026-11-06T02:30:50Z'), () => {});
      assert.deepEqual([r['20261103'].status, r['20261104'].status, r['20261105'].inserted], ['skipped-already-archived', 'skipped-already-archived', 300]);
      assert.equal(await total(), 1500);
      const rev = await TVBroadcastObservationModel.countDocuments({ rev: { $gt: 1 } });
      assert.equal(rev, 0);
    });

    await t.test('a re-run of the same timer is a no-op (idempotent)', async () => {
      const r: any = await runCatchup([], ON, at('2026-11-06T02:35:00Z'), () => {});
      assert.ok(Object.values(r).every((x: any) => x.status === 'skipped-already-archived'));
      assert.equal(await total(), 1500);
    });

    await t.test('a missed run (no timer on 07/11) is recovered on 08/11: only the days with nothing archived are read', async () => {
      const r: any = await runCatchup([], ON, at('2026-11-08T02:30:10Z'), () => {});
      assert.deepEqual(Object.keys(r), ['20261105', '20261106', '20261107']);
      assert.deepEqual([r['20261105'].status, r['20261106'].inserted, r['20261107'].inserted], ['skipped-already-archived', 300, 300]);
      assert.equal(await total(), 2100);
    });

    await t.test('naming the day forces a re-read (operator recovery of a half-archived day)', async () => {
      const r: any = await runCatchup(['20261103'], ON, at('2026-11-08T02:40:00Z'), () => {});
      assert.equal(r['20261103'].inserted, 4);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
