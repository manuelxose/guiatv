import test from 'node:test';
import assert from 'node:assert/strict';
import { PathLabelResolver, parseAiringId, staticLabel } from './pathLabels';

test('path labels: airing ids become programme/channel/time, unknown airings use only what the id encodes', async () => {
  const lookups: string[][] = [];
  const resolver = new PathLabelResolver(async (ids) => {
    lookups.push(ids);
    return ids.filter((id) => id.startsWith('20261104_antena_3')).map((id) => ({ id, title: 'El Hormiguero', channelName: 'Antena 3', start: '2026-11-04T20:00:00.000Z' }));
  });
  const live = '/contenido/program:20261104_antena_3_20261104210000';
  const expired = '/contenido/program:20260101_la_1_20260101220000';
  const labels = await resolver.resolve([live, expired, '/', '/canales/antena-3', '/programas/el-hormiguero', '/x/y', live]);
  assert.equal(labels.get(live), 'Emisión · El Hormiguero · Antena 3 · 04/11 21:00');
  assert.equal(labels.get(expired), 'Emisión · La 1 · 01/01 22:00');
  assert.equal(labels.get('/'), 'Inicio');
  assert.equal(labels.get('/canales/antena-3'), 'Canal · Antena 3');
  assert.equal(labels.get('/programas/el-hormiguero'), 'Programa · El hormiguero');
  assert.equal(labels.has('/x/y'), false);
  assert.equal(lookups.length, 1);
  assert.deepEqual(lookups[0].sort(), ['20260101_la_1_20260101220000', '20261104_antena_3_20261104210000']);
  await resolver.resolve([live, expired]);
  assert.equal(lookups.length, 1); // cached (positive and negative)
});

test('path labels: lookups are bounded per call and a failing lookup never throws', async () => {
  let asked = 0;
  const resolver = new PathLabelResolver(async (ids) => { asked = ids.length; throw new Error('db down'); }, { maxLookups: 5, maxCache: 10, ttlMs: 1000, negativeTtlMs: 1000 });
  const paths = Array.from({ length: 30 }, (_, i) => `/contenido/program:20261104_cuatro_2026110420${String(i).padStart(2, '0')}00`);
  const labels = await resolver.resolve(paths);
  assert.equal(asked, 5);
  assert.equal(labels.size, 30);
  assert.equal(labels.get(paths[29]), 'Emisión · Cuatro · 04/11 20:29');
  assert.equal(parseAiringId('nope'), null);
  assert.equal(staticLabel('/cookies'), 'Política de cookies');
});
