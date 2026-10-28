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
 *   indexable   identity and content pass: `index, follow`, with or without a current broadcast. M09-D: a complete
 *               record whose synopsis is only short (Phase 3B `synopsisThinChars`..`synopsisMinChars`) also passes when
 *               GuíaTV has recorded a broadcast of the work, at any date, so it stays indexed after the broadcast ends
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

// Only the first three cast members matter (`workContentPasses`): the sitemap build reads every row.
const ROW_FIELDS = { tmdbId: 1, tmdbType: 1, title: 1, normalizedTitle: 1, synopsis: 1, year: 1, runtimeMinutes: 1, posterPath: 1, tmdbGenres: 1, castSummary: { $slice: 3 }, directors: 1, lastEnrichedAt: 1 };
const KIND = { movie: 'movie', series: 'tv' } as const;

export function workPolicyApplies(slug: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return cohortApplies(slug, env.WORK_SEO_POLICY, env.WORK_SEO_CANARY_PERCENT);
}

/**
 * Content a work page needs before it is worth indexing: a full TMDB detail fetch (`lastEnrichedAt`; a lightweight
 * EPG/search row has no credits), the Phase 3B synopsis length, genres, a poster, credits, and for a film its year and
 * runtime (a film without a year cannot be told from its remake). No field is inferred.
 */
export function workContentPasses(r: WorkRow, kind: 'movie' | 'tv', synopsisMinChars: number = QUALITY_THRESHOLDS.synopsisMinChars): boolean {
  return Boolean(r.lastEnrichedAt)
    && (r.synopsis ?? '').trim().length >= synopsisMinChars
    && (r.tmdbGenres?.length ?? 0) > 0
    && Boolean(r.posterPath)
    && ((r.directors?.length ?? 0) > 0 || (r.castSummary?.length ?? 0) >= 3)
    && (kind === 'tv' || (Boolean(r.year) && (r.runtimeMinutes ?? 0) > 0));
}

/**
 * `rows`: the catalogue rows of the slug key. Same slug match as `CatalogService.findLocalSlugMatch` and M10's `workSlugResolves`.
 * `hasAirings`: the page lists current broadcasts. `everAired`: GuíaTV has recorded a broadcast of this work (`tv_read_airings`).
 */
export function workDisposition(slug: string, tmdbId: number, kind: 'movie' | 'tv', rows: readonly WorkRow[], hasAirings = false, everAired = false): WorkDisposition {
  const hits = rows.filter((r) => r.tmdbType === kind && typeof r.tmdbId === 'number'
    && (slugify(r.title ?? '') === slug || slugifyTitle(r.title ?? '') === slug));
  const own = hits.find((r) => r.tmdbId === tmdbId);
  if (!own || hits.some((r) => r.tmdbId !== tmdbId)) return 'ambiguous';
  if (slugifyTitle(own.title ?? '') !== slug) return 'variant';
  if (workContentPasses(own, kind) || (everAired && shortTierPasses(own, kind))) return 'indexable';
  return hasAirings ? 'airing' : 'thin';
}

/** M09-D: complete except for a synopsis between Phase 3B's thin line and its substantial line. */
function shortTierPasses(r: WorkRow, kind: 'movie' | 'tv'): boolean {
  return workContentPasses(r, kind, QUALITY_THRESHOLDS.synopsisThinChars);
}

export function workSeo(contentType: 'movie' | 'series', slug: string, tmdbId: number, rows: readonly WorkRow[], hasAirings = false, everAired = false): WorkSeo {
  const disposition = workDisposition(slug, tmdbId, KIND[contentType], rows, hasAirings, everAired);
  const canonicalPath = buildDetailPath(contentType, slug);
  return disposition === 'indexable' || disposition === 'airing'
    ? { disposition, applied: true, canonicalPath }
    : { disposition, applied: true, canonicalPath, robots: 'noindex, follow' };
}

/** The rows the page's local lookup reads for `slug`. Throws on a database failure. */
export async function readWorkRows(slug: string): Promise<WorkRow[]> {
  return MediaCatalogModel.find({ normalizedTitle: slugLookupKey(slug) }).select(ROW_FIELDS).lean<WorkRow[]>().exec();
}

