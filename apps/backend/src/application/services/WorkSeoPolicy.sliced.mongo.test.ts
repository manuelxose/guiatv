/**
 * M13-B3b: `indexableWorks` (reads unchanged, selection in time slices) returns exactly what the pre-change code did.
 * Runs only with TEST_MONGO_URI (throwaway database, dropped afterwards).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { MediaCatalogModel } from '@/infrastructure/database/models/MediaCatalogEntry.model';
import { TVReadAiringModel } from '@/infrastructure/database/models/TVReadAiring.model';
import { TimeSlice } from '@/shared/utils/timeSlice';
import { indexableWorks } from './WorkSeoPolicy';
import { air, ENV, fixture, oracle, prng, row, type Aired, type Row } from './WorkSeoPolicy.parity.fixtures';

const mongoUri = process.env.TEST_MONGO_URI;
const airingDoc = (a: Aired[number], i: number) => ({ id: `a${i}`, date: '20260410', program: { title: `t${i}`, tmdbId: a._id.id, editorialCategory: a._id.c } });

async function withDb(name: string, body: () => Promise<void>): Promise<void> {
  await mongoose.connect(mongoUri as string, { dbName: `guiatv_test_m13b3_${name}_${process.pid}`, monitorCommands: true });
  try {
    await body();
  } finally {
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
  }
}

/** The pre-change read: one find().lean() and one aggregate().exec(), the selection of the oracle. */
async function referenceRead(): Promise<ReturnType<typeof oracle>> {
  const rows = await MediaCatalogModel.find({ tmdbId: { $type: 'number' } }).lean().exec() as unknown as Row[];
  const aired = await TVReadAiringModel.aggregate<Aired[number]>([
    { $match: { 'program.tmdbId': { $type: 'number' }, 'program.editorialCategory': { $in: ['Cine', 'Series'] } } },
    { $group: { _id: { id: '$program.tmdbId', c: '$program.editorialCategory' } } },
  ]).exec();
  return oracle(rows, aired, ENV);
}

async function seed(extraRows = 0): Promise<void> {
  const { rows, aired } = fixture();
  const rnd = prng(11);
  const extra: Row[] = []; const extraAired: Aired = [];
  for (let i = 0; i < extraRows; i += 1) {
    const kind = i % 3 ? 'movie' : 'tv';
    extra.push(row(10_000 + i, kind, `Obra ${i}`, { tmdbGenres: [{ id: 1 + Math.floor(rnd() * 8) }] }));
    if (rnd() < 0.7) extraAired.push(air(10_000 + i, kind));
  }
  const seen = new Set<string>(); // the unique (tmdbType, tmdbId) index forbids what the pure fixture may repeat
  const bad = (rows as Row[]).filter((r) => typeof r.tmdbId === 'number' && !seen.has(`${r.tmdbType}:${r.tmdbId}`) && seen.add(`${r.tmdbType}:${r.tmdbId}`));
  await MediaCatalogModel.collection.insertMany([...bad, ...extra].map((r) => ({ ...r, contentType: r.tmdbType === 'tv' ? 'series' : 'movie', normalizedIdentity: `${r.tmdbType}:${r.tmdbId}:${r.title}` })));
  await TVReadAiringModel.collection.insertMany([...aired, ...extraAired].map(airingDoc));
}

test('sliced selection: 2 600 rows read from MongoDB give exactly the reference result', { skip: !mongoUri }, () =>
  withDb('parity', async () => {
    await seed(2_600);
    const expected = await referenceRead();
    const slice = new TimeSlice(0);
    const works = await indexableWorks(ENV, slice);
    assert.ok(expected.length > 1_000, `${expected.length} reference works`);
    assert.deepEqual(works, expected, 'identical works, fields and order');
    assert.ok(slice.yields > 2_000, `the selection yielded to the event loop (${slice.yields})`);
  }));

test('a catalogue write during the refresh cannot break the read: sorted, unique, and every pre-existing work is present', { skip: !mongoUri }, () =>
  withDb('concurrent', async () => {
    await seed(1_500);
    const before = await referenceRead();
    let inserted = false;
    const slice = new TimeSlice(0, async () => {
      if (!inserted) {
        inserted = true;
        await MediaCatalogModel.collection.insertOne({ ...row(990_001, 'movie', 'Llegada tardia'), contentType: 'movie', normalizedIdentity: 'late' });
        await TVReadAiringModel.collection.insertOne(airingDoc(air(990_001, 'movie'), 990_001));
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    const works = await indexableWorks(ENV, slice);
    const paths = works.map((w) => w.path);
    assert.deepEqual(paths, [...new Set(paths)].sort(), 'sorted and unique');
    for (const w of before) assert.ok(paths.includes(w.path), `${w.path} kept`);
    assert.ok(inserted);
  }));

test('a failing cursor rejects (the caller keeps the previous graph) and never hangs', { skip: !mongoUri }, () =>
  withDb('failure', async () => {
    await seed(50);
    const realFind = MediaCatalogModel.find;
    (MediaCatalogModel as any).find = () => { throw new Error('MongoNetworkError: connection lost'); };
    try {
      await assert.rejects(indexableWorks(ENV), /connection lost/);
    } finally { (MediaCatalogModel as any).find = realFind; }
    const realAggregate = TVReadAiringModel.aggregate;
    (TVReadAiringModel as any).aggregate = () => { throw new Error('MongoServerError: aggregate failed'); };
    try {
      await assert.rejects(indexableWorks(ENV), /aggregate failed/);
    } finally { (TVReadAiringModel as any).aggregate = realAggregate; }
    assert.ok((await indexableWorks(ENV)).length > 0, 'recovers when the database does');
  }));

test('policy off: nothing is read', { skip: !mongoUri }, () =>
  withDb('off', async () => {
    await seed(10);
    assert.deepEqual(await indexableWorks({} as NodeJS.ProcessEnv), []);
  }));
