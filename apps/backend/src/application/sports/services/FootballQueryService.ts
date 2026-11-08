import { getCompetitionCatalog, toCompetitionEntity } from '@/application/sports/services/FootballCompetitionCatalog';
/**
 * Football query service — the BFF for the football vertical.
 *
 * Aggregates provider data, broadcast reconciliation and editorial news into
 * the surfaces the frontend needs, without overfetching (no lineups/events/
 * full bodies on the home surface).
 */

import { ICacheRepository } from '@/domain/repositories/ICacheRepository';
import { BlogPostModel } from '@/infrastructure/database/models/BlogPost.model';
import { CacheFreshnessPolicy, StaleWhileRevalidateCache } from '@/infrastructure/cache/StaleWhileRevalidateCache';
import { NotFoundError } from '@/shared/errors';
import { measureTiming } from '@/shared/utils/performanceTiming';
import {
  FootballCompetition,
  FootballDataProvider,
  FootballMatch,
  FootballMatchQuery,
  FootballNewsItem,
  FootballTeam,
  isLiveMatchStatus,
} from '@/domain/sports/football/types';
import { BroadcastReconciliationService } from './BroadcastReconciliationService';
import {
  FootballCompetitionDetailDTO,
  FootballCompetitionsResponseDTO,
  FootballHomeDTO,
  FootballMatchDetailDTO,
  FootballMatchesResponseDTO,
  FootballSearchResponseDTO,
  FootballTeamDetailDTO,
} from '../dto/FootballDTO';

// No football-tagged category exists in the CMS yet (checked live: the real
// category slugs in use are all general-audience — guias, rankings, series,
// tdt, streaming... nothing football-specific). This list is the expected
// slug editorial will eventually use; until a post actually carries one of
// these (or real sportsRelations tagging), getNews() correctly returns
// empty rather than guessing.
const FOOTBALL_CATEGORY_SLUGS = ['futbol', 'football', 'deportes', 'sports'];

const CACHE_PREFIX = 'v2:football';
const CACHE_POLICIES = {
  home: { freshSeconds: 45, staleSeconds: 5 * 60 },
  live: { freshSeconds: 8, staleSeconds: 45 },
  today: { freshSeconds: 45, staleSeconds: 5 * 60 },
  fixtures: { freshSeconds: 10 * 60, staleSeconds: 60 * 60 },
  historical: { freshSeconds: 24 * 60 * 60, staleSeconds: 7 * 24 * 60 * 60 },
  detail: { freshSeconds: 60, staleSeconds: 15 * 60 },
  metadata: { freshSeconds: 6 * 60 * 60, staleSeconds: 24 * 60 * 60 },
  competition: { freshSeconds: 5 * 60, staleSeconds: 60 * 60 },
  news: { freshSeconds: 3 * 60, staleSeconds: 30 * 60 },
  newsDetail: { freshSeconds: 60 * 60, staleSeconds: 24 * 60 * 60 },
  search: { freshSeconds: 60, staleSeconds: 5 * 60 },
  empty: { freshSeconds: 60, staleSeconds: 5 * 60 },
} satisfies Record<string, CacheFreshnessPolicy>;

// The frontend polls this endpoint client-side for live matches (every
// ~25s per open tab, spec §49-51). Providers like football-data.org rate
// limit their free tier around 10 req/min, so this cache decouples N
// concurrent pollers from N upstream calls — short enough that scores
// still feel live, long enough to absorb a fleet of open tabs.

/**
 * F21: list EVERY catalogue competition, then overlay the ones we actually have
 * snapshots for. A competition with no data must still appear (honest "sin datos"),
 * never vanish from the public list.
 */
export function mergeCompetitionsWithCatalogue(ingested: readonly FootballCompetition[]): FootballCompetition[] {
  const bySlug = new Map<string, FootballCompetition>();
  for (const entry of getCompetitionCatalog()) {
    bySlug.set(entry.slug, toCompetitionEntity(entry));
  }
  for (const competition of ingested) {
    if (!competition?.slug) continue;
    const base = bySlug.get(competition.slug);
    bySlug.set(competition.slug, base ? { ...base, ...competition } : competition);
  }
  return [...bySlug.values()];
}

export class FootballQueryService {
  private readonly swrCache: StaleWhileRevalidateCache;

  constructor(
    private readonly provider: FootballDataProvider,
    private readonly reconciliation: BroadcastReconciliationService,
    private readonly cacheRepository?: ICacheRepository
  ) {
    this.swrCache = new StaleWhileRevalidateCache(cacheRepository);
  }

