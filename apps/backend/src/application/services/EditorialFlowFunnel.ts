/**
 * M14-R7 — Embudo del flujo editorial: catálogo de etapas y derivación.
 *
 * Cada etapa declara su fuente y la consulta EXACTA con la que se deriva el
 * recuento (para poder contrastarla contra MongoDB a mano) y los identificadores
 * de los registros subyacentes (drill-down).
 *
 * Reglas duras:
 * - Si el dato no existe, la etapa es `unavailable` con motivo en español. Nunca 0 inventado.
 * - Nunca se suman recuentos: ni entre dimensiones distintas ni entre etapas de la
 *   misma dimensión (comparten registros y sumarlas contaría dos veces).
 * - La tasa de conversión se calcula solo cuando ambas etapas están medidas; se
 *   marca cuándo compara dimensiones distintas.
 */

import { ValidationError } from '../../shared/errors';
import type { FlowQuery, FlowReadPort, FlowScope, ScopeKey } from './EditorialFlowScope';
import { CANDIDATE_STAGES } from './EditorialFlowStagesCandidate';
import { EDITORIAL_STAGES } from './EditorialFlowStagesEditorial';
import { EXECUTION_STAGES } from './EditorialFlowStagesExecution';
import { PUBLICATION_STAGES } from './EditorialFlowStagesPublication';
import { SEO_STAGES } from './EditorialFlowStagesSeo';
import {
  DIMENSION_LABELS,
  scopeBlocked,
  staticUnavailable,
  unavailable,
  type FlowDimension,
  type FunnelStage,
  type StageDerivation,
} from './EditorialFlowStageSupport';

export type { FlowDimension, FunnelStage } from './EditorialFlowStageSupport';
export { DIMENSION_LABELS } from './EditorialFlowStageSupport';

export interface ConversionRate {
  from: string;
  ratio: number | null;
  lost: number | null;
  crossDimension: boolean;
  /** Motivo cuando la tasa no se puede calcular (nunca se presenta como 0 %). */
  unavailableReason: string | null;
}

export interface DrillDown {
  ids: string[];
  total: number;
  returned: number;
  truncated: boolean;
  /** Endpoint con el que se obtienen los registros de la etapa. */
  endpoint: string;
}

export interface FunnelStageResult {
  key: string;
  dimension: FlowDimension;
  dimensionLabel: string;
  label: string;
  description: string;
  state: 'measured' | 'unavailable';
  count: number | null;
  unavailableReason: string | null;
  drillDown: DrillDown;
  queries: FlowQuery[];
  notes: string[];
  conversionFromPrevious: ConversionRate | null;
}

export interface FunnelReport {
  contractVersion: string;
  generatedAt: string;
  scope: { requested: FlowScope; applied: Array<{ key: ScopeKey; value: string }>; note: string };
  stages: FunnelStageResult[];
  dimensions: Array<{
    dimension: FlowDimension;
    label: string;
    stages: string[];
    total: null;
    totalNote: string;
  }>;
  totals: { global: null; globalNote: string; byDimension: Array<{ dimension: FlowDimension; total: null }> };
  availability: { connected: boolean; note: string | null };
}

const IDS_LIMIT = 250;

export const FUNNEL_STAGES: readonly FunnelStage[] = [
  staticUnavailable(
    'candidate.discovered',
    'candidate',
    'Descubiertos',
    'Temas propuestos por el ciclo de descubrimiento.',
    'El sistema no guarda un registro por tema descubierto: solo conserva la cola vigente, donde cada tema aparece ya en su estado actual (elegible, retenido, rechazado o caducado). No se puede reconstruir cuántos temas se descubrieron en el periodo y no se devuelve 0 en su lugar.'
  ),
  ...CANDIDATE_STAGES,
  ...EDITORIAL_STAGES,
  ...EXECUTION_STAGES,
  ...PUBLICATION_STAGES,
  ...SEO_STAGES,
];

export const FUNNEL_STAGE_KEYS: readonly string[] = FUNNEL_STAGES.map((stage) => stage.key);

/** Comprueba que el filtro `stage` del ámbito existe (400 en español si no). */
export function assertKnownStage(stage: string | undefined): void {
  if (stage === undefined) return;
  if (!FUNNEL_STAGE_KEYS.includes(stage)) {
    throw new ValidationError('La etapa no pertenece al embudo del Observatorio', [
      { field: 'stage', message: FUNNEL_STAGE_KEYS.join(', '), value: stage },
    ]);
  }
}

