/**
 * M14-R7 — Puerta de publicación del Observatorio editorial.
 *
 * - La PUBLICACIÓN reutiliza el handler real `BlogController.approveByPolicy`
 *   (el mismo que atiende `POST /v2/blog/:id/approve-by-policy`): todos los gates,
 *   el libro append-only `editorial_policy_approvals`, el límite diario y la
 *   parada de emergencia se vuelven a ejecutar dentro de esa ruta. Aquí no se
 *   escribe ningún camino de publicación nuevo.
 * - La ELEGIBILIDAD es informativa: evalúa los mismos gates exportados para poder
 *   devolver los bloqueos nombrados sin publicar. Una procedencia incompleta
 *   (editorial sin bundle de evidencia o sin borrador firmado) se informa como
 *   bloqueo nombrado, nunca como excepción: esos gates no se pueden evaluar.
 */

import type { Request, Response, NextFunction } from 'express';
import { BlogPostModel } from '../../infrastructure/database/models/BlogPost.model';
import { postNotFound } from '../../application/services/EditorialFlowErrors';
import {
  assertEditorialPostCanBeApproved,
  evaluateEditorialQuality,
  policyGateFailures,
  PUBLIC_EDITORIAL_FILTER,
} from '../../application/services/EditorialReviewPolicy';
import {
  evaluateEvidence,
  provenanceSignatureFindings,
  type EditorialProvenance,
} from '../../application/services/EditorialEvidence';
import { policyProviderProblem } from '../../application/services/EditorialAgentPipeline';
import { generatedImageFindings } from '../../application/services/EditorialImages';
import { editorialPolicyState } from './EditorialOpsController';
import type { BlogController } from './BlogController';
import type {
  PublicationBlocker,
  PublicationEligibility,
  PublicationGateway,
} from '../../application/services/EditorialFlowPublication';

type ApprovablePost = Parameters<typeof assertEditorialPostCanBeApproved>[0];
type EvidencePost = Parameters<typeof evaluateEvidence>[0];
type QualityPost = Parameters<typeof evaluateEditorialQuality>[0];
type ImagePost = Parameters<typeof generatedImageFindings>[0];

/** Subconjunto del estado de política que decide la elegibilidad (inyectable en pruebas). */
export interface PublicationPolicyState {
  envEnabled: boolean;
  paused: boolean;
  activated: boolean;
  pausedReason?: string | null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Bloqueos por procedencia incompleta. `evaluateEvidence` re-deriva el paquete con
 * `assessBundle(bundle)` y el borrador firmado con `markerIds(draftMarkdown)`:
 * sin esos datos lanzaría una excepción, así que aquí se convierten en bloqueos
 * nombrados y se omite su evaluación.
 */
export function provenanceBlockers(editorial: unknown): PublicationBlocker[] {
  if (!editorial || typeof editorial !== 'object') {
    return [{ code: 'editorial', message: 'La publicación por política exige procedencia del pipeline editorial.' }];
  }
  const value = editorial as { bundle?: unknown; draftMarkdown?: unknown };
  const blockers: PublicationBlocker[] = [];
  if (!value.bundle || typeof value.bundle !== 'object') {
    blockers.push({
      code: 'editorial',
      message:
        'La procedencia editorial está incompleta: falta el bundle de evidencia (fuentes y afirmaciones). No se puede evaluar la evidencia y el artículo no es elegible para publicación por política.',
    });
  }
  if (typeof value.draftMarkdown !== 'string' || !value.draftMarkdown.trim()) {
    blockers.push({
      code: 'editorial',
      message:
        'La procedencia editorial está incompleta: falta el borrador firmado (draftMarkdown) que se revisó. Sin él no se puede comprobar que lo publicado sea lo verificado.',
    });
  }
  return blockers;
}

/** Respuesta capturada de un handler Express, para poder invocarlo como función. */
interface CapturedResponse {
  statusCode: number;
  body: unknown;
}

/**
 * Invoca un handler de Express ya existente y devuelve su cuerpo JSON. Es el
 * mismo patrón con el que las pruebas del repositorio llaman a los controladores.
 * Resuelve tanto si el handler responde (escribe en `res`) como si llama a `next`.
 */
async function invokeHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
  request: { params: Record<string, string>; body: Record<string, unknown> }
): Promise<CapturedResponse> {
  const captured: CapturedResponse = { statusCode: 200, body: null };
  const req = {
    params: request.params,
    body: request.body,
    query: {},
    headers: {},
    header: () => undefined,
  } as unknown as Request;
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return res;
    },
    json(body: unknown) {
      captured.body = body;
      return res;
    },
  } as unknown as Response;
  const failure = await new Promise<unknown>((resolve) => {
    Promise.resolve()
      .then(() => handler(req, res, (error: unknown) => resolve(error)))
      .then(() => resolve(null))
      .catch((error: unknown) => resolve(error));
  });
  if (failure) throw failure;
  return captured;
}

