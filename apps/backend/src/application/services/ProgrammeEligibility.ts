/**
 * M10-E: the one computation of which `/programas/:slug` pages are indexable — the population of sitemap-programs.xml
 * and the only programme pages the channel schedule links (docs/roadmap/M10E-DELIVERY.md §4). Moved here unchanged from
 * SitemapController (candidates of today and tomorrow, the page's own lookup, `standalone` where the M09-B policy applies).
 *
 * A snapshot answers for one Europe/Madrid day (process TZ) until the first of: its TTL, the next midnight, or an
 * invalidation (a read-model rebuild, through invalidateSitemapCache). Both readers see the same snapshot object, so
 * the sitemap never lists a slug the channel pages do not link from that snapshot, nor the reverse.
 */
import { slugifyTitle } from '@/domain/services/detailPath';
import { DateUtils } from '@/shared/utils/dateUtils';
import { logger } from '@/shared/utils/logger';
import { programmePolicyApplies, type ProgrammeDisposition } from './ProgrammeSeoPolicy';
import type { TvReadQueryService } from './TvReadQueryService';

export interface ProgrammeEligibilityEntry {
  /** The title the page loads: a link is only drawn from an airing with this exact title (M10-B rule). */
  title: string;
  /** Newest change among the slug's candidate airings (ms); -Infinity when unknown. */
  lastChanged: number;
}

export interface ProgrammeEligibilitySnapshot {
  /** The Madrid days the candidates were read from: today, tomorrow. */
  dates: [string, string];
  entries: ReadonlyMap<string, ProgrammeEligibilityEntry>;
  builtAt: number;
  validUntil: number;
}

export type ProgrammePageLookup = (slug: string) => Promise<{ title: string; disposition: ProgrammeDisposition } | null>;

const log = logger.child('ProgrammeEligibility');
/** A failed rebuild serves the same day's last good snapshot for a minute, then retries (as the sitemap did). */
const STALE_RETRY_MS = 60 * 1000;

let epoch = 0;
/** Called by invalidateSitemapCache: every instance drops its snapshot; a build already running is not kept. */
export const invalidateProgrammeEligibility = (): void => { epoch++; };
let lastGoodEpoch = 0;
/** Called by clearSitemapLastGood: no instance falls back to a snapshot built before this call. */
export const clearProgrammeEligibilityLastGood = (): void => { lastGoodEpoch++; };

export class ProgrammeEligibility {
  private snap?: ProgrammeEligibilitySnapshot & { epoch: number };
  private lastGood?: ProgrammeEligibilitySnapshot & { lastGoodEpoch: number };
  private inflight?: Promise<ProgrammeEligibilitySnapshot>;
  private failedUntil = 0;