  /** Invalidate only football public read snapshots after admin mutations. */
  async invalidatePublicReads(): Promise<void> {
    await this.cacheRepository?.clear(`${CACHE_PREFIX}:*`);
  }

  async getHome(): Promise<FootballHomeDTO> {
    return this.swrCache.getOrLoad(`${CACHE_PREFIX}:home:v2`, CACHE_POLICIES.home, async () => {
    const now = new Date();
    const todayKey = 'today';
    const tomorrowKey = 'tomorrow';

    const [liveMatches, todayMatches, upcomingMatches] = await measureTiming('provider', () => Promise.all([
      this.provider.getLiveMatches(),
      this.provider.getMatches({ date: todayKey }),
      this.provider.getMatches({ date: tomorrowKey }),
    ]));

    const reconciled = await measureTiming('reconcile', () => this.reconciliation.reconcile([
      ...liveMatches,
      ...todayMatches,
      ...upcomingMatches,
    ]));

    const byId = new Map(reconciled.map((match) => [match.id, match]));
    const reconciledLive = liveMatches
      .map((match) => byId.get(match.id) ?? match)
      .filter((match) => isLiveMatchStatus(match.status));
    const reconciledToday = todayMatches.map((match) => byId.get(match.id) ?? match);
    const reconciledUpcoming = upcomingMatches.map((match) => byId.get(match.id) ?? match);

    const [competitions, latestNews] = await Promise.all([
      measureTiming('provider', () => settle(this.provider.getCompetitions(), [])),
      settle(this.getNews({ limit: 6 }), []),
    ]);

    // One compact, provider-backed table for the home rail. Prefer the
    // Spanish top flight for this Spain-first product, then preserve the
    // provider's order. If standings are unavailable, omit the module.
    const prioritizedCompetitions = prioritizeSpanishLeague(competitions);
    const standingsCompetition = prioritizedCompetitions.find((competition) => competition.type === 'league');
    const standingsRows = standingsCompetition
      ? await measureTiming('provider', () => settle(this.provider.getStandings(standingsCompetition.slug), []))
      : [];

    const home: FootballHomeDTO = {
      liveMatches: reconciledLive,
      todayMatches: reconciledToday,
      featuredMatches: this.pickFeatured(reconciledToday, reconciledUpcoming),
      upcomingMatches: reconciledUpcoming,
      featuredCompetitions: prioritizedCompetitions.slice(0, 6),
      standingsSnapshot: standingsCompetition && standingsRows.length
        ? { competition: standingsCompetition, rows: standingsRows.slice(0, 5) }
        : null,
      latestNews,
      generatedAt: now.toISOString(),
    };

    return home;
    });
  }

  async getMatches(query: FootballMatchQuery): Promise<FootballMatchesResponseDTO> {
    const policy = resolveMatchesPolicy(query);
    const key = `${CACHE_PREFIX}:matches:${stableKey(query)}`;
    return this.swrCache.getOrLoad(key, policy, async () => {
      const matches = await measureTiming('provider', () => this.provider.getMatches(query));
      const reconciled = await measureTiming('reconcile', () => this.reconciliation.reconcile(matches));
      return {
        matches: reconciled,
        meta: {
          total: reconciled.length,
          date: query.date,
          status: query.status,
          competitionSlug: query.competitionSlug,
          teamSlug: query.teamSlug,
          generatedAt: new Date().toISOString(),
        },
      };
    // An empty day may be a transient upstream blank (seen 2026-10-19 under rate limiting): keep it briefly.
    }, (result) => result.matches.length ? true : CACHE_POLICIES.empty);
  }

  async getLiveMatches(): Promise<FootballMatchesResponseDTO> {
    return this.swrCache.getOrLoad(`${CACHE_PREFIX}:matches:live`, CACHE_POLICIES.live, async () => {
      const matches = await measureTiming('provider', () => this.provider.getLiveMatches());
      const reconciled = await measureTiming('reconcile', () => this.reconciliation.reconcile(matches));
      const liveMatches = reconciled.filter((match) => isLiveMatchStatus(match.status));
      return {
        matches: liveMatches,
        meta: { total: liveMatches.length, status: 'live', generatedAt: new Date().toISOString() },
      };
    });
  }

