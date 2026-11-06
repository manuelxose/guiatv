/**
 * M14-R7 — Embudo y reconciliación del Observatorio editorial, probados contra
 * los documentos reales de producción (fixtures) sin base de datos.
 *
 *   node --test dist/application/services/EditorialFlow*.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTIONS, MemoryFlowRead, POSTS, emptyCollections } from './EditorialFlow.fixtures';
import { EditorialFlowDiagnostics } from './EditorialFlowDiagnostics';
import { FUNNEL_STAGE_KEYS } from './EditorialFlowFunnel';

const NOW = new Date('2026-11-06T12:00:00.000Z');
const diagnostics = (collections = COLLECTIONS, connected = true) =>
  new EditorialFlowDiagnostics({ read: new MemoryFlowRead(collections, connected), clock: () => NOW });

const stage = (report: { stages: Array<Record<string, any>> }, key: string) => {
  const found = report.stages.find((entry) => entry.key === key);
  assert.ok(found, `falta la etapa ${key}`);
  return found!;
};

test('M14-R7 embudo: conteos derivados de datos reales, consulta trazable y sin totales inventados', async () => {
  const report = await diagnostics().funnel();

  // Etapas de candidato: el estado de la cola vigente, tal cual está en producción.
  assert.equal(stage(report, 'candidate.eligible').count, 1);
  assert.equal(stage(report, 'candidate.invalid').count, 1);
  assert.equal(stage(report, 'candidate.duplicate').count, 1);
  assert.equal(stage(report, 'candidate.rejected-insufficient-evidence').count, 2);
  assert.equal(stage(report, 'candidate.rejected').count, 1);
  assert.equal(stage(report, 'candidate.retained').count, 1);
  assert.equal(stage(report, 'candidate.expired').count, 1);

  // Etapas editoriales: aprobado no implica publicado.
  assert.equal(stage(report, 'editorial.drafting').count, 1);
  assert.equal(stage(report, 'editorial.reviewing').count, 1);
  assert.equal(stage(report, 'editorial.approved').count, 1);
  assert.equal(stage(report, 'editorial.rejected').count, 0);

  // Etapas de ejecución: fallo técnico separado de bloqueo editorial.
  assert.equal(stage(report, 'execution.discovery').count, 1);
  assert.equal(stage(report, 'execution.failed').count, 1);
  assert.equal(stage(report, 'execution.blocked').count, 1);
  assert.equal(stage(report, 'execution.completed').count, 2);

  // Publicación: intentos registrados en el libro append-only, no una métrica de relleno.
  assert.equal(stage(report, 'publication.published').count, 4);
  // El registro legacy sin `status` no es un borrador: no se cuenta en «no publicados».
  assert.equal(stage(report, 'publication.unpublished').count, 3);
  assert.equal(stage(report, 'publication.attempts').count, 3);

  // SEO: publicado no implica indexado; lo no inspeccionado se declara aparte.
  assert.equal(stage(report, 'seo.indexed').count, 1);
  assert.equal(stage(report, 'seo.discovered-not-indexed').count, 1);
  assert.equal(stage(report, 'seo.not-recognized').count, 1);
  assert.equal(stage(report, 'seo.crawled-not-indexed').count, 0);
  assert.equal(stage(report, 'seo.pending-inspection').count, 1);

  // Cada recuento medido viaja con la consulta real y con los identificadores de debajo.
  for (const entry of report.stages) {
    if (entry.state === 'measured') {
      assert.ok(entry.queries.length > 0, `${entry.key} debe declarar su consulta`);
      assert.equal(entry.drillDown.total, entry.count);
    } else {
      assert.equal(entry.count, null);
      assert.ok(String(entry.unavailableReason).length > 20, `${entry.key} debe explicar por qué no está disponible`);
    }
    for (const query of entry.queries) {
      assert.ok(typeof query.collection === 'string');
      assert.equal(typeof query.filter, 'object');
    }
    assert.ok(Array.isArray(entry.drillDown.ids));
  }
  assert.deepEqual(stage(report, 'candidate.retained').drillDown.ids, ['cnmc-derechos-audiovisuales-accesibilidad-plataformas']);
  assert.equal(stage(report, 'candidate.retained').queries[0].collection, 'editorial_queue_snapshot');

  // Nunca se suma nada: no hay total global ni total por dimensión.
  assert.equal(report.totals.global, null);
  assert.match(report.totals.globalNote, /nunca se suman/i);
  for (const dimension of report.dimensions) assert.equal(dimension.total, null);
  assert.equal(report.totals.byDimension.length, 5);

  // Conversión solo entre etapas medidas, marcando el cruce de dimensión.
  const invalid = stage(report, 'candidate.invalid');
  assert.equal(invalid.conversionFromPrevious.from, 'candidate.eligible');
  assert.equal(invalid.conversionFromPrevious.ratio, 1);
  assert.equal(invalid.conversionFromPrevious.crossDimension, false);
  assert.equal(stage(report, 'editorial.drafting').conversionFromPrevious.crossDimension, true);
  assert.equal(stage(report, 'execution.discovery').conversionFromPrevious.ratio, null);
  assert.match(String(stage(report, 'execution.discovery').conversionFromPrevious.unavailableReason), /no está definida/);
});

test('M14-R7 embudo: el ámbito se aplica igual a todas las etapas o la etapa se marca no disponible', async () => {
  // Categoría: la aplican candidato, editorial y publicación; no la aplican
  // ejecución, intentos ni SEO, que quedan no disponibles (nunca 0 inventado).
  const byCategory = await diagnostics().funnel({ category: 'Deportes' });
  assert.equal(stage(byCategory, 'candidate.rejected-insufficient-evidence').count, 2);
  assert.equal(stage(byCategory, 'candidate.eligible').count, 0);
  assert.equal(stage(byCategory, 'publication.published').count, 1);
  const execution = stage(byCategory, 'execution.failed');
  assert.equal(execution.state, 'unavailable');
  assert.equal(execution.count, null);
  assert.match(execution.unavailableReason, /«categoría»/);
  assert.match(stage(byCategory, 'publication.attempts').unavailableReason, /«categoría»/);

  // Proveedor: ninguna colección del flujo lo registra; todas las etapas lo dicen.
  const byProvider = await diagnostics().funnel({ provider: 'deepseek' });
  for (const entry of byProvider.stages) {
    assert.equal(entry.state, 'unavailable', `${entry.key} debería ser no disponible`);
    assert.equal(entry.count, null);
    assert.match(String(entry.unavailableReason), /«proveedor»/);
  }

  // Modelo: sí consta en editorial_jobs (costEntries.model) y acota solo ejecución.
  const byModel = await diagnostics().funnel({ model: 'deepseek-v4-pro' });
  assert.equal(stage(byModel, 'execution.discovery').count, 1);
  assert.equal(stage(byModel, 'execution.blocked').count, 1);
  assert.equal(stage(byModel, 'execution.failed').count, 1);
  assert.equal(stage(byModel, 'execution.completed').count, 0);
  assert.equal(stage(byModel, 'candidate.retained').state, 'unavailable');

  // Periodo: se aplica sobre el sello propio de cada colección (startedAt como ISO).
  const recent = await diagnostics().funnel({ from: '2026-11-06T00:00:00.000Z' });
  assert.equal(stage(recent, 'execution.discovery').count, 1);
  assert.equal(stage(recent, 'execution.failed').count, 0);
  assert.equal(stage(recent, 'execution.completed').count, 0);
  const sinceYesterday = await diagnostics().funnel({ from: '2026-11-05T00:00:00.000Z' });
  assert.equal(stage(sinceYesterday, 'execution.failed').count, 1);
  assert.equal(stage(sinceYesterday, 'execution.blocked').count, 1);
  assert.equal(stage(sinceYesterday, 'execution.completed').count, 0);
  const beforeOctober = await diagnostics().funnel({ to: '2026-10-01T00:00:00.000Z' });
  assert.equal(stage(beforeOctober, 'execution.discovery').count, 0);
  assert.equal(stage(beforeOctober, 'execution.completed').count, 0);

  // Estado y etapa: filtran sin cambiar la población.
  const retained = await diagnostics().funnel({ stage: 'candidate.retained' });
  assert.equal(retained.stages.length, 1);
  assert.equal(stage(retained, 'candidate.retained').count, 1);
  const wrongState = await diagnostics().funnel({ stage: 'candidate.retained', state: 'queued' });
  assert.equal(stage(wrongState, 'candidate.retained').count, 0);

  // El origen manual no consta en la cola ni en los jobs: se explica.
  const manual = await diagnostics().funnel({ origin: 'manual' });
  assert.match(stage(manual, 'candidate.retained').unavailableReason, /origen manual/);
  assert.match(stage(manual, 'execution.blocked').unavailableReason, /origen manual/);

  // Un ámbito inválido es un 400 con motivo en español.
  await assert.rejects(() => diagnostics().funnel({ origin: 'otro' }), /solo admite «automatic» o «manual»/);
  await assert.rejects(() => diagnostics().funnel({ from: 'no-es-fecha' }), /fecha ISO 8601/);
  await assert.rejects(() => diagnostics().funnel({ from: '2026-11-06T00:00:00Z', to: '2026-11-01T00:00:00Z' }), /posterior/);
  await assert.rejects(() => diagnostics().funnel({ stage: 'inventada' }), /no pertenece al embudo/);
  await assert.rejects(() => diagnostics().funnel({ category: 'Inventada' }), /catálogo editorial/);
});

test('M14-R7 embudo: base vacía y sin conexión se marcan no disponibles sin lanzar excepciones', async () => {
  const empty = await diagnostics(emptyCollections()).funnel();
  // Colecciones vacías: el recuento real es 0 (no es un dato ausente).
  assert.equal(stage(empty, 'publication.published').count, 0);
  assert.equal(stage(empty, 'publication.unpublished').count, 0);
  assert.equal(stage(empty, 'execution.completed').count, 0);
  // La cola vigente no existe: no se puede afirmar el número de temas.
  assert.equal(stage(empty, 'candidate.eligible').state, 'unavailable');
  assert.match(stage(empty, 'candidate.eligible').unavailableReason, /_id="current"/);
  // Las etapas sin fuente real siguen siendo honestas.
  assert.equal(stage(empty, 'candidate.discovered').state, 'unavailable');
  assert.equal(stage(empty, 'publication.failed').state, 'unavailable');
  assert.equal(empty.stages.length, FUNNEL_STAGE_KEYS.length);

  const offline = await diagnostics(COLLECTIONS, false).funnel();
  for (const entry of offline.stages) {
    assert.equal(entry.state, 'unavailable', `${entry.key} sin conexión debe ser no disponible`);
    assert.equal(entry.count, null);
    assert.ok(String(entry.unavailableReason).length > 20, `${entry.key} debe explicar el motivo`);
  }
  assert.match(stage(offline, 'candidate.eligible').unavailableReason, /conexión con la base de datos/);
  assert.equal(offline.availability.connected, false);
});

test('M14-R7 reconciliación: veredicto publicado / no publicado / desconocido con masa explícita', async () => {
  const report = await diagnostics().reconciliation();
  assert.equal(report.count, 7);
  assert.equal(report.mass.total, 7);
  assert.equal(report.mass.published, 4);
  assert.equal(report.mass.notPublished, 2);
  assert.equal(report.mass.unknown, 1);
  assert.match(report.mass.note, /total de registros analizados/);

  const bySlug = new Map(report.records.map((record) => [record.slug, record]));

  const published = bySlug.get('limite-anuncios-television-minutos-por-hora-ley')!;
  assert.equal(published.verdict, 'publicado');
  assert.equal(published.collection, 'blog_posts');
  assert.equal(published.status, 'publish');
  assert.equal(published.reviewState, 'approved');
  assert.equal(published.inSitemap, true);
  assert.match(published.sitemapRule, /status="publish" y reviewState="approved"/);
  assert.equal(published.gsc?.coverageState, 'Descubierta: actualmente sin indexar');
  assert.equal(published.publicUrl, 'https://guiaprogramaciontv.com/guias/limite-anuncios-television-minutos-por-hora-ley');
  assert.equal(published.ledgerJob, null);
  assert.ok(published.unknowns.some((line) => /Solape con la cola/.test(line)));

  const withLedger = bySlug.get('horario-proteccion-menores-television-calificacion-por-edades')!;
  assert.equal(withLedger.verdict, 'publicado');
  assert.equal(withLedger.ledgerJob?.jobId, 'm14-ledger-2');
  assert.equal(withLedger.ledgerJob?.state, 'completed');
  assert.equal(withLedger.eligibilityGates.find((gate) => gate.gate === 'job-en-ledger')!.status, 'ok');

  const notPublished = bySlug.get('descargar-series-netflix-grabar-tele-copia-privada')!;
  assert.equal(notPublished.verdict, 'no publicado');
  assert.match(notPublished.verdictReason, /aprobado no implica publicado/i);
  assert.equal(notPublished.inSitemap, false);

  assert.equal(bySlug.get('guia-en-revision-editorial')!.verdict, 'no publicado');

  const unknown = bySlug.get('guia-legacy-sin-estado')!;
  assert.equal(unknown.verdict, 'desconocido');
  assert.match(unknown.verdictReason, /no se puede afirmar/);
  assert.equal(unknown.status, null);

  // Gates faltantes nombrados: la procedencia del pipeline no consta en estos legacy.
  const provenanceGate = published.eligibilityGates.find((gate) => gate.gate === 'procedencia-pipeline')!;
  assert.equal(provenanceGate.status, 'missing');
  assert.match(provenanceGate.detail, /sin procedencia/i);
  const gscMissing = bySlug.get('subtitulos-audiodescripcion-lengua-de-signos-television-obligaciones')!;
  assert.equal(gscMissing.gsc, null);
  assert.equal(gscMissing.eligibilityGates.find((gate) => gate.gate === 'inspeccion-gsc')!.status, 'missing');
  assert.ok(report.gateSummary.some((gate) => gate.gate === 'en-sitemap' && gate.ok === 4));
  assert.ok(report.dataGaps.some((gap) => /sitemap/.test(gap)));

  // Con procedencia presente, los gates de procedencia se evalúan de verdad.
  const withProvenance = POSTS.map((post) =>
    post.slug === 'movistar-plus-vs-dazn'
      ? { ...post, editorial: { pipelineVersion: 'm11g-2', state: 'published', bundle: { sources: [], claims: [] } } }
      : post
  );
  const withEditorial = new EditorialFlowDiagnostics({
    read: new MemoryFlowRead({ ...COLLECTIONS, blog_posts: withProvenance }),
    clock: () => NOW,
  });
  const signed = await withEditorial.reconciliation();
  const movistar = signed.records.find((record) => record.slug === 'movistar-plus-vs-dazn')!;
  assert.equal(movistar.eligibilityGates.find((gate) => gate.gate === 'procedencia-pipeline')!.status, 'ok');
  assert.equal(movistar.workflowVersion, 'm11g-2');
  const signature = movistar.eligibilityGates.find((gate) => gate.gate === 'firma-procedencia')!;
  assert.equal(signature.status, 'unknown');
  assert.match(signature.detail, /clave de firma/i);
});
