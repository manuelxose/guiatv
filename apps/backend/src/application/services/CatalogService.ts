import { LegacyEnrichmentService } from './LegacyEnrichmentService';
import { IChannelRepository } from '@/domain/repositories/IChannelRepository';
import { ICacheRepository } from '@/domain/repositories/ICacheRepository';
import {
  CatalogAiringDTO,
  CatalogContentType,
  CatalogDetailDTO,
  CatalogDetailEnrichmentDTO,
  CatalogItemDTO,
  CatalogPlatformDTO,
  CatalogProviderDTO,
  CatalogQueryResultDTO,
  CatalogSuggestionDTO,
  CatalogWhereToWatchDTO,
  CATALOG_PLATFORM_NAME_MAP,
  CATALOG_PLATFORM_REGISTRY,
} from '../dto/CatalogDTO';
import {
  buildProgramCatalogId,
  buildTmdbCatalogId,
  normalizeInteractionContentId,
  parseCatalogId,
} from './CatalogIdentity';
import {
  TMDBDetailResult,
  TMDBResult,
  TMDBService,
} from '@/infrastructure/external/TMDBService';
import {
  StreamingProvidersService,
  WatchProvidersResult,
} from '@/infrastructure/external/StreamingProvidersService';
import {
  genreLabelsMatch,
  MOVIE_GENRE_NAME_TO_TMDB_ID,
  normalizeGenreList,
  TV_GENRE_NAME_TO_TMDB_ID,
} from '@/shared/taxonomy/genreTaxonomy';
import { IUserContentInteractionRepository } from '@/domain/repositories/IUserContentInteractionRepository';
import { DateUtils } from '@/shared/utils/dateUtils';
import { NotFoundError } from '@/shared/errors';
import { UserListItemModel } from '@/infrastructure/database/models/UserListItem.model';
import { UserListModel } from '@/infrastructure/database/models/UserList.model';
import { UserContentInteractionModel } from '@/infrastructure/database/models/UserContentInteraction.model';
import { aggregateFriendActivity, findFolloweeIds } from './SocialSummaryQuery';
import { UserProfileModel } from '@/infrastructure/database/models/UserProfile.model';
import { buildCatalogAssetSet, buildSearchTokens } from '@/shared/utils/tvMetadata';
import { l1Cache } from '@/infrastructure/cache/L1Cache';
import { TvReadItemDTO, TvReadView } from '../dto/TvReadDTO';
import { TvReadQueryService, isConsumerVisibleTvReadItem } from './TvReadQueryService';
import { TVReadAiringModel } from '@/infrastructure/database/models/TVReadAiring.model';
import { MediaCatalogService } from './MediaCatalogService';
import { measureTiming } from '@/shared/utils/performanceTiming';
import { logger } from '@/shared/utils/logger';
import { titleIdentityKey } from '@/domain/services/contentIdentity';
import { airingDetailSlug, buildDetailPath, episodeWorkTitle, inferContentType, normalizeToken, programDetailPath, slugify, slugifyTitle } from '@/domain/services/detailPath';

export interface CatalogQueryParams {
  userId?: string;
  q?: string;
  types?: string[];
  genres?: string[];
  platforms?: string[];
  availability?: string[];
  date?: string;
  timeSlot?: string;
  sort?: string;
  page?: number;
  limit?: number;
}

export interface ResolveRecommendationInput {
  title: string;
  type?: 'movie' | 'series' | 'program';
  platform?: string;
  channel?: string;
}

interface CatalogPreferences {
  favoriteGenres: Set<string>;
  preferredPlatforms: Set<string>;
  excludeSeen: Set<string>;
}

// Canonical alias -> TMDB discover genre id tables, sourced from the shared
// genre taxonomy (single source of truth, see shared/taxonomy/genreTaxonomy).
const MOVIE_GENRE_IDS = MOVIE_GENRE_NAME_TO_TMDB_ID;
const TV_GENRE_IDS = TV_GENRE_NAME_TO_TMDB_ID;

export class CatalogService {
  private readonly ttlSeconds = 600;
  private readonly suggestionTtlSeconds = 300;
  private readonly hotCacheTtlMs = 30_000;
  private readonly channelMapTtlMs = 60_000;
  // Negative-result cache for /catalog/slug lookups: short enough that a genuinely
  // newly-added item doesn't stay "missing" for long, long enough to absorb the
  // repeated 404 traffic (mostly bots with userAgent "node") that was hammering the
  // uncached TMDB fallback and driving guiatv-api into repeated OOM crash-loops.
  private readonly slugNotFoundTtlSeconds = 6 * 60 * 60; // 6 hours
  // De-dupes identical concurrent /catalog/slug lookups (e.g. bot bursts hitting the
  // same missing slug in parallel) so N simultaneous requests share one TMDB/DB
  // lookup instead of each independently paying the up-to-8s TMDB timeout.
  private readonly inFlightSlugLookups = new Map<string, Promise<CatalogDetailDTO>>();

  constructor(
    private readonly channelRepository: IChannelRepository,
    private readonly cacheRepository: ICacheRepository,
    private readonly tmdbService: TMDBService,
    private readonly streamingProvidersService: StreamingProvidersService,
    private readonly interactionRepository: IUserContentInteractionRepository,
    private readonly tvReadQueryService: TvReadQueryService,
    // Optional: routes TMDB detail lookups through the local persistent media
    // catalog (L1 -> Redis -> Mongo -> TMDB) instead of hitting TMDB directly
    // on every request. Falls back to the old direct-TMDB behavior when absent
    // so existing tests/call sites that don't pass it keep working unchanged.
    private readonly mediaCatalogService?: MediaCatalogService,
    private readonly legacyEnrichment?: LegacyEnrichmentService
  ) {}

  /** Single choke point for TMDB *detail* fetches (movie/tv by id) so the
   * local-catalog-first strategy applies uniformly across the service. */
  private async fetchTmdbDetail(
    tmdbId: number,
    type: 'movie' | 'tv'
  ): Promise<TMDBDetailResult | null> {
    if (this.mediaCatalogService) {
      return this.mediaCatalogService.getDetail(tmdbId, type);
    }
    return type === 'movie'
      ? this.tmdbService.getMovieById(tmdbId)
      : this.tmdbService.getTVById(tmdbId);
  }

  /**
   * TMDB-free variant for the critical path of a program/EPG detail page: the
   * page already has real data to render from the airing itself, so TMDB
   * detail (cast/synopsis/runtime) is a nice-to-have enhancement, never a
   * blocker. Returns null immediately when nothing is cached locally yet —
   * `getLocalOnly` schedules its own background refresh for next time.
   */
  private async fetchLocalTmdbDetail(
    tmdbId: number,
    type: 'movie' | 'tv'
  ): Promise<TMDBDetailResult | null> {
    if (!this.mediaCatalogService) {
      return null;
    }
    return this.mediaCatalogService.getLocalOnly(tmdbId, type);
  }

  getPlatforms(): CatalogPlatformDTO[] {
    return CATALOG_PLATFORM_REGISTRY;
  }