  async getMatch(idOrSlug: string): Promise<FootballMatchDetailDTO> {
    return this.swrCache.getOrLoad(`${CACHE_PREFIX}:match:${encodeURIComponent(idOrSlug)}`, CACHE_POLICIES.detail, async () => {
    const match = await this.provider.getMatch(idOrSlug);
    if (!match) {
      throw new NotFoundError('Football match', idOrSlug);
    }
    // The match itself is already in hand at this point — broadcast
    // reconciliation and related news are both enrichment, and neither
    // should be able to turn a perfectly good match into a 500 (spec: "the
    // core scoreboard must render even if news/broadcast lookup fails").
    const [reconciledList, relatedNews] = await Promise.all([
      settle(this.reconciliation.reconcile([match]), [match]),
      settle(this.getNews({ matchId: match.id, limit: 8 }), []),
    ]);
    const reconciled = reconciledList[0];
    return {
      match: reconciled,
      relatedNews,
      meta: { generatedAt: new Date().toISOString() },
    };
    });
  }

  async getCompetitions(): Promise<FootballCompetitionsResponseDTO> {
    // Found via real E2E testing (not a curl check — those only ever
    // exercised SSR/TransferState, which never re-hits this path client-
    // side): this call had neither a cache nor any error handling at all,
    // unlike every other football endpoint. football-data.org's free tier
    // rate-limits around 10 req/min; enough cumulative testing (or normal
    // traffic — every uncached page view hits this) triggered a real 429
    // that propagated straight to an unhandled 500, confirmed in
    // production logs. Competitions are near-static reference data (13
    // items, rarely change), so a long cache both fixes the crash and
    // meaningfully cuts upstream pressure — the actual root cause.
    return this.swrCache.getOrLoad(
      `${CACHE_PREFIX}:competitions`,
      CACHE_POLICIES.metadata,
      async () => {
        // The public competitions list is the FULL catalogue, not just what has
        // been ingested. Building it from stored snapshots alone made every
        // competition without a current fixture disappear from /competiciones
        // (Serie A, Ligue 1, Eredivisie, Brasileirão...). Ingested records are
        // merged ON TOP so real data wins, and the rest keep their catalogue
        // entry (name, country, type) so the page can still list them.
        const ingested = await measureTiming('provider', () => settle(this.provider.getCompetitions(), []));
        const competitions = mergeCompetitionsWithCatalogue(ingested);
        return {
          competitions,
          meta: { total: competitions.length, generatedAt: new Date().toISOString() },
          // Whether the PROVIDER actually answered, not whether the list is long.
          // The catalogue always makes the list non-empty, so caching on length
          // would freeze a provider failure for the whole TTL.
          ingestedCount: ingested.length,
        };
      },
      // Only cache a result that carries real provider data.
      (result) => Number((result as unknown as { ingestedCount?: number }).ingestedCount ?? 0) > 0
    );
  }

  async getCompetition(slug: string): Promise<FootballCompetitionDetailDTO> {
    return this.swrCache.getOrLoad(`${CACHE_PREFIX}:competition:${encodeURIComponent(slug)}`, CACHE_POLICIES.competition, async () => {
    const competition = await this.provider.getCompetition(slug);
    if (!competition) {
      throw new NotFoundError('Football competition', slug);
    }
    // A single provider hiccup (standings, in practice — see
    // FootballDataOrgAdapter's getStandings) must not take matches/news
    // down with it. Each surface settles independently.
    const [matches, standings, news] = await Promise.all([
      settle(this.provider.getMatches({ competitionSlug: slug, limit: 40 }), []),
      settle(this.provider.getStandings(slug), []),
      settle(this.getNews({ competitionId: `catalog:${slug}`, limit: 8 }), []),
    ]);
    const reconciled = await settle(this.reconciliation.reconcile(matches), matches);
    return {
      competition,
      matches: reconciled,
      standings,
      news,
      meta: { generatedAt: new Date().toISOString() },
    };
    });
  }

