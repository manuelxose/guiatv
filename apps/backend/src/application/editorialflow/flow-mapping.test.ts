/**
 * M14-R7 — Pruebas de las funciones puras de mapeo y de las tablas explícitas,
 * con un caso por cada valor real observado en producción y por cada valor de enum.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapJobRecord,
  mapQueueItem,
  mapBlogPost,
  mapLedgerJob,
  mapGscInspection,
  classifyJobBlockedReason,
  queueReasonPrefix,
  JOB_STATE_TO_EXECUTION,
  JOB_STATE_TO_PUBLICATION,
  QUEUE_STATE_TO_CANDIDATE,
  QUEUE_REASON_PREFIX_TO_CANDIDATE,
  BLOG_STATUS_TO_PUBLICATION,
  BLOG_REVIEW_STATE_TO_EDITORIAL,
  LEDGER_STATE_TO_EXECUTION,
  STAGE_TO_EDITORIAL,
  GSC_COVERAGE_TO_SEO,
  GSC_INDEX_CLASS_TO_SEO,
} from './flow-mapping';

/* ────────────────────────────────────────────────────────────────────────────
 * Tablas de mapeo: cubren los valores reales observados en producción.
 * ──────────────────────────────────────────────────────────────────────────── */

test('la tabla editorial_jobs.state cubre los cinco valores reales observados', () => {
  for (const value of ['blocked', 'discovery', 'published', 'maintenance-verified', 'maintenance-unverifiable']) {
    assert.ok(value in JOB_STATE_TO_EXECUTION, `JOB_STATE_TO_EXECUTION debe cubrir ${value}`);
    assert.ok(value in JOB_STATE_TO_PUBLICATION, `JOB_STATE_TO_PUBLICATION debe cubrir ${value}`);
  }
});

test('la tabla de cola cubre los seis estados reales observados en el snapshot', () => {
  for (const value of ['queued', 'running', 'published', 'held', 'rejected', 'expired']) {
    assert.ok(value in QUEUE_STATE_TO_CANDIDATE, `QUEUE_STATE_TO_CANDIDATE debe cubrir ${value}`);
  }
});

test('los prefijos de motivo de la cola cubren los observados + manual:', () => {
  for (const prefix of ['insufficient-evidence:', 'invalid-candidate:', 'duplicate:', 'manual:']) {
    assert.ok(prefix in QUEUE_REASON_PREFIX_TO_CANDIDATE, `QUEUE_REASON_PREFIX_TO_CANDIDATE debe cubrir ${prefix}`);
  }
});

test('blog_posts.status cubre draft y publish', () => {
  assert.ok('draft' in BLOG_STATUS_TO_PUBLICATION);
  assert.ok('publish' in BLOG_STATUS_TO_PUBLICATION);
  for (const value of ['approved', 'rejected', 'in-review', 'unreviewed']) {
    assert.ok(value in BLOG_REVIEW_STATE_TO_EDITORIAL, `BLOG_REVIEW_STATE_TO_EDITORIAL debe cubrir ${value}`);
  }
});

test('la tabla del ledger cubre sus estados y las etapas mapean a editorial', () => {
  for (const value of ['queued', 'running', 'paused', 'cancelling', 'cancelled', 'completed', 'failed', 'dead-letter', 'blocked']) {
    assert.ok(value in LEDGER_STATE_TO_EXECUTION, `LEDGER_STATE_TO_EXECUTION debe cubrir ${value}`);
  }
  for (const stage of ['source-discovery', 'article-drafting', 'quality-evaluation', 'revision', 'publication', 'sitemap-registration']) {
    assert.ok(stage in STAGE_TO_EDITORIAL, `STAGE_TO_EDITORIAL debe cubrir ${stage}`);
  }
});

