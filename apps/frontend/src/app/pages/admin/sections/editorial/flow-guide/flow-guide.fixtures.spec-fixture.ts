import { of, throwError } from 'rxjs';
import { FlowGuideResponse, FlowStateGuide, FunnelReport, RecoveryActionKey, TopicView } from '../../../../../services/admin-editorial-flow.service';

/**
 * Dobles de prueba con la forma REAL de las respuestas de la API
 * (`/v2/admin/editorial/flow/*`). Compartidos por las pruebas del componente para
 * no duplicar el contrato y mantener el fixture en un solo sitio.
 */

export const stateMeta = (key: string, label: string, definition: string, notImplies: string[], admittedActions: RecoveryActionKey[] = []) => ({
  key,
  label,
  definition,
  notImplies,
  admittedActions,
});

export const GUIDE: FlowStateGuide = {
  version: 'm14-r7.1',
  candidate: {
    discovered: stateMeta('discovered', 'Descubierto', 'Propuesto por el ciclo de descubrimiento.', ['No implica aprobado.'], ['archive']),
    eligible: stateMeta('eligible', 'Elegible', 'Superó los gates de valor y evidencia.', ['No implica publicado.'], ['revise-brief']),
    invalid: stateMeta('invalid', 'Inválido', 'Slug no normalizado.', ['No equivale a fallo técnico.'], ['fix-slug']),
    rejected: stateMeta('rejected', 'Rechazado', 'Rechazado por el gate de evidencia.', ['No equivale a fallo técnico.'], ['add-evidence']),
    duplicate: stateMeta('duplicate', 'Duplicado', 'Duplica la intención de otro tema.', ['No equivale a fallo técnico.'], ['inspect-duplicate']),
    retained: stateMeta('retained', 'Retenido', 'Conservado en espera (held).', ['No equivale a pausado.'], ['retry-review']),
  },
  editorial: {
    researching: stateMeta('researching', 'Investigando', 'Se recupera evidencia.', ['No implica borrador.']),
    drafting: stateMeta('drafting', 'Redactando', 'Hay un borrador.', ['No implica aprobado.']),
    reviewing: stateMeta('reviewing', 'En revisión', 'El crítico evalúa el borrador.', ['No implica aprobado.']),
    'revision-required': stateMeta('revision-required', 'Requiere revisión', 'El crítico señaló defectos.', ['No implica rechazado.']),
    approved: stateMeta('approved', 'Aprobado', 'Superó la revisión de calidad.', ['No implica publicado.'], ['request-manual-review']),
    rejected: stateMeta('rejected', 'Rechazado (editorial)', 'El crítico bloqueó el borrador.', ['No equivale a fallo técnico.'], ['targeted-rewrite']),
  },
  execution: {
    queued: stateMeta('queued', 'En cola', 'Espera un trabajador.', ['No implica en ejecución.']),
    running: stateMeta('running', 'En ejecución', 'Trabajo en curso.', ['No implica completado.']),
    paused: stateMeta('paused', 'Pausado', 'Detenido a petición.', ['No equivale a retenido.']),
    retrying: stateMeta('retrying', 'Reintentando', 'Reencolado tras un fallo.', ['No implica aprobado.']),
    blocked: stateMeta('blocked', 'Bloqueado', 'No puede continuar.', ['No implica fallo técnico necesariamente.']),
    cancelled: stateMeta('cancelled', 'Cancelado', 'Cancelado antes de completar.', ['No implica fallido.']),
    failed: stateMeta('failed', 'Fallido', 'Terminó con fallo técnico.', ['No equivale a rechazado editorial.']),
    completed: stateMeta('completed', 'Completado', 'Terminó su ejecución.', ['No implica publicado.']),
  },
  publication: {
    unpublished: stateMeta('unpublished', 'No publicado', 'No salió al sitio público.', ['No implica rechazado.']),
    ready: stateMeta('ready', 'Listo para publicar', 'Aprobado sin bloqueos.', ['No implica publicado.']),
    scheduled: stateMeta('scheduled', 'Programado', 'Programado para una fecha futura.', ['No implica publicado todavía.']),
    publishing: stateMeta('publishing', 'Publicando', 'Publicación en curso.', ['No implica publicado de forma estable.']),
    published: stateMeta('published', 'Publicado', 'Está publicado en el sitio.', ['No implica indexado en Google.']),
    'unpublished-after-publication': stateMeta('unpublished-after-publication', 'Despublicado', 'Estuvo publicado y se retiró.', ['No implica borrado.']),
  },
  seo: {
    'no-inspeccionado': stateMeta('no-inspeccionado', 'No inspeccionado', 'Sin inspección de Google.', ['No implica no indexada.']),
    'no-reconocida': stateMeta('no-reconocida', 'No reconocida', 'Google no reconoce la URL.', ['No implica no publicada.']),
    'descubierta-sin-indexar': stateMeta('descubierta-sin-indexar', 'Descubierta sin indexar', 'Descubierta sin indexar.', ['No implica indexada.']),
    'crawleada-sin-indexar': stateMeta('crawleada-sin-indexar', 'Crawleada sin indexar', 'Rastreada sin indexar.', ['No implica indexada.']),
    indexada: stateMeta('indexada', 'Indexada', 'Google indexa la URL.', ['No implica bien posicionada.']),
    'error-de-fetch': stateMeta('error-de-fetch', 'Error de fetch', 'Google no pudo obtener la URL.', ['No implica rechazada.']),
    bloqueada: stateMeta('bloqueada', 'Bloqueada', 'Bloqueada para Google.', ['No implica no publicada.']),
    'evidencia-insuficiente': stateMeta('evidencia-insuficiente', 'Evidencia insuficiente', 'Sin datos suficientes.', ['No implica no indexada.']),
  },
  recoveryActions: {
    'retry-source': { key: 'retry-source', label: 'Reintentar recuperación de fuente', definition: 'Reintenta la descarga.' },
    'replace-source': { key: 'replace-source', label: 'Sustituir fuente rota', definition: 'Reemplaza una fuente rota.' },
    'fix-slug': { key: 'fix-slug', label: 'Corregir slug', definition: 'Corrige un slug inválido.' },
    'inspect-duplicate': { key: 'inspect-duplicate', label: 'Inspeccionar duplicado', definition: 'Revisa el solape.' },
    'revise-brief': { key: 'revise-brief', label: 'Revisar brief', definition: 'Ajusta el encargo editorial.' },
    'add-evidence': { key: 'add-evidence', label: 'Añadir evidencia', definition: 'Aporta fuentes adicionales.' },
    'targeted-rewrite': { key: 'targeted-rewrite', label: 'Reescritura dirigida', definition: 'Reescribe las partes señaladas.' },
    'retry-review': { key: 'retry-review', label: 'Reintentar revisión', definition: 'Vuelve a ejecutar la revisión.' },
    'request-manual-review': { key: 'request-manual-review', label: 'Pedir revisión manual', definition: 'Solicita revisión humana.' },
    archive: { key: 'archive', label: 'Archivar', definition: 'Saca el tema del flujo activo.' },
  },
};

