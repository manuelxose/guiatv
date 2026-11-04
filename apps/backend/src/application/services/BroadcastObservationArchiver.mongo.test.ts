/** M12-G3B: archiver on a scratch MongoDB: idempotency, revisions, caps, gating, concurrency, partial-failure recovery. */
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { archiveDay, isDayArchived } from './BroadcastObservationArchiver';
import { reconcileDay } from '@/domain/services/BroadcastObservationReconcile';
import { TVReadAiringModel } from '@/infrastructure/database/models/TVReadAiring.model';
import { TVBroadcastObservationModel } from '@/infrastructure/database/models/TVBroadcastObservation.model';

const NOW = () => new Date('2026-11-03T10:00:00Z');
const ON = { HISTORY_CAPTURE_ENABLED: 'true' } as NodeJS.ProcessEnv;
const row = (n: number, title = `P${n}`, date = '20261102') => ({
  id: `${date}-${n}`, date, viewDate: date, channel: { id: 'la_1' }, program: { title, normalizedTitle: title.toLowerCase() },
  airing: { start: new Date(Date.UTC(2026, 10, 2, 8, n)).toISOString(), end: new Date(Date.UTC(2026, 10, 2, 9, n)).toISOString() },
  assets: {}, availability: {}, sourceProvenance: { schedule: ['https://iptv-epg.org/x.xml.gz'] }, timingContext: {}, relevance: {},
});

