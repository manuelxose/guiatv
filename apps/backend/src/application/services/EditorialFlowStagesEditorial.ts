/**
 * M14-R7 — Etapas de la dimensión EDITORIAL.
 *
 * Fuente: `blog_posts` (status + reviewState), el único sitio donde consta el
 * proceso de redacción y revisión de un artículo. Un borrador aprobado NO está
 * publicado: esa distinción es explícita en cada etapa.
 */

import { equalsFilter, mergeFilters, periodFilter, type FlowQuery, type ScopeKey } from './EditorialFlowScope';
import { measured, text, unavailable, OFFLINE, type FunnelStage } from './EditorialFlowStageSupport';

const POSTS_SUPPORT: readonly ScopeKey[] = ['from', 'to', 'category', 'state', 'publicationStatus'];

interface PostStageDef {
  key: string;
  label: string;
  description: string;
  filter: Record<string, unknown>;
  stateFilter?: Record<string, unknown>;
  predicateText: string;
}

const POST_STAGE_DEFS: PostStageDef[] = [
  {
    key: 'editorial.drafting',
    label: 'En redacción',
    description: 'Borradores sin revisión: el artículo existe pero aún no pasó la revisión de calidad.',
    filter: { status: 'draft' },
    stateFilter: { $or: [{ reviewState: { $exists: false } }, { reviewState: 'unreviewed' }] },
    predicateText: 'status === "draft" && (reviewState ausente o "unreviewed")',
  },
  {
    key: 'editorial.reviewing',
    label: 'En revisión',
    description: 'Borradores en manos del crítico de calidad. En revisión no implica aprobado ni rechazado.',
    filter: { status: 'draft', reviewState: 'in-review' },
    predicateText: 'status === "draft" && reviewState === "in-review"',
  },
  {
    key: 'editorial.approved',
    label: 'Aprobados sin publicar',
    description: 'Aprobados editorialmente que siguen en borrador. Aprobado no implica publicado.',
    filter: { status: 'draft', reviewState: 'approved' },
    predicateText: 'status === "draft" && reviewState === "approved"',
  },
  {
    key: 'editorial.rejected',
    label: 'Rechazados editorialmente',
    description: 'Artículos que un revisor rechazó. Rechazado no equivale a fallo técnico.',
    filter: { reviewState: 'rejected' },
    predicateText: 'reviewState === "rejected"',
  },
];

function postStage(def: PostStageDef): FunnelStage {
  return {
    key: def.key,
    dimension: 'editorial',
    label: def.label,
    description: def.description,
    scopeSupport: POSTS_SUPPORT,
    async derive(port, scope) {
      if (!port.connected()) return unavailable(OFFLINE);
      const query: FlowQuery = {
        collection: 'blog_posts',
        filter: mergeFilters(
          def.filter,
          def.stateFilter ?? null,
          scope.state ? { reviewState: scope.state } : null,
          equalsFilter('status', scope.publicationStatus),
          scope.category ? { 'categories.name': scope.category } : null,
          periodFilter(scope, 'updatedAt', 'date')
        ),
        projection: { slug: 1, status: 1, reviewState: 1, updatedAt: 1 },
        note: 'El periodo se aplica sobre updatedAt (última modificación), el sello común a borradores y publicados.',
      };
      const docs = await port.find('blog_posts', query.filter, { projection: query.projection });
      return measured(
        docs.map((doc) => text(doc.slug) || null),
        [query],
        [`Predicado: ${def.predicateText}.`]
      );
    },
  };
}

export const EDITORIAL_STAGES: readonly FunnelStage[] = POST_STAGE_DEFS.map(postStage);
