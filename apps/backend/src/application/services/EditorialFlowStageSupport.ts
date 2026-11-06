/**
 * M14-R7 — Piezas comunes de las etapas del embudo del Observatorio editorial.
 * Tipos, etiquetas de dimensión y utilidades de derivación compartidas por las
 * etapas de cada dimensión.
 */

import { scopeUnavailableReason, unsupportedScopeKeys, type FlowQuery, type FlowReadPort, type FlowScope, type ScopeKey } from './EditorialFlowScope';

export type FlowDimension = 'candidate' | 'editorial' | 'execution' | 'publication' | 'seo';

export const DIMENSION_LABELS: Record<FlowDimension, string> = {
  candidate: 'Candidato (tema)',
  editorial: 'Editorial (redacción y revisión)',
  execution: 'Ejecución (trabajo)',
  publication: 'Publicación',
  seo: 'SEO (indexación)',
};

export interface StageDerivation {
  ids: string[];
  queries: FlowQuery[];
  unavailableReason?: string;
  notes?: string[];
}

export interface FunnelStage {
  key: string;
  dimension: FlowDimension;
  label: string;
  description: string;
  scopeSupport: readonly ScopeKey[];
  derive(port: FlowReadPort, scope: FlowScope): Promise<StageDerivation>;
}

/** Motivo común cuando el proceso no tiene conexión con MongoDB. */
export const OFFLINE = 'No hay conexión con la base de datos: este recuento no se puede derivar.';

export const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const itemsOf = (doc: Record<string, unknown> | undefined): Array<Record<string, unknown>> =>
  Array.isArray(doc?.items) ? (doc!.items as Array<Record<string, unknown>>) : [];

export const queueReasonPrefix = (reason: unknown): string => {
  const value = text(reason).toLowerCase();
  const colon = value.indexOf(':');
  return colon > 0 ? value.slice(0, colon + 1) : '';
};

export const distinct = (values: Array<string | null>): string[] =>
  [...new Set(values.filter((value): value is string => Boolean(value)))];

export const measured = (ids: Array<string | null>, queries: FlowQuery[], notes: string[] = []): StageDerivation => ({
  ids: distinct(ids),
  queries,
  notes,
});

export const unavailable = (reason: string, queries: FlowQuery[] = [], notes: string[] = []): StageDerivation => ({
  ids: [],
  queries,
  unavailableReason: reason,
  notes,
});

/**
 * Motivo en español cuando el ámbito informado no se puede aplicar a la etapa.
 * `stage` no es un filtro de datos: selecciona qué etapas se derivan, así que no
 * puede inhabilitar la etapa seleccionada.
 */
export function scopeBlocked(stage: FunnelStage, scope: FlowScope): string | null {
  const unsupported = unsupportedScopeKeys(scope, stage.scopeSupport).filter((key) => key !== 'stage');
  if (!unsupported.length) return null;
  return scopeUnavailableReason(stage.key, unsupported);
}

/** Etapa que no tiene fuente real: se declara no disponible con motivo, nunca 0. */
export const staticUnavailable = (
  key: string,
  dimension: FlowDimension,
  label: string,
  description: string,
  reason: string
): FunnelStage => ({
  key,
  dimension,
  label,
  description,
  scopeSupport: [],
  async derive() {
    return unavailable(reason);
  },
});

/** Escapa un texto para usarlo dentro de una expresión regular de MongoDB. */
export const regexEscaped = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