export class BlogPublicationGateway implements PublicationGateway {
  constructor(
    private readonly blog: BlogController,
    /** Estado de política inyectable: en producción, el estado persistido real. */
    private readonly policy: () => Promise<PublicationPolicyState> = editorialPolicyState
  ) {}

  /** Gates reales evaluados sin publicar; siempre devuelve bloqueos nombrados. */
  async eligibility(postId: string): Promise<PublicationEligibility> {
    const id = text(postId);
    const post = id ? await BlogPostModel.findById(id).lean().exec().catch(() => null) : null;
    if (!post) throw postNotFound(id);

    const policy = await this.policy();
    const blockers: PublicationBlocker[] = [];
    const alreadyPublished = post.status === 'publish';
    if (alreadyPublished) blockers.push({ code: 'already-published', message: 'El artículo ya está publicado.' });
    if (!policy.envEnabled) blockers.push({ code: 'policy-off', message: 'La publicación por política está apagada en el despliegue.' });
    if (policy.paused) blockers.push({ code: 'policy-paused', message: `Parada de emergencia activa${policy.pausedReason ? `: ${policy.pausedReason}` : ''}.` });
    if (!policy.activated) blockers.push({ code: 'policy-inactive', message: 'La publicación por política no se ha activado desde el Admin.' });

    const editorial = post.editorial as EditorialProvenance | undefined;
    if (!editorial || post.origin !== 'ai-assisted') {
      blockers.push({
        code: 'editorial',
        message: 'La publicación por política exige un artículo ai-assisted con procedencia del pipeline.',
      });
    } else {
      // T7-LOW-1: una procedencia a medias se informa, nunca revienta en un 500.
      const incomplete = provenanceBlockers(editorial);
      blockers.push(...incomplete);
      const plain = post as unknown as ApprovablePost & EvidencePost & QualityPost & ImagePost;
      if (!incomplete.length) {
        for (const finding of provenanceSignatureFindings(editorial, process.env.EDITORIAL_PIPELINE_SIGNING_KEY)) {
          blockers.push({ code: 'editorial', message: finding.message });
        }
        const providerProblem = policyProviderProblem(editorial);
        if (providerProblem) blockers.push({ code: 'editorial', message: `Procedencia no firmada o proveedor no válido (${providerProblem}).` });
      }
      try {
        assertEditorialPostCanBeApproved(plain);
      } catch (error) {
        blockers.push({ code: 'review', message: error instanceof Error ? error.message : 'Aprobación rechazada' });
      }
      const [publicPosts, unpublished] = await Promise.all([
        BlogPostModel.find({ ...PUBLIC_EDITORIAL_FILTER, _id: { $ne: post._id } }).select({ slug: 1, content: 1 }).lean().exec(),
        BlogPostModel.find({ _id: { $ne: post._id }, $nor: [PUBLIC_EDITORIAL_FILTER] }).select({ slug: 1 }).lean().exec(),
      ]);
      const findings = [
        // Sin bundle ni borrador firmado no hay evidencia que evaluar (y el gate lanzaría).
        ...(incomplete.length ? [] : evaluateEvidence(plain, editorial)),
        ...generatedImageFindings(plain),
        ...evaluateEditorialQuality(plain, {
          others: publicPosts.map((other) => ({ slug: String(other.slug), content: other.content })),
          unpublishedSlugs: unpublished.map((other) => String(other.slug)),
        }),
      ];
      for (const failure of policyGateFailures(findings)) blockers.push({ code: failure.code, message: failure.message });
    }

    const canonical = text(post.seo?.canonicalUrl) || `/guias/${text(post.slug)}`;
    const normalized = canonical.replace(/^https:\/\/(?:www\.)?guiaprogramaciontv\.com/, '');
    if (normalized !== `/guias/${text(post.slug)}`) {
      blockers.push({ code: 'canonicalUrl', message: `La publicación por política es canónica a /guias/${text(post.slug)}.` });
    }

    return {
      postId: id,
      status: text(post.status) || null,
      reviewState: text(post.reviewState) || null,
      eligible: blockers.length === 0,
      alreadyPublished,
      blockers,
    };
  }

  /** Publica por la ruta real; devuelve el artículo publicado y los hallazgos de calidad. */
  async publish(postId: string): Promise<{ post: Record<string, unknown>; qualityFindings: unknown[] }> {
    const captured = await invokeHandler(this.blog.approveByPolicy, { params: { id: text(postId) }, body: {} });
    const payload = captured.body as { data?: { post?: Record<string, unknown>; qualityFindings?: unknown[] } } | null;
    const post = payload?.data?.post;
    if (!post) throw new Error('La ruta de publicación no devolvió el artículo publicado');
    return { post, qualityFindings: payload?.data?.qualityFindings ?? [] };
  }
}
