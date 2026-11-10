/**
 * M03-L1: pure, side-effect-free decision "may this EPG programme be linked to an existing catalogue row?".
 * Same rules as the M02-C measurement (docs/roadmap/IDENTITY-LINKING-DESIGN.md): TMDB id + content type + exactly one valid
 * row + title key equal to the row's title/original-title key + no other title sharing the TMDB id. Similarity is never
 * evidence, an existing `mediaId` is never replaced, and a derived link is weaker than a sync-time link.
 */
import { titleIdentityKey } from './contentIdentity';

export const LINK_RULE = { rule: 'tmdb-type-titlekey-unique', version: 1 } as const;

export type LinkDecisionKind = 'LINKABLE' | 'ALREADY_LINKED' | 'REJECTED' | 'AMBIGUOUS';

export const LINK_REASONS = [
  'strict_match',
  'existing_media_id_valid',
  'missing_tmdb_id',
  'missing_catalogue_row',
  'invalid_catalogue_row',
  'invalid_title_key',
  'wrong_content_type',
  'title_key_mismatch',
  'conflicting_media_id',
  'cross_type_media_id',
  'tmdb_id_shared_by_other_titles',
  'duplicate_candidates',
  'ambiguous_content_type',
] as const;
export type LinkReason = (typeof LINK_REASONS)[number];

export interface LinkProgram {
  title?: string | null;
  tmdbId?: number | null;
  mediaId?: string | null;
  editorialCategory?: string | null;
}

export interface LinkRow {
  id: string;
  tmdbId?: number | null;
  tmdbType?: 'movie' | 'tv' | null;
  title?: string | null;
  originalTitle?: string | null;
  normalizedTitle?: string | null;
  /** TMDB backdrop path of the work: the rectangular art 16:9 cards need. */
  backdropPath?: string | null;
}

export interface LinkContext {
  rowsByTmdbId: ReadonlyMap<number, readonly LinkRow[]>;
  /** Distinct title keys of the programmes in the evaluated batch that carry each TMDB id. */
  titleKeysByTmdbId: ReadonlyMap<number, ReadonlySet<string>>;
}

export interface LinkDecision {
  decision: LinkDecisionKind;
  reason: LinkReason;
  evidence: {
    rule: typeof LINK_RULE.rule;
    version: typeof LINK_RULE.version;
    tmdbId?: number;
    tmdbType?: 'movie' | 'tv';
    mediaId?: string;
    titleKey?: string;
    candidateCount?: number;
  };
}

const isTmdbId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isValidRow = (r: LinkRow) => Boolean(r.title?.trim() && r.normalizedTitle?.trim() && (r.tmdbType === 'movie' || r.tmdbType === 'tv'));

function expectedType(category: string | null | undefined): 'movie' | 'tv' | null {
  return category === 'Cine' ? 'movie' : category === 'Series' ? 'tv' : null;
}

export function buildLinkContext(programs: readonly LinkProgram[], rows: readonly LinkRow[]): LinkContext {
  const rowsByTmdbId = new Map<number, LinkRow[]>();
  for (const row of rows) {
    if (!isTmdbId(row.tmdbId)) continue;
    const list = rowsByTmdbId.get(row.tmdbId);
    if (list) list.push(row);
    else rowsByTmdbId.set(row.tmdbId, [row]);
  }
  const titleKeysByTmdbId = new Map<number, Set<string>>();
  for (const p of programs) {
    if (!isTmdbId(p.tmdbId)) continue;
    const keys = titleKeysByTmdbId.get(p.tmdbId) ?? new Set<string>();
    keys.add(titleIdentityKey(p.title) ?? '∅');
    titleKeysByTmdbId.set(p.tmdbId, keys);
  }
  return { rowsByTmdbId, titleKeysByTmdbId };
}

export function linkCatalogueRow(program: LinkProgram, ctx: LinkContext): LinkDecision {
  const make = (decision: LinkDecisionKind, reason: LinkReason, extra: Partial<LinkDecision['evidence']> = {}): LinkDecision => ({
    decision,
    reason,
    evidence: { ...LINK_RULE, ...extra },
  });
  const tmdbId = program.tmdbId;
  if (!isTmdbId(tmdbId)) return make('REJECTED', 'missing_tmdb_id');

  const candidates = ctx.rowsByTmdbId.get(tmdbId) ?? [];
  const mediaId = program.mediaId ? String(program.mediaId) : undefined;
  const want = expectedType(program.editorialCategory);
  if (mediaId) {
    // M03-L2: a present id is not proof; its row must carry this TMDB id and, when the category names one, the same kind.
    const row = candidates.find((c) => c.id === mediaId);
    if (!row || !isValidRow(row)) return make('REJECTED', 'conflicting_media_id', { tmdbId, mediaId });
    if (want && row.tmdbType !== want) return make('REJECTED', 'cross_type_media_id', { tmdbId, mediaId, tmdbType: row.tmdbType! });
    return make('ALREADY_LINKED', 'existing_media_id_valid', { tmdbId, mediaId, tmdbType: row.tmdbType! });
  }

  const titleKey = titleIdentityKey(program.title);
  if (!titleKey) return make('REJECTED', 'invalid_title_key', { tmdbId });
  const base = { tmdbId, titleKey, candidateCount: candidates.length };
  if (!candidates.length) return make('REJECTED', 'missing_catalogue_row', base);

  const valid = candidates.filter(isValidRow);
  const pool = want ? valid.filter((c) => c.tmdbType === want) : valid;
  if (!pool.length) {
    return make('REJECTED', valid.length < candidates.length ? 'invalid_catalogue_row' : 'wrong_content_type', base);
  }
  if (pool.length > 1) return make('AMBIGUOUS', 'duplicate_candidates', base);
  if (!want && new Set(candidates.map((c) => c.tmdbType)).size > 1) return make('AMBIGUOUS', 'ambiguous_content_type', base);

  const row = pool[0];
  const rowKeys = [titleIdentityKey(row.title), titleIdentityKey(row.originalTitle)];
  if (!rowKeys.includes(titleKey)) return make('REJECTED', 'title_key_mismatch', base);
  if ((ctx.titleKeysByTmdbId.get(tmdbId)?.size ?? 0) > 1) return make('REJECTED', 'tmdb_id_shared_by_other_titles', base);
  return make('LINKABLE', 'strict_match', { ...base, ...(row.tmdbType ? { tmdbType: row.tmdbType } : {}), mediaId: row.id });
}
