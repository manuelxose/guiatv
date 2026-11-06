/**
 * M14-R7 - T6: cierra el invariante de publicación para el caso legacy completo.
 *
 * Motivación de T1c (medida en producción, sin inventar): un estado `maintenance-unverifiable` es la
 * re-verificación de una guía YA PUBLICADA; el job no publica (publicUrl null) y su re-verificación falló.
 * Si la publicación se derivara de ese job, la misma guía aparecería a la vez "publicada" y "fallida":
 * el diagnóstico contradictorio que este invariante impide. La publicación 'published' SOLO puede salir
 * de blog_posts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapJobRecord, mapBlogPost, mapLedgerJob } from './flow-mapping';

const LIMITE_ANUNCIOS_JOB = {
  jobId: '2026-11-03T08:33:36.237Z-maint-limite-anuncios-television-minutos-por-hora-ley',
  slug: 'limite-anuncios-television-minutos-por-hora-ley',
  state: 'maintenance-unverifiable',
  reason: 'sin el fichero de ejecución de la versión publicada: no se puede re-verificar',
  publicUrl: null,
};

const LIMITE_ANUNCIOS_POST = {
  slug: 'limite-anuncios-television-minutos-por-hora-ley',
  status: 'publish',
  reviewState: 'approved',
  origin: 'ai-assisted',
};

test('caso legacy completo: el job de mantenimiento no dice "publicado"; lo dice blog_posts', () => {
  const job = mapJobRecord(LIMITE_ANUNCIOS_JOB);
  // El job: re-verificación de mantenimiento fallida, no una publicación.
  assert.equal(job.jobKind, 'maintenance');
  assert.equal(job.execution, 'failed');
  assert.equal(job.publication, 'sin-datos');
  assert.notEqual(job.publication, 'published', 'derivar "published" del job produciría el diagnóstico contradictorio de T1c');

  // La publicación real solo puede salir de blog_posts (status publish).
  const post = mapBlogPost(LIMITE_ANUNCIOS_POST);
  assert.equal(post.publication, 'published');
  assert.equal(post.editorial, 'approved');

  // No hay contradicción: el job falló su mantenimiento y el artículo sigue publicado.
  assert.equal(job.execution, 'failed');
  assert.equal(job.publication, 'sin-datos');
  assert.equal(post.publication, 'published');
});

test('mapLedgerJob tampoco deriva publicación desde un job de mantenimiento o descubrimiento', () => {
  assert.equal(mapLedgerJob({ kind: 'maintenance', state: 'completed' }).publication, 'sin-datos');
  assert.equal(mapLedgerJob({ kind: 'discovery', state: 'completed' }).publication, 'sin-datos');
  // Un job de generación sin registro de publicación sigue siendo 'unpublished'.
  assert.equal(mapLedgerJob({ kind: 'article', state: 'completed' }).publication, 'unpublished');
});
