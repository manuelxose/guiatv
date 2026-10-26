/**
 * M10: the work page (`/peliculas/:slug`, `/series/:slug`) a built airing may link to, set as `program.workPath` only
 * when every identity check passes. Anything short of proof leaves the field absent and the card keeps its airing route
 * (`detailPath`). Read-only, batched, never written to stored programmes; a read failure assigns nothing (fail closed).
 *
 * An airing is linked when: it is Cine or Series; it carries a `mediaId` the M03 linker accepts as already linked (row
 * exists, is valid, has this TMDB id and the category's kind); its title key equals the row's title or original-title
 * key; no other title in the build shares the TMDB id; and the work slug resolves, through the same local lookup the
 * detail page runs first, to this TMDB id and no other. A derived (linker-only) match never produces a link.
 *
 * shortcut: the proof holds for the catalogue as read at build time; a namesake row added (or a row retitled) later can
 * change what the slug resolves to until the date is rebuilt (precompute runs every 6 h). Upgrade by making the page's
 * local lookup refuse ambiguity if that window is ever observed to matter.
 */
import { MongoMediaCatalogRepository } from '@/infrastructure/repositories/MongoMediaCatalogRepository';
import { buildLinkContext, linkCatalogueRow, LinkContext, LinkProgram, LinkRow } from '@/domain/services/catalogueLinker';
import { titleIdentityKey } from '@/domain/services/contentIdentity';
import { buildDetailPath, slugify, slugifyTitle } from '@/domain/services/detailPath';
import { normalizeTvToken } from '@/shared/utils/tvMetadata';
import { logger } from '@/shared/utils/logger';
import { CatalogueRowReader, readCatalogueRows, readCatalogueRowsFor } from './CatalogueLinkShadow';

const log = logger.child('VerifiedWorkLinks');
const SLUG_BATCH = 500;

export type WorkLinkProgram = LinkProgram & { workPath?: string };
export type WorkLinkReason =
  | 'linked'
  | 'not_cine_or_series'
  | 'no_media_id'
  | 'media_id_rejected'
  | 'title_key_mismatch'
  | 'tmdb_id_shared_by_other_titles'
  | 'slug_unresolved'
  | 'slug_ambiguous';

export interface SlugRow {
  tmdbId?: number | null;
  tmdbType?: 'movie' | 'tv' | null;
  title?: string | null;
}
/** Catalogue rows whose `normalizedTitle` is one of `keys` (what `MediaCatalogService.findKnownMatchesForTitles` reads). */
export type SlugRowReader = (keys: string[]) => Promise<Array<SlugRow & { normalizedTitle?: string | null }>>;

// The page reads through this repository, whose `toEntities` drops invalid rows: read the same way so the build sees
// exactly the candidates the page will. A read failure returns [] there, i.e. `slug_unresolved` (no link).
const catalogue = new MongoMediaCatalogRepository();
export const readSlugRows: SlugRowReader = async (keys) =>
  (await catalogue.findByNormalizedTitles(keys)).map((e) => ({ tmdbId: e.tmdbId, tmdbType: e.tmdbType, title: e.title, normalizedTitle: e.normalizedTitle }));

/** The key `CatalogService.getBySlug` derives from a slug before its local lookup. */
export const slugLookupKey = (slug: string) => normalizeTvToken(slug.replace(/-/g, ' '), ' ');

const KIND: Record<string, 'movie' | 'tv'> = { Cine: 'movie', Series: 'tv' };

type Pending = { workSlug: string; tmdbId: number; tmdbType: 'movie' | 'tv' };

