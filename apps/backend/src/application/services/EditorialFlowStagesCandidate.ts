/**
 * M14-R7 — Etapas de la dimensión CANDIDATO.
 *
 * Fuente: `editorial_queue_snapshot` (_id: 'current'). El runner publica la cola
 * vigente como un único documento con `items[]`; el estado de candidato se deriva
 * de `item.state` y del prefijo de `item.reason`, exactamente como documenta el
 * contrato de T1 (upsufficient-evidence:, invalid-candidate:, duplicate:, manual:).
 */

import { periodFilter, type FlowQuery, type FlowScope, type ScopeKey } from './EditorialFlowScope';
import { OFFLINE, itemsOf, measured, queueReasonPrefix, text, unavailable, type FunnelStage } from './EditorialFlowStageSupport';

const QUEUE_SUPPORT: readonly ScopeKey[] = ['from', 'to', 'category', 'state', 'failureReason', 'origin'];

interface QueueStageDef {
  key: string;
  label: string;
  description: string;
  predicate: (item: Record<string, unknown>) => boolean;
  predicateText: string;
}

const QUEUE_STAGE_DEFS: QueueStageDef[] = [
  {
    key: 'candidate.eligible',
    label: 'Elegibles en cola',
    description: 'Temas admitidos y esperando turno en la cola vigente.',
    predicate: (item) => text(item.state) === 'queued',
    predicateText: 'state === "queued"',
  },
  {
    key: 'candidate.invalid',
    label: 'Inválidos',
    description: 'Candidatos rechazados porque el tema no era válido tal cual (habitualmente, slug no normalizado).',
    predicate: (item) => text(item.state) === 'rejected' && queueReasonPrefix(item.reason) === 'invalid-candidate:',
    predicateText: 'state === "rejected" && el motivo empieza por "invalid-candidate:"',
  },
  {
    key: 'candidate.duplicate',
    label: 'Duplicados',
    description: 'Candidatos descartados por duplicar la intención de otro tema ya cubierto.',
    predicate: (item) => text(item.state) === 'rejected' && queueReasonPrefix(item.reason) === 'duplicate:',
    predicateText: 'state === "rejected" && el motivo empieza por "duplicate:"',
  },
  {
    key: 'candidate.rejected-insufficient-evidence',
    label: 'Sin evidencia suficiente',
    description: 'Rechazados por no alcanzar el umbral de evidencia verificable (no es un fallo técnico).',
    predicate: (item) => text(item.state) === 'rejected' && queueReasonPrefix(item.reason) === 'insufficient-evidence:',
    predicateText: 'state === "rejected" && el motivo empieza por "insufficient-evidence:"',
  },
  {
    key: 'candidate.rejected',
    label: 'Rechazados (otros motivos)',
    description: 'Rechazados por decisión manual o por un motivo no clasificado. No equivale a fallo técnico.',
    predicate: (item) =>
      text(item.state) === 'rejected' &&
      !['invalid-candidate:', 'duplicate:', 'insufficient-evidence:'].includes(queueReasonPrefix(item.reason)),
    predicateText: 'state === "rejected" && el motivo no es invalid-candidate:, duplicate: ni insufficient-evidence:',
  },
  {
    key: 'candidate.retained',
    label: 'Retenidos',
    description: 'Temas conservados en espera (held) sin descartarse. Retenido no equivale a pausado.',
    predicate: (item) => text(item.state) === 'held',
    predicateText: 'state === "held"',
  },
  {
    key: 'candidate.expired',
    label: 'Caducados',
    description: 'Temas que perdieron vigencia antes de ejecutarse.',
    predicate: (item) => text(item.state) === 'expired',
    predicateText: 'state === "expired"',
  },
];

function queueStage(def: QueueStageDef): FunnelStage {
  return {
    key: def.key,
    dimension: 'candidate',
    label: def.label,
    description: def.description,
    scopeSupport: QUEUE_SUPPORT,
    async derive(port, scope: FlowScope) {
      if (!port.connected()) return unavailable(OFFLINE);
      if (scope.origin === 'manual') {
        return unavailable(
          'Los ítems de la cola proceden del descubrimiento automático; una decisión manual se registra como solicitud de generación (editorial_generation_requests), no en el ítem de la cola. No se puede acotar esta etapa al origen manual.'
        );
      }
      const query: FlowQuery = {
        collection: 'editorial_queue_snapshot',
        filter: { _id: 'current' },
        projection: { items: 1, updatedAt: 1 },
        note: 'Se lee el documento de la cola vigente; el recuento y el ámbito se aplican en memoria sobre sus ítems (así los escribe el runner).',
      };
      const [doc] = await port.find('editorial_queue_snapshot', query.filter, { projection: query.projection });
      if (!doc) {
        return unavailable(
          'No existe el documento editorial_queue_snapshot con _id="current": el runner no ha publicado ninguna cola, así que no se puede afirmar cuántos temas hay en este estado.',
          [query]
        );
      }
      const from = scope.from ? Date.parse(scope.from) : null;
      const to = scope.to ? Date.parse(scope.to) : null;
      const items = itemsOf(doc).filter((item) => {
        if (!def.predicate(item)) return false;
        if (scope.state && text(item.state) !== scope.state) return false;
        if (scope.category && text(item.category) !== scope.category) return false;
        if (scope.failureReason && !text(item.reason).toLowerCase().includes(scope.failureReason.toLowerCase())) return false;
        if (from !== null || to !== null) {
          const at = Date.parse(text(item.updatedAt));
          if (Number.isNaN(at)) return false;
          if (from !== null && at < from) return false;
          if (to !== null && at > to) return false;
        }
        return true;
      });
      return measured(
        items.map((item) => text(item.id) || null),
        [query],
        [
          `Predicado aplicado en memoria: ${def.predicateText}.`,
          'El resto del ámbito se aplica ítem a ítem sobre el documento de la cola.',
        ]
      );
    },
  };
}

export const CANDIDATE_STAGES: readonly FunnelStage[] = QUEUE_STAGE_DEFS.map(queueStage);

/** Consulta del documento de la cola, reutilizada por la ficha de tema. */
export const QUEUE_QUERY: FlowQuery = {
  collection: 'editorial_queue_snapshot',
  filter: { _id: 'current' },
  projection: { items: 1, updatedAt: 1 },
};

/** Ámbito de una etapa de candidato (exportado para pruebas y ficha de tema). */
export const CANDIDATE_PERIOD = (scope: FlowScope) => periodFilter(scope, 'updatedAt', 'date');
