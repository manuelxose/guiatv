export interface CatalogIndexabilityInput {
  source?: 'program' | 'tmdb';
  contentType?: 'movie' | 'series' | 'program';
  airings?: unknown[];
  seo?: { robots?: string; applied?: boolean };
}

const INDEXABLE = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';

/**
 * Provider metadata alone is not indexable inventory. M09-C: when the API applied its work policy (`seo.applied`), its
 * identity and content verdict decides, whether or not the work airs today; otherwise the pre-M09-C airing rule stays.
 */
export function catalogRobotsPolicy(item: CatalogIndexabilityInput): string {
  if (item.source === 'program' || item.contentType === 'program') return INDEXABLE;
  if (item.seo?.applied) return item.seo.robots === 'noindex, follow' ? 'noindex, follow' : INDEXABLE;
  return Array.isArray(item.airings) && item.airings.length > 0 ? INDEXABLE : 'noindex, follow';
}
