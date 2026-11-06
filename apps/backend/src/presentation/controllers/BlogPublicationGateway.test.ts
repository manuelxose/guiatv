/**
 * M14-R7 — T7-LOW-1: la elegibilidad de publicación nunca responde 500 por una
 * procedencia editorial incompleta.
 *
 * Reproduce el caso real de `blog_posts.editorial` presente sin `bundle` ni
 * `draftMarkdown` (registros legacy): `evaluateEvidence` lanzaría dentro de
 * `assessBundle`/`markerIds`, así que la consulta informativa debe devolver los
 * BLOQUEOS NOMBRADOS en español. La publicación real no cambia: `publish()` sigue
 * delegando en `BlogController.approveByPolicy`, con todos sus gates.
 *
 *   node --test dist/presentation/controllers/BlogPublicationGateway.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { BlogPostModel } from '../../infrastructure/database/models/BlogPost.model';
import { evaluateEvidence, type EditorialProvenance } from '../../application/services/EditorialEvidence';
import { EditorialFlowPublicationService } from '../../application/services/EditorialFlowPublication';
import { BlogPublicationGateway, provenanceBlockers, type PublicationPolicyState } from './BlogPublicationGateway';
import { EditorialFlowController } from './EditorialFlowController';

const ACTIVE_POLICY: PublicationPolicyState = { envEnabled: true, paused: false, activated: true, pausedReason: null };

const LEGACY_EDITORIAL = {
  pipelineVersion: 'm11g-2',
  state: 'verified',
  bundleHash: 'a'.repeat(64),
  draftHash: 'b'.repeat(64),
  // Sin `bundle` y sin `draftMarkdown`: exactamente el registro legacy que reventaba.
};

const LEGACY_POST = {
  _id: '6ae1d117d7775493a1b536ec',
  slug: 'cnmc-derechos-audiovisuales-accesibilidad-plataformas',
  title: 'Derechos audiovisuales y accesibilidad en las plataformas',
  status: 'draft',
  reviewState: 'unreviewed',
  origin: 'ai-assisted',
  excerpt: 'Resumen de la guía',
  content: 'Contenido publicado de la guía',
  seo: { canonicalUrl: '/guias/cnmc-derechos-audiovisuales-accesibilidad-plataformas' },
  editorial: LEGACY_EDITORIAL,
};

/**
 * Sustituye las dos consultas a Mongo del gateway por documentos en memoria:
 * el artículo pedido y una lista vacía de otros artículos. No hay base de datos.
 */
async function withStubbedModel<T>(post: unknown, run: () => Promise<T>): Promise<T> {
  const model = BlogPostModel as unknown as { findById: unknown; find: unknown };
  const original = { findById: model.findById, find: model.find };
  model.findById = () => ({ lean: () => ({ exec: async () => post }) });
  model.find = () => ({ select: () => ({ lean: () => ({ exec: async () => [] }) }) });
  try {
    return await run();
  } finally {
    model.findById = original.findById;
    model.find = original.find;
  }
}

interface FakeResponse {
  status(code: number): FakeResponse;
  json(body: unknown): void;
}

/** Ejecuta un handler del controlador y devuelve el código y el cuerpo JSON. */
function callHandler(
  handler: (req: never, res: never, next: never) => Promise<void>,
  params: Record<string, string>
): Promise<{ code: number; body: any; error?: unknown }> {
  return new Promise((resolve) => {
    const res = {
      code: 200,
      status(code: number) {
        this.code = code;
        return this;
      },
      json(body: unknown) {
        resolve({ code: this.code, body });
      },
    };
    const request = { params, body: {}, query: {}, header: () => undefined };
    Promise.resolve(handler(request as never, res as never, ((error: unknown) => resolve({ code: 500, body: null, error })) as never)).catch(
      (error: unknown) => resolve({ code: 500, body: null, error })
    );
  });
}

