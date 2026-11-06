/**
 * M14-R7 — Controlador del Observatorio editorial (Administración → Editorial → Guía de flujos).
 *
 * Todos los endpoints viven bajo `/v2/admin/editorial/flow` y el guard de admin del
 * router. Las acciones de escritura reutilizan los mecanismos existentes:
 * - recuperación: solicitudes de generación, acciones de cola y libro de ejecución;
 * - publicación: la ruta real de publicación por política de BlogController.
 *
 * Ningún endpoint de este controlador publica sin gates, sube el límite diario ni
 * reactiva la generación programada.
 */

import { Request, Response } from 'express';
import { errorResponse, successResponse } from '../../shared/types/ApiResponse';
import { AuthenticatedRequest } from '../middlewares/authGuard';
import { FLOW_STATE_GUIDE } from '../../application/editorialflow';
import {
  composeSchedulerStatus,
  type EditorialFlowDiagnostics,
  type SchedulerOperationsState,
  type SchedulerPolicyState,
  type SchedulerRunnerProcessState,
} from '../../application/services/EditorialFlowDiagnostics';
import type { EditorialEvidenceRecovery } from '../../application/services/EditorialEvidenceRecovery';
import {
  PublicationNotEligibleError,
  type EditorialFlowPublicationService,
} from '../../application/services/EditorialFlowPublication';

export interface EditorialFlowControllerDeps {
  diagnostics: EditorialFlowDiagnostics;
  recovery: EditorialEvidenceRecovery;
  publication: EditorialFlowPublicationService;
  /** Estado persistido de la política editorial (parada, activación, límite diario). */
  policy: () => Promise<SchedulerPolicyState>;
  /** Estado operativo del runner y de la generación (ajustes persistidos). */
  operations: () => Promise<SchedulerOperationsState>;
  runnerProcess: () => SchedulerRunnerProcessState;
  clock?: () => Date;
}

const actorOf = (req: Request): string => {
  const user = (req as AuthenticatedRequest).user;
  return user ? user.email || user.id : 'admin-key';
};

const queryOf = (req: Request): Record<string, unknown> => (req.query ?? {}) as Record<string, unknown>;

const sourcesOf = (body: Record<string, unknown>): string[] | undefined =>
  Array.isArray(body.sources) ? body.sources.map((url) => String(url)) : undefined;

const briefOf = (body: Record<string, unknown>): { title?: string; intent?: string } | undefined =>
  body.brief && typeof body.brief === 'object' ? (body.brief as { title?: string; intent?: string }) : undefined;

export class EditorialFlowController {
  constructor(private readonly deps: EditorialFlowControllerDeps) {}

  private now(): Date {
    return (this.deps.clock ?? (() => new Date()))();
  }

  /** Guía única de estados del contrato (la UI no duplica textos). */
  guide = async (_req: Request, res: Response): Promise<void> => {
    res.json(successResponse({ contractVersion: FLOW_STATE_GUIDE.version, guide: FLOW_STATE_GUIDE }));
  };

  /** Embudo por etapas con ámbito explícito, drill-down y la consulta de cada recuento. */
  funnel = async (req: Request, res: Response): Promise<void> => {
    res.json(successResponse(await this.deps.diagnostics.funnel(queryOf(req))));
  };

  /** Ficha completa de un tema. */
  topic = async (req: Request, res: Response): Promise<void> => {
    res.json(successResponse(await this.deps.diagnostics.topic(String(req.params.id ?? ''))));
  };

  /** Reconciliación de los registros legacy con masa de desconocidos explícita. */
  reconciliation = async (req: Request, res: Response): Promise<void> => {
    res.json(successResponse(await this.deps.diagnostics.reconciliation(queryOf(req))));
  };

  /** Estado honesto del planificador y de la publicación manual (independiente). */
  scheduler = async (_req: Request, res: Response): Promise<void> => {
    const [policy, operations] = await Promise.all([this.deps.policy(), this.deps.operations()]);
    res.json(
      successResponse(
        composeSchedulerStatus({
          policy,
          operations,
          runnerProcess: this.deps.runnerProcess(),
          now: this.now(),
        })
      )
    );
  };

  /** Acción de recuperación individual, validada contra el estado real. */
  recovery = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await this.deps.recovery.recover({
      topicId: String(req.params.topicId ?? ''),
      action: body.action as never,
      actor: actorOf(req),
      sources: sourcesOf(body),
      brief: briefOf(body),
      note: typeof body.note === 'string' ? body.note : undefined,
    });
    res.json(successResponse(result));
  };

  /** Recuperación en lote: un resultado por ítem, sin abortar el resto. */
  recoveryBulk = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await this.deps.recovery.recoverMany({
      topicIds: Array.isArray(body.topicIds) ? body.topicIds.map((id) => String(id)) : [],
      action: body.action as never,
      actor: actorOf(req),
      sources: sourcesOf(body),
      brief: briefOf(body),
      note: typeof body.note === 'string' ? body.note : undefined,
    });
    res.json(successResponse(result));
  };

  /** Elegibilidad de publicación: bloqueos nombrados, sin publicar. */
  eligibility = async (req: Request, res: Response): Promise<void> => {
    res.json(successResponse(await this.deps.publication.eligibility(String(req.params.postId ?? ''))));
  };

  /** Publicación manual inmediata e idempotente por clave. */
  publishNow = async (req: Request, res: Response): Promise<void> => {
    const headerKey = req.header('idempotency-key');
    const bodyKey = (req.body as { idempotencyKey?: unknown } | undefined)?.idempotencyKey;
    const key = String(headerKey ?? bodyKey ?? '').trim();
    try {
      const result = await this.deps.publication.publishNow({
        postId: String(req.params.postId ?? ''),
        key,
        actor: actorOf(req),
      });
      res.json(successResponse(result));
    } catch (error) {
      if (error instanceof PublicationNotEligibleError) {
        res
          .status(409)
          .json(
            errorResponse('NOT_ELIGIBLE', error.message, {
              postId: error.eligibility.postId,
              status: error.eligibility.status,
              reviewState: error.eligibility.reviewState,
              alreadyPublished: error.eligibility.alreadyPublished,
              blockers: error.eligibility.blockers,
            })
          );
        return;
      }
      throw error;
    }
  };
}