  async getTeam(slug: string): Promise<FootballTeamDetailDTO> {
    return this.swrCache.getOrLoad(`${CACHE_PREFIX}:team:${encodeURIComponent(slug)}`, CACHE_POLICIES.competition, async () => {
    const team = await this.provider.getTeam(slug);
    if (!team) {
      throw new NotFoundError('Football team', slug);
    }
    // Same isolation as getCompetition(): a news lookup failure must not
    // take the whole team page down with it.
    const [matches, news] = await Promise.all([
      settle(this.provider.getMatches({ teamSlug: slug, limit: 40 }), []),
      settle(this.getNews({ teamId: team.id, limit: 8 }), []),
    ]);
    const reconciled = await settle(this.reconciliation.reconcile(matches), matches);
    const now = Date.now();
    const upcoming = reconciled
      .filter((match) => new Date(match.kickoffAt).getTime() >= now)
      .sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime());
    const finished = reconciled
      .filter((match) => new Date(match.kickoffAt).getTime() < now)
      .sort((a, b) => new Date(b.kickoffAt).getTime() - new Date(a.kickoffAt).getTime());

    return {
      team,
      nextMatch: upcoming[0] ?? null,
      lastResult: finished[0] ?? null,
      matches: reconciled,
      news,
      meta: { generatedAt: new Date().toISOString() },
    };
    });
  }

  async search(q: string): Promise<FootballSearchResponseDTO> {
    const query = String(q || '').trim();
    if (!query) {
      return { query: '', matches: [], teams: [], competitions: [], news: [], meta: { generatedAt: new Date().toISOString() } };
    }

    return this.swrCache.getOrLoad(`${CACHE_PREFIX}:search:${encodeURIComponent(normalizeQuery(query))}`, CACHE_POLICIES.search, async () => {
    // Same isolation as getCompetition()/getTeam()/getMatch(): one entity
    // type failing (teams/competitions listings, news) must not blank out
    // the others — a user searching should still see whichever result
    // groups actually resolved.
    const [matches, teams, competitions, news] = await Promise.all([
      settle(this.provider.getMatches({ q: query, limit: 12 }), []),
      settle(this.provider.getTeams(), []),
      settle(this.provider.getCompetitions(), []),
      settle(this.getNews({ q: query, limit: 8 }), []),
    ]);

    const normalizedQuery = normalizeQuery(query);
    const filteredTeams = teams
      .filter((team) => teamMatches(team, normalizedQuery))
      .slice(0, 8);
    const filteredCompetitions = competitions
      .filter((competition) => competitionMatches(competition, normalizedQuery))
      .slice(0, 8);

    return {
      query,
      matches: await settle(this.reconciliation.reconcile(matches), matches),
      teams: filteredTeams,
      competitions: filteredCompetitions,
      news,
      meta: { generatedAt: new Date().toISOString() },
    };
    });
  }

  async getNews(filters: NewsFilters = {}): Promise<FootballNewsItem[]> {
    const policy = filters.slug ? CACHE_POLICIES.newsDetail : CACHE_POLICIES.news;
    return this.swrCache.getOrLoad(`${CACHE_PREFIX}:news:${stableKey(filters)}`, policy, async () => {
      const query = buildNewsQuery(filters);
      const includeContent = Boolean(filters.slug);
      const projection = includeContent
        ? undefined
        : {
            title: 1, slug: 1, excerpt: 1, contentType: 1, author: 1,
            featuredImage: 1, 'seo.ogImage': 1, publishedAt: 1, updatedAt: 1,
            sportsRelations: 1,
          };

      const mongoQuery = BlogPostModel.find(query)
        .sort({ featured: -1, publishedAt: -1, createdAt: -1 })
        .skip(Math.max(filters.offset || 0, 0))
        .limit(Math.min(filters.limit || 12, 30));
      if (projection) mongoQuery.select(projection);
      const posts = await measureTiming('db', () => mongoQuery.lean().exec());
      return posts.map((post: any) => this.mapNewsItem(post, includeContent));
    });
  }

  private mapNewsItem(post: any, includeContent = false): FootballNewsItem {
    const publishedAt = post.publishedAt || post.createdAt || new Date();
    return {
      id: String(post._id || post.id),
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      contentType: post.contentType || 'news',
      author: post.author,
      coverImage: post.featuredImage?.sourceUrl || post.seo?.ogImage || null,
      publishedAt: new Date(publishedAt).toISOString(),
      updatedAt: post.updatedAt ? new Date(post.updatedAt).toISOString() : undefined,
      sportsRelations: post.sportsRelations || { teamIds: [], competitionIds: [], matchIds: [] },
      content: includeContent ? post.content : undefined,
    };
  }

  private pickFeatured(today: FootballMatch[], upcoming: FootballMatch[]): FootballMatch[] {
    // Featured = the next few high-profile matches (live first, then today).
    const pool = [...today, ...upcoming]
      .filter((match) => match.status === 'live' || match.status === 'scheduled')
      .sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime());
    return pool.slice(0, 4);
  }

}

