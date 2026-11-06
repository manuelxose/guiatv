import type { FlowDimension, FlowStateGuide, FlowStateMeta } from '../../../../../services/admin-editorial-flow.service';

/**
 * M14-R7 — Piezas de la guía permanente del flujo editorial.
 *
 * Los TEXTOS de estado (etiqueta, definición, lo que no implica y acciones
 * admitidas) NO se escriben aquí: se leen siempre de `FLOW_STATE_GUIDE`, que
 * entrega la API desde el contrato compartido del backend. Este módulo solo
 * aporta estructura de navegación, el orden de las dimensiones, las seis
 * distinciones del contrato y los ejemplos anclados al comportamiento real, con
 * su comprobación de vigencia (un ejemplo deja de mostrarse si el estado que
 * ejemplifica ya no existe en la versión del contrato cargada).
 */

export const DIMENSION_ORDER: readonly FlowDimension[] = ['candidate', 'editorial', 'execution', 'publication', 'seo'];

export const DIMENSION_LABELS: Record<FlowDimension, string> = {
  candidate: 'Candidato (tema)',
  editorial: 'Editorial (redacción y revisión)',
  execution: 'Ejecución (trabajo)',
  publication: 'Publicación',
  seo: 'SEO (indexación en Google)',
};

export const DIMENSION_QUESTIONS: Record<FlowDimension, string> = {
  candidate: '¿El tema es apto para entrar en el flujo?',
  editorial: '¿En qué punto está la redacción y la revisión?',
  execution: '¿Qué está haciendo el trabajo: cola, arrendamiento y reintentos?',
  publication: '¿El artículo está publicado en el sitio público?',
  seo: '¿Google tiene la URL en su índice?',
};

/** Distinciones codificadas en los metadatos `notImplies` del contrato (documento M14-R7 §2). */
export interface DistinctionExample {
  /** Estado que encarna el primer lado de la distinción. */
  leftDimension: FlowDimension;
  leftState: string;
  /** Estado (normalmente de otra dimensión) que encarna el segundo lado. */
  rightDimension: FlowDimension;
  rightState: string;
}

export interface FlowDistinction {
  id: string;
  title: string;
  plain: string;
  example: DistinctionExample;
}

export const FLOW_DISTINCTIONS: readonly FlowDistinction[] = [
  {
    id: 'discovered-vs-approved',
    title: 'Descubierto no es aprobado',
    plain:
      'Que el ciclo de descubrimiento haya propuesto un tema no dice nada sobre su calidad editorial: entre «descubierto» y «aprobado» median la elegibilidad, la evidencia, la redacción y la revisión de calidad.',
    example: { leftDimension: 'candidate', leftState: 'discovered', rightDimension: 'editorial', rightState: 'approved' },
  },
  {
    id: 'rejected-vs-technical-failure',
    title: 'Rechazado no es un fallo técnico',
    plain:
      'Un rechazo es un veredicto sobre el contenido (evidencia insuficiente, crítico que no da el visto bueno). Un fallo es un error de ejecución (proveedor, plazo, modelo truncado). Ocurren en dimensiones distintas y se recuperan de forma distinta.',
    example: { leftDimension: 'editorial', leftState: 'rejected', rightDimension: 'execution', rightState: 'failed' },
  },
  {
    id: 'retained-vs-paused',
    title: 'Retenido no es pausado',
    plain:
      '«Retenido» es un tema que se conserva en la cola para reintentarlo más adelante. «Pausado» es un trabajo detenido a petición. El primero es una decisión sobre el tema; el segundo, sobre la ejecución.',
    example: { leftDimension: 'candidate', leftState: 'retained', rightDimension: 'execution', rightState: 'paused' },
  },
  {
    id: 'approved-vs-published',
    title: 'Aprobado no es publicado',
    plain:
      'Un borrador puede superar la revisión de calidad y seguir sin aparecer en el sitio público: como «listo para publicar» o como «programado». Aprobado es una condición necesaria, no la publicación.',
    example: { leftDimension: 'editorial', leftState: 'approved', rightDimension: 'publication', rightState: 'published' },
  },
  {
    id: 'published-vs-indexed',
    title: 'Publicado no es indexado',
    plain:
      'Publicar solo pone la URL en el sitio público. Google puede no reconocerla, descubrirla sin indexarla o bloquearla. La indexación se lee de la inspección de Search Console, nunca de la publicación.',
    example: { leftDimension: 'publication', leftState: 'published', rightDimension: 'seo', rightState: 'indexada' },
  },
  {
    id: 'scheduled-vs-manual',
    title: 'Ejecución programada no es ejecución manual',
    plain:
      'La generación programada depende del interruptor del planificador y del reloj del runner; la intervención manual (solicitar, aprobar, recuperar, publicar a mano) está disponible por separado. Apagar la generación programada no bloquea la publicación manual, y un tema encolado a mano no es un ciclo automático.',
    example: { leftDimension: 'publication', leftState: 'scheduled', rightDimension: 'publication', rightState: 'publishing' },
  },
];

