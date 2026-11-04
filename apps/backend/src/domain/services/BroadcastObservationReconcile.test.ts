import test from 'node:test';
import assert from 'node:assert/strict';
import { observationId, toObservation } from './BroadcastObservation';
import { reconcileDay } from './BroadcastObservationReconcile';
import { buildTvReadAiringId } from '@/shared/utils/tvMetadata';
import { isAllowedCommand } from '@/scripts/readOnlyGuard';

const NOW = new Date('2026-11-05T10:00:00Z');
const row = (start: string, over: any = {}) => ({
  channel: { id: 'la_1' }, program: { title: `T ${start}`, normalizedTitle: `t ${start}` },
  airing: { start, end: new Date(Date.parse(start) + 3600_000).toISOString() },
  sourceProvenance: { schedule: ['https://iptv-epg.org/x.xml.gz'] }, ...over,
});
const archivedOf = (r: any, extra: any = {}) => {
  const o = (toObservation(r, NOW) as any).obs;
  return { _id: o._id, channelId: o.channelId, startUtc: o.startUtc, rev: 1, ...extra };
};
const D = '2026-11-03';
const A = '2026-11-03T08:00:00.000Z', B = '2026-11-03T09:00:00.000Z', C = '2026-11-03T10:00:00.000Z';

test('complete archive reconciles with nothing missing or extra', () => {
  const rows = [row(A), row(B)];
  const r = reconcileDay(D, rows, rows.map((x) => archivedOf(x)), NOW);
  assert.deepEqual([r.status, r.expected, r.archived, r.missing, r.extra], ['reconciled', 2, 2, [], []]);
});

test('equal counts with different keys are reported as one missing and one extra', () => {
  const r = reconcileDay(D, [row(A), row(B)], [archivedOf(row(A)), archivedOf(row(C))], NOW);
  assert.equal(r.expected, r.archived);
  assert.deepEqual(r.missing, [observationId('la_1', new Date(B))]);
  assert.deepEqual(r.extra, [observationId('la_1', new Date(C))]);
});

test('read-model rows of the same channel and start collapse; differing titles are flagged', () => {
  const r = reconcileDay(D, [row(A), row(A), row(A, { program: { title: 'Other', normalizedTitle: 'other' } })], [archivedOf(row(A))], NOW);
  assert.deepEqual([r.expected, r.duplicateSourceRows, r.conflictingSourceRows, r.missing], [1, 2, 1, []]);
});

test('a source correction keeps the same key: revised rows are counted, never missing or extra', () => {
  const corrected = row(A, { program: { title: 'Corrected', normalizedTitle: 'corrected' } });
  const r = reconcileDay(D, [corrected], [archivedOf(row(A), { rev: 2 })], NOW);
  assert.deepEqual([r.missing, r.extra, r.archivedRevised], [[], [], 1]);
});

test('Madrid-local day: 23:30 CET belongs to the day, 00:00 CET next day is out of day, not missing', () => {
  const late = '2026-11-03T22:30:00.000Z', next = '2026-11-03T23:00:00.000Z'; // 23:30 and 00:00 CET
  const r = reconcileDay(D, [row(late), row(next)], [archivedOf(row(late))], NOW);
  assert.deepEqual([r.expected, r.outOfDay, r.missing], [1, 1, []]);
});

test('rejected rows are not expected; unverified work identity is reported, not inferred', () => {
  const r = reconcileDay(D, [row(A), row(B, { channel: {} })], [archivedOf(row(A))], NOW);
  assert.deepEqual([r.expected, r.rejected['no-channel'], r.missing, r.archivedWithoutWorkRef], [1, 1, [], 1]);
});

test('archive identity defects: duplicate instant under another id, and an id that is not the hash', () => {
  const ok = archivedOf(row(A));
  const r = reconcileDay(D, [row(A)], [ok, { ...ok, _id: 'forged' }], NOW);
  assert.equal(r.archiveIdentityDefects, 1);
});

test('a day the read model no longer holds is not independently reconcilable, never assumed to match', () => {
  const r = reconcileDay(D, [], [archivedOf(row(A))], NOW);
  assert.deepEqual([r.status, r.archived, r.missing, r.extra], ['not-reconcilable', 1, [], []]);
});

test('DST fall-back (2026-10-25): the read-model airing id collides for the two 02:30, the archive identity does not', () => {
  const cest = new Date('2026-10-25T00:30:00Z'), cet = new Date('2026-10-25T01:30:00Z'); // both 02:30 local
  const id = (startTime: Date) => buildTvReadAiringId({ viewDate: '20261025', channelId: 'la_1', startTime, normalizedTitle: 'x' });
  assert.equal(id(cest), id(cet)); // Finding A: characterises today's behaviour; the read model keeps one row (unique id)
  assert.notEqual(observationId('la_1', cest), observationId('la_1', cet));
  const rows = [row(cest.toISOString()), row(cet.toISOString())];
  const r = reconcileDay('2026-10-25', rows, rows.map((x) => archivedOf(x)), NOW);
  assert.deepEqual([r.expected, r.missing], [2, []]); // both survive when the read model does present both
});

test('a backward-compatible future airing id is feasible: only the second 02:xx of the 25h day would need a suffix', () => {
  // Candidate rule (NOT applied in G3D): the offset one hour earlier was larger => this is the repeated hour's second pass.
  const secondPass = (d: Date) => d.getTimezoneOffset() > new Date(d.getTime() - 3600_000).getTimezoneOffset();
  const cest = new Date('2026-10-25T00:30:00Z'), cet = new Date('2026-10-25T01:30:00Z');
  assert.deepEqual([secondPass(cest), secondPass(cet)], [false, true]);
  for (const d of ['2026-10-25T02:30:00Z', '2026-10-24T20:00:00Z', '2026-03-29T01:30:00Z', '2026-11-03T08:00:00Z']) assert.equal(secondPass(new Date(d)), false, d); // every other instant keeps today's id
  const id = (d: Date) => buildTvReadAiringId({ viewDate: '20261025', channelId: 'la_1', startTime: d, normalizedTitle: 'x' }) + (secondPass(d) ? '_cet' : '');
  assert.notEqual(id(cest), id(cet));
  assert.equal(id(cest), buildTvReadAiringId({ viewDate: '20261025', channelId: 'la_1', startTime: cest, normalizedTitle: 'x' }));
});

test('read-only guard classifies the reconciliation commands as reads and any write as a violation', () => {
  for (const c of ['find', 'aggregate', 'getMore', 'count', 'collStats', 'dbStats', 'listIndexes', 'serverStatus', 'buildInfo', 'hello']) assert.equal(isAllowedCommand(c, { pipeline: [{ $match: {} }] }), true, c);
  for (const c of ['insert', 'update', 'delete', 'createIndexes', 'drop', 'mapReduce', 'setParameter', 'createUser', 'grantRolesToUser', 'shutdown', 'fsync', 'killOp', 'createSearchIndexes']) assert.equal(isAllowedCommand(c, {}), false, c); // the last ones were invisible to the old denylist
  assert.equal(isAllowedCommand('aggregate', { pipeline: [{ $merge: { into: 'x' } }] }), false);
  assert.equal(isAllowedCommand('aggregate', { pipeline: [{ $out: 'x' }] }), false);
});
