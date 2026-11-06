/**
 * M14-R7 — Estado del PLANIFICADOR (generación programada).
 *
 * Mapea el interruptor persistido `editorial_settings._id:'generation'.settings.enabled`
 * a un estado cerrado del planificador. Es independiente de las cuatro dimensiones de
 * estado y del SEO: gestiona el arranque AUTOMÁTICO del runner, no la publicación manual.
 *
 * Fuente de verdad (código candidato): EditorialGenerationService
 * - DEFAULT_GENERATION_SETTINGS.enabled = false (fail-closed).
 * - runnerStartAllowed(settings, mode): el arranque MANUAL siempre se permite; el
 *   AUTOMÁTICO exige enabled:true. La publicación manual queda disponible de forma
 *   independiente del interruptor `enabled`.
 */

import { type StateMeta } from './flow-states';

export const PLANNER_STATES = ['enabled', 'disabled'] as const;
export type PlannerState = (typeof PLANNER_STATES)[number];

/**
 * Valor por defecto fail-closed del candidato. La build desplegada observada en
 * producción tiene enabled:true.
 */
export const DEFAULT_PLANNER_ENABLED = false as const;

export const PLANNER_META: Record<PlannerState, StateMeta<PlannerState>> = {
  enabled: {
    key: 'enabled',
    label: 'Generación activada',
    definition: 'La generación programada está activada (enabled:true): el runner automático puede arrancar según el horario configurado.',
    notImplies: ['No implica que haya una ejecución en curso.', 'No implica publicado.', 'No implica que el runner esté conectado en este momento.'],
    admittedActions: [],
  },
  disabled: {
    key: 'disabled',
    label: 'Generación desactivada',
    definition: 'La generación programada está desactivada (enabled:false). Es el valor por defecto fail-closed del candidato.',
    notImplies: ['No implica que la publicación manual esté bloqueada (está disponible de forma independiente).', 'No implica que no haya temas en cola.', 'No implica que el runner no pueda arrancar en modo manual.'],
    admittedActions: [],
  },
};

/** editorial_settings._id:'generation'.settings.enabled → estado del planificador. */
export const GENERATION_ENABLED_TO_PLANNER: Record<'true' | 'false', PlannerState> = {
  true: 'enabled',
  false: 'disabled',
};

export interface GenerationSettings {
  enabled?: unknown;
  [key: string]: unknown;
}

/**
 * Mapea `editorial_settings._id:'generation'.settings` a un estado de planificador.
 * Sin documento o sin `enabled` explícito se aplica el valor por defecto fail-closed
 * del candidato (enabled = false → 'disabled').
 */
export function mapGenerationSettings(settings: GenerationSettings | null | undefined): PlannerState {
  const enabled = settings && typeof settings.enabled === 'boolean' ? settings.enabled : DEFAULT_PLANNER_ENABLED;
  return GENERATION_ENABLED_TO_PLANNER[String(enabled) as 'true' | 'false'];
}
