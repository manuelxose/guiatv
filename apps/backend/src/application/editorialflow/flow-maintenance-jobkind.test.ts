/**
 * M14-R7 - T1c: el tipo de trabajo (`jobKind`) y las consecuencias de mapeo.
 *
 * Motivación medida en producción (sin inventar): un estado `maintenance-*` es la re-verificación
 * periódica de una guía YA PUBLICADA; el job no publica nada y su `publicUrl` es null. Mapearlo a
 * ejecución 'blocked' y a publicación 'published' a la vez producía un diagnóstico contradictorio en
 * los cuatro registros legacy cuyo mantenimiento no pudo re-verificarse.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jobKindOf, mapJobRecord, JOB_STATE_TO_EXECUTION, JOB_STATE_TO_PUBLICATION,
} from './flow-mapping';

const MAINT_UNVERIFIABLE_JOB = {
  jobId: '2026-11-03T08:33:36.237Z-maint-limite-anuncios-television-minutos-por-hora-ley',
  slug: 'limite-anuncios-television-minutos-por-hora-ley',
  state: 'maintenance-unverifiable',
  reason: 'sin el fichero de ejecución de la versión publicada: no se puede re-verificar',
  publicUrl: null,
};

const DISCOVERY_JOB = {
  jobId: '2026-11-06T05:11:06.140Z-discovery',
  slug: 'discovery',
  state: 'discovery',
  publicUrl: null,
};

test('jobKindOf distingue mantenimiento, descubrimiento y generación', () => {
  assert.equal(jobKindOf(MAINT_UNVERIFIABLE_JOB.jobId), 'maintenance');
  assert.equal(jobKindOf(DISCOVERY_JOB.jobId), 'discovery');
  assert.equal(jobKindOf('2026-11-05T18:36:10.676Z-permanencia-television-pago-derechos-espana'), 'generation');
  assert.equal(jobKindOf(undefined), 'generation');
});

test('un job de mantenimiento no publica: publicUrl null y publicación sin datos', () => {
  const view = mapJobRecord(MAINT_UNVERIFIABLE_JOB);
  assert.equal(view.jobKind, 'maintenance');
  assert.equal(view.publication, 'sin-datos', 'un job de mantenimiento nunca informa la publicación');
  assert.equal(view.rawState, 'maintenance-unverifiable');
});

test('la re-verificación fallida es un fallo, no un ciclo de generación bloqueado', () => {
  const view = mapJobRecord(MAINT_UNVERIFIABLE_JOB);
  assert.equal(view.execution, 'failed');
  assert.notEqual(view.execution, 'blocked');
});

test('un job de descubrimiento no informa publicación', () => {
  const view = mapJobRecord(DISCOVERY_JOB);
  assert.equal(view.jobKind, 'discovery');
  assert.equal(view.publication, 'sin-datos');
  assert.equal(view.candidate, 'discovered');
});

test('la tabla de publicación solo publica desde jobs de generación', () => {
  assert.equal(JOB_STATE_TO_PUBLICATION['published'], 'published');
  assert.equal(JOB_STATE_TO_PUBLICATION['blocked'], 'unpublished');
  assert.equal(JOB_STATE_TO_PUBLICATION['maintenance-verified'], 'sin-datos');
  assert.equal(JOB_STATE_TO_PUBLICATION['maintenance-unverifiable'], 'sin-datos');
  assert.equal(JOB_STATE_TO_PUBLICATION['discovery'], 'sin-datos');
});

test('la tabla de ejecución separa verificada de inverificable sin llamarlas bloqueado', () => {
  assert.equal(JOB_STATE_TO_EXECUTION['maintenance-verified'], 'completed');
  assert.equal(JOB_STATE_TO_EXECUTION['maintenance-unverifiable'], 'failed');
});