/** Etapas del flujo que la Vista A recorre, con el enlace a la dimensión que las posee. */
export interface FlowStageCard {
  id: string;
  title: string;
  dimension: FlowDimension;
  body: string;
  states: string[];
}

/** Los diez puntos del flujo exigidos por el contrato, en el orden en que ocurren. */
export const FLOW_STAGES: readonly FlowStageCard[] = [
  {
    id: 'automatic',
    title: 'Flujo automático',
    dimension: 'candidate',
    body:
      'En cada ciclo, el runner publica una cola nueva con los temas que descubre. Cada tema entra como candidato y pasa los controles de valor y de evidencia antes de ser admitido. La cola vigente es la única historia del descubrimiento: no se guarda un registro por tema descartado, así que el número de «descubiertos» no se puede reconstruir y el diagnóstico lo declara no disponible en lugar de inventarlo.',
    states: ['discovered', 'eligible'],
  },
  {
    id: 'manual',
    title: 'Flujo manual',
    dimension: 'candidate',
    body:
      'Una persona puede crear un tema a mano o decidir sobre uno de la cola (aprobar, rechazar, priorizar o editar). La decisión queda registrada como acción de cola y el runner la aplica en su siguiente ciclo; la interfaz no finge que el cambio ya se aplicó. La solicitud de generación guarda quién la creó.',
    states: ['eligible', 'retained'],
  },
  {
    id: 'scheduled',
    title: 'Publicación programada',
    dimension: 'publication',
    body:
      'Un artículo puede quedar programado para una fecha futura. Programar no es publicar: mientras llega la fecha, la publicación sigue pendiente y la indexación no consta. La generación programada es otra cosa: es el interruptor que permite al runner arrancar solo por horario.',
    states: ['scheduled', 'ready'],
  },
  {
    id: 'review',
    title: 'Revisión editorial',
    dimension: 'editorial',
    body:
      'El borrador pasa por un crítico independiente que evalúa la sostenibilidad de las afirmaciones. Mientras se revisa, el estado es «en revisión»: no está aprobado ni rechazado. Si el crítico señala defectos, el artículo pasa a «requiere revisión» para una reescritura dirigida.',
    states: ['reviewing', 'revision-required'],
  },
  {
    id: 'rejection',
    title: 'Rechazo',
    dimension: 'editorial',
    body:
      'Un rechazo cierra el camino editorial de ese borrador: se agotaron los ciclos de revisión o el gate encontró evidencia insuficiente, un candidato inválido o un duplicado. Rechazado no borra el registro y no se confunde con un fallo técnico ni con un duplicado.',
    states: ['rejected', 'duplicate', 'invalid'],
  },
  {
    id: 'retry',
    title: 'Reintento y recuperación',
    dimension: 'execution',
    body:
      'Un trabajo puede volver a la cola tras un fallo (reintento) o un tema retenido puede relanzarse con nuevas fuentes, un brief corregido o un slug válido. El Observatorio valida cada acción contra el estado real del tema y se niega a repetir una petición cuya causa no ha cambiado: primero hay que cambiar algo.',
    states: ['retrying', 'retained', 'blocked'],
  },
  {
    id: 'approval',
    title: 'Aprobación',
    dimension: 'editorial',
    body:
      'Cuando el borrador supera la revisión de calidad, queda aprobado. La aprobación es del contenido; no publica nada por sí sola ni garantiza que vaya a publicarse.',
    states: ['approved'],
  },
  {
    id: 'publication',
    title: 'Publicación',
    dimension: 'publication',
    body:
      'Publicar exige superar todos los gates otra vez en el servidor, respetar el límite diario y que la publicación esté activa. Desde el Observatorio se puede lanzar una publicación manual por la ruta real, con clave de idempotencia: repetirla no publica dos veces.',
    states: ['ready', 'publishing', 'published'],
  },
  {
    id: 'sitemap',
    title: 'Registro en sitemap',
    dimension: 'publication',
    body:
      'La presencia en el sitemap se deriva de la misma regla que usa el servidor: artículo con estado publicado y revisión aprobada. No se lee el sitemap generado, así que se informa como regla derivada y no como prueba de que Google lo haya leído.',
    states: ['published', 'unpublished-after-publication'],
  },
  {
    id: 'indexing',
    title: 'Monitorización de indexación de Google',
    dimension: 'seo',
    body:
      'La indexación se conoce solo por la inspección de Search Console de la URL. Si no hay inspección, el estado es «no inspeccionado» y no se deduce de la publicación. Cada cobertura que devuelve Google se traduce a un estado SEO cerrado.',
    states: ['no-inspeccionado', 'indexada', 'no-reconocida', 'descubierta-sin-indexar', 'crawleada-sin-indexar'],
  },
];

