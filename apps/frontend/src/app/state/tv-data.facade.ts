import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { EMPTY, catchError, combineLatest, expand, map, Observable, of, retry, scan, shareReplay, switchMap, timer } from 'rxjs';
import { TvApiService } from '../api/tv-api.service';
import {
  ChannelMetaDTO,
  TvGuideSurfaceDTO,
  TvReadChannelSummaryDTO,
  TvReadItemDTO,
} from '../api/models';
import { CatalogItem, CatalogPlatform, CatalogResponse, FALLBACK_CATALOG_GENRES, FALLBACK_CATALOG_PLATFORMS } from '../services/catalog.service';
import { DiscoveryBrowseResponse, DiscoveryService } from '../services/discovery.service';
import { CatalogService } from '../services/catalog.service';
import {
  UnifiedAvailability,
  UnifiedContentType,
  UnifiedDiscoverIntent,
  UnifiedLiveFlag,
} from './unified-guide.state';

export type UnifiedDiscoveryItem = TvReadItemDTO | CatalogItem;

export interface UnifiedDiscoveryResult {
  items: UnifiedDiscoveryItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  };
  availablePlatforms: CatalogPlatform[];
  availableGenres: string[];
}

export interface UnifiedLiveFilters {
  group?: string;
  category?: string;
  date?: string;
  channel?: string;
  channelType?: string;
  region?: string;
  flags?: UnifiedLiveFlag[];
  q?: string;
  limit?: number;
  /** ISO country code (e.g. 'GB'); omitted or 'es'/'all' keeps today's unfiltered Spanish channels. */
  country?: string;
}

export interface UnifiedDiscoverFilters {
  q?: string;
  types?: UnifiedContentType[];
  availability?: UnifiedAvailability[];
  platforms?: string[];
  genres?: string[];
  intent?: UnifiedDiscoverIntent;
  sort?: string;
  date?: string;
  page?: number;
  limit?: number;
}

export interface UnifiedStreamingFilters {
  q?: string;
  platform?: string;
  type?: '' | 'movie' | 'series';
  availability?: UnifiedAvailability[];
  genres?: string[];
  sort?: string;
  page?: number;
  limit?: number;
}

@Injectable({ providedIn: 'root' })
export class TvDataFacade {
  private readonly isBrowser: boolean;

