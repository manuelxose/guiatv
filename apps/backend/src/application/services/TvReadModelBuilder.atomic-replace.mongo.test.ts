/** M12-G3C: rebuildDate must never leave a day empty — upsert by id first, remove obsolete rows only after the write succeeded. */
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { TvReadModelBuilder } from './TvReadModelBuilder';
import { TVReadAiringModel } from '@/infrastructure/database/models/TVReadAiring.model';

const DAY = '20261023';
const prog = (id: string, title: string, hour: number, description = '') => ({
  id, channelId: 'la_1', canonicalChannelId: 'la_1', title, normalizedTitle: title.toLowerCase(), titleAliases: [],
  startTime: new Date(Date.UTC(2026, 9, 23, hour)), endTime: new Date(Date.UTC(2026, 9, 23, hour + 1)), duration: 60,
  genre: 'Cine', sourceFeed: '', description,
});
const builderFor = (programs: any[]) =>
  new TvReadModelBuilder({ findByDate: async () => programs } as any, { clear: async () => undefined } as any);
const titles = async (date = DAY) => (await TVReadAiringModel.find({ date }).lean()).map((a: any) => a.program.title).sort();

async function withDb(name: string, body: () => Promise<void>) {
  await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName: `guiatv_test_g3c_${name}_${process.pid}` });
  try {
    await mongoose.connection.dropDatabase();
    await TVReadAiringModel.init();
    await body();
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}

test('a failed write leaves the previous day intact and propagates the error', { skip: !process.env.TEST_MONGO_URI }, () =>
  withDb('fail', async () => {
    await builderFor([prog('a', 'Uno', 10), prog('b', 'Dos', 12)]).rebuildDate(DAY);
    const before = await titles();
    assert.deepEqual(before, ['Dos', 'Uno']);

    const original = TVReadAiringModel.bulkWrite;
    (TVReadAiringModel as any).bulkWrite = async () => { throw new Error('MongoNetworkTimeoutError'); };
    try {
      await assert.rejects(builderFor([prog('c', 'Tres', 14)]).rebuildDate(DAY), /MongoNetworkTimeoutError/);
    } finally {
      (TVReadAiringModel as any).bulkWrite = original;
    }
    assert.deepEqual(await titles(), before, 'obsolete rows are only removed after a successful write');
  }));

test('rebuild replaces the day: updates in place, adds new, drops obsolete, keeps other days, is idempotent', { skip: !process.env.TEST_MONGO_URI }, () =>
  withDb('replace', async () => {
    await builderFor([prog('a', 'Uno', 10), prog('b', 'Dos', 12)]).rebuildDate(DAY);
    const other = { ...prog('z', 'Otro día', 10) };
    await builderFor([other]).rebuildDate('20261024');

    const second = [prog('a', 'Uno', 10, 'nueva sinopsis'), prog('c', 'Tres', 14)];
    for (let i = 0; i < 2; i++) await builderFor(second).rebuildDate(DAY); // retry is idempotent
    assert.deepEqual(await titles(), ['Tres', 'Uno']);
    const uno: any = await TVReadAiringModel.findOne({ date: DAY, 'program.title': 'Uno' }).lean();
    assert.equal(uno.program.description, 'nueva sinopsis');
    assert.deepEqual(await titles('20261024'), ['Otro día']);
    assert.equal(await TVReadAiringModel.countDocuments(), 3);
    const ids = (await TVReadAiringModel.find().lean()).map((a: any) => a.id);
    assert.equal(new Set(ids).size, ids.length, 'unique id preserved, no duplicates');
  }));

test('a day with no programmes is emptied, as before', { skip: !process.env.TEST_MONGO_URI }, () =>
  withDb('empty', async () => {
    await builderFor([prog('a', 'Uno', 10)]).rebuildDate(DAY);
    await builderFor([]).rebuildDate(DAY);
    assert.deepEqual(await titles(), []);
  }));

test('concurrent rebuilds converge on the full set and a reader never sees an empty day', { skip: !process.env.TEST_MONGO_URI }, () =>
  withDb('concurrent', async () => {
    const set = Array.from({ length: 300 }, (_, i) => ({ ...prog(`p${i}`, `T${i}`, i % 20), channelId: `ch${i}`, canonicalChannelId: `ch${i}` }));
    await builderFor(set).rebuildDate(DAY);
    let empty = 0;
    let running = true;
    const reader = (async () => {
      while (running) {
        if ((await TVReadAiringModel.countDocuments({ date: DAY })) === 0) empty++;
      }
    })();
    await Promise.all([builderFor(set).rebuildDate(DAY), builderFor(set).rebuildDate(DAY), builderFor(set).rebuildDate(DAY)]);
    running = false;
    await reader;
    assert.equal(empty, 0);
    assert.equal(await TVReadAiringModel.countDocuments({ date: DAY }), 300);
  }));
