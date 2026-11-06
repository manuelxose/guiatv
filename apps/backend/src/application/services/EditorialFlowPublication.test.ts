/**
 * M14-R7 — El detalle del bloqueo de elegibilidad editorial llega a la API.
 *
 * T11: cuando la procedencia está incompleta, la elegibilidad debe decir si falta
 * el bundle de evidencia, el borrador firmado o la procedencia entera, con un
 * subcódigo estable (`editorial-bundle` / `editorial-draft` /
 * `editorial-provenance`) además del código de gate `editorial`, en lugar de
 * sustituir el mensaje específico por el texto genérico.
 *
 *   node --test dist/application/services/EditorialFlowPublication.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EditorialFlowPublicationService,
  PublicationNotEligibleError,
  provenanceSubCode,
  type PublicationBlocker,
  type PublicationEligibility,
  type PublicationGateway,
} from './EditorialFlowPublication';

const BUNDLE_MESSAGE =
  'La procedencia editorial está incompleta: falta el bundle de evidencia (fuentes y afirmaciones). No se puede evaluar la evidencia y el artículo no es elegible para publicación por política.';
const DRAFT_MESSAGE =
  'La procedencia editorial está incompleta: falta el borrador firmado (draftMarkdown) que se revisó. Sin él no se puede comprobar que lo publicado sea lo verificado.';
const PROVENANCE_MESSAGE = 'La publicación por política exige un artículo ai-assisted con procedencia del pipeline.';

function harness(blockers: PublicationBlocker[], options: { status?: string; reviewState?: string } = {}) {
  const calls = { eligibility: 0, publish: 0 };
  const gateway: PublicationGateway = {
    async eligibility(postId): Promise<PublicationEligibility> {
      calls.eligibility += 1;
      return {
        postId,
        status: options.status ?? 'draft',
        reviewState: options.reviewState ?? 'unreviewed',
        eligible: blockers.length === 0,
        alreadyPublished: false,
        blockers,
      };
    },
    async publish() {
      calls.publish += 1;
      return { post: { status: 'publish' }, qualityFindings: [] };
    },
  };
  const service = new EditorialFlowPublicationService({
    gateway,
    store: { claim: async () => 'claimed', complete: async () => undefined, get: async () => null },
    audit: { insert: async () => undefined },
    clock: () => new Date('2026-11-06T12:00:00.000Z'),
  });
  return { service, calls };
}

test('M14-R7 T11: procedencia sin bundle ni borrador → dos bloqueos con su subcódigo y mensaje concreto', async () => {
  const { service } = harness([
    { code: 'editorial', message: BUNDLE_MESSAGE },
    { code: 'editorial', message: DRAFT_MESSAGE },
  ]);
  const eligibility = await service.eligibility('post-1');

  assert.equal(eligibility.eligible, false);
  assert.deepEqual(
    eligibility.blockers.map((blocker) => blocker.code),
    ['editorial', 'editorial'],
    'el código de gate se conserva'
  );
  assert.deepEqual(eligibility.blockers.map((blocker) => blocker.subCode), ['editorial-bundle', 'editorial-draft']);
  assert.equal(eligibility.blockers[0].message, BUNDLE_MESSAGE, 'el mensaje específico del gateway no se sustituye');
  assert.equal(eligibility.blockers[1].message, DRAFT_MESSAGE);
  assert.equal(eligibility.status, 'draft');
});

test('M14-R7 T11: falta solo el bundle → subcódigo y mensaje de bundle', async () => {
  const { service } = harness([{ code: 'editorial', message: BUNDLE_MESSAGE }]);
  const [blocker] = (await service.eligibility('post-1')).blockers;
  assert.equal(blocker.subCode, 'editorial-bundle');
  assert.match(blocker.message, /bundle de evidencia/);
});

test('M14-R7 T11: falta solo el borrador → subcódigo y mensaje de borrador', async () => {
  const { service } = harness([{ code: 'editorial', message: DRAFT_MESSAGE }]);
  const [blocker] = (await service.eligibility('post-1')).blockers;
  assert.equal(blocker.subCode, 'editorial-draft');
  assert.match(blocker.message, /borrador firmado/);
  assert.match(blocker.message, /draftMarkdown/);
});

test('M14-R7 T11: sin procedencia alguna → subcódigo editorial-provenance', async () => {
  const { service } = harness([{ code: 'editorial', message: PROVENANCE_MESSAGE }]);
  const [blocker] = (await service.eligibility('post-1')).blockers;
  assert.equal(blocker.code, 'editorial');
  assert.equal(blocker.subCode, 'editorial-provenance');
  assert.equal(blocker.message, PROVENANCE_MESSAGE);
});

test('M14-R7 T11: el texto genérico solo se usa si el gateway no aporta mensaje o está en inglés', async () => {
  const { service } = harness([
    { code: 'editorial', message: '   ' },
    { code: 'review', message: 'El artículo no supera la revisión editorial de calidad.' },
  ]);
  const [empty, review] = (await service.eligibility('post-1')).blockers;
  assert.equal(empty.subCode, undefined, 'sin detalle no se inventa subcódigo');
  assert.equal(empty.message, 'El artículo no tiene la procedencia editorial del pipeline que exige la publicación por política.');
  assert.equal(review.code, 'review');
  assert.equal(review.message, 'El artículo no supera la revisión editorial de calidad.');

  // Un subcódigo explícito del gateway se respeta tal cual.
  const explicit = harness([{ code: 'editorial', subCode: 'editorial-bundle', message: BUNDLE_MESSAGE }]);
  const [kept] = (await explicit.service.eligibility('post-2')).blockers;
  assert.equal(kept.subCode, 'editorial-bundle');

  // La función de clasificación es determinista y no inventa motivos.
  assert.equal(provenanceSubCode(BUNDLE_MESSAGE), 'editorial-bundle');
  assert.equal(provenanceSubCode(DRAFT_MESSAGE), 'editorial-draft');
  assert.equal(provenanceSubCode(PROVENANCE_MESSAGE), 'editorial-provenance');
  assert.equal(provenanceSubCode('La URL canónica debe ser la del propio artículo'), null);
});

test('M14-R7 T11: fail-closed: la publicación sigue bloqueada y el 409 nombra el motivo concreto', async () => {
  const { service, calls } = harness([
    { code: 'editorial', message: BUNDLE_MESSAGE },
    { code: 'editorial', message: DRAFT_MESSAGE },
  ]);
  await assert.rejects(
    () => service.publishNow({ postId: 'post-1', key: 'clave-1', actor: 'admin@guia.tv' }),
    (error: unknown) => {
      assert.ok(error instanceof PublicationNotEligibleError);
      assert.equal((error as PublicationNotEligibleError).statusCode, 409);
      const message = (error as Error).message;
      assert.match(message, /editorial-bundle/);
      assert.match(message, /editorial-draft/);
      assert.match(message, /bundle de evidencia/);
      assert.match(message, /borrador firmado/);
      return true;
    }
  );
  assert.equal(calls.publish, 0, 'no se intenta publicar un artículo no elegible');
});