export const stage = (
  key: string,
  dimension: FunnelReport['stages'][number]['dimension'],
  label: string,
  count: number | null,
  reason: string | null = null,
  ids: string[] = [],
  conversion: FunnelReport['stages'][number]['conversionFromPrevious'] = null
): FunnelReport['stages'][number] => ({
  key,
  dimension,
  dimensionLabel: dimension,
  label,
  description: `Descripción de ${label}`,
  state: reason ? 'unavailable' : 'measured',
  count,
  unavailableReason: reason,
  drillDown: { ids, total: count ?? 0, returned: ids.length, truncated: false, endpoint: `/v2/admin/editorial/flow/funnel?stage=${key}` },
  queries: [{ collection: 'editorial_queue_snapshot', filter: {}, note: 'Recuento en memoria' }],
  notes: [],
  conversionFromPrevious: conversion,
});

export const FUNNEL: FunnelReport = {
  contractVersion: 'm14-r7.1',
  generatedAt: '2026-11-06T10:00:00.000Z',
  scope: { requested: {}, applied: [{ key: 'origin', value: 'manual' }], note: 'Mismo ámbito en todas las etapas' },
  stages: [
    stage('candidate.discovered', 'candidate', 'Descubiertos', null, 'El sistema no guarda un registro por tema descubierto.'),
    stage('candidate.eligible', 'candidate', 'Elegibles en cola', 4, null, ['tema-a', 'tema-b', 'tema-c', 'tema-d'], {
      from: 'candidate.discovered', ratio: null, lost: null, crossDimension: false,
      unavailableReason: 'Alguna de las dos etapas está marcada como no disponible: la tasa no se puede calcular.',
    }),
    stage('editorial.approved', 'editorial', 'Aprobados sin publicar', 2, null, ['tema-a', 'tema-b'], {
      from: 'candidate.eligible', ratio: 0.5, lost: 2, crossDimension: true, unavailableReason: null,
    }),
    stage('publication.failed', 'publication', 'Publicaciones fallidas', null, 'El sistema no registra un evento de publicación fallida.', [], {
      from: 'editorial.approved', ratio: null, lost: null, crossDimension: false,
      unavailableReason: 'Alguna de las dos etapas está marcada como no disponible: la tasa no se puede calcular.',
    }),
    stage('seo.pending-inspection', 'seo', 'Publicadas pendientes de inspección', 0, null, [], {
      from: 'publication.failed', ratio: null, lost: null, crossDimension: true,
      unavailableReason: 'Alguna de las dos etapas está marcada como no disponible: la tasa no se puede calcular.',
    }),
  ],
  dimensions: [
    { dimension: 'candidate', label: 'Candidato (tema)', stages: ['candidate.discovered', 'candidate.eligible'], total: null, totalNote: 'No se suma un total de dimensión.' },
    { dimension: 'editorial', label: 'Editorial (redacción y revisión)', stages: ['editorial.approved'], total: null, totalNote: 'No se suma un total de dimensión.' },
    { dimension: 'publication', label: 'Publicación', stages: ['publication.failed'], total: null, totalNote: 'No se suma un total de dimensión.' },
    { dimension: 'seo', label: 'SEO (indexación)', stages: ['seo.pending-inspection'], total: null, totalNote: 'No se suma un total de dimensión.' },
  ],
  totals: { global: null, globalNote: 'No existe un total global.', byDimension: [] },
  availability: { connected: true, note: null },
};