/** Ejemplo anclado al comportamiento real del sistema, con los estados que cita. */
export interface FlowExample {
  id: string;
  title: string;
  body: string;
  anchor: string;
  cites: Array<{ dimension: FlowDimension; state: string }>;
}

export const FLOW_EXAMPLES: readonly FlowExample[] = [
  {
    id: 'retained-held',
    title: 'Un tema retenido no es un trabajo pausado',
    body:
      'Un ítem de la cola con estado «held» y un motivo del estilo «blocked: agotados los ciclos de revisión» se lee como candidato retenido, editorial rechazado y ejecución bloqueada. Sigue la tabla de mapeo de la cola del contrato: no es un trabajo pausado ni un fallo técnico, y por eso la acción sensata es relanzar la revisión con algo cambiado, no reanudar.',
    anchor: 'Contrato §3.2–3.3 · editorial_queue_snapshot.items[]',
    cites: [
      { dimension: 'candidate', state: 'retained' },
      { dimension: 'editorial', state: 'rejected' },
      { dimension: 'execution', state: 'blocked' },
    ],
  },
  {
    id: 'blocked-reason',
    title: 'El mismo estado «blocked» es un fallo o un rechazo según el motivo',
    body:
      'Un job bloqueado con motivo «error: …» se mapea a ejecución fallida (técnico) y editorial sin datos; el mismo estado con motivo «agotados los ciclos de revisión» se mapea a editorial rechazado y ejecución bloqueada. La clasificación del motivo es una tabla explícita del contrato, no una heurística de la interfaz.',
    anchor: 'Contrato §3.1 · classifyJobBlockedReason',
    cites: [
      { dimension: 'execution', state: 'failed' },
      { dimension: 'editorial', state: 'rejected' },
      { dimension: 'execution', state: 'blocked' },
    ],
  },
  {
    id: 'published-not-indexed',
    title: 'Publicado no implica indexado',
    body:
      'Un artículo con estado publicado y revisión aprobada puede tener una inspección de Search Console que diga «Google no reconoce esta URL». El contrato lo traduce a SEO «no reconocida»: está publicado y no está indexado. La ficha del tema muestra las dos dimensiones por separado.',
    anchor: 'Contrato §3.6 y §4 (ejemplo C) · editorial_gsc_inspections',
    cites: [
      { dimension: 'publication', state: 'published' },
      { dimension: 'seo', state: 'no-reconocida' },
    ],
  },
  {
    id: 'insufficient-evidence',
    title: 'Un rechazo por evidencia no es un duplicado',
    body:
      'En la cola, un tema rechazado con motivo «insufficient-evidence:» se mapea a candidato rechazado y admite añadir evidencia o sustituir la fuente. Un motivo «duplicate:» se mapea a candidato duplicado y su acción es inspeccionar el solape. Ambos son rechazos, pero el catálogo de recuperación es distinto.',
    anchor: 'Contrato §3.3 · QUEUE_REASON_PREFIX_TO_CANDIDATE',
    cites: [
      { dimension: 'candidate', state: 'rejected' },
      { dimension: 'candidate', state: 'duplicate' },
    ],
  },
  {
    id: 'maintenance-not-generation',
    title: 'Mantenimiento y descubrimiento no son generación',
    body:
      'Los trabajos de mantenimiento y de descubrimiento no publican nada: su estado de publicación se lee del artículo, no del job. El contrato distingue el tipo de trabajo para no mostrar «publicado» a partir de un job que nunca publicó.',
    anchor: 'Contrato §3 (T1c) · jobKindOf',
    cites: [
      { dimension: 'execution', state: 'completed' },
      { dimension: 'publication', state: 'published' },
    ],
  },
];