test('archiver', { skip: !process.env.TEST_MONGO_URI }, async (t) => {
  await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName: `guiatv_test_g3b_${process.pid}` });
  const reset = async () => { await TVReadAiringModel.deleteMany({}); await TVBroadcastObservationModel.deleteMany({}); };
  try {
    await mongoose.connection.dropDatabase();
    await t.test('disabled by default and for open days: writes nothing', async () => {
      await reset();
      await TVReadAiringModel.insertMany([row(1)]);
      assert.equal((await archiveDay('20261102', { env: {}, now: NOW })).status, 'disabled');
      assert.equal((await archiveDay('20261103', { env: ON, now: NOW })).status, 'not-closed');
      assert.equal(await TVBroadcastObservationModel.countDocuments(), 0);
    });
    await t.test('duplicate ingestion is a no-op; rebuild and restart keep one observation', async () => {
      await reset();
      await TVReadAiringModel.insertMany([row(1), row(2), { ...row(3), channel: {} }]);
      const a = await archiveDay('20261102', { env: ON, now: NOW });
      assert.deepEqual([a.inserted, a.rejected['no-channel']], [2, 1]);
      const b = await archiveDay('20261102', { env: ON, now: () => new Date('2026-11-03T11:00:00Z') });
      assert.deepEqual([b.inserted, b.revised, b.unchanged], [0, 0, 2]);
      await TVReadAiringModel.deleteMany({});
      await TVReadAiringModel.insertMany([row(1), row(2)]); // rebuild
      assert.equal((await archiveDay('20261102', { env: ON, now: NOW })).unchanged, 2);
      assert.equal(await TVBroadcastObservationModel.countDocuments(), 2);
    });
    await t.test('EPG correction revises in place and keeps the previous value', async () => {
      await reset();
      await TVReadAiringModel.insertMany([row(1, 'Cine')]);
      await archiveDay('20261102', { env: ON, now: NOW });
      await TVReadAiringModel.deleteMany({});
      await TVReadAiringModel.insertMany([row(1, 'Heat')]);
      const r = await archiveDay('20261102', { env: ON, now: NOW });
      assert.equal(r.revised, 1);
      const o: any = await TVBroadcastObservationModel.findOne().lean();
      assert.deepEqual([o.title, o.rev, o.prev.title, o.seenCount, o.state], ['Heat', 2, 'Cine', 2, 'scheduled']);
    });
    await t.test('per-run and total caps stop writes', async () => {
      await reset();
      await TVReadAiringModel.insertMany([row(1), row(2), row(3)]);
      const r = await archiveDay('20261102', { env: { ...ON, HISTORY_CAPTURE_MAX_PER_RUN: '2' }, now: NOW });
      assert.deepEqual([r.status, r.inserted], ['capped', 2]);
      const t2 = await archiveDay('20261102', { env: { ...ON, HISTORY_CAPTURE_MAX_TOTAL: '2' }, now: NOW });
      assert.equal(t2.status, 'capped');
      assert.equal(await TVBroadcastObservationModel.countDocuments(), 2);
    });
    await t.test('concurrent runs converge on one document per broadcast without throwing', async () => {
      await reset();
      await TVReadAiringModel.insertMany([row(1), row(2), row(3)]);
      await Promise.all([1, 2, 3].map(() => archiveDay('20261102', { env: ON, now: NOW })));
      assert.equal(await TVBroadcastObservationModel.countDocuments(), 3);
    });
    await t.test('cross-midnight row present in two read-model days is owned by its start day and never flip-flops', async () => {
      await reset();
      const x = (date: string, title: string, end: string) => ({ ...row(1, title, date), id: `${date}-x`, airing: { start: '2026-11-01T22:00:00.000Z', end } });
      await TVReadAiringModel.insertMany([x('20261101', 'No Data', '2026-11-01T23:00:00.000Z'), x('20261102', 'Próximo partido', '2026-11-02T02:00:00.000Z')]);
      for (let i = 0; i < 3; i++) {
        const a = await archiveDay('20261101', { env: ON, now: NOW });
        const b = await archiveDay('20261102', { env: ON, now: NOW });
        assert.equal(b.outOfDay, 1);
        if (i) assert.deepEqual([a.revised, b.revised], [0, 0]);
      }
      const o: any = await TVBroadcastObservationModel.findOne().lean();
      assert.deepEqual([await TVBroadcastObservationModel.countDocuments(), o.title, o.rev], [1, 'No Data', 1]);
    });
    await t.test('partial run: re-run skips what exists and finishes the rest', async () => {
      await reset();
      await TVReadAiringModel.insertMany([row(1), row(2), row(3)]);
      await archiveDay('20261102', { env: { ...ON, HISTORY_CAPTURE_MAX_PER_RUN: '1' }, now: NOW });
      const r = await archiveDay('20261102', { env: ON, now: NOW });
      assert.deepEqual([r.inserted, r.unchanged], [2, 1]);
    });
    await t.test('isDayArchived: true only for a day that has observations', async () => {
      await reset();
      await TVReadAiringModel.insertMany([row(1)]);
      assert.equal(await isDayArchived('20261102'), false);
      await archiveDay('20261102', { env: ON, now: NOW });
      assert.deepEqual([await isDayArchived('20261102'), await isDayArchived('20261101')], [true, false]);
    });
    await t.test('a write that dies half way leaves a consistent subset; the next run completes it with no duplicates', async () => {
      await reset();
      await TVReadAiringModel.insertMany([row(1), row(2), row(3), row(4)]);
      const real = TVBroadcastObservationModel.bulkWrite.bind(TVBroadcastObservationModel);
      (TVBroadcastObservationModel as any).bulkWrite = async (ops: any[], o: any) => { await real(ops.slice(0, 2), o); throw new Error('network timeout'); };
      try { await assert.rejects(archiveDay('20261102', { env: ON, now: NOW }), /network timeout/); } finally { delete (TVBroadcastObservationModel as any).bulkWrite; } // back to the prototype method
      assert.equal(await TVBroadcastObservationModel.countDocuments(), 2);
      const r = await archiveDay('20261102', { env: ON, now: NOW });
      assert.deepEqual([r.inserted, r.unchanged, await TVBroadcastObservationModel.countDocuments()], [2, 2, 4]);
      const rec = reconcileDay('2026-11-02', await TVReadAiringModel.find({ date: '20261102' }).lean(), await TVBroadcastObservationModel.find({}, { channelId: 1, startUtc: 1, rev: 1 }).lean() as any, NOW());
      assert.deepEqual([rec.missing, rec.extra, rec.archiveIdentityDefects], [[], [], 0]); // the same four broadcasts, not merely the same count
    });
    await t.test('key reconciliation: equal counts with a swapped observation are caught; a clean archive passes', async () => {
      await reset();
      await TVReadAiringModel.insertMany([row(1), row(2), row(3)]);
      await archiveDay('20261102', { env: ON, now: NOW });
      const load = async () => reconcileDay('2026-11-02', await TVReadAiringModel.find({ date: '20261102' }).lean(), await TVBroadcastObservationModel.find({ madridDate: '2026-11-02' }, { channelId: 1, startUtc: 1, workRef: 1, rev: 1 }).lean() as any, NOW());
      const clean = await load();
      assert.deepEqual([clean.expected, clean.archived, clean.missing, clean.extra], [3, 3, [], []]);
      const gone = await TVBroadcastObservationModel.findOne({ title: 'P2' }).lean() as any;
      await TVBroadcastObservationModel.deleteOne({ _id: gone._id });
      await TVBroadcastObservationModel.collection.insertOne({ ...gone, _id: 'f'.repeat(24), startUtc: new Date('2026-11-02T20:00:00Z') });
      const bad = await load();
      assert.equal(bad.expected, bad.archived);
      assert.deepEqual([bad.missing, bad.extra.length, bad.archiveIdentityDefects], [[gone._id], 1, 1]);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