/** Identity half of the decision (no slug check yet). */
export function workLinkIdentity(program: WorkLinkProgram, ctx: LinkContext): { reason: WorkLinkReason; pending?: Pending } {
  const want = KIND[program.editorialCategory ?? ''];
  if (!want) return { reason: 'not_cine_or_series' };
  if (!program.mediaId) return { reason: 'no_media_id' };
  const decision = linkCatalogueRow(program, ctx);
  if (decision.decision !== 'ALREADY_LINKED') return { reason: 'media_id_rejected' };
  const tmdbId = program.tmdbId as number;
  const row = (ctx.rowsByTmdbId.get(tmdbId) ?? []).find((r) => r.id === String(program.mediaId)) as LinkRow;
  const key = titleIdentityKey(program.title);
  if (!key || ![titleIdentityKey(row.title), titleIdentityKey(row.originalTitle)].includes(key)) return { reason: 'title_key_mismatch' };
  if ((ctx.titleKeysByTmdbId.get(tmdbId)?.size ?? 0) > 1) return { reason: 'tmdb_id_shared_by_other_titles' };
  const workSlug = slugifyTitle(row.title ?? '');
  if (workSlug === 'sin-titulo') return { reason: 'slug_unresolved' };
  return { reason: 'linked', pending: { workSlug, tmdbId, tmdbType: want } };
}

/** Slug half: every local row the detail page could pick for this slug must be this TMDB work. */
export function workSlugResolves(p: Pending, rows: readonly SlugRow[]): WorkLinkReason {
  const hits = rows.filter((r) => r.tmdbType === p.tmdbType && typeof r.tmdbId === 'number'
    && (slugify(r.title ?? '') === p.workSlug || slugifyTitle(r.title ?? '') === p.workSlug));
  if (!hits.length) return 'slug_unresolved';
  return hits.every((r) => r.tmdbId === p.tmdbId) ? 'linked' : 'slug_ambiguous';
}

export type WorkLinkCounts = Record<WorkLinkReason, number> & { errors: number };

/** Sets `workPath` on the programmes that pass, clears any other; returns counts per reason. Never throws. */
export async function assignVerifiedWorkPaths(
  programs: WorkLinkProgram[],
  options: { reader?: CatalogueRowReader; slugReader?: SlugRowReader } = {}
): Promise<WorkLinkCounts> {
  const counts = Object.fromEntries(
    ['linked', 'not_cine_or_series', 'no_media_id', 'media_id_rejected', 'title_key_mismatch', 'tmdb_id_shared_by_other_titles', 'slug_unresolved', 'slug_ambiguous', 'errors'].map((k) => [k, 0])
  ) as WorkLinkCounts;
  for (const p of programs) delete p.workPath;
  const typed = programs.filter((p) => KIND[p.editorialCategory ?? ''] && p.mediaId);
  counts.not_cine_or_series = programs.filter((p) => !KIND[p.editorialCategory ?? '']).length;
  counts.no_media_id = programs.filter((p) => KIND[p.editorialCategory ?? ''] && !p.mediaId).length;
  if (!typed.length) return counts;
  try {
    const rows = await readCatalogueRowsFor(typed.map((p) => p.tmdbId).filter((v): v is number => Number.isInteger(v) && (v as number) > 0), options.reader ?? readCatalogueRows);
    // Shared-id check over the whole build, not only the linked subset (same scope as the M03 measurement).
    const ctx = buildLinkContext(programs, rows);
    const pending = new Map<WorkLinkProgram, Pending>();
    for (const p of typed) {
      const r = workLinkIdentity(p, ctx);
      if (r.pending) pending.set(p, r.pending);
      else counts[r.reason] += 1;
    }
    const keys = [...new Set([...pending.values()].map((x) => slugLookupKey(x.workSlug)).filter(Boolean))];
    const byKey = new Map<string, SlugRow[]>();
    for (let i = 0; i < keys.length; i += SLUG_BATCH) {
      for (const row of await (options.slugReader ?? readSlugRows)(keys.slice(i, i + SLUG_BATCH))) {
        const k = String(row.normalizedTitle ?? '');
        (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(row);
      }
    }
    for (const [p, x] of pending) {
      const reason = workSlugResolves(x, byKey.get(slugLookupKey(x.workSlug)) ?? []);
      counts[reason] += 1;
      if (reason === 'linked') p.workPath = buildDetailPath(x.tmdbType === 'movie' ? 'movie' : 'series', x.workSlug);
    }
  } catch (error) {
    counts.errors += 1;
    for (const p of programs) delete p.workPath;
    log.warn('Verified work links could not read the catalogue; no work links assigned', { error: (error as Error).message });
  }
  log.info('Verified work links', counts);
  return counts;
}
