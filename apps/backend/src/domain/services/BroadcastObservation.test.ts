import test from 'node:test';
import assert from 'node:assert/strict';
import { madridDate, plan, toObservation } from './BroadcastObservation';

const NOW = new Date('2026-11-03T10:00:00Z');
const airing = (over: any = {}) => ({
  channel: { id: 'la_1' }, program: { title: 'Telediario', normalizedTitle: 'telediario' },
  airing: { start: '2026-11-02T20:00:00.000Z', end: '2026-11-02T21:00:00.000Z' },
  sourceProvenance: { schedule: ['https://iptv-epg.org/files/epg-es.xml.gz'] }, ...over,
});

test('same broadcast gives the same id; a correction keeps the id and changes the hash', () => {
  const a = toObservation(airing(), NOW) as any, b = toObservation(airing(), NOW) as any;
  const c = toObservation(airing({ program: { title: 'Telediario 2', normalizedTitle: 'telediario 2' } }), NOW) as any;
  assert.equal(a.obs._id, b.obs._id);
  assert.equal(a.obs._id, c.obs._id);
  assert.equal(plan(b.obs, a.obs), 'unchanged');
  assert.equal(plan(c.obs, a.obs), 'revise');
  assert.equal(plan(a.obs), 'insert');
});

test('rejects missing channel, bad time, no title, no source', () => {
  const reason = (o: any) => (toObservation(airing(o), NOW) as any).reason;
  assert.equal(reason({ channel: {} }), 'no-channel');
  assert.equal(reason({ airing: { start: 'x', end: 'y' } }), 'invalid-time');
  assert.equal(reason({ airing: { start: '2026-11-02T21:00:00Z', end: '2026-11-02T20:00:00Z' } }), 'invalid-time');
  assert.equal(reason({ program: { title: ' ' } }), 'no-title');
  assert.equal(reason({ sourceProvenance: { schedule: [] } }), 'no-source');
});

test('workRef only from a valid entityId, never from the title', () => {
  assert.equal((toObservation(airing(), NOW) as any).obs.workRef, undefined);
  assert.equal((toObservation(airing({ program: { title: 'Heat', mediaId: 'abc', tmdbId: 949 } }), NOW) as any).obs.workRef, undefined);
  assert.equal((toObservation(airing({ program: { title: 'Heat', entityId: 'bad' } }), NOW) as any).obs.workRef, undefined);
  const id = 'ce_01ARZ3NDEKTSV4RRFFQ69G5FAV';
  assert.equal((toObservation(airing({ program: { title: 'Heat', entityId: id } }), NOW) as any).obs.workRef, id);
});

test('Madrid date at midnight and DST boundaries', () => {
  assert.equal(madridDate(new Date('2026-11-02T22:59:59Z')), '2026-11-02'); // CET 23:59
  assert.equal(madridDate(new Date('2026-11-02T23:00:00Z')), '2026-11-03'); // CET 00:00
  assert.equal(madridDate(new Date('2026-06-30T22:00:00Z')), '2026-07-01'); // CEST 00:00
  assert.equal(madridDate(new Date('2026-03-28T23:30:00Z')), '2026-03-29'); // spring-forward day starts
  assert.equal(madridDate(new Date('2026-10-24T22:00:00Z')), '2026-10-25'); // fall-back day (25h) starts
  assert.equal(madridDate(new Date('2026-10-25T22:59:59Z')), '2026-10-25'); // still 25 Oct, 23:59 CET
});
