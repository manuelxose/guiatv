/**
 * M09-C: the robots of a `/peliculas/:slug` or `/series/:slug` page, independent of whether the work airs today
 * (docs/roadmap/M09C-DELIVERY.md §6). Before M09-C a work page was indexable only while it had airings, so a page Google
 * had indexed went `noindex` the day its broadcast ended, and a feed gap did the same to every work at once.
 *
 *   ambiguous   no local catalogue row of this kind answers to the slug with this TMDB id, or another one answers to it
 *               with a different id (a namesake): the identity is not proven, the page stays `noindex, follow`
 *   variant     the requested slug is not the folded slug of the title (legacy accent-dropping form): `noindex, follow`
 *   thin        identity proven, content below the Phase 3B thresholds (QUALITY_THRESHOLDS), no current broadcast:
 *               `noindex, follow` until the content improves
 *   airing      identity proven, content below the thresholds, but the page lists current broadcasts (first-party
 *               value, Phase 3B `original_value`): `index, follow` while they last, never in the sitemap
 *   indexable   identity and content pass: `index, follow`, with or without a current broadcast
 *
 * The rows are the ones the page's own local lookup reads (`normalizedTitle` = the slug key), read so that a database
 * failure throws (the page answers 503, never a cacheable `noindex`). The sitemap lists an indexable work only when
 * GuíaTV has recorded at least one broadcast of it: a first-party fact that does not expire when the broadcast ends.
 *
 *   WORK_SEO_POLICY=off|canary|on        off (default) = pre-M09-C: indexable only while airings exist
 *   WORK_SEO_CANARY_PERCENT=1..100       canary cohort: a stable hash of the slug
 */
import { MediaCatalogModel } from '@/infrastructure/database/models/MediaCatalogEntry.model';
import { TVReadAiringModel } from '@/infrastructure/database/models/TVReadAiring.model';
import { buildDetailPath, slugify, slugifyTitle } from '@/domain/services/detailPath';
import { cohortApplies } from './ProgrammeSeoPolicy';
import { QUALITY_THRESHOLDS } from './PublicationQuality';
import { slugLookupKey } from './VerifiedWorkLinks';

export type WorkDisposition = 'indexable' | 'airing' | 'thin' | 'ambiguous' | 'variant';
export interface WorkSeo {
  disposition: WorkDisposition;
  applied: true;
  canonicalPath: string;
  robots?: 'noindex, follow';
}

/** The catalogue fields the decision reads (a lean `media_catalog` document). */
export interface WorkRow {
  tmdbId?: number | null;
  tmdbType?: 'movie' | 'tv' | null;
  title?: string | null;
  normalizedTitle?: string | null;
  synopsis?: string | null;
  year?: string | null;
  runtimeMinutes?: number | null;
  posterPath?: string | null;
  tmdbGenres?: unknown[] | null;
  castSummary?: unknown[] | null;
  directors?: string[] | null;
  lastEnrichedAt?: Date | null;
}

const ROW_FIELDS = 'tmdbId tmdbType title normalizedTitle synopsis year runtimeMinutes posterPath tmdbGenres castSummary directors lastEnrichedAt';
const KIND = { movie: 'movie', series: 'tv' } as const;

export function workPolicyApplies(slug: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return cohortApplies(slug, env.WORK_SEO_POLICY, env.WORK_SEO_CANARY_PERCENT);
}

/**
 * Content a work page needs before it is worth indexing: a full TMDB detail fetch (`lastEnrichedAt`; a lightweight
 * EPG/search row has no credits), the Phase 3B synopsis length, genres, a poster, credits, and for a film its year and
 * runtime (a film without a year cannot be told from its remake). No field is inferred.
 */
export function workContentPasses(r: WorkRow, kind: 'movie' | 'tv'): boolean {
  return Boolean(r.lastEnrichedAt)
    && (r.synopsis ?? '').trim().length >= QUALITY_THRESHOLDS.synopsisMinChars
    && (r.tmdbGenres?.length ?? 0) > 0
    && Boolean(r.posterPath)
    && ((r.directors?.length ?? 0) > 0 || (r.castSummary?.length ?? 0) >= 3)
    && (kind === 'tv' || (Boolean(r.year) && (r.runtimeMinutes ?? 0) > 0));
}

