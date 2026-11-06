/**
 * M14-R7 — Correcciones T1b: prefijo 'blocked:' de la cola y confirmación de las
 * distinciones "aprobado ≠ publicado" y "publicado ≠ indexado".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapQueueItem, mapBlogPost, QUEUE_REASON_PREFIX_TO_CANDIDATE } from './flow-mapping';

test('el prefijo blocked: de la cola mapea a candidato retained', () => {
  assert.equal(QUEUE_REASON_PREFIX_TO_CANDIDATE['blocked:'], 'retained');
});

test('mapQueueItem: rejected por blocked → candidato retained', () => {
  const view = mapQueueItem({ state: 'rejected', reason: 'blocked: agotados los ciclos de revisión (5)' });
  assert.equal(view.candidate, 'retained');
});

test('aprobado NO produce publicado (approved ≠ published)', () => {
  const view = mapBlogPost({ status: 'draft', reviewState: 'approved' });
  assert.equal(view.editorial, 'approved');
  assert.notEqual(view.publication, 'published', 'aprobado no implica publicado');
  assert.equal(view.publication, 'ready');
});

test('publicado NO produce indexado (published ≠ indexada)', () => {
  const view = mapBlogPost({ status: 'publish', reviewState: 'approved' });
  assert.equal(view.publication, 'published');
  assert.notEqual(view.seo, 'indexada', 'publicado no implica indexado');
  assert.equal(view.seo, 'sin-datos');
});