export const TOPIC: TopicView = {
  topicId: 'tema-a',
  identity: { topicId: 'tema-a', slug: 'tema-a', title: 'Guía de prueba con evidencia', category: 'Televisión', jobId: 'job-1', postId: 'post-1', publicUrl: null },
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-05T10:00:00.000Z',
  origin: { kind: 'manual', detail: 'Solicitud de generación creada por Ana' },
  editorialBrief: null,
  presence: { queue: true, job: true, ledger: true, post: true, inspection: false },
  dimensions: {
    candidate: { dimension: 'candidate', state: 'retained', label: 'Retenido', definition: 'Conservado en espera.', notImplies: [], provenance: { collection: 'editorial_queue_snapshot', workflowVersion: 'no-consta' }, rawState: 'held', reason: null },
    editorial: { dimension: 'editorial', state: 'rejected', label: 'Rechazado (editorial)', definition: 'El crítico bloqueó el borrador.', notImplies: [], provenance: { collection: 'blog_posts', workflowVersion: 'no-consta' }, rawState: 'rejected', reason: null },
    execution: { dimension: 'execution', state: 'blocked', label: 'Bloqueado', definition: 'No puede continuar.', notImplies: [], provenance: { collection: 'editorial_job_ledger', workflowVersion: 'no-consta' }, rawState: 'blocked', reason: null },
    publication: { dimension: 'publication', state: 'unpublished', label: 'No publicado', definition: 'No salió al sitio público.', notImplies: [], provenance: { collection: 'blog_posts', workflowVersion: 'no-consta' }, rawState: 'draft', reason: null },
    seo: { dimension: 'seo', state: 'no-inspeccionado', label: 'No inspeccionado', definition: 'Sin inspección de Google.', notImplies: [], provenance: { collection: 'editorial_gsc_inspections', workflowVersion: 'no-consta' }, rawState: null, reason: null },
  },
  sources: [],
  lastCompletedStage: null,
  blockingReason: { reason: 'agotados los ciclos de revisión (5)', source: 'editorial_queue_snapshot.items[].reason', technical: false },
  retries: { attempts: 2, maxAttempts: 5, source: 'editorial_job_ledger.attempt' },
  reviewCycles: { count: 5, log: [], source: 'editorial_jobs.revisions' },
  jobId: 'job-1',
  availableActions: [{ key: 'retry-review', label: 'Reintentar revisión', definition: 'Vuelve a ejecutar la revisión.', dimension: 'varias' }],
  unavailableActionsNote: null,
  history: [{ at: '2026-11-05T10:00:00.000Z', dimension: 'candidate', what: 'Última actualización del tema en la cola', detail: 'state=held', source: 'editorial_queue_snapshot' }],
  dataGaps: ['No hay inspección de Search Console: el estado SEO queda como «no inspeccionado».'],
};

export const guideResponse = (): FlowGuideResponse => ({ contractVersion: 'm14-r7.1', guide: GUIDE });
export { of, throwError };