/** `rows`: the catalogue rows of the slug key. Same slug match as `CatalogService.findLocalSlugMatch` and M10's `workSlugResolves`. */
export function workDisposition(slug: string, tmdbId: number, kind: 'movie' | 'tv', rows: readonly WorkRow[], hasAirings = false): WorkDisposition {
  const hits = rows.filter((r) => r.tmdbType === kind && typeof r.tmdbId === 'number'
    && (slugify(r.title ?? '') === slug || slugifyTitle(r.title ?? '') === slug));
  const own = hits.find((r) => r.tmdbId === tmdbId);
  if (!own || hits.some((r) => r.tmdbId !== tmdbId)) return 'ambiguous';
  if (slugifyTitle(own.title ?? '') !== slug) return 'variant';
  if (workContentPasses(own, kind)) return 'indexable';
  return hasAirings ? 'airing' : 'thin';
}

export function workSeo(contentType: 'movie' | 'series', slug: string, tmdbId: number, rows: readonly WorkRow[], hasAirings = false): WorkSeo {
  const disposition = workDisposition(slug, tmdbId, KIND[contentType], rows, hasAirings);
  const canonicalPath = buildDetailPath(contentType, slug);
  return disposition === 'indexable' || disposition === 'airing'
    ? { disposition, applied: true, canonicalPath }
    : { disposition, applied: true, canonicalPath, robots: 'noindex, follow' };
}

/** The rows the page's local lookup reads for `slug`. Throws on a database failure. */
export async function readWorkRows(slug: string): Promise<WorkRow[]> {
  return MediaCatalogModel.find({ normalizedTitle: slugLookupKey(slug) }).select(ROW_FIELDS).lean<WorkRow[]>().exec();
}

/**
 * Sitemap work paths: indexable (same rule and rows as the page), inside the policy cohort, and broadcast at least once
 * on a channel GuíaTV tracks (`tv_read_airings` keeps the history). Throws on a database failure.
 */
export async function indexableWorkPaths(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  if (!['on', 'canary'].includes(env.WORK_SEO_POLICY ?? '')) return [];
  const [rows, aired] = await Promise.all([
    MediaCatalogModel.find({ tmdbId: { $type: 'number' } }).select(ROW_FIELDS).lean<WorkRow[]>().exec(),
    TVReadAiringModel.aggregate<{ _id: { id: number; c: string } }>([
      { $match: { 'program.tmdbId': { $type: 'number' }, 'program.editorialCategory': { $in: ['Cine', 'Series'] } } },
      { $group: { _id: { id: '$program.tmdbId', c: '$program.editorialCategory' } } },
    ]).allowDiskUse(true).exec(),
  ]);
  const airedKeys = new Set(aired.map((a) => `${a._id.c === 'Cine' ? 'movie' : 'tv'}:${a._id.id}`));
  const byKey = new Map<string, WorkRow[]>();
  for (const r of rows) (byKey.get(r.normalizedTitle ?? '') ?? byKey.set(r.normalizedTitle ?? '', []).get(r.normalizedTitle ?? '')!).push(r);
  const paths = new Set<string>();
  for (const r of rows) {
    const kind = r.tmdbType;
    if ((kind !== 'movie' && kind !== 'tv') || !airedKeys.has(`${kind}:${r.tmdbId}`)) continue;
    const slug = slugifyTitle(r.title ?? '');
    if (slug === 'sin-titulo' || !workPolicyApplies(slug, env)) continue;
    if (workDisposition(slug, r.tmdbId as number, kind, byKey.get(slugLookupKey(slug)) ?? []) !== 'indexable') continue;
    paths.add(buildDetailPath(kind === 'movie' ? 'movie' : 'series', slug));
  }
  return [...paths].sort();
}
