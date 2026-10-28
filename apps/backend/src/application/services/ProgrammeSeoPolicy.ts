/**
 * M09-B: the SEO disposition of a `/programas/:slug` page (docs/roadmap/M09B-DELIVERY.md §6).
 *
 *   episode     an explicit episode airing ("Fallen T1 E3", "Episodio 812"): noindex, follow; never canonicalised to the
 *               series page, which is a different document
 *   work        the M10 verified work page (same TMDB identity, per-airing gate): canonical = that `/peliculas|/series` URL
 *   ambiguous   a TMDB id the M10 gate did not verify: kept as it is (self-canonical, indexable), no target is guessed
 *   thin        no TMDB identity and under 20 words of description: noindex, follow
 *   standalone  anything else: self-canonical, indexable
 *
 * Only `standalone` is a sitemap candidate. The canonical slug folds accents ("último" -> "ultimo"); the legacy slug
 * that dropped them still resolves and declares the folded one as canonical (no redirect: both serve the same row).
 *
 *   PROGRAMME_SEO_POLICY=off|canary|on        off (default) = pre-M09-B signals, except the folded canonical slug
 *   PROGRAMME_SEO_CANARY_PERCENT=1..100       canary cohort: a stable hash of the canonical slug
 */
import { createHash } from 'node:crypto';
import { episodeWorkTitle, slugify, slugifyTitle } from '@/domain/services/detailPath';

export type ProgrammeDisposition = 'episode' | 'work' | 'ambiguous' | 'thin' | 'standalone';
export interface ProgrammeSeo {
  disposition: ProgrammeDisposition;
  /** Whether the disposition is applied to this page (policy on, or the slug is in the canary cohort). */
  applied: boolean;
  canonicalPath: string;
  robots?: 'noindex, follow';
}

const WORK_PATH = /^\/(peliculas|series)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EPISODE_ONLY = /^episodio\s+\d+\b/i;
/** M11-A threshold: below it the synopsis cannot carry a search intent of its own (placeholders like "sin descripción."). */
export const MIN_DESCRIPTION_WORDS = 20;

/** The legacy accent-dropping slug of a title maps to its folded slug; any other resolvable slug is already canonical. */
export function programmeCanonicalSlug(requested: string, title: string): string {
  return requested === slugify(title) ? slugifyTitle(title) : requested;
}

/** `slug` is the canonical slug of the page: the work slug of an episode airing ("/programas/friends") is not an episode page. */
export function programmeDisposition(slug: string, p: { title: string; workPath?: string; tmdbId?: number; synopsis?: string }): ProgrammeDisposition {
  const work = episodeWorkTitle(p.title);
  if (EPISODE_ONLY.test(p.title.trim()) || (work && slug !== slugifyTitle(work))) return 'episode';
  if (p.workPath && WORK_PATH.test(p.workPath)) return 'work';
  if (p.tmdbId) return 'ambiguous';
  const words = (p.synopsis ?? '').trim().split(/\s+/).filter(Boolean).length;
  return words < MIN_DESCRIPTION_WORDS ? 'thin' : 'standalone';
}

/** Whether the policy applies to a canonical programme slug; an invalid canary percentage applies it nowhere. */
export function programmePolicyApplies(slug: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = env.PROGRAMME_SEO_POLICY;
  if (mode === 'on') return true;
  if (mode !== 'canary') return false;
  const percent = Number(env.PROGRAMME_SEO_CANARY_PERCENT);
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) return false;
  return createHash('sha256').update(slug).digest().readUInt16BE(0) % 100 < percent;
}

export function programmeSeo(
  requestedSlug: string,
  page: { title: string; workPath?: string; tmdbId?: number; synopsis?: string },
  env: NodeJS.ProcessEnv = process.env,
  /** false when the folded slug loads another title ("Último" vs "Ultimo"): the page keeps its own slug. */
  fold = true
): ProgrammeSeo {
  const slug = fold ? programmeCanonicalSlug(requestedSlug, page.title) : requestedSlug;
  const self = `/programas/${slug}`;
  const disposition = programmeDisposition(slug, page);
  const applied = programmePolicyApplies(slug, env);
  if (!applied) return { disposition, applied, canonicalPath: self };
  if (disposition === 'work') return { disposition, applied, canonicalPath: page.workPath! };
  if (disposition === 'episode' || disposition === 'thin') return { disposition, applied, canonicalPath: self, robots: 'noindex, follow' };
  return { disposition, applied, canonicalPath: self };
}