/** `true` cuando el estado citado existe en la guía cargada (el ejemplo sigue vigente). */
export function stateExists(guide: FlowStateGuide | null, dimension: FlowDimension, state: string): boolean {
  if (!guide) return false;
  const bucket = guide[dimension] as Record<string, FlowStateMeta> | undefined;
  return Boolean(bucket && Object.prototype.hasOwnProperty.call(bucket, state));
}

export function metaOf(guide: FlowStateGuide, dimension: FlowDimension, state: string): FlowStateMeta | null {
  const bucket = guide[dimension] as Record<string, FlowStateMeta>;
  return bucket[state] ?? null;
}

/** Etiqueta del estado o el identificador crudo si el contrato no lo conoce (nunca se inventa). */
export function stateLabel(guide: FlowStateGuide | null, dimension: FlowDimension, state: string): string {
  return (guide && metaOf(guide, dimension, state)?.label) || state;
}

/**
 * `desconocido` y `sin-datos` NO son estados del contrato: son la forma honesta de
 * decir «no consta», y se muestran separados del resto de la dimensión.
 */
export const ABSENCE_MARKERS: ReadonlyArray<{ key: string; label: string; definition: string }> = [
  {
    key: 'desconocido',
    label: 'Desconocido',
    definition: 'El registro tiene un valor, pero no pertenece a ningún estado cerrado del contrato: no se decide por él.',
  },
  {
    key: 'sin-datos',
    label: 'Sin datos',
    definition: 'La colección consultada no registra esta dimensión para este registro: la vista no la rellena.',
  },
];

/** Estados de una dimensión en el orden en que los declara el contrato. */
export function statesOf(guide: FlowStateGuide | null, dimension: FlowDimension): Array<{ key: string; meta: FlowStateMeta }> {
  if (!guide) return [];
  const bucket = (guide[dimension] ?? {}) as Record<string, FlowStateMeta>;
  return Object.entries(bucket).map(([key, meta]) => ({ key, meta }));
}

/** Etiquetas del ámbito del diagnóstico. */
export const SCOPE_LABELS = {
  from: 'Desde',
  to: 'Hasta',
  cycleId: 'Ciclo',
  origin: 'Origen',
  category: 'Categoría',
  stage: 'Etapa',
  state: 'Estado',
  failureReason: 'Motivo de fallo',
  model: 'Modelo',
  provider: 'Proveedor',
  publicationStatus: 'Estado de publicación',
} as const;

export const ORIGIN_LABELS: Record<string, string> = { automatic: 'Automático', manual: 'Manual' };
export const PUBLICATION_STATUS_LABELS: Record<string, string> = { publish: 'Publicado', draft: 'Borrador' };

/** Categorías del catálogo editorial (mismo enum que valida el backend). */
export const TOPIC_CATEGORIES = ['Televisión', 'Cine', 'Series', 'Streaming', 'Fútbol', 'Deportes', 'Tecnología'] as const;