test('las tablas SEO cubren cobertura observada y clases normalizadas', () => {
  assert.equal(GSC_COVERAGE_TO_SEO['Google no reconoce esta URL'], 'no-reconocida');
  assert.equal(GSC_COVERAGE_TO_SEO['Descubierta: actualmente sin indexar'], 'descubierta-sin-indexar');
  for (const value of ['indexed', 'blocked', 'fetch-error', 'crawled-not-indexed', 'discovered-not-indexed', 'not-discovered', 'insufficient-evidence']) {
    assert.ok(value in GSC_INDEX_CLASS_TO_SEO, `GSC_INDEX_CLASS_TO_SEO debe cubrir ${value}`);
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 * mapJobRecord — un caso por cada valor real de editorial_jobs.state.
 * ──────────────────────────────────────────────────────────────────────────── */

test('mapJobRecord: blocked con error técnico → ejecución failed, editorial sin-datos', () => {
  const view = mapJobRecord({ state: 'blocked', reason: 'error: editorial: answer truncated at max_tokens' });
  assert.equal(view.execution, 'failed');
  assert.equal(view.editorial, 'sin-datos');
  assert.equal(view.publication, 'unpublished');
  assert.equal(view.technicalFailure, true);
  assert.equal(view.provenance.collection, 'editorial_jobs');
});

test('mapJobRecord: blocked por agotar ciclos de revisión → ejecución blocked, editorial rejected', () => {
  const view = mapJobRecord({ state: 'blocked', reason: 'agotados los ciclos de revisión (5)' });
  assert.equal(view.execution, 'blocked');
  assert.equal(view.editorial, 'rejected');
  assert.equal(view.publication, 'unpublished');
  assert.equal(view.technicalFailure, false);
});

test('mapJobRecord: blocked por límite → ejecución blocked, editorial sin-datos', () => {
  const view = mapJobRecord({ state: 'blocked', reason: 'límite: sin margen para otra llamada' });
  assert.equal(view.execution, 'blocked');
  assert.equal(view.editorial, 'sin-datos');
  assert.equal(view.technicalFailure, false);
});

test('mapJobRecord: discovery → candidato discovered, ejecución completed, sin publicación', () => {
  const view = mapJobRecord({ state: 'discovery', reason: '8 propuestos, 1 en cola, 7 descartados' });
  assert.equal(view.candidate, 'discovered');
  assert.equal(view.execution, 'completed');
  assert.equal(view.editorial, 'sin-datos');
  assert.equal(view.publication, 'unpublished');
});

test('mapJobRecord: published → editorial approved, ejecución completed, publicación published', () => {
  const view = mapJobRecord({ state: 'published', reason: null, publicUrl: 'https://guiaprogramaciontv.com/guias/x' });
  assert.equal(view.candidate, 'eligible');
  assert.equal(view.editorial, 'approved');
  assert.equal(view.execution, 'completed');
  assert.equal(view.publication, 'published');
});

test('mapJobRecord: maintenance-verified → aprobado y publicado, verificación completada', () => {
  const view = mapJobRecord({ state: 'maintenance-verified', reason: '22 afirmaciones verificadas' });
  assert.equal(view.editorial, 'approved');
  assert.equal(view.execution, 'completed');
  assert.equal(view.publication, 'published');
});

test('mapJobRecord: maintenance-unverifiable → no fabrica "verificado" (ejecución blocked)', () => {
  const view = mapJobRecord({ state: 'maintenance-unverifiable', reason: 'sin el fichero de ejecución de la versión publicada: no se puede re-verificar' });
  assert.equal(view.execution, 'blocked');
  assert.equal(view.editorial, 'approved'); // la versión publicada sí consta en el motivo
  assert.equal(view.publication, 'published');
  assert.notEqual(view.execution, 'completed', 'no se puede dar por completada una re-verificación que no corrió');
});

/* ────────────────────────────────────────────────────────────────────────────
 * mapQueueItem — un caso por cada estado de cola y por cada prefijo de motivo.
 * ──────────────────────────────────────────────────────────────────────────── */

test('mapQueueItem: queued → candidato eligible, ejecución queued', () => {
  const view = mapQueueItem({ state: 'queued' });
  assert.equal(view.candidate, 'eligible');
  assert.equal(view.execution, 'queued');
  assert.equal(view.publication, 'unpublished');
});

test('mapQueueItem: running → ejecución running', () => {
  assert.equal(mapQueueItem({ state: 'running' }).execution, 'running');
});

test('mapQueueItem: published → aprobado, completado y publicado', () => {
  const view = mapQueueItem({ state: 'published' });
  assert.equal(view.candidate, 'eligible');
  assert.equal(view.editorial, 'approved');
  assert.equal(view.execution, 'completed');
  assert.equal(view.publication, 'published');
});

test('mapQueueItem: held por ciclos de revisión → retenido (NO pausado), editorial rejected', () => {
  const view = mapQueueItem({ state: 'held', reason: 'blocked: agotados los ciclos de revisión (5)' });
  assert.equal(view.candidate, 'retained');
  assert.notEqual(view.candidate, 'paused' as never);
  assert.equal(view.editorial, 'rejected');
  assert.equal(view.execution, 'blocked');
});

test('mapQueueItem: rejected por evidencia insuficiente → candidato rejected', () => {
  const view = mapQueueItem({ state: 'rejected', reason: 'insufficient-evidence: menos de dos entidades editoras verificadas' });
  assert.equal(view.candidate, 'rejected');
  assert.equal(view.execution, 'sin-datos');
});

test('mapQueueItem: rejected por slug → candidato invalid', () => {
  const view = mapQueueItem({ state: 'rejected', reason: 'invalid-candidate: slug' });
  assert.equal(view.candidate, 'invalid');
});

test('mapQueueItem: rejected por duplicado → candidato duplicate', () => {
  const view = mapQueueItem({ state: 'rejected', reason: 'duplicate: misma intención que protección-menores-control-parental-plataformas (0.47)' });
  assert.equal(view.candidate, 'duplicate');
});

test('mapQueueItem: rejected manual → candidato rejected', () => {
  const view = mapQueueItem({ state: 'rejected', reason: 'manual: no interesa' });
  assert.equal(view.candidate, 'rejected');
});

test('mapQueueItem: expired → candidato rejected', () => {
  assert.equal(mapQueueItem({ state: 'expired' }).candidate, 'rejected');
});

test('queueReasonPrefix extrae los prefijos reales', () => {
  assert.equal(queueReasonPrefix('insufficient-evidence: menos de dos…'), 'insufficient-evidence:');
  assert.equal(queueReasonPrefix('invalid-candidate: slug'), 'invalid-candidate:');
  assert.equal(queueReasonPrefix('duplicate: misma intención…'), 'duplicate:');
  assert.equal(queueReasonPrefix('manual: no interesa'), 'manual:');
  assert.equal(queueReasonPrefix('sin dos puntos'), null);
});

test('classifyJobBlockedReason distingue técnico, revisión y límite', () => {
  assert.equal(classifyJobBlockedReason('error: Connection error.'), 'technical');
  assert.equal(classifyJobBlockedReason('agotados los ciclos de revisión (2)'), 'review-exhausted');
  assert.equal(classifyJobBlockedReason('límite: sin margen para otra llamada'), 'limit');
  assert.equal(classifyJobBlockedReason('el crítico bloqueó el borrador'), 'other');
});

/* ────────────────────────────────────────────────────────────────────────────
 * mapBlogPost — draft/publish × reviewState.
 * ──────────────────────────────────────────────────────────────────────────── */

test('mapBlogPost: publish + approved → publicado y aprobado', () => {
  const view = mapBlogPost({ status: 'publish', reviewState: 'approved' });
  assert.equal(view.publication, 'published');
  assert.equal(view.editorial, 'approved');
});

test('mapBlogPost: draft + approved → listo para publicar (ready)', () => {
  const view = mapBlogPost({ status: 'draft', reviewState: 'approved' });
  assert.equal(view.publication, 'ready');
  assert.equal(view.editorial, 'approved');
});

test('mapBlogPost: draft + unreviewed → no publicado, editorial drafting', () => {
  const view = mapBlogPost({ status: 'draft', reviewState: 'unreviewed' });
  assert.equal(view.publication, 'unpublished');
  assert.equal(view.editorial, 'drafting');
});

test('mapBlogPost: draft + rejected → no publicado, editorial rejected', () => {
  const view = mapBlogPost({ status: 'draft', reviewState: 'rejected' });
  assert.equal(view.publication, 'unpublished');
  assert.equal(view.editorial, 'rejected');
});

test('mapBlogPost: draft + in-review → editorial reviewing', () => {
  assert.equal(mapBlogPost({ status: 'draft', reviewState: 'in-review' }).editorial, 'reviewing');
});

test('mapBlogPost: sin reviewState → editorial sin-datos (no fabrica aprobado)', () => {
  const view = mapBlogPost({ status: 'draft' });
  assert.equal(view.editorial, 'sin-datos');
  assert.equal(view.publication, 'unpublished');
});

/* ────────────────────────────────────────────────────────────────────────────
 * mapLedgerJob — un caso por cada estado del ledger + reintento + publicación.
 * ──────────────────────────────────────────────────────────────────────────── */

test('mapLedgerJob: queued → ejecución queued', () => {
  assert.equal(mapLedgerJob({ state: 'queued', attempt: 0 }).execution, 'queued');
});

test('mapLedgerJob: queued con intento previo → ejecución retrying', () => {
  assert.equal(mapLedgerJob({ state: 'queued', attempt: 2 }).execution, 'retrying');
});

test('mapLedgerJob: running → ejecución running', () => {
  assert.equal(mapLedgerJob({ state: 'running' }).execution, 'running');
});

test('mapLedgerJob: paused → ejecución paused (no es "retenido")', () => {
  assert.equal(mapLedgerJob({ state: 'paused' }).execution, 'paused');
});

test('mapLedgerJob: cancelling → ejecución cancelled', () => {
  assert.equal(mapLedgerJob({ state: 'cancelling' }).execution, 'cancelled');
});

test('mapLedgerJob: cancelled → ejecución cancelled', () => {
  assert.equal(mapLedgerJob({ state: 'cancelled' }).execution, 'cancelled');
});

test('mapLedgerJob: completed sin publicación → ejecución completed, no publicado', () => {
  const view = mapLedgerJob({ state: 'completed' });
  assert.equal(view.execution, 'completed');
  assert.equal(view.publication, 'unpublished');
});

test('mapLedgerJob: failed → ejecución failed', () => {
  assert.equal(mapLedgerJob({ state: 'failed' }).execution, 'failed');
});

test('mapLedgerJob: dead-letter → ejecución failed', () => {
  assert.equal(mapLedgerJob({ state: 'dead-letter' }).execution, 'failed');
});

test('mapLedgerJob: blocked → ejecución blocked', () => {
  assert.equal(mapLedgerJob({ state: 'blocked' }).execution, 'blocked');
});

test('mapLedgerJob: publicación publicada → aprobado y publicado', () => {
  const view = mapLedgerJob({ state: 'completed', publication: { state: 'published' } });
  assert.equal(view.publication, 'published');
  assert.equal(view.editorial, 'approved');
});

test('mapLedgerJob: publicación en curso → publishing', () => {
  assert.equal(mapLedgerJob({ state: 'running', publication: { state: 'publishing' } }).publication, 'publishing');
});

test('mapLedgerJob: etapa actual mapea a editorial', () => {
  assert.equal(mapLedgerJob({ state: 'running', currentStage: 'article-drafting' }).editorial, 'drafting');
  assert.equal(mapLedgerJob({ state: 'running', currentStage: 'quality-evaluation' }).editorial, 'reviewing');
  assert.equal(mapLedgerJob({ state: 'running', currentStage: 'revision' }).editorial, 'revision-required');
  assert.equal(mapLedgerJob({ state: 'running', currentStage: 'source-retrieval' }).editorial, 'researching');
});

test('mapLedgerJob: kind discovery → candidato discovered', () => {
  assert.equal(mapLedgerJob({ kind: 'discovery', state: 'completed' }).candidate, 'discovered');
});

/* ────────────────────────────────────────────────────────────────────────────
 * mapGscInspection — un caso por clase SEO observada.
 * ──────────────────────────────────────────────────────────────────────────── */

test('mapGscInspection: "Google no reconoce esta URL" → no-reconocida', () => {
  assert.equal(mapGscInspection({ coverageState: 'Google no reconoce esta URL' }), 'no-reconocida');
});

test('mapGscInspection: "Descubierta: actualmente sin indexar" → descubierta-sin-indexar', () => {
  assert.equal(mapGscInspection({ coverageState: 'Descubierta: actualmente sin indexar' }), 'descubierta-sin-indexar');
});

test('mapGscInspection: sin inspección → no-inspeccionado', () => {
  assert.equal(mapGscInspection(null), 'no-inspeccionado');
  assert.equal(mapGscInspection({}), 'no-inspeccionado');
});

test('mapGscInspection: clase normalizada indexada/blocked/fetch-error', () => {
  assert.equal(mapGscInspection({ gscIndexClass: 'indexed' }), 'indexada');
  assert.equal(mapGscInspection({ gscIndexClass: 'blocked' }), 'bloqueada');
  assert.equal(mapGscInspection({ gscIndexClass: 'fetch-error' }), 'error-de-fetch');
  assert.equal(mapGscInspection({ gscIndexClass: 'crawled-not-indexed' }), 'crawleada-sin-indexar');
  assert.equal(mapGscInspection({ gscIndexClass: 'insufficient-evidence' }), 'evidencia-insuficiente');
});

/* ────────────────────────────────────────────────────────────────────────────
 * Legacy: sin evidencia → sin-datos / desconocido, con procedencia; sin historia.
 * ──────────────────────────────────────────────────────────────────────────── */

test('registro legacy sin estado → sin-datos con procedencia, sin fabricar historia', () => {
  const view = mapJobRecord({}); // sin state
  assert.equal(view.execution, 'sin-datos');
  assert.equal(view.publication, 'sin-datos');
  assert.equal(view.editorial, 'sin-datos');
  assert.equal(view.provenance.collection, 'editorial_jobs');
  assert.equal(view.provenance.workflowVersion, 'no-consta');
  // La vista no contiene ningún evento de historia fabricado.
  assert.ok(!('history' in view) && !('events' in view), 'la vista no debe inventar historia');
});

test('valor de estado presente pero no reconocido → desconocido (no completado)', () => {
  const view = mapJobRecord({ state: 'estado-inventado' });
  assert.equal(view.execution, 'desconocido');
  assert.notEqual(view.execution, 'completed');
  assert.equal(view.rawState, 'estado-inventado');
});

test('la procedencia refleja workflowVersion cuando consta, si no "no-consta"', () => {
  const withVersion = mapJobRecord({ state: 'blocked', reason: 'error: x', workflowVersion: 'm11g-2' });
  assert.equal(withVersion.provenance.workflowVersion, 'm11g-2');
  const without = mapBlogPost({ status: 'draft' });
  assert.equal(without.provenance.workflowVersion, 'no-consta');
});

/* ────────────────────────────────────────────────────────────────────────────
 * Pureza: las funciones no mutan la entrada.
 * ──────────────────────────────────────────────────────────────────────────── */

test('las funciones de mapeo son puras (no mutan la entrada)', () => {
  const job = { state: 'blocked', reason: 'error: x', publicUrl: null };
  const snapshot = JSON.stringify(job);
  mapJobRecord(job);
  assert.equal(JSON.stringify(job), snapshot);

  const item = { state: 'rejected', reason: 'duplicate: misma intención' };
  const itemSnapshot = JSON.stringify(item);
  mapQueueItem(item);
  assert.equal(JSON.stringify(item), itemSnapshot);

  const post = { status: 'draft', reviewState: 'unreviewed' };
  const postSnapshot = JSON.stringify(post);
  mapBlogPost(post);
  assert.equal(JSON.stringify(post), postSnapshot);
});
