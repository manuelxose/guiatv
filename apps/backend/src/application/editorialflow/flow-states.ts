/**
 * M14-R7 — Contrato versionado de estado del flujo editorial.
 *
 * Este módulo es el ÚNICO punto de verdad de las CUATRO dimensiones de estado
 * (candidato, editorial, ejecución, publicación) más el estado SEO separado.
 * La UI de la guía (View A) y el diagnóstico (View B) consumen `FLOW_STATE_GUIDE`;
 * ningún texto de usuario final debe duplicarse en el frontend.
 *
 * Reglas de diseño:
 * - Cada dimensión es un enum cerrado y explícito (unión de literales + array iterable).
 * - Cada estado declara: etiqueta española, definición, lo que NO implica y las
 *   acciones de recuperación admitidas (el resto de acciones "no aplican").
 * - Lo que no consta se representa como 'desconocido' o 'sin-datos', nunca como
 *   un estado completado. Aquí NO se fabrica historia para registros legacy.
 */

export const FLOW_CONTRACT_VERSION = 'm14-r7.1' as const;

/** Marcadores de ausencia/desconocimiento. No son estados: son la forma honesta de decir "no consta". */
export const UNKNOWN = 'desconocido' as const;
export const NO_DATA = 'sin-datos' as const;
export type DimensionMarker = typeof UNKNOWN | typeof NO_DATA;

/* ────────────────────────────────────────────────────────────────────────────
 * 1. DIMENSIÓN CANDIDATO
 * Estado del TEMA como candidato a publicación (antes y durante su elegibilidad).
 * ──────────────────────────────────────────────────────────────────────────── */

export const CANDIDATE_STATES = [
  'discovered',
  'eligible',
  'invalid',
  'rejected',
  'duplicate',
  'retained',
] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

/* ────────────────────────────────────────────────────────────────────────────
 * 2. DIMENSIÓN EDITORIAL
 * Estado del PROCESO de redacción y revisión (del borrador al visto bueno).
 * ──────────────────────────────────────────────────────────────────────────── */

export const EDITORIAL_STATES = [
  'researching',
  'drafting',
  'reviewing',
  'revision-required',
  'approved',
  'rejected',
] as const;
export type EditorialState = (typeof EDITORIAL_STATES)[number];

/* ────────────────────────────────────────────────────────────────────────────
 * 3. DIMENSIÓN EJECUCIÓN
 * Estado de la EJECUCIÓN del trabajo (cola, arrendamiento, reintentos, terminales).
 * ──────────────────────────────────────────────────────────────────────────── */

export const EXECUTION_STATES = [
  'queued',
  'running',
  'paused',
  'retrying',
  'blocked',
  'cancelled',
  'failed',
  'completed',
] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

/* ────────────────────────────────────────────────────────────────────────────
 * 4. DIMENSIÓN PUBLICACIÓN
 * Estado de la PUBLICACIÓN del artículo (independiente de su indexación SEO).
 * ──────────────────────────────────────────────────────────────────────────── */

export const PUBLICATION_STATES = [
  'unpublished',
  'ready',
  'scheduled',
  'publishing',
  'published',
  'unpublished-after-publication',
] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

/* ────────────────────────────────────────────────────────────────────────────
 * 5. DIMENSIÓN SEO (separada e independiente)
 * Estado de indexación en Google. Publicado NO implica indexado.
 * ──────────────────────────────────────────────────────────────────────────── */

export const SEO_STATES = [
  'no-inspeccionado',
  'no-reconocida',
  'descubierta-sin-indexar',
  'crawleada-sin-indexar',
  'indexada',
  'error-de-fetch',
  'bloqueada',
  'evidencia-insuficiente',
] as const;
export type SeoState = (typeof SEO_STATES)[number];

/* ────────────────────────────────────────────────────────────────────────────
 * ACCIONES DE RECUPERACIÓN
 * Catálogo cerrado de acciones que el backend (T2) puede ejecutar. Cada estado
 * declara cuáles admite; las que no aparecen "no aplican" para ese estado.
 * ──────────────────────────────────────────────────────────────────────────── */

