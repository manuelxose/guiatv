/**
 * M14-R7 — Etapas de la dimensión EJECUCIÓN.
 *
 * Fuente: `editorial_jobs` (un documento por pasada del runner). El motivo en
 * texto libre distingue un fallo técnico (`error: …`) de un bloqueo editorial
 * (`agotados los ciclos de revisión`), tal como documenta el contrato de T1.
 */

import { equalsFilter, mergeFilters, periodFilter, type FlowQuery, type ScopeKey } from './EditorialFlowScope';
import { OFFLINE, measured, regexEscaped, text, unavailable, type FunnelStage } from './EditorialFlowStageSupport';

const JOBS_SUPPORT: readonly ScopeKey[] = ['from', 'to', 'state', 'failureReason', 'model', 'publicationStatus', 'origin'];

interface JobStageDef {
  key: string;
  label: string;
  description: string;
  filter: Record<string, unknown>;
  predicateText: string;
}

const JOB_STAGE_DEFS: JobStageDef[] = [
  {
    key: 'execution.discovery',
    label: 'Ejecuciones de descubrimiento',
    description: 'Pasadas del descubrimiento registradas. Cada registro es una ejecución, no un tema propuesto.',
    filter: { state: 'discovery' },
    predicateText: 'state === "discovery"',
  },
  {
    key: 'execution.failed',
    label: 'Fallidos técnicamente',
    description: 'Ejecuciones bloqueadas por un error técnico (el motivo empieza por "error:").',
    filter: { state: 'blocked', reason: { $regex: '^error:' } },
    predicateText: 'state === "blocked" && reason empieza por "error:"',
  },
  {
    key: 'execution.blocked',
    label: 'Bloqueados (sin error técnico)',
    description: 'Bloqueados por ciclos de revisión agotados, límites o plan descartado. No es un fallo técnico.',
    filter: { state: 'blocked', reason: { $not: { $regex: '^error:' } } },
    predicateText: 'state === "blocked" && reason no empieza por "error:"',
  },
  {
    key: 'execution.completed',
    label: 'Completados',
    description: 'Ejecuciones terminadas: publicadas o verificadas en mantenimiento. Completar no implica publicar.',
    filter: { state: { $in: ['published', 'maintenance-verified'] } },
    predicateText: 'state ∈ {"published", "maintenance-verified"}',
  },
];

function jobStage(def: JobStageDef): FunnelStage {
  return {
    key: def.key,
    dimension: 'execution',
    label: def.label,
    description: def.description,
    scopeSupport: JOBS_SUPPORT,
    async derive(port, scope) {
      if (!port.connected()) return unavailable(OFFLINE);
      if (scope.origin === 'manual') {
        return unavailable(
          'editorial_jobs no registra si una ejecución la lanzó una persona o el runner: solo consta el trabajo y su resultado. No se puede acotar esta etapa al origen manual.'
        );
      }
      const query: FlowQuery = {
        collection: 'editorial_jobs',
        filter: mergeFilters(
          def.filter,
          equalsFilter('state', scope.state),
          scope.failureReason ? { reason: { $regex: regexEscaped(scope.failureReason), $options: 'i' } } : null,
          scope.model ? { 'costEntries.model': scope.model } : null,
          scope.publicationStatus === 'publish' ? { state: 'published' } : null,
          periodFilter(scope, 'startedAt', 'iso-string')
        ),
        projection: { jobId: 1, slug: 1, state: 1, reason: 1, startedAt: 1, revisions: 1 },
        note: 'startedAt se guarda como cadena ISO en producción: el periodo se compara como texto ISO.',
      };
      const docs = await port.find('editorial_jobs', query.filter, { projection: query.projection });
      return measured(
        docs.map((doc) => text(doc.jobId) || text(doc.slug) || null),
        [query],
        [`Predicado: ${def.predicateText}.`]
      );
    },
  };
}

export const EXECUTION_STAGES: readonly FunnelStage[] = JOB_STAGE_DEFS.map(jobStage);