function toResult(stage: FunnelStage, derivation: StageDerivation): FunnelStageResult {
  const unavailableReason = derivation.unavailableReason ?? null;
  const total = derivation.ids.length;
  const ids = derivation.ids.slice(0, IDS_LIMIT);
  return {
    key: stage.key,
    dimension: stage.dimension,
    dimensionLabel: DIMENSION_LABELS[stage.dimension],
    label: stage.label,
    description: stage.description,
    state: unavailableReason ? 'unavailable' : 'measured',
    count: unavailableReason ? null : total,
    unavailableReason,
    drillDown: {
      ids,
      total,
      returned: ids.length,
      truncated: total > ids.length,
      endpoint: `/v2/admin/editorial/flow/funnel?stage=${encodeURIComponent(stage.key)}`,
    },
    queries: derivation.queries,
    notes: derivation.notes ?? [],
    conversionFromPrevious: null,
  };
}

function withConversions(stages: FunnelStageResult[]): FunnelStageResult[] {
  return stages.map((stage, index) => {
    if (index === 0) return stage;
    const previous = stages[index - 1];
    const crossDimension = previous.dimension !== stage.dimension;
    if (previous.count === null || stage.count === null) {
      return {
        ...stage,
        conversionFromPrevious: {
          from: previous.key,
          ratio: null,
          lost: null,
          crossDimension,
          unavailableReason: 'Alguna de las dos etapas está marcada como no disponible: la tasa no se puede calcular.',
        },
      };
    }
    if (previous.count === 0) {
      return {
        ...stage,
        conversionFromPrevious: {
          from: previous.key,
          ratio: null,
          lost: null,
          crossDimension,
          unavailableReason: 'La etapa anterior no tiene registros: la tasa no está definida (no es 0 %).',
        },
      };
    }
    return {
      ...stage,
      conversionFromPrevious: {
        from: previous.key,
        ratio: Number((stage.count / previous.count).toFixed(4)),
        lost: previous.count - stage.count,
        crossDimension,
        unavailableReason: null,
      },
    };
  });
}

export function buildFunnelReport(
  stages: FunnelStageResult[],
  scope: FlowScope,
  options: { connected: boolean; contractVersion: string; now: Date }
): FunnelReport {
  const withRates = withConversions(stages);
  const dimensions = [...new Set(withRates.map((stage) => stage.dimension))];
  return {
    contractVersion: options.contractVersion,
    generatedAt: options.now.toISOString(),
    scope: {
      requested: scope,
      applied: Object.entries(scope).map(([key, value]) => ({ key: key as ScopeKey, value: String(value) })),
      note: 'El mismo ámbito se aplica a todas las etapas; cuando una etapa no sabe aplicarlo se marca no disponible en lugar de devolver un número de otra población.',
    },
    stages: withRates,
    dimensions: dimensions.map((dimension) => ({
      dimension,
      label: DIMENSION_LABELS[dimension],
      stages: withRates.filter((stage) => stage.dimension === dimension).map((stage) => stage.key),
      total: null,
      totalNote:
        'No se suma un total de dimensión: las etapas comparten registros y sumarlas contaría dos veces. Cada recuento es independiente y contrastable.',
    })),
    totals: {
      global: null,
      globalNote: 'No existe un total global: nunca se suman recuentos de dimensiones distintas.',
      byDimension: dimensions.map((dimension) => ({ dimension, total: null })),
    },
    availability: {
      connected: options.connected,
      note: options.connected ? null : 'Sin conexión a la base de datos: todos los recuentos están marcados como no disponibles.',
    },
  };
}

/** Deriva todas las etapas con el MISMO ámbito, de una en una. */
export async function deriveFunnel(
  port: FlowReadPort,
  scope: FlowScope,
  options: { contractVersion: string; now: Date }
): Promise<FunnelReport> {
  const results: FunnelStageResult[] = [];
  for (const stage of FUNNEL_STAGES) {
    if (scope.stage && scope.stage !== stage.key) continue;
    const blocked = scopeBlocked(stage, scope);
    if (blocked) {
      results.push(toResult(stage, unavailable(blocked)));
      continue;
    }
    let derivation: StageDerivation;
    try {
      derivation = await stage.derive(port, scope);
    } catch (error) {
      derivation = unavailable(`No se pudo derivar el recuento: ${error instanceof Error ? error.message : 'error desconocido'}`);
    }
    results.push(toResult(stage, derivation));
  }
  return buildFunnelReport(results, scope, { connected: port.connected(), ...options });
}