export const RECOVERY_ACTIONS = [
  'retry-source',
  'replace-source',
  'fix-slug',
  'inspect-duplicate',
  'revise-brief',
  'add-evidence',
  'targeted-rewrite',
  'retry-review',
  'request-manual-review',
  'archive',
] as const;
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];

export interface RecoveryActionMeta {
  key: RecoveryAction;
  label: string;
  definition: string;
}

export const RECOVERY_ACTIONS_META: Record<RecoveryAction, RecoveryActionMeta> = {
  'retry-source': {
    key: 'retry-source',
    label: 'Reintentar recuperación de fuente',
    definition: 'Reintenta la descarga de una fuente semilla que falló (HTTP, texto ilegible), sin sustituirla.',
  },
  'replace-source': {
    key: 'replace-source',
    label: 'Sustituir fuente rota',
    definition: 'Reemplaza una fuente que no se puede recuperar por una alternativa verificada.',
  },
  'fix-slug': {
    key: 'fix-slug',
    label: 'Corregir slug',
    definition: 'Corrige un slug inválido para que el tema vuelva a ser un candidato válido.',
  },
  'inspect-duplicate': {
    key: 'inspect-duplicate',
    label: 'Inspeccionar duplicado',
    definition: 'Revisa si el tema duplica la intención de otro y decide si se descarta o se mantiene.',
  },
  'revise-brief': {
    key: 'revise-brief',
    label: 'Revisar brief',
    definition: 'Ajusta el encargo editorial del tema (título, intención, alcance).',
  },
  'add-evidence': {
    key: 'add-evidence',
    label: 'Añadir evidencia',
    definition: 'Aporta fuentes adicionales para alcanzar el umbral de evidencia exigido.',
  },
  'targeted-rewrite': {
    key: 'targeted-rewrite',
    label: 'Reescritura dirigida',
    definition: 'Reescribe solo las partes del borrador señaladas por el crítico.',
  },
  'retry-review': {
    key: 'retry-review',
    label: 'Reintentar revisión',
    definition: 'Vuelve a ejecutar la revisión de calidad sobre el borrador.',
  },
  'request-manual-review': {
    key: 'request-manual-review',
    label: 'Pedir revisión manual',
    definition: 'Solicita que una persona revise y decida manualmente.',
  },
  archive: {
    key: 'archive',
    label: 'Archivar',
    definition: 'Saca el tema/registro del flujo activo sin borrarlo.',
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * METADATOS DE ESTADO
 * ──────────────────────────────────────────────────────────────────────────── */

export interface StateMeta<State extends string> {
  key: State;
  /** Etiqueta española para la UI. */
  label: string;
  /** Definición operativa en español. */
  definition: string;
  /** Lista explícita de lo que el estado NO implica / NO equivale. */
  notImplies: string[];
  /** Acciones de recuperación admitidas; el resto de RECOVERY_ACTIONS no aplica. */
  admittedActions: RecoveryAction[];
}

export const CANDIDATE_META: Record<CandidateState, StateMeta<CandidateState>> = {
  discovered: {
    key: 'discovered',
    label: 'Descubierto',
    definition: 'El tema fue propuesto por el ciclo de descubrimiento, pero aún no pasó los gates de elegibilidad.',
    notImplies: ['No implica elegible ni aprobado.', 'No implica que se vaya a redactar.', 'No implica evidencia verificada.'],
    admittedActions: ['revise-brief', 'archive'],
  },
  eligible: {
    key: 'eligible',
    label: 'Elegible',
    definition: 'El tema superó los gates de valor y evidencia y está admitido en la cola.',
    notImplies: ['No implica en ejecución ni redactado.', 'No implica aprobado ni publicado.', 'No implica evidencia completa (solo el umbral del gate).'],
    admittedActions: ['revise-brief', 'archive'],
  },
  invalid: {
    key: 'invalid',
    label: 'Inválido',
    definition: 'El candidato no es válido tal cual (por ejemplo, slug no normalizado).',
    notImplies: ['No equivale a fallo técnico.', 'No implica falta de evidencia.', 'No implica contenido de baja calidad.'],
    admittedActions: ['fix-slug', 'archive'],
  },
  rejected: {
    key: 'rejected',
    label: 'Rechazado',
    definition: 'El candidato fue rechazado por el gate (por ejemplo, evidencia insuficiente o rechazo manual).',
    notImplies: ['No equivale a fallo técnico de la ejecución.', 'No implica que el tema no tenga valor.', 'No implica imposible de recuperar.'],
    admittedActions: ['add-evidence', 'replace-source', 'retry-source', 'revise-brief', 'archive'],
  },
  duplicate: {
    key: 'duplicate',
    label: 'Duplicado',
    definition: 'El candidato duplica la intención de otro tema ya presente.',
    notImplies: ['No equivale a fallo técnico.', 'No implica que el contenido sea erróneo.', 'No implica rechazado por evidencia.'],
    admittedActions: ['inspect-duplicate', 'archive'],
  },
  retained: {
    key: 'retained',
    label: 'Retenido',
    definition: 'El candidato se conserva en espera (held) sin descartarse, para reintentarlo más adelante.',
    notImplies: ['No equivale a pausado (la pausa es de ejecución).', 'No implica rechazado de forma definitiva.', 'No implica que esté en ejecución.'],
    admittedActions: ['add-evidence', 'replace-source', 'revise-brief', 'retry-review', 'archive'],
  },
};

export const EDITORIAL_META: Record<EditorialState, StateMeta<EditorialState>> = {
  researching: {
    key: 'researching',
    label: 'Investigando',
    definition: 'Se está recuperando y verificando evidencia para sostener las afirmaciones.',
    notImplies: ['No implica que haya borrador.', 'No implica aprobado ni publicado.', 'No implica evidencia ya completa.'],
    admittedActions: ['retry-source', 'replace-source', 'revise-brief', 'archive'],
  },
  drafting: {
    key: 'drafting',
    label: 'Redactando',
    definition: 'Existe un borrador en construcción o pendiente de revisión.',
    notImplies: ['No implica revisado ni aprobado.', 'No implica publicado.', 'No implica evidencia verificada en su totalidad.'],
    admittedActions: ['revise-brief', 'targeted-rewrite', 'archive'],
  },
  reviewing: {
    key: 'reviewing',
    label: 'En revisión',
    definition: 'El borrador está siendo evaluado por el crítico de calidad.',
    notImplies: ['No implica aprobado ni rechazado todavía.', 'No implica publicado.', 'No implica que vaya a pasar.'],
    admittedActions: ['request-manual-review', 'archive'],
  },
  'revision-required': {
    key: 'revision-required',
    label: 'Requiere revisión',
    definition: 'El crítico señaló defectos y hace falta una reescritura o nueva revisión.',
    notImplies: ['No implica rechazado de forma definitiva.', 'No implica fallo técnico.', 'No implica publicado.'],
    admittedActions: ['targeted-rewrite', 'retry-review', 'add-evidence', 'request-manual-review', 'archive'],
  },
  approved: {
    key: 'approved',
    label: 'Aprobado',
    definition: 'El borrador superó la revisión de calidad y está listo para publicar.',
    notImplies: ['No implica publicado.', 'No implica indexado en Google.', 'No implica que la publicación esté programada.'],
    admittedActions: ['targeted-rewrite', 'request-manual-review', 'archive'],
  },
  rejected: {
    key: 'rejected',
    label: 'Rechazado (editorial)',
    definition: 'El crítico bloqueó el borrador y se agotaron los ciclos de revisión.',
    notImplies: ['No equivale a fallo técnico de la ejecución.', 'No implica que el tema no sirva.', 'No implica publicado.'],
    admittedActions: ['targeted-rewrite', 'revise-brief', 'retry-review', 'add-evidence', 'request-manual-review', 'archive'],
  },
};

export const EXECUTION_META: Record<ExecutionState, StateMeta<ExecutionState>> = {
  queued: {
    key: 'queued',
    label: 'En cola',
    definition: 'El trabajo está encolado esperando un trabajador disponible.',
    notImplies: ['No implica en ejecución.', 'No implica aprobado ni publicado.', 'No implica reintento (aún no falló).'],
    admittedActions: ['archive'],
  },
  running: {
    key: 'running',
    label: 'En ejecución',
    definition: 'El trabajo está en curso con un arrendamiento activo.',
    notImplies: ['No implica completado.', 'No implica aprobado ni publicado.', 'No implica que vaya a terminar bien.'],
    admittedActions: ['request-manual-review', 'archive'],
  },
  paused: {
    key: 'paused',
    label: 'Pausado',
    definition: 'El trabajo se pausó a petición y no avanza hasta reanudarse.',
    notImplies: ['No equivale a retenido (retenido es estado de candidato).', 'No implica cancelado ni fallido.', 'No implica completado.'],
    admittedActions: ['archive'],
  },
  retrying: {
    key: 'retrying',
    label: 'Reintentando',
    definition: 'El trabajo se volvió a encolar tras un fallo previo (intento > 0).',
    notImplies: ['No implica que la causa raíz haya cambiado.', 'No implica aprobado ni publicado.', 'No implica que vaya a completar.'],
    admittedActions: ['retry-source', 'replace-source', 'archive'],
  },
  blocked: {
    key: 'blocked',
    label: 'Bloqueado',
    definition: 'El trabajo no puede continuar (motivo técnico, límite, revisión agotada o plan descartado).',
    notImplies: ['No implica fallo técnico necesariamente (puede ser revisión agotada).', 'No implica publicado.', 'No implica descartado para siempre.'],
    admittedActions: ['retry-source', 'replace-source', 'add-evidence', 'targeted-rewrite', 'retry-review', 'request-manual-review', 'archive'],
  },
  cancelled: {
    key: 'cancelled',
    label: 'Cancelado',
    definition: 'El trabajo se canceló antes de completar.',
    notImplies: ['No implica fallido.', 'No implica completado.', 'No implica publicado.'],
    admittedActions: ['archive'],
  },
  failed: {
    key: 'failed',
    label: 'Fallido',
    definition: 'El trabajo terminó con un fallo técnico (proveedor, plazo, error de ejecución).',
    notImplies: ['No equivale a rechazado editorial.', 'No implica que el contenido sea malo.', 'No implica imposible de reintentar.'],
    admittedActions: ['retry-source', 'replace-source', 'retry-review', 'request-manual-review', 'archive'],
  },
  completed: {
    key: 'completed',
    label: 'Completado',
    definition: 'El trabajo terminó su ejecución (no implica que se publicara).',
    notImplies: ['No implica publicado.', 'No implica indexado en Google.', 'No implica aprobado por un humano.'],
    admittedActions: ['archive'],
  },
};

export const PUBLICATION_META: Record<PublicationState, StateMeta<PublicationState>> = {
  unpublished: {
    key: 'unpublished',
    label: 'No publicado',
    definition: 'No hay publicación: el artículo no salió al sitio público.',
    notImplies: ['No implica rechazado.', 'No implica sin aprobar.', 'No implica indexado.'],
    admittedActions: ['targeted-rewrite', 'retry-review', 'request-manual-review', 'archive'],
  },
  ready: {
    key: 'ready',
    label: 'Listo para publicar',
    definition: 'Aprobado y sin bloqueos de publicación, pero aún no publicado.',
    notImplies: ['No implica publicado.', 'No implica programado.', 'No implica indexado.'],
    admittedActions: ['targeted-rewrite', 'request-manual-review', 'archive'],
  },
  scheduled: {
    key: 'scheduled',
    label: 'Programado',
    definition: 'La publicación está programada para una fecha futura.',
    notImplies: ['No implica publicado todavía.', 'No implica indexado.', 'No implica que no se pueda cancelar.'],
    admittedActions: ['archive'],
  },
  publishing: {
    key: 'publishing',
    label: 'Publicando',
    definition: 'La publicación está en curso (transición no terminada).',
    notImplies: ['No implica publicado de forma estable.', 'No implica indexado.', 'No implica que el evento sea idempotente por sí solo.'],
    admittedActions: ['archive'],
  },
  published: {
    key: 'published',
    label: 'Publicado',
    definition: 'El artículo está publicado en el sitio público.',
    notImplies: ['No implica indexado en Google.', 'No implica reconocido por Google.', 'No implica libre de errores.'],
    admittedActions: ['archive'],
  },
  'unpublished-after-publication': {
    key: 'unpublished-after-publication',
    label: 'Despublicado',
    definition: 'El artículo estuvo publicado y luego se retiró del sitio público.',
    notImplies: ['No implica nunca publicado (sí lo estuvo).', 'No implica indexado (Google puede conservar la URL).', 'No implica borrado.'],
    admittedActions: ['retry-review', 'request-manual-review', 'archive'],
  },
};

export const SEO_META: Record<SeoState, StateMeta<SeoState>> = {
  'no-inspeccionado': {
    key: 'no-inspeccionado',
    label: 'No inspeccionado',
    definition: 'No hay inspección de Google para la URL (aún no se solicitó o no devolvió dato).',
    notImplies: ['No implica no indexada.', 'No implica no publicada.', 'No implica error.'],
    admittedActions: ['archive'],
  },
  'no-reconocida': {
    key: 'no-reconocida',
    label: 'No reconocida',
    definition: 'Google no reconoce la URL (no la descubrió ni la tiene en su índice).',
    notImplies: ['No implica no publicada.', 'No implica bloqueada.', 'No implica que nunca se pueda indexar.'],
    admittedActions: ['archive'],
  },
  'descubierta-sin-indexar': {
    key: 'descubierta-sin-indexar',
    label: 'Descubierta sin indexar',
    definition: 'Google descubrió la URL pero aún no la indexa.',
    notImplies: ['No implica indexada.', 'No implica bloqueada.', 'No implica que no se vaya a indexar.'],
    admittedActions: ['archive'],
  },
  'crawleada-sin-indexar': {
    key: 'crawleada-sin-indexar',
    label: 'Crawleada sin indexar',
    definition: 'Google rastreó la URL pero decidió no indexarla.',
    notImplies: ['No implica indexada.', 'No implica bloqueada por robots.', 'No implica error de rastreo.'],
    admittedActions: ['archive'],
  },
  indexada: {
    key: 'indexada',
    label: 'Indexada',
    definition: 'Google indexa la URL.',
    notImplies: ['No implica bien posicionada.', 'No implica sin errores de contenido.', 'No implica que no pueda desindexarse después.'],
    admittedActions: ['archive'],
  },
  'error-de-fetch': {
    key: 'error-de-fetch',
    label: 'Error de fetch',
    definition: 'Google no pudo obtener la URL (404, 5xx, redirección rota, acceso denegado…).',
    notImplies: ['No implica rechazada editorialmente.', 'No implica no publicada.', 'No implica bloqueada por robots.'],
    admittedActions: ['retry-source', 'replace-source', 'archive'],
  },
  bloqueada: {
    key: 'bloqueada',
    label: 'Bloqueada',
    definition: 'La URL está bloqueada para Google (robots disallow, noindex o bloqueo de meta).',
    notImplies: ['No implica no publicada.', 'No implica que el bloqueo sea un error (puede ser intencional).', 'No implica indexada.'],
    admittedActions: ['archive'],
  },
  'evidencia-insuficiente': {
    key: 'evidencia-insuficiente',
    label: 'Evidencia insuficiente',
    definition: 'No hay datos suficientes de la inspección para afirmar un estado de indexación.',
    notImplies: ['No implica no indexada.', 'No implica bloqueada.', 'No implica error.'],
    admittedActions: ['add-evidence', 'archive'],
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * GUÍA ÚNICA (View A + View B)
 * Constante exportada que la UI consume. No duplicar estos textos en el frontend.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface FlowStateGuide {
  version: typeof FLOW_CONTRACT_VERSION;
  candidate: Record<CandidateState, StateMeta<CandidateState>>;
  editorial: Record<EditorialState, StateMeta<EditorialState>>;
  execution: Record<ExecutionState, StateMeta<ExecutionState>>;
  publication: Record<PublicationState, StateMeta<PublicationState>>;
  seo: Record<SeoState, StateMeta<SeoState>>;
  recoveryActions: Record<RecoveryAction, RecoveryActionMeta>;
}

export const FLOW_STATE_GUIDE: FlowStateGuide = {
  version: FLOW_CONTRACT_VERSION,
  candidate: CANDIDATE_META,
  editorial: EDITORIAL_META,
  execution: EXECUTION_META,
  publication: PUBLICATION_META,
  seo: SEO_META,
  recoveryActions: RECOVERY_ACTIONS_META,
};