  constructor(
    private readonly rows: Pick<TvReadQueryService, 'getIndexableProgramSitemapRows'>,
    private readonly page?: ProgrammePageLookup,
    private readonly ttlMs = 6 * 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  /** The current snapshot, built (once, shared by concurrent callers) when missing or expired. Rejects, never empties. */
  async snapshot(): Promise<ProgrammeEligibilitySnapshot> {
    const today = this.today();
    if (this.valid(this.snap, today)) return this.snap!;
    if (this.inflight) return this.inflight;
    const started = epoch;
    const promise = this.build(today)
      .then((snapshot) => {
        if (started === epoch) {
          this.snap = { ...snapshot, epoch: started };
          this.lastGood = { ...snapshot, lastGoodEpoch };
        }
        return snapshot;
      })
      .catch((error) => {
        log.error('Programme eligibility build failed', { error });
        this.failedUntil = this.now() + STALE_RETRY_MS;
        const stale = this.lastGood;
        // Another day's eligibility is not today's.
        if (!stale || stale.lastGoodEpoch !== lastGoodEpoch || stale.dates[0] !== today[0]) throw error;
        const { lastGoodEpoch: _discarded, ...good } = stale;
        const retry = { ...good, validUntil: Math.min(good.validUntil, this.now() + STALE_RETRY_MS) };
        if (started === epoch) this.snap = { ...retry, epoch: started };
        return retry;
      })
      .finally(() => {
        if (this.inflight === promise) this.inflight = undefined;
      });
    this.inflight = promise;
    return promise;
  }

  /**
   * For the request path: never waits. The snapshot when it still answers for today, else undefined (no programme
   * link is drawn) while a build starts in the background.
   */
  current(): ProgrammeEligibilitySnapshot | undefined {
    if (this.valid(this.snap, this.today())) return this.snap;
    // During an outage the page requests do not each start a build: one retry a minute.
    if (this.now() >= this.failedUntil) this.snapshot().catch(() => undefined);
    return undefined;
  }

  private valid(snap: (ProgrammeEligibilitySnapshot & { epoch: number }) | undefined, today: [string, string]): boolean {
    return !!snap && snap.epoch === epoch && snap.dates[0] === today[0] && snap.validUntil > this.now();
  }

  private today(): [string, string] {
    // DateUtils.getToday/TomorrowYYYYMMDD on the injected clock (the page's own lookup window).
    const now = new Date(this.now());
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    return [DateUtils.formatYYYYMMDD(now), DateUtils.formatYYYYMMDD(tomorrow)];
  }

  private async build(dates: [string, string]): Promise<ProgrammeEligibilitySnapshot> {
    const builtAt = this.now();
    const rows = await this.rows.getIndexableProgramSitemapRows(dates);
    const lastChanged = new Map<string, number>();
    for (const row of rows) {
      const slug = slugifyTitle(row.title);
      if (slug === 'sin-titulo') continue;
      const changed = row.updatedAt ? new Date(row.updatedAt).getTime() : NaN;
      lastChanged.set(slug, Math.max(lastChanged.get(slug) ?? -Infinity, Number.isNaN(changed) ? -Infinity : changed));
    }
    const titles = await this.filterEligible([...lastChanged.keys()]);
    const entries = new Map<string, ProgrammeEligibilityEntry>();
    for (const [slug, changed] of lastChanged) {
      const title = titles.get(slug);
      if (title !== undefined) entries.set(slug, { title, lastChanged: changed });
    }
    const [y, m, d] = [dates[0].slice(0, 4), dates[0].slice(4, 6), dates[0].slice(6, 8)].map(Number);
    const nextMidnight = new Date(y, m - 1, d + 1).getTime();
    return { dates, entries, builtAt, validUntil: Math.min(builtAt + this.ttlMs, nextMidnight) };
  }

  /**
   * Slugs whose page resolves and, where the M09-B policy applies, is `standalone`, with the title the page loads.
   * Bounded parallel check; a lookup failure fails the whole build so an outage never yields a truncated set.
   */
  private async filterEligible(slugs: string[]): Promise<Map<string, string>> {
    const ok = new Map<string, string>();
    if (!this.page) {
      // No page lookup (installations without it): no title to match, so no channel link; the sitemap rule is kept.
      for (const slug of slugs) if (!programmePolicyApplies(slug)) ok.set(slug, '');
      return ok;
    }
    const queue = [...slugs];
    await Promise.all(Array.from({ length: 8 }, async () => {
      for (let slug = queue.shift(); slug !== undefined; slug = queue.shift()) {
        try {
          const page = await this.page!(slug);
          if (page && (page.disposition === 'standalone' || !programmePolicyApplies(slug))) ok.set(slug, page.title);
        } catch (error) {
          queue.length = 0; // stop the other workers: the build fails as a whole
          throw error;
        }
      }
    }));
    return ok;
  }
}

/**
 * The `/programas/:slug` page an airing links to, from a snapshot: only an eligible slug whose page loads this same
 * title, and never for a verified work (its `/peliculas|/series` page stays the destination).
 */
export function programmePathFor(
  snapshot: ProgrammeEligibilitySnapshot | undefined,
  program: { title?: string; workPath?: string },
): string | undefined {
  if (!snapshot || program.workPath || !program.title) return undefined;
  const slug = slugifyTitle(program.title);
  const entry = snapshot.entries.get(slug);
  return entry && entry.title && entry.title === program.title ? `/programas/${slug}` : undefined;
}
