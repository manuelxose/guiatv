/**
 * M10-B: the "Relacionados" rail of a work page (`/peliculas|/series/:slug`) links only works of the sitemap set
 * (`WorkSeoPolicy.indexableWorks`: identity proven, indexable, broadcast by GuíaTV), of the same kind, sharing a TMDB
 * genre when one does. Before M10-B the rail was TMDB's popular list for the genre: titles with no local row, linked
 * under a slug the page then resolved by a TMDB search (a namesake could answer) and mostly `noindex`.
 *
 * The choice is deterministic and spreads the links over the whole set: for each seed and each genre of the work, the
 * works of that kind and genre sit on a ring ordered by a hash of (seed, genre, id), and the work links its successor on
 * each ring. Every work with a genre is the successor of another on the seed-0 ring of each of its genres, so it gets an
 * inlink from an indexable page; several hashed rings make the graph shallow instead of a chain. A kind-wide ring fills
 * a work with too few genre neighbours. No title similarity is involved and nothing is fetched from TMDB.
 *
 * The set is read once per TTL in the background (a full catalogue read, never on a request once warm); a failed read
 * keeps the last good set, and with none the rail is empty (no unverified fallback here).
 */
import { createHash } from 'node:crypto';
import { logger } from '@/shared/utils/logger';
import { IndexableWork, indexableWorks } from './WorkSeoPolicy';

const log = logger.child('RelatedWorks');
const SEEDS = 3;
const ANY_GENRE = -1;
const TTL_MS = Number(process.env.RELATED_WORKS_TTL_MS) || 6 * 60 * 60 * 1000;

const rank = (seed: number, genre: number, w: { kind: string; tmdbId: number }) =>
  createHash('sha1').update(`${seed}:${genre}:${w.kind}:${w.tmdbId}`).digest().readUInt32BE(0);

export class RelatedWorkGraph {
  private readonly rings = new Map<string, Array<{ r: number; w: IndexableWork }>>();
  private readonly byId = new Map<string, IndexableWork>();

  constructor(works: readonly IndexableWork[]) {
    for (const w of works) {
      this.byId.set(`${w.kind}:${w.tmdbId}`, w);
      for (const g of [...new Set(w.genreIds), ANY_GENRE]) {
        for (let s = 0; s < SEEDS; s++) {
          const k = `${w.kind}:${g}:${s}`;
          (this.rings.get(k) ?? this.rings.set(k, []).get(k)!).push({ r: rank(s, g, w), w });
        }
      }
    }
    for (const ring of this.rings.values()) ring.sort((a, b) => a.r - b.r || a.w.tmdbId - b.w.tmdbId);
  }

  get size(): number { return this.byId.size; }

  /**
   * Up to `limit` related works of `kind`, never `tmdbId` itself. A work of the set uses its own stored genres (so the
   * ring guarantee holds); any other uses `genreIds` from its detail.
   */
  related(kind: 'movie' | 'tv', tmdbId: number, genreIds: readonly number[] = [], limit = 8): IndexableWork[] {
    const own = this.byId.get(`${kind}:${tmdbId}`);
    const genres = [...new Set(own ? own.genreIds : genreIds)];
    const self = { kind, tmdbId };
    const out = new Map<string, IndexableWork>();
    const take = (g: number, s: number, rounds: number) => {
      const ring = this.rings.get(`${kind}:${g}:${s}`);
      if (!ring?.length) return;
      const r = rank(s, g, self);
      // First entry after this work's own position (its successor when it is on the ring).
      let i = ring.findIndex((e) => e.r > r || (e.r === r && e.w.tmdbId > tmdbId));
      if (i < 0) i = 0;
      for (let n = 0, added = 0; n < ring.length && added < rounds && out.size < limit; n++) {
        const w = ring[(i + n) % ring.length].w;
        if (w.tmdbId === tmdbId || out.has(w.path)) continue;
        out.set(w.path, w);
        added += 1;
      }
    };
    for (let s = 0; s < SEEDS && out.size < limit; s++) for (const g of genres) take(g, s, 1);
    for (let s = 0; s < SEEDS && out.size < limit; s++) take(ANY_GENRE, s, limit);
    return [...out.values()].slice(0, limit);
  }
}

type Loader = () => Promise<readonly IndexableWork[]>;

/** The set, refreshed in the background every TTL; one read in flight at a time. Never throws. */
export class RelatedWorkIndex {
  private graph?: RelatedWorkGraph;
  private loadedAt = 0;
  private failedAt = -Infinity;
  private inFlight?: Promise<RelatedWorkGraph | undefined>;

  constructor(private readonly load: Loader = () => indexableWorks(), private readonly ttlMs = TTL_MS, private readonly now = () => Date.now()) {}

  /** Starts the first read without waiting (process start). */
  warm(): void { void this.refresh(); }

  /** The current graph; waits only when none was ever built. Undefined when the set could not be read. */
  async get(): Promise<RelatedWorkGraph | undefined> {
    // After a failed read, wait a minute before the next one: a database outage must not turn every request into one.
    if (!this.graph) return this.now() - this.failedAt < 60_000 ? undefined : this.refresh();
    if (this.now() - this.loadedAt > this.ttlMs && this.now() - this.failedAt >= 60_000) void this.refresh();
    return this.graph;
  }

  private refresh(): Promise<RelatedWorkGraph | undefined> {
    this.inFlight ??= this.load()
      .then((works) => {
        this.graph = new RelatedWorkGraph(works);
        this.loadedAt = this.now();
        return this.graph;
      })
      .catch((error) => {
        this.failedAt = this.now();
        log.warn('Related works could not read the indexable set; keeping the previous one', { error: (error as Error).message });
        return this.graph;
      })
      .finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }
}

export const relatedWorkIndex = new RelatedWorkIndex();
