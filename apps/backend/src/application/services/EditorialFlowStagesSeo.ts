/**
 * M14-R7 — Etapas de la dimensión SEO (indexación), separada de publicación.
 *
 * Fuente: `editorial_gsc_inspections`. El estado SEO se deriva del texto de
 * cobertura que devuelve Google Search Console; "no inspeccionada" nunca se
 * presenta como "no indexada".
 */

import { mergeFilters, periodFilter, type FlowQuery, type ScopeKey } from './EditorialFlowScope';
import { OFFLINE, measured, text, unavailable, type FunnelStage } from './EditorialFlowStageSupport';

const GSC_SUPPORT: readonly ScopeKey[] = ['from', 'to', 'state'];

interface GscStageDef {
  key: string;
  label: string;
  description: string;
  coverage: string;
}

const GSC_STAGE_DEFS: GscStageDef[] = [
  {
    key: 'seo.indexed',
    label: 'Indexadas',
    description: 'Google indexa la URL según la última inspección.',
    coverage: 'Página indexada',
  },
  {
    key: 'seo.discovered-not-indexed',
    label: 'Descubiertas sin indexar',
    description: 'Google conoce la URL pero aún no la indexa.',
    coverage: 'Descubierta: actualmente sin indexar',
  },
  {
    key: 'seo.crawled-not-indexed',
    label: 'Rastreadas sin indexar',
    description: 'Google rastreó la URL y decidió no indexarla.',
    coverage: 'Rastreada: actualmente sin indexar',
  },
  {
    key: 'seo.not-recognized',
    label: 'No reconocidas',
    description: 'Google no reconoce la URL. No implica que no esté publicada.',
    coverage: 'Google no reconoce esta URL',
  },
];

function gscStage(def: GscStageDef): FunnelStage {
  return {
    key: def.key,
    dimension: 'seo',
    label: def.label,
    description: def.description,
    scopeSupport: GSC_SUPPORT,
    async derive(port, scope) {
      if (!port.connected()) return unavailable(OFFLINE);
      const query: FlowQuery = {
        collection: 'editorial_gsc_inspections',
        filter: mergeFilters(
          { coverageState: def.coverage },
          scope.state ? { coverageState: scope.state } : null,
          periodFilter(scope, 'inspectedAt', 'date')
        ),
        projection: { url: 1, coverageState: 1, inspectedAt: 1 },
        note: 'Estado SEO derivado del texto de cobertura que devuelve Google Search Console.',
      };
      const docs = await port.find('editorial_gsc_inspections', query.filter, { projection: query.projection });
      return measured(docs.map((doc) => text(doc.url) || null), [query]);
    },
  };
}

function pendingInspectionStage(): FunnelStage {
  return {
    key: 'seo.pending-inspection',
    dimension: 'seo',
    label: 'Publicadas pendientes de inspección',
    description: 'URLs publicadas sin inspección registrada en Search Console: la indexación no consta.',
    scopeSupport: ['from', 'to', 'category'],
    async derive(port, scope) {
      if (!port.connected()) return unavailable(OFFLINE);
      const postsQuery: FlowQuery = {
        collection: 'blog_posts',
        filter: mergeFilters(
          { status: 'publish' },
          scope.category ? { 'categories.name': scope.category } : null,
          periodFilter(scope, 'publishedAt', 'date')
        ),
        projection: { slug: 1, publishedAt: 1 },
      };
      const inspectionsQuery: FlowQuery = {
        collection: 'editorial_gsc_inspections',
        filter: {},
        projection: { url: 1 },
        note: 'Se leen todas las URLs inspeccionadas para poder restarlas de las publicadas.',
      };
      const [posts, inspections] = await Promise.all([
        port.find('blog_posts', postsQuery.filter, { projection: postsQuery.projection }),
        port.find('editorial_gsc_inspections', inspectionsQuery.filter, { projection: inspectionsQuery.projection }),
      ]);
      const inspected = new Set(inspections.map((row) => text(row.url)).filter(Boolean));
      const pending = posts
        .map((post) => text(post.slug))
        .filter((slug) => slug && !inspected.has(`https://guiaprogramaciontv.com/guias/${slug}`));
      return measured(pending, [postsQuery, inspectionsQuery], [
        'Se deriva de dos consultas: artículos publicados menos las URLs con inspección registrada. No se inventa un estado de indexación que no consta.',
      ]);
    },
  };
}

export const SEO_STAGES: readonly FunnelStage[] = [...GSC_STAGE_DEFS.map(gscStage), pendingInspectionStage()];