/** Keep the product's home market first without disturbing provider order for the rest. */
export function prioritizeSpanishLeague<T extends { slug: string; name: string; country?: string; type?: string }>(competitions: T[]): T[] {
  const spanishLeagueIndex = competitions.findIndex((competition) => {
    const slug = normalizeQuery(competition.slug);
    const name = normalizeQuery(competition.name);
    const country = normalizeQuery(competition.country || '');
    const isSpanish = country === 'spain' || country === 'espana';
    return slug === 'laliga' || name === 'laliga' || (isSpanish && (!competition.type || competition.type === 'league'));
  });
  if (spanishLeagueIndex <= 0) return [...competitions];
  return [competitions[spanishLeagueIndex], ...competitions.slice(0, spanishLeagueIndex), ...competitions.slice(spanishLeagueIndex + 1)];
}

function stableKey(value: object): string {
  return Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined && entry !== null && entry !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(entry))}`)
    .join('&') || 'all';
}

function resolveMatchesPolicy(query: FootballMatchQuery): CacheFreshnessPolicy {
  if (query.status === 'live') return CACHE_POLICIES.live;
  if (query.status === 'finished') return CACHE_POLICIES.historical;
  if (query.date === 'today') return CACHE_POLICIES.today;
  return CACHE_POLICIES.fixtures;
}

function normalizeQuery(q: string): string {
  return q
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function teamMatches(team: FootballTeam, normalizedQuery: string): boolean {
  return [team.name, team.shortName, ...team.aliases]
    .filter(Boolean)
    .some((value) =>
      String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .includes(normalizedQuery)
    );
}

function competitionMatches(competition: FootballCompetition, normalizedQuery: string): boolean {
  return [competition.name, competition.shortName]
    .filter(Boolean)
    .some((value) =>
      String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .includes(normalizedQuery)
    );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface NewsFilters {
  teamId?: string;
  competitionId?: string;
  matchId?: string;
  slug?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

/**
 * Builds the Mongo query for getNews() — extracted as a pure function so
 * the football-relevance scoping (the actual bug fix) is unit-testable
 * without touching Mongo. A request scoped to a real team/competition/match
 * ID is inherently football-relevant already (that field can only be
 * non-empty if the article was actually tagged). A bare listing or a slug
 * lookup is NOT inherently scoped, though — this was the real bug: the news
 * pages were showing streaming/movie guides with zero football relevance
 * under the "Noticias de fútbol" banner, and a slug lookup with no extra
 * scoping could surface any blog post via a guessed URL. Both cases get
 * scoped to genuine football signals (a real football category, or actual
 * sportsRelations tagging). If editorial hasn't tagged any football content
 * yet, this correctly returns empty — the UI already has a proper "no news
 * yet" empty state for exactly that.
 */
export function buildNewsQuery(filters: NewsFilters): Record<string, any> {
  const query: Record<string, any> = { status: 'publish' };
  const clauses: Record<string, any>[] = [];

  if (filters.slug) query.slug = filters.slug;
  if (filters.teamId) query['sportsRelations.teamIds'] = filters.teamId;
  if (filters.competitionId) query['sportsRelations.competitionIds'] = filters.competitionId;
  if (filters.matchId) query['sportsRelations.matchIds'] = filters.matchId;
  if (filters.q) {
    clauses.push({
      $or: [
        { title: { $regex: escapeRegex(filters.q), $options: 'i' } },
        { excerpt: { $regex: escapeRegex(filters.q), $options: 'i' } },
      ],
    });
  }

  const hasTeamCompetitionOrMatchFilter = filters.teamId || filters.competitionId || filters.matchId;
  if (!hasTeamCompetitionOrMatchFilter) {
    clauses.push({
      $or: [
        { 'categories.slug': { $in: FOOTBALL_CATEGORY_SLUGS } },
        { 'sportsRelations.teamIds.0': { $exists: true } },
        { 'sportsRelations.competitionIds.0': { $exists: true } },
        { 'sportsRelations.matchIds.0': { $exists: true } },
      ],
    });
  }

  if (clauses.length) {
    query.$and = clauses;
  }

  return query;
}

/**
 * Resolves a secondary/enrichment call to its value, or to `fallback` if it
 * rejects — the mechanism behind every degrade-gracefully guarantee in this
 * file (spec: standings/news/reconciliation failures must never take down a
 * page whose primary data already resolved). Exported standalone so it's
 * unit-testable without touching the I/O (Mongo, HTTP) any real caller does.
 */
export async function settle<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}