  constructor(
    private readonly tvApi: TvApiService,
    private readonly discoveryService: DiscoveryService,
    private readonly catalogService: CatalogService,
    @Inject(DOCUMENT) private readonly document: Document,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  getLivePrograms(filters: UnifiedLiveFilters = {}): Observable<TvReadItemDTO[]> {
    return this.readView('now', filters);
  }

  getNextPrograms(filters: UnifiedLiveFilters = {}): Observable<TvReadItemDTO[]> {
    return this.readView('next', filters);
  }

  getTonightPrograms(filters: UnifiedLiveFilters = {}): Observable<TvReadItemDTO[]> {
    return this.readView('tonight', filters);
  }

  getAllPrograms(filters: UnifiedLiveFilters = {}): Observable<TvReadItemDTO[]> {
    const limit = Math.min(Math.max(filters.limit || 240, 1), 240);
    const requestPage = (cursor?: string) => this.tvApi.getTvRead({
      view: 'day',
      date: filters.date || 'today',
      group: normalizeAll(filters.group),
      category: normalizeCategory(filters.category),
      channelId: filters.channel,
      q: filters.q,
      limit,
      cursor,
      includeChannels: false,
    });

    return requestPage().pipe(
      expand((response, pageIndex) => {
        const cursor = response.data?.meta.nextCursor;
        // SSR transfers only the bounded first viewport. The hydrated browser
        // progressively appends a few batches without exposing pagination UI.
        return this.isBrowser && cursor && pageIndex < 3
          ? requestPage(cursor).pipe(catchError(() => EMPTY))
          : EMPTY;
      }),
      map((response) => response.data?.items || []),
      scan((items, page) => [...items, ...page], [] as TvReadItemDTO[]),
      catchError(() => of([]))
    );
  }

  getDaySchedule(filters: UnifiedLiveFilters = {}): Observable<TvReadItemDTO[]> {
    return this.tvApi.getTvReadSchedule({
      date: filters.date || 'today',
      group: normalizeAll(filters.group),
      category: normalizeCategory(filters.category),
      channelId: filters.channel || undefined,
      q: String(filters.q || '').trim() || undefined,
      // The API slices each channel from the start of the broadcast day (the previous evening), so a cap of 32
      // cut channels with short programmes (kids and documentary channels run 80-150 a day) off in the early
      // morning: their rows in the parrilla were empty from then on. The cap is the server's maximum instead —
      // a whole TDT day is 934 KB (+37 %), still bounded by `fields=grid`.
      itemsPerChannel: 192,
      // Light per-item projection (no synopsis, image sets or provenance): ~5× smaller, also in the SSR transfer state.
      fields: 'grid',
      country: filters.country,
    }).pipe(
      retry({ count: 2, delay: 350 }),
      map((response) => this.applyLiveFilters(
        (response.data?.channels || []).flatMap((entry) => entry.items),
        filters
      ))
    );
  }

  searchTvPrograms(filters: UnifiedLiveFilters = {}): Observable<TvReadItemDTO[]> {
    return this.readView('search', filters);
  }

  getChannels(group?: string, date = 'today'): Observable<ChannelMetaDTO[]> {
    return this.tvApi.getTvReadChannels(date, normalizeAll(group)).pipe(
      map((response) =>
        (response.data?.channels || []).map((entry) => entry.channel).filter(Boolean)
      ),
      catchError(() => of([]))
    );
  }

  getChannelDirectory(
    group?: string,
    date = 'today',
    limit?: number
  ): Observable<TvReadChannelSummaryDTO[]> {
    return this.tvApi.getTvReadChannels(date, normalizeAll(group), limit).pipe(
      map((response) => response.data?.channels || []),
      catchError(() => of([]))
    );
  }

  getGuideSurface(filters: UnifiedLiveFilters = {}): Observable<TvGuideSurfaceDTO> {
    return this.tvApi
      .getTvGuideSurface({
        date: filters.date || 'today',
        group: normalizeAll(filters.group),
        category: normalizeCategory(filters.category),
      })
      .pipe(
        retry({ count: 2, delay: 350 }),
        map(
          (response) => response.data || this.emptyGuideSurface(filters)
        ),
        catchError(() => of(this.emptyGuideSurface(filters)))
      );
  }

  watchGuideSurface(filters: UnifiedLiveFilters = {}, refreshMs = 60_000): Observable<TvGuideSurfaceDTO> {
    return timer(0, refreshMs).pipe(
      switchMap(() => (this.shouldPoll() ? this.getGuideSurface(filters) : of(null))),
      map((surface) => surface as TvGuideSurfaceDTO),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  discoverContent(filters: UnifiedDiscoverFilters = {}): Observable<UnifiedDiscoveryResult> {
    const normalized = this.normalizeDiscoverFilters(filters);
    if (normalized.q) {
      return this.searchContent(normalized.q, normalized);
    }

    const requests: Observable<UnifiedDiscoveryResult>[] = [];
    const includePrograms = normalized.types.includes('program');
    const includeMovies = normalized.types.includes('movie');
    const includeSeries = normalized.types.includes('series');

    if (includePrograms) {
      const view: 'now' | 'all' =
        normalized.availability.includes('live') || !normalized.availability.length
          ? 'now'
          : 'all';
      requests.push(
        this.readView(view, {
          date: normalized.date,
          q: normalized.q,
          limit: 48,
        }).pipe(
          map((items) => ({
            items: items
              .filter((item) => this.matchesDiscoverTvItem(item, normalized))
              .sort((left, right) => this.compareDiscoveryItems(left, right, normalized)),
            meta: {
              total: items.length,
              page: normalized.page,
              limit: normalized.limit,
              hasMore: false,
            },
            availableGenres: FALLBACK_CATALOG_GENRES,
            availablePlatforms: FALLBACK_CATALOG_PLATFORMS,
          }))
        )
      );
    }

    if (includeMovies) {
      requests.push(this.browseDiscoveryType('movie', normalized));
    }

    if (includeSeries) {
      requests.push(this.browseDiscoveryType('series', normalized));
    }

    if (!requests.length) {
      return of(this.emptyDiscoveryResult(normalized.page, normalized.limit));
    }

    return combineLatest(requests).pipe(
      map((results) => this.mergeDiscoveryResults(results, normalized.page, normalized.limit))
    );
  }

  searchContent(q: string, context: Partial<UnifiedDiscoverFilters> = {}): Observable<UnifiedDiscoveryResult> {
    const normalized = this.normalizeDiscoverFilters({
      ...context,
      q,
    });
    const singleType =
      normalized.types.length === 1 &&
      normalized.types[0] !== 'program'
        ? normalized.types[0]
        : normalized.types.length === 1 && normalized.types[0] === 'program'
          ? 'program'
          : undefined;
    const singleGenre = normalized.genres.length === 1 ? normalized.genres[0] : undefined;
    const singlePlatform = normalized.platforms.length === 1 ? normalized.platforms[0] : undefined;

    return this.discoveryService
      .search({
        q: normalized.q,
        type: singleType,
        genre: singleGenre,
        platform: singlePlatform,
        limit: normalized.limit,
        page: normalized.page,
      })
      .pipe(
        map((response) => {
          const filtered = (response.items || []).filter((item) =>
            this.matchesUnifiedItem(item, normalized)
          );
          return {
            items: filtered,
            meta: {
              total: filtered.length,
              page: normalized.page,
              limit: normalized.limit,
              hasMore: Boolean(response.meta?.hasMore),
            },
            availableGenres:
              response.availableGenres?.length ? response.availableGenres : FALLBACK_CATALOG_GENRES,
            availablePlatforms:
              response.availablePlatforms?.length
                ? response.availablePlatforms
                : FALLBACK_CATALOG_PLATFORMS,
          };
        }),
        catchError(() => of(this.emptyDiscoveryResult(normalized.page, normalized.limit)))
      );
  }

  getStreamingContent(filters: UnifiedStreamingFilters = {}): Observable<CatalogResponse> {
    const normalized = {
      q: String(filters.q || '').trim(),
      platform: String(filters.platform || '').trim(),
      type: filters.type === 'movie' || filters.type === 'series' ? filters.type : '',
      availability: Array.isArray(filters.availability) ? filters.availability.filter(Boolean) : [],
      genres: Array.isArray(filters.genres) ? filters.genres.filter(Boolean) : [],
      sort: String(filters.sort || 'popular').trim(),
      page: Math.max(1, Number(filters.page || 1)),
      limit: Math.max(1, Number(filters.limit || 24)),
    };

    const types = normalized.type ? [normalized.type] : (['movie', 'series'] as const);
    const requests = types.map((type) =>
      this.discoveryService.browse({
        type,
        q: normalized.q || undefined,
        platform: normalized.platform || undefined,
        genre: normalized.genres.length ? normalized.genres.join(',') : undefined,
        availability: this.resolveStreamingAvailability(normalized.availability),
        sort: normalized.sort,
        page: normalized.page,
        limit: normalized.limit,
      })
    );

    return combineLatest(requests).pipe(
      map((responses) => this.mergeCatalogResponses(responses, normalized.page, normalized.limit)),
      map((response) => ({
        ...response,
        items: response.items.filter((item) =>
          !normalized.genres.length ||
          normalized.genres.every((genre) => item.genres?.includes(genre))
        ),
      })),
      catchError(() => of({
        items: [],
        meta: {
          total: 0,
          page: normalized.page,
          limit: normalized.limit,
          hasMore: false,
        },
        availableGenres: [],
        availablePlatforms: FALLBACK_CATALOG_PLATFORMS,
      }))
    );
  }

  getPlatforms(): Observable<CatalogPlatform[]> {
    return this.catalogService.getPlatformsState().pipe(
      map((result) => result.data || FALLBACK_CATALOG_PLATFORMS),
      catchError(() => of(FALLBACK_CATALOG_PLATFORMS))
    );
  }

  getForYou(limit = 12): Observable<CatalogItem[]> {
    return this.catalogService.getForYouState(limit).pipe(
      map((result) => (Array.isArray(result.data) ? result.data : []).map(unwrapForYouItem)),
      catchError(() => of([]))
    );
  }

  private readView(
    view: 'now' | 'next' | 'tonight' | 'all' | 'search',
    filters: UnifiedLiveFilters
  ): Observable<TvReadItemDTO[]> {
    return this.tvApi
      .getTvRead({
        view,
        date: filters.date || 'today',
        group: normalizeAll(filters.group),
        category: normalizeCategory(filters.category),
        channelId: filters.channel || undefined,
        q: String(filters.q || '').trim() || undefined,
        limit: filters.limit,
        includeChannels: false,
      })
      .pipe(
        retry({ count: 2, delay: 350 }),
        map((response) => this.applyLiveFilters(response.data?.items || [], filters)),
        catchError(() => of([]))
      );
  }

  private browseDiscoveryType(
    type: 'movie' | 'series',
    filters: ReturnType<TvDataFacade['normalizeDiscoverFilters']>
  ): Observable<UnifiedDiscoveryResult> {
    return this.discoveryService
      .browse({
        type,
        q: filters.q || undefined,
        genre: filters.genres.length ? filters.genres.join(',') : undefined,
        platform: filters.platforms.length ? filters.platforms.join(',') : undefined,
        availability: filters.availability.length ? filters.availability.join(',') : undefined,
        sort: filters.sort,
        page: filters.page,
        limit: filters.limit,
      })
      .pipe(
        map((response) => ({
          items: (response.items || []).filter((item) => this.matchesUnifiedItem(item, filters)),
          meta: {
            total: response.meta?.total || 0,
            page: response.meta?.page || filters.page,
            limit: response.meta?.limit || filters.limit,
            hasMore: Boolean(response.meta?.hasMore),
          },
          availablePlatforms:
            response.availablePlatforms?.length
              ? response.availablePlatforms
              : FALLBACK_CATALOG_PLATFORMS,
          availableGenres:
            response.availableGenres?.length
              ? response.availableGenres
              : FALLBACK_CATALOG_GENRES,
        })),
        catchError(() => of(this.emptyDiscoveryResult(filters.page, filters.limit)))
      );
  }

  private mergeDiscoveryResults(
    results: UnifiedDiscoveryResult[],
    page: number,
    limit: number
  ): UnifiedDiscoveryResult {
    const deduped = new Map<string, UnifiedDiscoveryItem>();
    const genres = new Set<string>();
    const platforms = new Map<string, CatalogPlatform>();
    let hasMore = false;

    results.forEach((result) => {
      hasMore = hasMore || Boolean(result.meta?.hasMore);
      result.items.forEach((item) => {
        const key = 'catalogId' in item ? item.catalogId : item.id;
        if (!deduped.has(key)) {
          deduped.set(key, item);
        }
      });
      (result.availableGenres || []).forEach((genre) => genres.add(genre));
      (result.availablePlatforms || []).forEach((platform) =>
        platforms.set(platform.name, platform)
      );
    });

    const items = Array.from(deduped.values());
    return {
      items,
      meta: {
        total: items.length,
        page,
        limit,
        hasMore,
      },
      availableGenres: Array.from(genres).sort((left, right) =>
        left.localeCompare(right, 'es')
      ),
      availablePlatforms: Array.from(platforms.values()),
    };
  }

  private mergeCatalogResponses(
    responses: DiscoveryBrowseResponse[],
    page: number,
    limit: number
  ): CatalogResponse {
    const items = new Map<string, CatalogItem>();
    const genres = new Set<string>();
    const platforms = new Map<string, CatalogPlatform>();
    let hasMore = false;

    responses.forEach((response) => {
      hasMore = hasMore || Boolean(response.meta?.hasMore);
      (response.items || []).forEach((item) => items.set(item.catalogId, item));
      (response.availableGenres || []).forEach((genre) => genres.add(genre));
      (response.availablePlatforms || []).forEach((platform) =>
        platforms.set(platform.name, platform)
      );
    });

    return {
      items: Array.from(items.values()),
      meta: {
        total: items.size,
        page,
        limit,
        hasMore,
      },
      availableGenres: Array.from(genres),
      availablePlatforms: Array.from(platforms.values()),
    };
  }

  private emptyDiscoveryResult(page = 1, limit = 24): UnifiedDiscoveryResult {
    return {
      items: [],
      meta: {
        total: 0,
        page,
        limit,
        hasMore: false,
      },
      availablePlatforms: FALLBACK_CATALOG_PLATFORMS,
      availableGenres: FALLBACK_CATALOG_GENRES,
    };
  }

  private emptyGuideSurface(filters: UnifiedLiveFilters): TvGuideSurfaceDTO {
    return {
      date: filters.date || 'today',
      filters: {},
      nowItems: [],
      nextItems: [],
      nightItems: [],
      channels: [],
      meta: {
        totalChannels: 0,
        totalItems: 0,
        primeTimeWindowStart: '21:45',
        primeTimeWindowEnd: '00:30',
        groupOrder: [],
        groupCounts: {},
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private normalizeDiscoverFilters(filters: UnifiedDiscoverFilters): {
    q: string;
    types: UnifiedContentType[];
    availability: UnifiedAvailability[];
    platforms: string[];
    genres: string[];
    intent: UnifiedDiscoverIntent;
    sort: string;
    date: string;
    page: number;
    limit: number;
  } {
    const rawTypes = filters.types?.length ? filters.types : ['program', 'movie', 'series'];
    const normalizedIntent = filters.intent || '';
    const normalizedSort =
      filters.sort ||
      (normalizedIntent === 'rating' || normalizedIntent === 'recent' || normalizedIntent === 'popular'
        ? normalizedIntent
        : 'popular');
    return {
      q: String(filters.q || '').trim(),
      types: rawTypes as UnifiedContentType[],
      availability: filters.availability || [],
      platforms: filters.platforms || [],
      genres: filters.genres || [],
      intent: normalizedIntent,
      sort: String(normalizedSort || 'popular').trim(),
      date: String(filters.date || 'today').trim(),
      page: Math.max(1, Number(filters.page || 1)),
      limit: Math.max(1, Number(filters.limit || 24)),
    };
  }

  private matchesDiscoverTvItem(
    item: TvReadItemDTO,
    filters: ReturnType<TvDataFacade['normalizeDiscoverFilters']>
  ): boolean {
    // A TV airing is not on any streaming platform: a platform filter means catalogue titles only.
    if (filters.platforms.length) {
      return false;
    }
    if (!this.matchesAvailabilityFlags(filters.availability, {
      live: Boolean(item.airing.liveNow || item.availability.live),
      streaming: Boolean(item.availability.streaming),
    })) {
      return false;
    }

    if (filters.genres.length) {
      const haystack = [
        item.program.editorialCategory,
        item.program.genre,
        item.program.subgenre,
      ]
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter(Boolean);
      const matchesGenre = filters.genres.some((genre) =>
        haystack.some((entry) => entry.includes(genre.toLowerCase()))
      );
      if (!matchesGenre) {
        return false;
      }
    }

    if (!filters.q) {
      return true;
    }
    const haystack = `${item.program.title} ${item.program.description || ''}`.toLowerCase();
    return haystack.includes(filters.q.toLowerCase());
  }

  private matchesUnifiedItem(
    item: UnifiedDiscoveryItem,
    filters: ReturnType<TvDataFacade['normalizeDiscoverFilters']>
  ): boolean {
    if ('contentType' in item && filters.types.length && !filters.types.includes(item.contentType)) {
      return false;
    }

    if (isTvItem(item)) {
      return this.matchesDiscoverTvItem(item, filters);
    }

    if (filters.platforms.length) {
      const platformNames = new Set((item.primaryPlatforms || []).map(platformKey));
      const matchesPlatform = filters.platforms.some((platform) => platformNames.has(platformKey(platform)));
      if (!matchesPlatform) {
        return false;
      }
    }

    if (filters.genres.length) {
      const genreNames = (item.genres || []).map((entry) => entry.toLowerCase());
      const matchesGenre = filters.genres.some((genre) =>
        genreNames.includes(genre.toLowerCase())
      );
      if (!matchesGenre) {
        return false;
      }
    }

    return this.matchesAvailabilityFlags(filters.availability, {
      live: Boolean(item.liveNow),
      streaming: Boolean(item.primaryPlatforms?.length),
    });
  }

  private matchesAvailabilityFlags(
    filters: UnifiedAvailability[],
    flags: { live: boolean; streaming: boolean }
  ): boolean {
    if (!filters.length) {
      return true;
    }
    return filters.some((value) => {
      if (value === 'live') return flags.live;
      if (value === 'streaming' || value === 'flatrate' || value === 'free' || value === 'rent' || value === 'buy') {
        return flags.streaming;
      }
      return true;
    });
  }

  private shouldPoll(): boolean {
    if (!this.isBrowser) {
      return true;
    }
    return this.document.visibilityState !== 'hidden';
  }

  /** Client-side channel filters (type, region, availability); the guide page applies them without a new request. */
  applyLiveFilters(items: TvReadItemDTO[], filters: UnifiedLiveFilters): TvReadItemDTO[] {
    return items.filter((item) => {
      if (filters.channel && item.channel.id !== filters.channel) {
        return false;
      }

      if (filters.channelType && filters.channelType !== 'all') {
        const type = String(item.channel.type || '').trim().toLowerCase();
        if (type !== String(filters.channelType).trim().toLowerCase()) {
          return false;
        }
      }

      if (filters.region && filters.region !== 'all') {
        const region = String(item.channel.region || item.channel.country || '').trim().toLowerCase();
        if (region !== String(filters.region).trim().toLowerCase()) {
          return false;
        }
      }

      if (filters.flags?.length) {
        const availability = {
          live: Boolean(item.airing.liveNow || item.availability.live),
          catchup: Boolean(item.availability.catchup),
          streaming: Boolean(item.availability.streaming),
        };
        if (!filters.flags.every((flag) => availability[flag])) {
          return false;
        }
      }

      return true;
    });
  }

  private compareDiscoveryItems(
    left: UnifiedDiscoveryItem,
    right: UnifiedDiscoveryItem,
    filters: ReturnType<TvDataFacade['normalizeDiscoverFilters']>
  ): number {
    if (filters.sort === 'rating') {
      return scoreOf(right) - scoreOf(left);
    }
    if (filters.sort === 'recent') {
      return timeOf(right) - timeOf(left);
    }
    if (filters.sort === 'airtime') {
      return timeOf(left) - timeOf(right);
    }
    return scoreOf(right) - scoreOf(left);
  }

  private resolveStreamingAvailability(availability: string[]): string {
    // Was `.find(...)` — collapsed every selection down to just the first
    // non-'streaming' value, so toggling multiple availability chips in the
    // UI (streaming-view.component.ts toggleAvailability) never actually
    // reached the backend as more than one filter. DiscoveryController.browse
    // already CSV-splits this param and applies it as OR, so joining all
    // selected values here is enough to make multi-select real end-to-end.
    const specific = availability.filter((value) => value && value !== 'streaming');
    return specific.length ? specific.join(',') : 'streaming';
  }
}

/** Provider names that are the same service as a platform filter (TMDB spells some differently). */
const PLATFORM_ALIASES: Record<string, string> = {
  'movistar plus': 'movistar',
  'movistar plus ficcion total': 'movistar',
  rtve: 'rtve play',
  max: 'hbo max',
};

/** Same normalisation as the backend (accents, "+" and punctuation dropped), then aliases: "Apple TV+" = "Apple TV". */
export function platformKey(name: string): string {
  const key = String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return PLATFORM_ALIASES[key] || key;
}

function isTvItem(item: UnifiedDiscoveryItem): item is TvReadItemDTO {
  return 'airing' in item;
}

/**
 * GET /discovery/for-you responds with a wrapper per recommendation
 * (`{ item, score, reason, matchedGenres, whereToWatch }`, see backend's
 * `PersonalizedRecommendation`), not a flat `CatalogItem`. Unwrap it here so
 * `normalizeToCard` receives the shape it expects — otherwise every field
 * (title, image, catalogId...) reads as undefined and cards render blank.
 */
function unwrapForYouItem(entry: unknown): CatalogItem {
  if (entry && typeof entry === 'object' && 'item' in entry) {
    return (entry as { item: CatalogItem }).item;
  }
  return entry as CatalogItem;
}

function normalizeAll(value?: string): string | undefined {
  const safe = String(value || '').trim();
  if (!safe || safe === 'all') {
    return undefined;
  }
  return safe;
}

function normalizeCategory(value?: string): string | undefined {
  const safe = String(value || '').trim();
  if (!safe || safe === 'all') {
    return undefined;
  }
  return safe;
}

function scoreOf(item: UnifiedDiscoveryItem): number {
  if ('relevance' in item) {
    return Number(item.relevance?.score || 0);
  }
  return Number(item.rating || 0);
}

function timeOf(item: UnifiedDiscoveryItem): number {
  if ('airing' in item) {
    return new Date(item.airing.start).getTime();
  }
  return new Date(item.start || 0).getTime();
}