  async query(params: CatalogQueryParams): Promise<CatalogQueryResultDTO> {
    const normalized = this.normalizeQuery(params);
    const hotCacheKey = this.buildHotCatalogCacheKey(normalized);
    if (hotCacheKey) {
      const hotCached = l1Cache.get(hotCacheKey) as CatalogQueryResultDTO | undefined;
      if (hotCached) {
        return hotCached;
      }
    }
    const cacheKey = `catalog:query:v2:${JSON.stringify(normalized)}`;
    const cached = await this.cacheRepository.get<CatalogQueryResultDTO>(cacheKey);
    if (cached) {
      if (hotCacheKey) {
        l1Cache.set(hotCacheKey, cached, this.hotCacheTtlMs);
      }
      return cached;
    }

    const [channelMap, preferences, programItems, streamingItems] = await Promise.all([
      this.loadChannelMap(),
      this.loadPreferences(normalized.userId),
      normalized.types.includes('program') ? this.loadProgramItems(normalized) : Promise.resolve([]),
      this.loadStreamingItems(normalized),
    ]);

    const merged = this.mergeItems(
      [...programItems, ...streamingItems],
      channelMap
    );
    const scored = merged
      .map((item) => ({
        item,
        score: this.computeScore(item, normalized.sort, preferences),
      }))
      .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, 'es'))
      .map((entry) => entry.item)
      .filter((item) => this.matchesAvailability(item, normalized.availability))
      .filter((item) => this.matchesPlatforms(item, normalized.platforms))
      .filter((item) => this.matchesGenres(item, normalized.genres))
      .filter((item) => this.matchesSeenFilter(item, normalized.sort, preferences));

    const total = scored.length;
    const startIndex = (normalized.page - 1) * normalized.limit;
    const paged = scored.slice(startIndex, startIndex + normalized.limit);
    const withInteractions = await this.attachUserInteractions(
      paged,
      normalized.userId
    );

    const response: CatalogQueryResultDTO = {
      items: withInteractions,
      meta: {
        page: normalized.page,
        limit: normalized.limit,
        total,
        hasMore: startIndex + normalized.limit < total,
      },
      availableGenres: Array.from(
        new Set(
          scored.flatMap((item) => item.genres).map((genre) => String(genre || '').trim())
        )
      )
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'es')),
      availablePlatforms: this.getPlatforms(),
    };

    await this.cacheRepository.set(cacheKey, response, this.ttlSeconds);
    if (hotCacheKey) {
      l1Cache.set(hotCacheKey, response, this.hotCacheTtlMs);
    }
    return response;
  }

  async suggest(
    q: string,
    userId?: string,
    limit: number = 8
  ): Promise<CatalogSuggestionDTO[]> {
    const normalizedQuery = String(q || '').trim();
    if (!normalizedQuery) {
      return [];
    }

    const cacheKey = `catalog:suggest:v2:${normalizedQuery.toLowerCase()}:${userId || 'anon'}:${limit}`;
    const cached = await this.cacheRepository.get<CatalogSuggestionDTO[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await this.query({
      userId,
      q: normalizedQuery,
      types: ['movie', 'series'],
      limit,
      page: 1,
      sort: 'popular',
    });

    const suggestions = result.items.slice(0, limit).map((item) => ({
      catalogId: item.catalogId,
      source: item.source,
      contentType: item.contentType,
      title: item.title,
      slug: item.slug,
      detailPath: item.detailPath,
      subtitle:
        item.source === 'program'
          ? item.channel?.name || item.start
          : item.primaryPlatforms[0] || item.genres[0],
      image: item.image || item.assets?.poster?.url || item.assets?.backdrop?.url,
      primaryPlatforms: item.primaryPlatforms,
    }));

    await this.cacheRepository.set(cacheKey, suggestions, this.suggestionTtlSeconds);
    return suggestions;
  }

  async getDetail(
    catalogId: string,
    userId?: string,
    options: { legacyEnrichment?: boolean } = {}
  ): Promise<CatalogDetailDTO> {
    const parsed = parseCatalogId(catalogId);
    if (!parsed) {
      throw new NotFoundError('Catalog item', catalogId);
    }

    if (parsed.source === 'program' && parsed.programId) {
      const detail = await this.getProgramDetail(parsed.programId, userId);
      return options.legacyEnrichment === false ? detail : this.withLegacyEnrichment(detail);
    }

    if (parsed.source === 'tmdb' && parsed.tmdbId && parsed.tmdbType) {
      const detail = await this.getTmdbDetail(parsed.tmdbId, parsed.tmdbType, userId);
      return options.legacyEnrichment === false ? detail : this.withLegacyEnrichment(detail);
    }

    throw new NotFoundError('Catalog item', catalogId);
  }

  /**
   * Phase 3E: verified additions to the legacy payload, behind `CONTENT_LEGACY_ENRICHMENT_ENABLED`. Applied at the
   * public entry points (`getDetail`, `getBySlug`) so every route to a legacy page shares it; it never throws and
   * returns the payload untouched when off, unbound or unavailable (see `LegacyEnrichmentService`).
   */
  private async withLegacyEnrichment(detail: CatalogDetailDTO, requestedSlug?: string): Promise<CatalogDetailDTO> {
    if (!this.legacyEnrichment) return detail;
    const tmdbType = detail.source === 'tmdb'
      ? (detail.contentType === 'movie' ? 'movie' : 'tv')
      : this.resolveProgramTmdbType(detail.contentType, detail.tmdbId);
    const slugBound = requestedSlug === undefined
      ? undefined
      : [detail.slug, this.slugify(detail.title), this.slugifyTitle(detail.title)].includes(requestedSlug);
    return this.legacyEnrichment.apply(detail, { tmdbType, slugBound });
  }

  async getBySlug(
    contentType: CatalogContentType,
    slug: string,
    userId?: string
  ): Promise<CatalogDetailDTO> {
    const validTypes: CatalogContentType[] = ['movie', 'series', 'program'];
    if (!validTypes.includes(contentType)) {
      throw new NotFoundError('Content type', contentType);
    }

    const searchText = String(slug || '').replace(/-/g, ' ').trim();
    if (!searchText) {
      throw new NotFoundError('Catalog item', slug);
    }

    const negativeCacheKey = this.buildSlugNotFoundCacheKey(contentType, slug);
    // Programme availability changes with every schedule refresh. A persisted
    // negative from yesterday must not hide a programme that is resolvable
    // today; movie/series identities remain stable and keep the cache benefit.
    const cachedNotFound = contentType === 'program'
      ? false
      : await this.cacheRepository.get<boolean>(negativeCacheKey);
    // M10: the guide links slugs a verified local row resolves; a miss cached before that row existed must not 404 them.
    if (cachedNotFound && !(await this.findLocalSlugMatch(searchText, slug, contentType === 'movie' ? 'movie' : 'tv'))) {
      throw new NotFoundError('Catalog item', slug);
    }

    // De-dupe identical concurrent lookups (same contentType+slug+user) so a burst of
    // simultaneous requests for the same not-yet-cached slug doesn't each independently
    // hit TMDB/the DB.
    const inFlightKey = `${contentType}:${slug}:${userId || 'anon'}`;
    const existing = this.inFlightSlugLookups.get(inFlightKey);
    if (existing) {
      return existing.then((detail) => this.withLegacyEnrichment(detail, slug));
    }

    const lookupPromise = this.resolveBySlug(
      contentType,
      slug,
      searchText,
      userId,
      negativeCacheKey
    ).finally(() => {
      this.inFlightSlugLookups.delete(inFlightKey);
    });
    this.inFlightSlugLookups.set(inFlightKey, lookupPromise);
    return lookupPromise.then((detail) => this.withLegacyEnrichment(detail, slug));
  }

  private buildSlugNotFoundCacheKey(
    contentType: CatalogContentType,
    slug: string
  ): string {
    return `catalog:slug:notfound:${contentType}:${slug}`;
  }

  private async resolveBySlug(
    contentType: CatalogContentType,
    slug: string,
    searchText: string,
    userId: string | undefined,
    negativeCacheKey: string
  ): Promise<CatalogDetailDTO> {
    return measureTiming('slug', () =>
      this.resolveBySlugInternal(contentType, slug, searchText, userId, negativeCacheKey)
    );
  }

  /** Resolves a slug against content already known to this system (local
   * media catalog) without ever calling TMDB. Returns the matching tmdbId,
   * or undefined when nothing local matches — the only case that should
   * still fall through to a live TMDB search. */
  private async findLocalSlugMatch(
    searchText: string,
    slug: string,
    tmdbType: 'movie' | 'tv'
  ): Promise<number | undefined> {
    if (!this.mediaCatalogService) {
      return undefined;
    }
    const candidates = await this.mediaCatalogService.findKnownMatchesForTitles([searchText]);
    const match = candidates.find(
      (entry) =>
        entry.tmdbType === tmdbType &&
        (this.slugify(entry.title) === slug || this.slugifyTitle(entry.title) === slug)
    );
    return match?.tmdbId;
  }

  private async resolveBySlugInternal(
    contentType: CatalogContentType,
    slug: string,
    searchText: string,
    userId: string | undefined,
    negativeCacheKey: string
  ): Promise<CatalogDetailDTO> {
    // For TMDB content: check the local media catalog first (titles already
    // seen through EPG, search or a prior detail view) — a slug for known
    // content should never have to pay a live TMDB search. Only a genuinely
    // new-to-this-system title falls through to TMDB.
    if (contentType === 'movie' || contentType === 'series') {
      const tmdbType = contentType === 'movie' ? 'movie' : 'tv';
      const localMatch = await this.findLocalSlugMatch(searchText, slug, tmdbType);
      if (localMatch) {
        return this.getTmdbDetail(localMatch, tmdbType, userId);
      }

      const results = tmdbType === 'movie'
        ? await this.tmdbService.searchMovies(searchText, { page: 1, limit: 10 })
        : await this.tmdbService.searchTV(searchText, { page: 1, limit: 10 });

      const match = results.find(
        (entry) =>
          this.slugify(entry.title || entry.name || '') === slug ||
          this.slugifyTitle(entry.title || entry.name || '') === slug
      );
      if (match) {
        return this.getTmdbDetail(match.id, tmdbType, userId);
      }
      // Fallback: the TV read model. EPG serials are classified as
      // 'series'/'movie' by category inference, but daily serials have no
      // TMDB entry and must still resolve against today's TV airings.
      {
        const tvFound = await this.findTvReadItemBySlug(
          searchText,
          slug,
          DateUtils.getTodayYYYYMMDD(),
          contentType
        );
        if (tvFound) {
          return this.getProgramDetail(tvFound.id, userId);
        }
        const tvTomorrow = await this.findTvReadItemBySlug(
          searchText,
          slug,
          DateUtils.getTomorrowYYYYMMDD(),
          contentType
        );
        if (tvTomorrow) {
          return this.getProgramDetail(tvTomorrow.id, userId);
        }
      }
      await this.cacheSlugNotFound(negativeCacheKey);
      throw new NotFoundError('Catalog item', slug);
    }

    // For programs, search against the canonical TV read model.
    const found = await this.findTvReadItemBySlug(searchText, slug, DateUtils.getTodayYYYYMMDD());
    if (found) {
      return this.getProgramDetail(found.id, userId);
    }

    const foundTomorrow = await this.findTvReadItemBySlug(
      searchText,
      slug,
      DateUtils.getTomorrowYYYYMMDD()
    );
    if (foundTomorrow) {
      return this.getProgramDetail(foundTomorrow.id, userId);
    }

    await this.cacheSlugNotFound(negativeCacheKey);
    throw new NotFoundError('Catalog item', slug);
  }

  /**
   * Whether `/programas/:slug` resolves today or tomorrow: exactly the lookup `resolveBySlugInternal` runs for a
   * programme, so the sitemap can list only URLs that answer 200.
   */
  async programSlugResolves(slug: string): Promise<boolean> {
    const searchText = String(slug || '').replace(/-/g, ' ').trim();
    if (!searchText) return false;
    const found =
      (await this.findTvReadItemBySlug(searchText, slug, DateUtils.getTodayYYYYMMDD())) ??
      (await this.findTvReadItemBySlug(searchText, slug, DateUtils.getTomorrowYYYYMMDD()));
    // The page then loads the item by id (getProgramDetail -> getItem), which answers 404 for an item that is not
    // consumer-visible. The lookup does not apply that rule, so apply it here (same row, no extra query).
    return Boolean(found) && isConsumerVisibleTvReadItem(found as TvReadItemDTO);
  }

  /**
   * M10: the `/programas/:slug` broadcast page of this TMDB work, only when the page's own lookup resolves the slug to a
   * visible airing that carries the same TMDB id (a homonymous programme is not this work). At most two candidate slugs.
   */
  private async resolveProgrammePath(tmdbId: number, contentType: CatalogContentType, airings: CatalogAiringDTO[]): Promise<string | undefined> {
    // Legacy `slugify` on purpose: /programas URLs keep it (the sitemap and airingDetailSlug('program') use it).
    const slugs = [...new Set(airings.map((airing) => slugify(airing.title)).filter((slug) => slug !== 'sin-titulo'))].slice(0, 2);
    // On the request path: every lookup runs at once; the page's own order (today, then tomorrow) is kept in the result.
    const today = DateUtils.getTodayYYYYMMDD();
    const tomorrow = DateUtils.getTomorrowYYYYMMDD();
    const found = await Promise.all(slugs.map(async (slug) => {
      const searchText = slug.replace(/-/g, ' ');
      const [first, second] = await Promise.all([today, tomorrow].map((date) => this.findTvReadItemBySlug(searchText, slug, date)));
      return { slug, item: (first ?? second) as TvReadItemDTO | null };
    }));
    // TMDB movie and tv ids share one number space: the kind must agree too.
    const match = found.find(({ item }) => item && isConsumerVisibleTvReadItem(item) && item.program?.tmdbId === tmdbId
      && this.inferTvReadContentType(item) === contentType);
    return match ? `/programas/${match.slug}` : undefined;
  }

  private async cacheSlugNotFound(negativeCacheKey: string): Promise<void> {
    try {
      await this.cacheRepository.set(negativeCacheKey, true, this.slugNotFoundTtlSeconds);
    } catch {
      /* non-fatal: worst case we just re-check TMDB next time */
    }
  }

  async resolveRecommendation(
    input: ResolveRecommendationInput
  ): Promise<CatalogItemDTO | null> {
    const query = String(input.title || '').trim();
    if (!query) {
      return null;
    }

    if (input.type === 'program' || input.channel) {
      return this.resolveTvRecommendation(input);
    }

    const items = await this.query({
      q: query,
      limit: 6,
      page: 1,
      types: input.type ? [input.type] : undefined,
      platforms: input.platform ? [input.platform] : undefined,
      availability: input.channel ? ['live'] : undefined,
      sort: input.channel ? 'airtime' : 'popular',
    });

    return (
      items.items.find((item) => {
        if (input.type && item.contentType !== input.type) {
          return false;
        }
        if (
          input.channel &&
          !String(item.channel?.name || '')
            .toLowerCase()
            .includes(String(input.channel).toLowerCase())
        ) {
          return false;
        }
        return this.normalizeToken(item.title) === this.normalizeToken(query);
      }) ||
      items.items[0] ||
      null
    );
  }

  private async loadProgramItems(
    query: Required<CatalogQueryParams>
  ): Promise<CatalogItemDTO[]> {
    if (
      !query.types.includes('program') &&
      !query.types.includes('movie') &&
      !query.types.includes('series')
    ) {
      return [];
    }

    const includePrograms =
      !query.availability.length || query.availability.includes('live');
    if (!includePrograms) {
      return [];
    }

    const items = await this.loadTvReadItems(query);
    const filtered = items
      .filter((item) => {
        const type = this.inferTvReadContentType(item);
        if (!query.types.includes('program') && type === 'program') {
          return false;
        }
        if (!query.types.includes(type)) {
          return false;
        }
        if (query.timeSlot && !this.tvReadItemMatchesTimeSlot(item, query.timeSlot)) {
          return false;
        }
        if (query.q && !this.tvReadItemMatchesQuery(item, query.q)) {
          return false;
        }
        if (
          query.availability.includes('live') &&
          query.availability.length === 1 &&
          !query.timeSlot &&
          !item.airing.liveNow
        ) {
          return false;
        }
        return true;
      })
      .slice(0, 1200);

    return filtered.map((item) => this.mapTvReadItemToCatalogItem(item));
  }

  private async loadStreamingItems(
    query: Required<CatalogQueryParams>
  ): Promise<CatalogItemDTO[]> {
    const includeStreaming =
      !query.availability.length ||
      query.availability.some((value) =>
        ['streaming', 'free', 'flatrate', 'rent', 'buy'].includes(value)
      );

    if (!includeStreaming) {
      return [];
    }

    const tmdbTypes = query.types.filter((type) => type === 'movie' || type === 'series');
    if (!tmdbTypes.length) {
      return [];
    }

    const providerHydrationLimit = this.resolveProviderHydrationLimit(
      query,
      tmdbTypes.length
    );

    const providerIds = query.platforms
      .map((platform) => this.findPlatform(platform)?.tmdbProviderId)
      .filter((value): value is number => typeof value === 'number');
    const monetizationTypes = this.mapAvailabilityToWatchTypes(query.availability);
    const movieGenreIds = this.mapGenreNamesToIds(query.genres, 'movie');
    const tvGenreIds = this.mapGenreNamesToIds(query.genres, 'tv');

    const requests: Array<Promise<CatalogItemDTO[]>> = [];
    if (tmdbTypes.includes('movie')) {
      requests.push(
        this.loadTmdbTypeItems('movie', {
          q: query.q,
          page: query.page,
          sort: query.sort,
          providerIds,
          monetizationTypes,
          genreIds: movieGenreIds,
          providerHydrationLimit,
        })
      );
    }
    if (tmdbTypes.includes('series')) {
      requests.push(
        this.loadTmdbTypeItems('tv', {
          q: query.q,
          page: query.page,
          sort: query.sort,
          providerIds,
          monetizationTypes,
          genreIds: tvGenreIds,
          providerHydrationLimit,
        })
      );
    }

    const chunks = await Promise.all(requests);
    return chunks.flat();
  }

  private async loadTmdbTypeItems(
    type: 'movie' | 'tv',
    params: {
      q?: string;
      page: number;
      sort: string;
      providerIds: number[];
      monetizationTypes: Array<'flatrate' | 'free' | 'rent' | 'buy'>;
      genreIds: number[];
      providerHydrationLimit: number;
    }
  ): Promise<CatalogItemDTO[]> {
    const items = params.q
      ? type === 'movie'
        ? await this.tmdbService.searchMovies(params.q, { page: params.page, limit: 24 })
        : await this.tmdbService.searchTV(params.q, { page: params.page, limit: 24 })
      : (
          type === 'movie'
            ? await this.tmdbService.discoverMovies({
                page: params.page,
                sortBy: this.mapSortToTmdb(params.sort, type),
                withWatchProviders: params.providerIds,
                withGenres: params.genreIds,
                watchMonetizationTypes: params.monetizationTypes,
              })
            : await this.tmdbService.discoverTV({
                page: params.page,
                sortBy: this.mapSortToTmdb(params.sort, type),
                withWatchProviders: params.providerIds,
                withGenres: params.genreIds,
                watchMonetizationTypes: params.monetizationTypes,
              })
        ).results;

    const withProviders = await Promise.all(
      items.slice(0, params.providerHydrationLimit).map(async (entry) => {
        const whereToWatch =
          type === 'movie'
            ? await this.streamingProvidersService.getMovieProviders(entry.id)
            : await this.streamingProvidersService.getTVProviders(entry.id);
        return this.mapTmdbToCatalogItem(entry, type, whereToWatch || undefined);
      })
    );

    return withProviders.filter(Boolean) as CatalogItemDTO[];
  }

  private resolveProviderHydrationLimit(
    query: Required<CatalogQueryParams>,
    typeCount: number
  ): number {
    const normalizedTypeCount = Math.max(typeCount, 1);
    // Was clamped to 48/[12,24] — with 2 content types requested (the
    // default movie+series grid), that left only 12 of a TMDB page's ~20
    // results actually hydrated (the rest silently dropped by the
    // `.slice(providerHydrationLimit)` in loadTmdbTypeItems), which is the
    // root cause of "plataformas" pages showing very little content per
    // page. Raised modestly, not unbounded — this still drives one
    // provider-lookup TMDB call per hydrated item.
    const requestedLimit = Math.min(Math.max(query.limit || 24, 1), 96);
    const multiplier =
      query.availability.includes('free') || query.platforms.length ? 2 : 1;
    const perTypeTarget = Math.ceil(
      (requestedLimit * multiplier) / normalizedTypeCount
    );

    return Math.min(Math.max(perTypeTarget, 16), 40);
  }

  /**
   * Critical detail path for an EPG/program-sourced catalogId. Returns only
   * what's needed to render the page: the airing itself (already fetched,
   * free), plus cast/director/synopsis *when already available locally* —
   * never a live TMDB call. Providers, related titles, social summary and
   * user interaction are deliberately left out; the frontend fetches them via
   * `getDetailEnrichment` after the critical response has rendered.
   */
  private async getProgramDetail(
    programId: string,
    _userId?: string
  ): Promise<CatalogDetailDTO> {
    const tvReadDetail = await measureTiming('media', () =>
      this.tvReadQueryService.getItem(programId)
    );
    const item = this.mapTvReadItemToCatalogItem(tvReadDetail.item);
    const tmdbType = this.resolveProgramTmdbType(
      this.inferTvReadContentType(tvReadDetail.item),
      item.tmdbId
    );
    const tmdbDetail =
      tmdbType && item.tmdbId
        ? await measureTiming('tmdb', () => this.fetchLocalTmdbDetail(item.tmdbId as number, tmdbType))
        : null;

    // A URL is not identity: homonymous works can share a slug. Reject explicit identity conflicts before titles.
    const own = this.mapTvReadItemToAiring(tvReadDetail.item);
    const sameWork = (candidate: TvReadItemDTO) => {
      if (this.inferTvReadContentType(candidate) !== item.contentType) return false;
      const original = tvReadDetail.item.program;
      const related = candidate.program;
      if (original.mediaId && related.mediaId && original.mediaId !== related.mediaId) return false;
      if (original.tmdbId && related.tmdbId && original.tmdbId !== related.tmdbId) return false;
      if (original.mediaId && original.mediaId === related.mediaId) return true;
      if (original.tmdbId && original.tmdbId === related.tmdbId) return true;
      const workTitle = (title: string) => this.normalizeToken(
        (item.contentType === 'series' && episodeWorkTitle(title)) || title
      );
      return workTitle(original.title) === workTitle(related.title);
    };
    const airings = this.mergeAirings([own], tvReadDetail.relatedChannelItems.filter(sameWork).map((slot) => this.mapTvReadItemToAiring(slot)));
    const channelAirings = tvReadDetail.relatedChannelItems.filter((slot) => !sameWork(slot)).map((slot) => this.mapTvReadItemToAiring(slot));

    return {
      ...item,
      synopsis: tmdbDetail?.overview || item.synopsis,
      image: item.image || this.tmdbService.getImageUrl(tmdbDetail?.poster_path || null),
      backdrop:
        item.backdrop || this.tmdbService.getImageUrl(tmdbDetail?.backdrop_path || null, 'original'),
      cast: this.mapCast(tmdbDetail),
      director: this.extractDirector(tmdbDetail),
      airings,
      channelAirings,
      enrichmentPending: true,
    };
  }

  public mapTvReadItemToCatalogItem(
    item: TvReadItemDTO,
    providers?: CatalogWhereToWatchDTO
  ): CatalogItemDTO {
    const contentType = this.inferTvReadContentType(item);
    const slug = this.airingDetailSlug(contentType, item.program.title);
    const image =
      item.assets.poster?.url ||
      (item.assets.primary?.kind === 'poster' || item.assets.primary?.kind === 'backdrop'
        ? item.assets.primary?.url
        : undefined);
    const backdrop =
      item.assets.backdrop?.url ||
      item.assets.poster?.url ||
      (item.assets.primary?.kind === 'poster' || item.assets.primary?.kind === 'backdrop'
        ? item.assets.primary?.url
        : undefined);

    return {
      catalogId: buildProgramCatalogId(item.id),
      source: 'program',
      contentType,
      title: item.program.title,
      slug,
      detailPath: programDetailPath(item.id),
      workPath: item.program.workPath,
      subtitle: item.program.subtitle,
      synopsis: item.program.description,
      image,
      backdrop,
      assets: item.assets,
      sourceProvenance: item.sourceProvenance,
      timingContext: item.timingContext,
      genres: this.extractTvReadGenres(item),
      tmdbId: item.program.tmdbId,
      durationMinutes: item.airing.durationMinutes,
      start: item.airing.start,
      end: item.airing.end,
      liveNow: item.airing.liveNow,
      primaryPlatforms: this.extractPrimaryPlatforms(providers),
      whereToWatch: providers,
      channel: {
        id: item.channel.id,
        name: item.channel.name,
        icon: item.channel.icon,
        normalizedName: item.channel.normalizedName,
        aliases: item.channel.aliases,
        sourceIds: item.channel.sourceIds,
        type: item.channel.group,
        region: item.channel.region,
      },
      airings: [this.mapTvReadItemToAiring(item)],
    };
  }

  /**
   * Critical detail path for a TMDB-sourced catalogId (movie/series). The
   * only unavoidable network dependency here is the local-catalog-first
   * `fetchTmdbDetail` — it resolves from L1/Redis/Mongo for any content seen
   * before, and only reaches TMDB on a genuine first-ever view of that id.
   * Providers, related titles, social summary and user interaction are left
   * to `getDetailEnrichment` — none of them are required to render the page.
   */
  private async getTmdbDetail(
    tmdbId: number,
    type: 'movie' | 'tv',
    _userId?: string
  ): Promise<CatalogDetailDTO> {
    const detail = await measureTiming('tmdb', () => this.fetchTmdbDetail(tmdbId, type));
    if (!detail) {
      throw new NotFoundError('TMDB content', String(tmdbId));
    }

    const item = this.mapTmdbToCatalogItem(detail, type);
    const airings = await measureTiming('airings', () =>
      this.loadAiringsForTmdb(detail, item.contentType)
    );
    const original = (detail.original_title || detail.original_name || '').trim();
    const programmePath = airings.length
      ? await measureTiming('programme', () => this.resolveProgrammePath(tmdbId, item.contentType, airings).catch(() => undefined))
      : undefined;

    return {
      ...item,
      programmePath,
      // The full record of this same TMDB id (search results carry none of these). A series' runtime is per
      // episode, so only a film gets a duration.
      genres: (detail.genres ?? []).map((genre) => genre.name).filter(Boolean),
      durationMinutes: type === 'movie' && Number.isInteger(detail.runtime) && (detail.runtime as number) > 0 ? detail.runtime : undefined,
      originalTitle: original && titleIdentityKey(original) !== titleIdentityKey(item.title) ? original : undefined,
      cast: this.mapCast(detail),
      director: this.extractDirector(detail),
      airings,
      enrichmentPending: true,
    };
  }

  /**
   * Secondary, deferrable data for a detail page: related titles (with their
   * own provider lookups), social summary, where-to-watch providers for the
   * primary item, and the caller's own interaction/watchlist state. Called
   * by the frontend only after the critical response has rendered, and never
   * allowed to fail the whole request — each section degrades to "absent" on
   * its own error so one slow/broken dependency can't take out the others.
   */
  async getDetailEnrichment(
    catalogId: string,
    userId?: string
  ): Promise<CatalogDetailEnrichmentDTO> {
    const parsed = parseCatalogId(catalogId);
    if (!parsed) {
      throw new NotFoundError('Catalog item', catalogId);
    }

    if (parsed.source === 'program' && parsed.programId) {
      return this.getProgramDetailEnrichment(parsed.programId, userId);
    }

    if (parsed.source === 'tmdb' && parsed.tmdbId && parsed.tmdbType) {
      return this.getTmdbDetailEnrichment(parsed.tmdbId, parsed.tmdbType, userId);
    }

    throw new NotFoundError('Catalog item', catalogId);
  }

  private async getProgramDetailEnrichment(
    programId: string,
    userId?: string
  ): Promise<CatalogDetailEnrichmentDTO> {
    const tvReadDetail = await this.tvReadQueryService.getItem(programId);
    const item = this.mapTvReadItemToCatalogItem(tvReadDetail.item);
    const tmdbType = this.resolveProgramTmdbType(
      this.inferTvReadContentType(tvReadDetail.item),
      item.tmdbId
    );

    const [whereToWatch, related, socialSummary, userInteraction] = await Promise.allSettled([
      measureTiming('providers', () => this.resolveTvReadProviders(tvReadDetail.item, tmdbType)),
      measureTiming('related', () => this.loadRelatedForTvReadItem(tvReadDetail.item)),
      measureTiming('social', () => this.loadSocialSummary(userId, item)),
      measureTiming('social', () => this.loadSingleUserInteraction(userId, item.catalogId)),
    ]);

    return {
      related: settledOr(related, []),
      socialSummary: settledOr(socialSummary, undefined),
      whereToWatch: settledOr(whereToWatch, undefined),
      userInteraction: settledOr(userInteraction, undefined),
    };
  }

  private async getTmdbDetailEnrichment(
    tmdbId: number,
    type: 'movie' | 'tv',
    userId?: string
  ): Promise<CatalogDetailEnrichmentDTO> {
    const detail = await this.fetchTmdbDetail(tmdbId, type);
    if (!detail) {
      return { related: [] };
    }

    // `item` here is only used to key the social/interaction lookups
    // (catalogId/title/tmdbId) — none of those depend on providers, so it's
    // built eagerly rather than waiting on the providers call below.
    const item = this.mapTmdbToCatalogItem(detail, type);

    const [providers, related, socialSummary, userInteraction] = await Promise.allSettled([
      measureTiming('providers', () =>
        type === 'movie'
          ? this.streamingProvidersService.getMovieProviders(tmdbId)
          : this.streamingProvidersService.getTVProviders(tmdbId)
      ),
      measureTiming('related', () => this.loadRelatedForTmdb(detail, type)),
      measureTiming('social', () => this.loadSocialSummary(userId, item)),
      measureTiming('social', () => this.loadSingleUserInteraction(userId, item.catalogId)),
    ]);

    const providersValue = settledOr(providers, null);
    return {
      related: settledOr(related, []),
      socialSummary: settledOr(socialSummary, undefined),
      whereToWatch: providersValue ? this.mapWatchProviders(providersValue) : undefined,
      userInteraction: settledOr(userInteraction, undefined),
    };
  }

  private slugify(text: string): string {
    return slugify(text);
  }

  private slugifyTitle(text: string): string {
    return slugifyTitle(text);
  }

  private airingDetailSlug(contentType: CatalogContentType, title: string): string {
    return airingDetailSlug(contentType, title);
  }

  private buildDetailPath(contentType: CatalogContentType, slug: string): string {
    return buildDetailPath(contentType, slug);
  }

  private mapTmdbToCatalogItem(
    entry: TMDBResult,
    type: 'movie' | 'tv',
    providers?: WatchProvidersResult
  ): CatalogItemDTO {
    const whereToWatch = providers ? this.mapWatchProviders(providers) : undefined;
    const contentType: CatalogContentType = type === 'movie' ? 'movie' : 'series';
    const title = entry.title || entry.name || '';
    const slug = this.slugifyTitle(title);
    const primaryPlatform = this.extractPrimaryPlatforms(whereToWatch)[0];
    const assets = buildCatalogAssetSet({
      poster: this.tmdbService.getImageUrl(entry.poster_path),
      backdrop: this.tmdbService.getImageUrl(entry.backdrop_path, 'original'),
      platformLogo: this.resolvePrimaryPlatformLogo(primaryPlatform),
      posterSource: 'tmdb_poster',
      backdropSource: 'tmdb_backdrop',
    });

    return {
      catalogId: buildTmdbCatalogId(type, entry.id),
      source: 'tmdb',
      contentType,
      title,
      slug,
      detailPath: this.buildDetailPath(contentType, slug),
      synopsis: entry.overview || '',
      image: assets.poster?.url,
      backdrop: assets.backdrop?.url,
      assets,
      sourceProvenance: {
        schedule: [],
        metadata: ['tmdb'],
        assets: Array.from(new Set(assets.fallbackChain.map((asset) => asset.source))),
      },
      timingContext: {
        liveNow: false,
        window: 'unknown',
      },
      genres: [],
      tmdbId: entry.id,
      rating: typeof entry.vote_average === 'number' && !isNaN(entry.vote_average) ? entry.vote_average : undefined,
      releaseYear: this.extractYear(entry.release_date || entry.first_air_date),
      liveNow: false,
      primaryPlatforms: this.extractPrimaryPlatforms(whereToWatch),
      whereToWatch,
    };
  }

  private mergeItems(items: CatalogItemDTO[], channelMap: Map<string, any>): CatalogItemDTO[] {
    const merged = new Map<string, CatalogItemDTO>();

    items.forEach((item) => {
      const key = item.tmdbId ? `${item.contentType}:${item.tmdbId}` : item.catalogId;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, item);
        return;
      }

      const preferred =
        item.source === 'program' && (item.liveNow || !existing.liveNow)
          ? item
          : existing;
      const secondary = preferred === item ? existing : item;

      merged.set(key, {
        ...preferred,
        image: preferred.image || secondary.image,
        backdrop: preferred.backdrop || secondary.backdrop,
        assets: this.mergeAssetSets(preferred.assets, secondary.assets),
        synopsis: preferred.synopsis || secondary.synopsis,
        sourceProvenance: {
          schedule: Array.from(
            new Set([
              ...(preferred.sourceProvenance?.schedule || []),
              ...(secondary.sourceProvenance?.schedule || []),
            ])
          ),
          metadata: Array.from(
            new Set([
              ...(preferred.sourceProvenance?.metadata || []),
              ...(secondary.sourceProvenance?.metadata || []),
            ])
          ),
          assets: Array.from(
            new Set([
              ...(preferred.sourceProvenance?.assets || []),
              ...(secondary.sourceProvenance?.assets || []),
            ])
          ),
        },
        timingContext: preferred.timingContext || secondary.timingContext,
        genres: Array.from(new Set([...(preferred.genres || []), ...(secondary.genres || [])])),
        primaryPlatforms: Array.from(
          new Set([...(preferred.primaryPlatforms || []), ...(secondary.primaryPlatforms || [])])
        ),
        whereToWatch: preferred.whereToWatch || secondary.whereToWatch,
        airings: this.mergeAirings(preferred.airings, secondary.airings),
        channel:
          preferred.channel ||
          secondary.channel ||
          (preferred.source === 'program' && preferred.airings?.[0]
            ? {
                id: preferred.airings[0].channelId,
                name: preferred.airings[0].channelName,
                icon: preferred.airings[0].channelIcon,
              }
            : undefined),
      });
    });

    return Array.from(merged.values()).map((item) => {
      if (!item.channel && item.airings?.length) {
        const first = item.airings[0];
        const channel = channelMap.get(first.channelId);
        return {
          ...item,
          channel: {
            id: first.channelId,
            name: first.channelName,
            icon: first.channelIcon || channel?.icon || undefined,
          },
        };
      }
      return item;
    });
  }

  private async loadAiringsForTmdb(
    detail: TMDBDetailResult,
    contentType: CatalogContentType
  ): Promise<CatalogAiringDTO[]> {
    const title = detail.title || detail.name || '';
    const matches = await this.findProgramMatches(
      title,
      detail.id,
      contentType === 'series' ? 'series' : 'movie'
    );
    return matches.map((entry) => this.mapTvReadItemToAiring(entry));
  }

  private async loadRelatedForTmdb(
    detail: TMDBDetailResult,
    type: 'movie' | 'tv'
  ): Promise<CatalogItemDTO[]> {
    const topGenreIds = (detail.genres || []).slice(0, 2).map((genre) => genre.id);
    const discovered =
      type === 'movie'
        ? await this.tmdbService.discoverMovies({
            withGenres: topGenreIds,
            page: 1,
            sortBy: 'popularity.desc',
          })
        : await this.tmdbService.discoverTV({
            withGenres: topGenreIds,
            page: 1,
            sortBy: 'popularity.desc',
          });

    const providers = await Promise.all(
      discovered.results
        .filter((item) => item.id !== detail.id)
        .slice(0, 8)
        .map(async (item) => {
          const watch =
            type === 'movie'
              ? await this.streamingProvidersService.getMovieProviders(item.id)
              : await this.streamingProvidersService.getTVProviders(item.id);
          return this.mapTmdbToCatalogItem(item, type, watch || undefined);
        })
    );

    return providers;
  }

  private async attachUserInteractions(
    items: CatalogItemDTO[],
    userId?: string
  ): Promise<CatalogItemDTO[]> {
    if (!userId || !items.length) {
      return items;
    }

    const interactionMap = await this.loadInteractionMap(
      userId,
      items.map((item) => item.catalogId)
    );

    return items.map((item) => ({
      ...item,
      userInteraction: interactionMap.get(item.catalogId) || item.userInteraction,
    }));
  }

  private async loadSingleUserInteraction(
    userId: string | undefined,
    catalogId: string
  ) {
    if (!userId) {
      return undefined;
    }

    const map = await this.loadInteractionMap(userId, [catalogId]);
    return map.get(catalogId);
  }

  private async loadInteractionMap(userId: string, catalogIds: string[]) {
    const acceptedIds = Array.from(
      new Set(catalogIds.flatMap((catalogId) => this.expandAcceptedContentIds(catalogId)))
    );

    const [interactions, listItems] = await Promise.all([
      UserContentInteractionModel.find({
        userId,
        contentId: { $in: acceptedIds },
      })
        .lean()
        .exec(),
      UserListItemModel.find({
        userId,
        contentId: { $in: acceptedIds },
      })
        .lean()
        .exec(),
    ]);

    const listIds = Array.from(
      new Set(listItems.map((item: any) => String(item.listId || '')).filter(Boolean))
    );
    const lists = listIds.length
      ? await UserListModel.find({ _id: { $in: listIds } }).lean().exec()
      : [];
    const listTitleById = new Map(
      lists.map((list: any) => [String(list._id), String(list.title || '')])
    );

    const result = new Map<string, CatalogItemDTO['userInteraction']>();
    catalogIds.forEach((catalogId) => {
      const aliases = this.expandAcceptedContentIds(catalogId);
      const interaction = interactions.find((entry: any) =>
        aliases.includes(String(entry.contentId || ''))
      );
      const matchingListItems = listItems.filter((entry: any) =>
        aliases.includes(String(entry.contentId || ''))
      );

      if (!interaction && !matchingListItems.length) {
        return;
      }

      result.set(catalogId, {
        status: interaction?.status || (matchingListItems.length ? 'pending' : undefined),
        rating: typeof interaction?.rating === 'number' ? interaction.rating : undefined,
        liked: Boolean(interaction?.liked),
        inWatchlist: matchingListItems.length > 0,
        lists: matchingListItems
          .map((entry: any) => listTitleById.get(String(entry.listId || '')) || '')
          .filter(Boolean),
        watchedAt: interaction?.watchedAt
          ? new Date(interaction.watchedAt).toISOString()
          : undefined,
      });
    });

    return result;
  }

  private async loadSocialSummary(
    userId: string | undefined,
    item: CatalogItemDTO
  ): Promise<CatalogDetailDTO['socialSummary']> {
    if (!userId) {
      return undefined;
    }

    const followeeIds = await findFolloweeIds(userId);
    if (!followeeIds.length) {
      return undefined;
    }

    const acceptedIds = this.expandAcceptedContentIds(item.catalogId);
    const stats = await aggregateFriendActivity(followeeIds, [
      { contentId: { $in: acceptedIds } },
      ...(item.tmdbId ? [{ tmdbId: item.tmdbId }] : []),
      { contentTitle: new RegExp(`^${this.escapeRegex(item.title)}$`, 'i') },
    ]);

    return stats || undefined;
  }

  private mapWatchProviders(providers: WatchProvidersResult): CatalogWhereToWatchDTO {
    const mapProviders = (
      input: WatchProvidersResult['flatrate'],
      type: CatalogProviderDTO['type']
    ): CatalogProviderDTO[] =>
      input.map((provider) => ({
        id: provider.providerId,
        name: provider.providerName,
        logoUrl: provider.logoPath
          ? this.streamingProvidersService.getLogoUrl(provider.logoPath)
          : '',
        type,
        deepLink: providers.link || undefined,
      }));

    return {
      flatrate: mapProviders(providers.flatrate, 'flatrate'),
      rent: mapProviders(providers.rent, 'rent'),
      buy: mapProviders(providers.buy, 'buy'),
      free: mapProviders(providers.free, 'free'),
      tmdbLink: providers.link || '',
    };
  }

  private extractPrimaryPlatforms(
    whereToWatch?: CatalogWhereToWatchDTO
  ): string[] {
    if (!whereToWatch) {
      return [];
    }

    return Array.from(
      new Set(
        [
          ...(whereToWatch.flatrate || []),
          ...(whereToWatch.free || []),
          ...(whereToWatch.rent || []),
          ...(whereToWatch.buy || []),
        ]
          .map((provider) => provider.name)
          .filter(Boolean)
      )
    );
  }

  private resolvePrimaryPlatformLogo(platformName?: string): string | undefined {
    return this.findPlatform(platformName || '')?.logoUrl;
  }

  private mergeAssetSets(
    primary?: CatalogItemDTO['assets'],
    secondary?: CatalogItemDTO['assets']
  ): CatalogItemDTO['assets'] | undefined {
    const fallbackChain = [
      ...(primary?.fallbackChain || []),
      ...(secondary?.fallbackChain || []),
    ].filter(
      (asset, index, assets) =>
        index ===
        assets.findIndex(
          (candidate) =>
            candidate.kind === asset.kind &&
            candidate.url === asset.url &&
            candidate.source === asset.source
        )
    );

    if (!fallbackChain.length) {
      return primary || secondary;
    }

    const primaryVisual =
      primary?.primary?.kind === 'poster' || primary?.primary?.kind === 'backdrop'
        ? primary.primary
        : undefined;
    const secondaryVisual =
      secondary?.primary?.kind === 'poster' || secondary?.primary?.kind === 'backdrop'
        ? secondary.primary
        : undefined;
    const fallbackVisual =
      fallbackChain.find((asset) => asset.kind === 'poster') ||
      fallbackChain.find((asset) => asset.kind === 'backdrop');

    return {
      primary: primaryVisual || secondaryVisual || fallbackVisual,
      poster: primary?.poster || secondary?.poster,
      backdrop: primary?.backdrop || secondary?.backdrop,
      channelLogo: primary?.channelLogo || secondary?.channelLogo,
      platformLogo: primary?.platformLogo || secondary?.platformLogo,
      fallbackChain,
    };
  }

  private mapAvailabilityToWatchTypes(
    availability: string[]
  ): Array<'flatrate' | 'free' | 'rent' | 'buy'> {
    const resolved = new Set<'flatrate' | 'free' | 'rent' | 'buy'>();
    availability.forEach((value) => {
      if (value === 'streaming' || value === 'flatrate') {
        resolved.add('flatrate');
      }
      if (value === 'free') {
        resolved.add('free');
      }
      if (value === 'rent') {
        resolved.add('rent');
      }
      if (value === 'buy') {
        resolved.add('buy');
      }
    });

    return Array.from(resolved);
  }

  private computeScore(
    item: CatalogItemDTO,
    sort: string,
    preferences: CatalogPreferences
  ): number {
    const genreBoost = item.genres.some((genre) =>
      preferences.favoriteGenres.has(this.normalizeToken(genre))
    )
      ? 0.25
      : 0;
    const platformBoost = item.primaryPlatforms.some((platform) =>
      preferences.preferredPlatforms.has(this.normalizeToken(platform))
    )
      ? 0.2
      : 0;
    const ratingScore = Math.min(1, Number(item.rating || 0) / 10);
    const liveBoost = item.liveNow ? 0.4 : item.start ? 0.2 : 0;

    if (sort === 'airtime') {
      return liveBoost + this.computeAirtimeScore(item);
    }
    if (sort === 'rating') {
      return ratingScore + genreBoost + platformBoost;
    }
    if (sort === 'recent') {
      return this.computeRecencyScore(item) + genreBoost + platformBoost;
    }
    if (sort === 'personalized') {
      return genreBoost + platformBoost + ratingScore * 0.35 + liveBoost * 0.2;
    }

    return ratingScore * 0.5 + liveBoost * 0.2 + genreBoost + platformBoost;
  }

  private computeAirtimeScore(item: CatalogItemDTO): number {
    if (!item.start) {
      return 0;
    }
    const start = new Date(item.start).getTime();
    const delta = Math.abs(start - Date.now());
    return Math.max(0, 1 - delta / (1000 * 60 * 60 * 24));
  }

  private computeRecencyScore(item: CatalogItemDTO): number {
    if (!item.releaseYear) {
      return item.start ? this.computeAirtimeScore(item) : 0;
    }
    const deltaYears = Math.max(0, new Date().getFullYear() - item.releaseYear);
    return Math.max(0, 1 - deltaYears / 20);
  }

  private buildHotCatalogCacheKey(
    query: Required<CatalogQueryParams>
  ): string | null {
    if (query.userId || query.q || query.page !== 1 || query.limit > 96) {
      return null;
    }

    const isHotAvailability =
      !query.availability.length ||
      query.availability.every((value) =>
        ['live', 'streaming', 'free', 'flatrate', 'rent', 'buy'].includes(value)
      );
    if (!isHotAvailability) {
      return null;
    }

    return `catalog:hot:v2:${query.date}:${query.timeSlot || 'all'}:${query.sort}:${query.types.join(',')}:${query.platforms.join(',')}:${query.genres.join(',')}:${query.availability.join(',')}`;
  }

  private matchesAvailability(item: CatalogItemDTO, availability: string[]): boolean {
    if (!availability.length) {
      return true;
    }

    if (availability.includes('live') && item.source === 'program') {
      return true;
    }

    if (
      availability.includes('streaming') &&
      (item.primaryPlatforms.length > 0 || item.source === 'tmdb')
    ) {
      return true;
    }

    const whereToWatch = item.whereToWatch;
    if (!whereToWatch) {
      return false;
    }

    return availability.some((value) => {
      if (value === 'free') return Boolean(whereToWatch.free?.length);
      if (value === 'flatrate') return Boolean(whereToWatch.flatrate?.length);
      if (value === 'rent') return Boolean(whereToWatch.rent?.length);
      if (value === 'buy') return Boolean(whereToWatch.buy?.length);
      return false;
    });
  }

  private matchesPlatforms(item: CatalogItemDTO, platforms: string[]): boolean {
    if (!platforms.length) {
      return true;
    }

    const itemPlatforms = new Set(
      item.primaryPlatforms.map((platform) => this.normalizeToken(platform))
    );
    return platforms.some((platform) => itemPlatforms.has(this.normalizeToken(platform)));
  }

  private matchesGenres(item: CatalogItemDTO, genres: string[]): boolean {
    if (!genres.length) {
      return true;
    }

    // Alias-tolerant: a request for "action"/"accion" matches an item tagged
    // with the canonical "Acción" label, not just an exact string match.
    return genres.some((genre) =>
      item.genres.some((itemGenre) => genreLabelsMatch(itemGenre, genre))
    );
  }

  private matchesSeenFilter(
    item: CatalogItemDTO,
    sort: string,
    preferences: CatalogPreferences
  ): boolean {
    if (sort !== 'personalized') {
      return true;
    }

    if (preferences.excludeSeen.has(item.catalogId)) {
      return false;
    }

    if (
      item.tmdbId &&
      preferences.excludeSeen.has(
        item.contentType === 'series'
          ? buildTmdbCatalogId('tv', item.tmdbId)
          : buildTmdbCatalogId('movie', item.tmdbId)
      )
    ) {
      return false;
    }

    return true;
  }

  private async loadPreferences(userId?: string): Promise<CatalogPreferences> {
    if (!userId) {
      return {
        favoriteGenres: new Set(),
        preferredPlatforms: new Set(),
        excludeSeen: new Set(),
      };
    }

    const [profile, genreProfile, history] = await Promise.all([
      UserProfileModel.findOne({ userId }).lean().exec(),
      this.interactionRepository.getUserGenreProfile(userId),
      this.interactionRepository.findByUser(userId, { limit: 250 }),
    ]);

    const excludeSeen = new Set<string>();
    history
      .filter((entry) => entry.status === 'seen' || entry.status === 'dropped')
      .forEach((entry) => {
        excludeSeen.add(normalizeInteractionContentId(entry));
      });

    return {
      favoriteGenres: new Set(
        [...(profile?.favoriteGenres || []), ...genreProfile.genres.map((item) => item.genre)].map((item) =>
          this.normalizeToken(item)
        )
      ),
      preferredPlatforms: new Set(
        [...(profile?.preferredPlatforms || []), ...genreProfile.preferredPlatforms].map((item) =>
          this.normalizeToken(item)
        )
      ),
      excludeSeen,
    };
  }

  private normalizeQuery(params: CatalogQueryParams): Required<CatalogQueryParams> {
    return {
      userId: params.userId || '',
      q: String(params.q || '').trim(),
      types: this.normalizeTypes(params.types),
      genres: this.normalizeStringArray(params.genres),
      platforms: this.normalizeStringArray(params.platforms),
      availability: this.normalizeAvailability(params.availability),
      date: this.normalizeDate(params.date),
      timeSlot: String(params.timeSlot || '').trim(),
      sort: this.normalizeSort(params.sort),
      page: Math.max(1, Number(params.page || 1)),
      limit: Math.min(1000, Math.max(1, Number(params.limit || 24))),
    };
  }

  private normalizeTypes(value?: string[]): CatalogContentType[] {
    const input = Array.isArray(value) ? value : [];
    const normalized = Array.from(
      new Set(
        input
          .map((item) => String(item || '').trim().toLowerCase())
          .map((item) => {
            if (item === 'movies') return 'movie';
            if (item === 'tv') return 'program';
            if (item === 'programs') return 'program';
            if (item === 'series') return 'series';
            if (item === 'movie') return 'movie';
            if (item === 'program') return 'program';
            return '';
          })
          .filter(Boolean) as CatalogContentType[]
      )
    );

    return normalized.length ? normalized : ['movie', 'series'];
  }

  private normalizeAvailability(value?: string[]): string[] {
    const normalized = this.normalizeStringArray(value);
    return normalized.filter((entry) =>
      ['live', 'streaming', 'free', 'flatrate', 'rent', 'buy'].includes(
        entry
      )
    );
  }

  private normalizeStringArray(value?: string[]): string[] {
    return Array.from(
      new Set(
        (Array.isArray(value) ? value : [])
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      )
    );
  }

  private normalizeDate(value?: string): string {
    const raw = String(value || 'today').trim();
    if (!raw) {
      return DateUtils.getTodayYYYYMMDD();
    }

    try {
      return DateUtils.parseDateAlias(raw);
    } catch {
      return DateUtils.getTodayYYYYMMDD();
    }
  }

  private normalizeSort(value?: string): string {
    const raw = String(value || 'popular').trim().toLowerCase();
    return ['personalized', 'popular', 'rating', 'airtime', 'recent'].includes(raw)
      ? raw
      : 'popular';
  }

  private mapSortToTmdb(
    sort: string,
    type: 'movie' | 'tv'
  ): 'popularity.desc' | 'vote_average.desc' | 'primary_release_date.desc' | 'first_air_date.desc' {
    if (sort === 'rating' || sort === 'personalized') {
      return 'vote_average.desc';
    }
    if (sort === 'recent') {
      return type === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc';
    }
    return 'popularity.desc';
  }

  private mapGenreNamesToIds(
    genres: string[],
    type: 'movie' | 'tv'
  ): number[] {
    const source = type === 'movie' ? MOVIE_GENRE_IDS : TV_GENRE_IDS;
    return Array.from(
      new Set(
        genres
          .map((genre) => this.normalizeToken(genre))
          .map((genre) => source[genre])
          .filter((genreId): genreId is number => typeof genreId === 'number')
      )
    );
  }

  private inferTvReadContentType(item: TvReadItemDTO): CatalogContentType {
    return this.inferCatalogContentTypeFromValues(
      item.program.editorialCategory,
      item.program.genre,
      item.program.title
    );
  }

  private inferCatalogContentTypeFromValues(editorialCategory?: string, genre?: string, title?: string): CatalogContentType {
    return inferContentType(editorialCategory, genre, title);
  }

  private inferTmdbTypeFromContentType(
    type: CatalogContentType
  ): 'movie' | 'tv' | null {
    if (type === 'movie') return 'movie';
    if (type === 'series') return 'tv';
    return null;
  }

  /**
   * Same as inferTmdbTypeFromContentType, but for the generic 'program'
   * bucket (an EPG item whose genre/category text matched neither the
   * "movie" nor "series" tokens — see inferTvReadContentType) it no longer
   * hard-blocks enrichment: when the item carries a linked tmdbId, default
   * to 'tv' rather than null. Most EPG entertainment programs that get a
   * tmdbId at all are episodic TV formats in TMDB's catalog. This was the
   * actual root cause of "programas" detail pages rendering with no
   * cast/director/backdrop even when a tmdbId was present — getProgramDetail
   * and getProgramDetailEnrichment never attempted the TMDB lookup for
   * plain 'program' content. If the id turns out to be a movie in TMDB,
   * fetchLocalTmdbDetail's existing not-found handling degrades gracefully
   * to "no enrichment", same as before this fix.
   */
  private resolveProgramTmdbType(
    type: CatalogContentType,
    tmdbId: number | undefined
  ): 'movie' | 'tv' | null {
    const inferred = this.inferTmdbTypeFromContentType(type);
    if (inferred) {
      return inferred;
    }
    return tmdbId ? 'tv' : null;
  }

  private extractTvReadGenres(item: TvReadItemDTO): string[] {
    // Normalizes each raw source value (EPG editorial category, TMDB-derived
    // genre/genreTags, composite strings like "Acción/Aventura") against the
    // canonical genre taxonomy. Unrecognized values pass through unchanged.
    return normalizeGenreList([
      item.program.editorialCategory,
      item.program.genre,
      item.program.subgenre,
      ...(item.program.genreTags || []),
    ]);
  }

  private tvReadItemMatchesQuery(item: TvReadItemDTO, q: string): boolean {
    const token = this.normalizeToken(q);
    return [
      item.program.title,
      item.program.subtitle,
      item.program.description,
      item.program.genre,
      item.program.subgenre,
      item.program.editorialCategory,
      item.channel.name,
      ...(item.channel.aliases || []),
    ].some((value) => this.normalizeToken(value || '').includes(token));
  }

  private tvReadItemMatchesTimeSlot(item: TvReadItemDTO, timeSlot: string): boolean {
    const slot = Number(timeSlot);
    if (!Number.isFinite(slot)) {
      return true;
    }
    const hours = new Date(item.airing.start).getHours();
    if (slot === 6) return hours >= 18 && hours < 21;
    if (slot === 7) return hours >= 21 || hours < 3;
    const ranges: Array<[number, number]> = [
      [0, 3],
      [3, 6],
      [6, 9],
      [9, 12],
      [12, 15],
      [15, 18],
    ];
    const range = ranges[slot] || ranges[0];
    return hours >= range[0] && hours < range[1];
  }

  private async loadChannelMap() {
    const cacheKey = 'catalog:channels:v1';
    const cached = l1Cache.get(cacheKey) as Map<string, any> | undefined;
    if (cached) {
      return cached;
    }

    const channels = await this.channelRepository.findAll();
    const channelMap = new Map(channels.map((channel) => [channel.id, channel.toJSON()]));
    l1Cache.set(cacheKey, channelMap, this.channelMapTtlMs);
    return channelMap;
  }

  private async findProgramMatches(
    title: string,
    tmdbId?: number,
    contentType?: 'movie' | 'series'
  ): Promise<TvReadItemDTO[]> {
    const dates = [DateUtils.getTodayYYYYMMDD(), DateUtils.getTomorrowYYYYMMDD()];

    // Identity is known (the common case: this is called from a resolved TMDB
    // detail) — use the indexed program.tmdbId+date query instead of loading
    // every airing for the day and filtering in process. This is the airings
    // lookup on the *critical* detail-page path, so it must stay a bounded,
    // indexed read.
    if (tmdbId) {
      const chunks = await Promise.all(
        dates.map((date) =>
          TVReadAiringModel.find({ date, 'program.tmdbId': tmdbId })
            .sort({ 'airing.start': 1 })
            .limit(12)
            .lean()
            .exec()
        )
      );
      // Film and TV ids are separate TMDB namespaces, and a series airing may still carry a same-titled film's id
      // (M03-L2): an airing of the opposite kind is never a broadcast of this page. Programme-classed airings stay.
      const opposite = contentType === 'movie' ? 'series' : contentType === 'series' ? 'movie' : undefined;
      return chunks
        .flatMap((chunk) => chunk as unknown as TvReadItemDTO[])
        .filter((program) => !opposite || this.inferTvReadContentType(program) !== opposite)
        .slice(0, 12);
    }

    // No tmdbId to key off of (defensive fallback, not exercised by the
    // resolved-TMDB-detail call site): use the searchTokens index to get a
    // bounded candidate set per day rather than scanning the full day.
    const normalizedTitle = this.normalizeToken(title);
    const tokens = buildSearchTokens([title])
      .filter((token) => !token.includes(' ') && !token.includes('_') && token.length >= 3)
      .sort((left, right) => right.length - left.length)
      .slice(0, 6);
    if (!tokens.length) {
      return [];
    }

    const chunks = await Promise.all(
      dates.map((date) =>
        TVReadAiringModel.find({ date, searchTokens: { $in: tokens } })
          .sort({ 'airing.start': 1 })
          .limit(200)
          .lean()
          .exec()
      )
    );
    return chunks
      .flatMap((chunk) => chunk as unknown as TvReadItemDTO[])
      .filter((program) => {
        if (contentType) {
          const inferred = this.inferTvReadContentType(program);
          if (inferred !== contentType) {
            return false;
          }
        }
        return this.normalizeToken(program.program.title) === normalizedTitle;
      })
      .slice(0, 12);
  }

  private async findTvReadItemBySlug(
    searchText: string,
    slug: string,
    date: string,
    contentType?: CatalogContentType
  ): Promise<TvReadItemDTO | null> {
    // Never hydrate the whole day's 20k+ airings for a slug lookup. Bots
    // enumerate distinct missing slugs, so negative caching cannot protect
    // this first lookup and the former day-view fallback retained a large
    // array per concurrent request. searchTokens has a compound Mongo index;
    // use it to obtain a bounded candidate set, then preserve the canonical
    // exact-slug comparison in process. Multiple tokens are intentional:
    // the legacy slugifier drops accented characters ("región" -> "regin"),
    // so another title token may be the one that locates that real program.
    const tokens = buildSearchTokens([searchText])
      .filter((token) => !token.includes(' ') && !token.includes('_') && token.length >= 3)
      .sort((left, right) => right.length - left.length)
      .slice(0, 6);
    if (!tokens.length) {
      return null;
    }

    // Query tokens from most distinctive to least distinctive. searchTokens
    // also holds the editorial category and channel names, so a token such as
    // "deportes" tags thousands of airings: a capped, start-sorted `find`
    // never reaches an exact title like "Deportes". Distinct titles for the
    // token are small and uncapped; only the exact slug match is then loaded.
    for (const token of tokens) {
      const titles = (await TVReadAiringModel.distinct('program.title', {
        date,
        searchTokens: token,
      }).exec()) as string[];
      // Every slug airingDetailSlug may have linked: legacy, accent-folded, or the work of an episode title.
      const title = titles.find((candidate) => {
        const work = episodeWorkTitle(candidate);
        return [this.slugify(candidate), this.slugifyTitle(candidate), ...(work ? [this.slugifyTitle(work)] : [])].includes(slug);
      });
      if (!title) continue;
      // The token narrows the lookup to that title's few airings ({searchTokens, date} index) instead of walking
      // the whole day through the date/start index (production 2026-10-21: 11,697 docs, 499 ms -> 2 docs, 2 ms).
      // Only a token of the title itself: every airing of the title carries those (TvReadModelBuilder searchTokens),
      // so the result is the same airing (checked on 32,351 production airings, 41,435 title tokens: 0 differences).
      // distinct() found the title through an airing carrying the token, so the narrowed query matches unless a
      // concurrent rebuildDate replaced the day in between; the title-only query then answers as before.
      const earliest = (filter: Record<string, unknown>) =>
        TVReadAiringModel.findOne(filter).sort({ 'airing.start': 1 }).lean().exec() as unknown as Promise<TvReadItemDTO | null>;
      const byTitle = { date, 'program.title': title };
      const match =
        (buildSearchTokens([title]).includes(token) ? await earliest({ ...byTitle, searchTokens: token }) : null) ??
        (await earliest(byTitle));
      if (match && (!contentType || this.inferTvReadContentType(match) === contentType)) return match;
    }
    return null;
  }

  private async loadTvReadItems(
    query: Required<CatalogQueryParams>
  ): Promise<TvReadItemDTO[]> {
    const view = this.resolveTvReadView(query);
    const limit = query.q ? 240 : view === 'day' ? 2400 : 1200;
    const response = await this.tvReadQueryService.query({
      view,
      date: query.date,
      q: query.q || undefined,
      limit,
    });
    return response.items;
  }

  private async resolveTvRecommendation(
    input: ResolveRecommendationInput
  ): Promise<CatalogItemDTO | null> {
    const query = String(input.title || '').trim();
    const dates = [DateUtils.getTodayYYYYMMDD(), DateUtils.getTomorrowYYYYMMDD()];

    for (const date of dates) {
      const response = await this.tvReadQueryService.query({
        view: 'search',
        date,
        q: query,
        limit: 24,
      });

      const matches = response.items.filter((item) => {
        if (
          input.channel &&
          !String(item.channel.name || '')
            .toLowerCase()
            .includes(String(input.channel || '').toLowerCase())
        ) {
          return false;
        }

        if (input.type && this.inferTvReadContentType(item) !== input.type) {
          return false;
        }

        return this.normalizeToken(item.program.title) === this.normalizeToken(query);
      });

      const picked = matches[0] || response.items[0];
      if (picked) {
        return this.mapTvReadItemToCatalogItem(picked);
      }
    }

    return null;
  }

  private resolveTvReadView(query: Required<CatalogQueryParams>): TvReadView {
    if (query.q) {
      return 'search';
    }
    if (query.timeSlot === '6' || query.timeSlot === '7') {
      return 'night';
    }
    if (
      query.availability.length === 1 &&
      query.availability.includes('live') &&
      !query.timeSlot
    ) {
      return 'now';
    }
    return 'day';
  }

  private mergeAirings(
    primary?: CatalogAiringDTO[],
    secondary?: CatalogAiringDTO[]
  ): CatalogAiringDTO[] | undefined {
    const merged = [...(primary || []), ...(secondary || [])];
    if (!merged.length) {
      return undefined;
    }
    const seen = new Set<string>();
    return merged.filter((airing) => {
      const key = `${airing.channelId}:${airing.start}:${airing.end}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private mapTvReadItemToAiring(item: TvReadItemDTO): CatalogAiringDTO {
    return {
      channelId: item.channel.id,
      channelNormalizedName: item.channel.normalizedName,
      channelName: item.channel.name,
      channelIcon: item.channel.icon,
      start: item.airing.start,
      end: item.airing.end,
      title: item.program.title,
      catalogId: buildProgramCatalogId(item.id),
      detailPath: programDetailPath(item.id),
      workPath: item.program.workPath,
      liveNow: item.airing.liveNow,
      // Same fallback chain mapTvReadItemToCatalogItem uses for `image` —
      // without this, "Próximas emisiones"/"A continuación" cards on the
      // detail page had no artwork at all, just text.
      image:
        item.assets.poster?.url ||
        (item.assets.primary?.kind === 'poster' || item.assets.primary?.kind === 'backdrop'
          ? item.assets.primary?.url
          : undefined),
    };
  }

  private async loadRelatedForTvReadItem(
    item: TvReadItemDTO
  ): Promise<CatalogItemDTO[]> {
    const response = await this.tvReadQueryService.query({
      view: 'day',
      date: item.airing.date,
      category: item.program.editorialCategory,
      limit: 18,
    });

    return response.items
      .filter((candidate) => candidate.id !== item.id)
      .slice(0, 8)
      .map((candidate) => this.mapTvReadItemToCatalogItem(candidate));
  }

  private async resolveTvReadProviders(
    item: TvReadItemDTO,
    tmdbType: 'movie' | 'tv' | null
  ): Promise<CatalogWhereToWatchDTO | undefined> {
    if (!tmdbType || !item.program.tmdbId) {
      return undefined;
    }

    const providers =
      tmdbType === 'movie'
        ? await this.streamingProvidersService.getMovieProviders(item.program.tmdbId)
        : await this.streamingProvidersService.getTVProviders(item.program.tmdbId);

    return providers ? this.mapWatchProviders(providers) : undefined;
  }

  private mapCast(detail: TMDBDetailResult | null | undefined) {
    return (detail?.credits?.cast || []).slice(0, 10).map((person) => ({
      name: person.name,
      character: person.character,
      profile: this.tmdbService.getImageUrl(person.profile_path || null),
    }));
  }

  private extractDirector(detail: TMDBDetailResult | null | undefined) {
    const crew = detail?.credits?.crew || [];
    const director = crew.find(
      (person) => person.job === 'Director' || person.department === 'Directing'
    );
    return director?.name;
  }

  private extractYear(value?: string): number | undefined {
    if (!value) {
      return undefined;
    }
    const year = Number(String(value).slice(0, 4));
    return Number.isFinite(year) ? year : undefined;
  }

  private findPlatform(name: string) {
    const normalized = this.normalizeToken(name);
    for (const platform of CATALOG_PLATFORM_REGISTRY) {
      if (this.normalizeToken(platform.name) === normalized) {
        return platform;
      }
    }
    return CATALOG_PLATFORM_NAME_MAP.get(String(name || '').trim().toLowerCase()) || null;
  }

  private normalizeToken(value: string): string {
    return normalizeToken(value);
  }

  private expandAcceptedContentIds(catalogId: string): string[] {
    const parsed = parseCatalogId(catalogId);
    if (!parsed) {
      return [catalogId];
    }
    if (parsed.source === 'program' && parsed.programId) {
      return [catalogId, parsed.programId];
    }
    if (parsed.source === 'tmdb' && parsed.tmdbId) {
      return [catalogId, String(parsed.tmdbId)];
    }
    return [catalogId];
  }

  private escapeRegex(value: string): string {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

/**
 * Unwraps one leg of a `Promise.allSettled` enrichment batch: a rejected leg
 * degrades to `fallback` (and is logged) instead of taking down the other,
 * unrelated secondary sections in the same response.
 */
function settledOr<T>(result: PromiseSettledResult<T>, fallback: T): T {
  if (result.status === 'fulfilled') {
    return result.value;
  }
  logger.child('CatalogService').warn('Secondary enrichment section failed', {
    error: (result.reason as Error)?.message || String(result.reason),
  });
  return fallback;
}