test('M14-R7 T7-LOW-1: editorial sin bundle devuelve bloqueos nombrados, no una excepción', async () => {
  const gateway = new BlogPublicationGateway({} as never, async () => ACTIVE_POLICY);
  const result = await withStubbedModel(LEGACY_POST, () => gateway.eligibility(String(LEGACY_POST._id)));

  assert.equal(result.eligible, false);
  const editorialBlockers = result.blockers.filter((blocker) => blocker.code === 'editorial');
  assert.ok(editorialBlockers.length > 0, 'debe nombrar el bloqueo de procedencia');
  assert.ok(
    editorialBlockers.some((blocker) => /bundle de evidencia/.test(blocker.message)),
    `falta el bloqueo por bundle: ${JSON.stringify(editorialBlockers)}`
  );
  assert.ok(
    editorialBlockers.some((blocker) => /draftMarkdown/.test(blocker.message)),
    `falta el bloqueo por borrador firmado: ${JSON.stringify(editorialBlockers)}`
  );
  assert.ok(result.blockers.every((blocker) => blocker.message.trim().length > 0));
  // La política estaba activa: los bloqueos vienen de la procedencia, no del estado de publicación.
  assert.equal(result.blockers.filter((blocker) => blocker.code.startsWith('policy-')).length, 0);
  // Y la respuesta conserva el estado real del artículo para poder pintarlo en la UI.
  assert.equal(result.status, 'draft');
  assert.equal(result.reviewState, 'unreviewed');
});

test('M14-R7 T7-LOW-1: GET eligibility responde 200 con los bloqueos, no un 500', async () => {
  const gateway = new BlogPublicationGateway({} as never, async () => ACTIVE_POLICY);
  const publication = new EditorialFlowPublicationService({
    gateway,
    store: {
      claim: async () => 'claimed',
      complete: async () => undefined,
      get: async () => null,
    },
    audit: { insert: async () => undefined },
  });
  // `eligibility` solo usa `publication`; el resto de dependencias no interviene.
  const controller = new EditorialFlowController({ publication } as never);

  const outcome = await withStubbedModel(LEGACY_POST, () =>
    callHandler(controller.eligibility as never, { postId: String(LEGACY_POST._id) })
  );

  assert.equal(outcome.code, 200, `la consulta informativa no debe romper: ${String(outcome.error)}`);
  assert.equal(outcome.body.success, true);
  assert.equal(outcome.body.data.eligible, false);
  const blockers = outcome.body.data.blockers as Array<{ code: string; message: string }>;
  assert.ok(blockers.some((blocker) => blocker.code === 'editorial' && /bundle de evidencia/.test(blocker.message)));
  assert.equal(outcome.body.data.status, 'draft');
});

test('M14-R7 T7-LOW-1: el gate de evidencia sí lanza con esa procedencia (por eso hace falta el guard)', () => {
  // Documenta el fallo original: el código anterior llamaba a evaluateEvidence y moría aquí.
  assert.throws(
    () => evaluateEvidence(LEGACY_POST as never, LEGACY_EDITORIAL as unknown as EditorialProvenance),
    (error: unknown) => error instanceof TypeError
  );
  // El guard nuevo la clasifica antes de llegar al gate.
  const blockers = provenanceBlockers(LEGACY_EDITORIAL);
  assert.equal(blockers.length, 2);
  assert.deepEqual(blockers.map((blocker) => blocker.code), ['editorial', 'editorial']);
});

test('M14-R7 T7-LOW-1: una procedencia completa no añade bloqueos de procedencia', () => {
  const complete = { bundle: { sources: [], claims: [], conflicts: [] }, draftMarkdown: '# Guía verificada' };
  assert.deepEqual(provenanceBlockers(complete), []);
  // Sin procedencia alguna sigue nombrándose el bloqueo editorial de siempre.
  const missing = provenanceBlockers(undefined);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].code, 'editorial');
  // Un bundle que no es objeto tampoco se evalúa.
  assert.equal(provenanceBlockers({ bundle: 'no-es-un-bundle', draftMarkdown: 'x' }).length, 1);
});

test('M14-R7 T7-LOW-1: publicar sigue delegando en la ruta real de publicación', async () => {
  const calls: string[] = [];
  const blog = {
    approveByPolicy: async (request: { params: { id: string } }, response: FakeResponse) => {
      calls.push(request.params.id);
      response.status(200).json({
        success: true,
        data: { post: { id: request.params.id, status: 'publish' }, qualityFindings: ['finding-1'] },
      });
    },
  };
  const gateway = new BlogPublicationGateway(blog as never, async () => ACTIVE_POLICY);
  const published = await gateway.publish('post-7');

  assert.deepEqual(calls, ['post-7'], 'la publicación pasa por approveByPolicy con el id real');
  assert.equal(published.post.status, 'publish');
  assert.deepEqual(published.qualityFindings, ['finding-1']);
});
