/**
 * M14-R7 — Etapas de la dimensión PUBLICACIÓN.
 *
 * Fuentes: `blog_posts` (status) y `editorial_policy_approvals` (libro append-only
 * del que se derivan los intentos de publicación registrados). Publicado no
 * implica indexado, y aprobado no implica publicado.
 */

import { mergeFilters, periodFilter, type FlowQuery, type ScopeKey } from './EditorialFlowScope';
import { OFFLINE, measured, staticUnavailable, text, unavailable, type FunnelStage } from './EditorialFlowStageSupport';

const POSTS_SUPPORT: readonly ScopeKey[] = ['from', 'to', 'category', 'state', 'publicationStatus'];

function publishedStage(): FunnelStage {
  return {
    key: 'publication.published',
    dimension: 'publication',
    label: 'Publicados',
    description: 'Artículos con status "publish" en el sitio público. Publicado no implica indexado.',
    scopeSupport: POSTS_SUPPORT,
    async derive(port, scope) {
      if (!port.connected()) return unavailable(OFFLINE);
      if (scope.publicationStatus === 'draft') {
        return unavailable(
          'La etapa «publicados» no puede acotarse al estado de publicación "draft": el filtro se contradice con la propia etapa.'
        );
      }
      const query: FlowQuery = {
        collection: 'blog_posts',
        filter: mergeFilters(
          { status: 'publish' },
          scope.state ? { reviewState: scope.state } : null,
          scope.category ? { 'categories.name': scope.category } : null,
          periodFilter(scope, 'publishedAt', 'date')
        ),
        projection: { slug: 1, status: 1, reviewState: 1, publishedAt: 1 },
        note: 'El periodo se aplica sobre publishedAt.',
      };
      const docs = await port.find('blog_posts', query.filter, { projection: query.projection });
      return measured(docs.map((doc) => text(doc.slug) || null), [query]);
    },
  };
}

function unpublishedStage(): FunnelStage {
  return {
    key: 'publication.unpublished',
    dimension: 'publication',
    label: 'No publicados',
    description: 'Borradores que no están en el sitio público, estén aprobados o no.',
    scopeSupport: POSTS_SUPPORT,
    async derive(port, scope) {
      if (!port.connected()) return unavailable(OFFLINE);
      if (scope.publicationStatus === 'publish') {
        return unavailable(
          'La etapa «no publicados» no puede acotarse al estado de publicación "publish": el filtro se contradice con la propia etapa.'
        );
      }
      const query: FlowQuery = {
        collection: 'blog_posts',
        filter: mergeFilters(
          { status: 'draft' },
          scope.state ? { reviewState: scope.state } : null,
          scope.category ? { 'categories.name': scope.category } : null,
          periodFilter(scope, 'updatedAt', 'date')
        ),
        projection: { slug: 1, status: 1, reviewState: 1, updatedAt: 1 },
      };
      const docs = await port.find('blog_posts', query.filter, { projection: query.projection });
      return measured(docs.map((doc) => text(doc.slug) || null), [query]);
    },
  };
}

function attemptsStage(): FunnelStage {
  return {
    key: 'publication.attempts',
    dimension: 'publication',
    label: 'Intentos de publicación registrados',
    description: 'Aprobaciones de publicación anotadas en el libro append-only editorial_policy_approvals.',
    scopeSupport: ['from', 'to'],
    async derive(port, scope) {
      if (!port.connected()) return unavailable(OFFLINE);
      const query: FlowQuery = {
        collection: 'editorial_policy_approvals',
        filter: mergeFilters(periodFilter(scope, 'at', 'date')),
        projection: { postId: 1, at: 1 },
        note: 'Una fila por artículo y borrador publicado; es el único registro real de intentos de publicación.',
      };
      const docs = await port.find('editorial_policy_approvals', query.filter, { projection: query.projection });
      return measured(
        docs.map((doc) => (doc.postId ? String(doc.postId) : null)),
        [query],
        ['Cada fila se identifica por el identificador del artículo publicado, no por el slug.']
      );
    },
  };
}

export const PUBLICATION_STAGES: readonly FunnelStage[] = [
  publishedStage(),
  unpublishedStage(),
  attemptsStage(),
  staticUnavailable(
    'publication.failed',
    'publication',
    'Publicaciones fallidas',
    'Intentos de publicación que terminaron en error.',
    'El sistema no registra un evento de publicación fallida: cuando la publicación falla, el artículo permanece en borrador y el error solo consta en la ejecución (editorial_jobs). No se devuelve 0 en su lugar.'
  ),
];