const CATEGORY = { movie: 'Cine', tv: 'Series' } as const;

/**
 * The page's verdict on its own rows; the broadcast record is read only when the short-synopsis tier could decide it.
 * Same answer as `indexableWorkPaths` for a work in the sitemap. Throws on a database failure.
 */
export async function readWorkSeo(contentType: 'movie' | 'series', slug: string, tmdbId: number, hasAirings = false): Promise<WorkSeo> {
  const rows = await readWorkRows(slug);
  const kind = KIND[contentType];
  const own = rows.find((r) => r.tmdbId === tmdbId && r.tmdbType === kind);
  const everAired = Boolean(own && !workContentPasses(own, kind) && shortTierPasses(own, kind)
    && await TVReadAiringModel.exists({ 'program.tmdbId': tmdbId, 'program.editorialCategory': CATEGORY[kind] }).exec());
  return workSeo(contentType, slug, tmdbId, rows, hasAirings, everAired);
}

/** M10-B: an indexable work of the sitemap set, with what a related-works card needs. */
export interface IndexableWork {
  kind: 'movie' | 'tv';
  tmdbId: number;
  path: string;
  title: string;
  genreIds: number[];
  posterPath?: string;
  year?: string;
  rating?: number;
}

/**
 * Sitemap work paths: indexable (same rule and rows as the page), inside the policy cohort, and broadcast at least once
 * on a channel GuíaTV tracks (`tv_read_airings` keeps the history). Throws on a database failure.
 */
export async function indexableWorkPaths(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  return (await indexableWorks(env)).map((w) => w.path);
}

/** The works behind `indexableWorkPaths`, one per path, sorted by path. Throws on a database failure. */
export async function indexableWorks(env: NodeJS.ProcessEnv = process.env): Promise<IndexableWork[]> {
  if (!['on', 'canary'].includes(env.WORK_SEO_POLICY ?? '')) return [];
  const [rows, aired] = await Promise.all([
    MediaCatalogModel.find({ tmdbId: { $type: 'number' } }).select({ ...ROW_FIELDS, rating: 1 }).lean<Array<WorkRow & { rating?: number }>>().exec(),
    TVReadAiringModel.aggregate<{ _id: { id: number; c: string } }>([
      { $match: { 'program.tmdbId': { $type: 'number' }, 'program.editorialCategory': { $in: Object.values(CATEGORY) } } },
      { $group: { _id: { id: '$program.tmdbId', c: '$program.editorialCategory' } } },
    ]).allowDiskUse(true).exec(),
  ]);
  const airedKeys = new Set(aired.map((a) => `${a._id.c === 'Cine' ? 'movie' : 'tv'}:${a._id.id}`));
  const byKey = new Map<string, WorkRow[]>();
  for (const r of rows) (byKey.get(r.normalizedTitle ?? '') ?? byKey.set(r.normalizedTitle ?? '', []).get(r.normalizedTitle ?? '')!).push(r);
  const works = new Map<string, IndexableWork>();
  for (const r of rows) {
    const kind = r.tmdbType;
    if ((kind !== 'movie' && kind !== 'tv') || !airedKeys.has(`${kind}:${r.tmdbId}`)) continue;
    const slug = slugifyTitle(r.title ?? '');
    if (slug === 'sin-titulo' || !workPolicyApplies(slug, env)) continue;
    if (workDisposition(slug, r.tmdbId as number, kind, byKey.get(slugLookupKey(slug)) ?? [], false, true) !== 'indexable') continue;
    const path = buildDetailPath(kind === 'movie' ? 'movie' : 'series', slug);
    if (works.has(path)) continue;
    works.set(path, {
      kind, tmdbId: r.tmdbId as number, path, title: r.title ?? '',
      genreIds: (r.tmdbGenres ?? []).map((g) => (g as { id?: unknown }).id).filter((id): id is number => typeof id === 'number'),
      posterPath: r.posterPath ?? undefined, year: r.year ?? undefined, rating: typeof r.rating === 'number' ? r.rating : undefined,
    });
  }
  return [...works.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
