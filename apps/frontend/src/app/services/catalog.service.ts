import type { EntityBroadcasts } from '../pages/entity-detail/entity-detail.model';
import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, concat, of } from 'rxjs';
import { catchError, finalize, map, shareReplay } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { FALLBACK_CATALOG_PLATFORMS } from '../data/catalog-platforms.data';

export type CatalogAvailability =
  | 'live'
  | 'streaming'
  | 'free'
  | 'flatrate'
  | 'rent'
  | 'buy';
export type CatalogSort = 'personalized' | 'popular' | 'rating' | 'airtime' | 'recent';
export type CatalogContentType = 'movie' | 'series' | 'program';

export interface CatalogPlatform {
  key: string;
  name: string;
  tmdbProviderId: number;
  color: string;
  logoUrl?: string;
  supportedAvailability: CatalogAvailability[];
}

export interface CatalogRequestState<T> {
  data: T;
  unavailable: boolean;
  stale: boolean;
  status?: number;
  updatedAt?: string;
}

export interface CatalogProvider {
  id: number;
  name: string;
  logoUrl: string;
  type: 'flatrate' | 'rent' | 'buy' | 'free';
  deepLink?: string;
  price?: string;
}

export interface CatalogUserInteraction {
  status?: 'seen' | 'watching' | 'pending' | 'dropped' | string;
  rating?: number;
  liked?: boolean;
  inWatchlist: boolean;
  lists: string[];
  watchedAt?: string;
}

/** Phase 3E: verified additions the API attaches to a legacy detail payload (absent when the feature is off or the checks failed). */
export interface CatalogLegacyEnrichment {
  version: 1;
  metadata?: { originalTitle?: string; runtimeMinutes?: number; genres?: string[] };
  broadcasts?: EntityBroadcasts;
  attribution?: { notice: string; updatedAt: string };
}

export interface CatalogItem {
  catalogId: string;
  enrichment?: CatalogLegacyEnrichment;
  source: 'program' | 'tmdb';
  contentType: CatalogContentType;
  title: string;
  slug?: string;
  detailPath?: string;
  /** M10, programme-sourced items: verified work page of this airing (absent unless proven by the API). */
  workPath?: string;
  /** M10, TMDB work detail: `/programas/:slug` broadcast page of this same work (absent unless proven by the API). */
  programmePath?: string;
  /** M09-B, `/programas/:slug` only: the canonical path and robots the page declares (backend ProgrammeSeoPolicy). */
  seo?: { canonicalPath: string; robots?: string; disposition?: string; applied?: boolean };
  subtitle?: string;
  synopsis?: string;
  image?: string;
  backdrop?: string;
  genres: string[];
  tmdbId?: number;
  rating?: number;
  releaseYear?: number;
  durationMinutes?: number;
  /** TMDB detail only, when it differs from `title`. */
  originalTitle?: string;
  start?: string;
  end?: string;
  liveNow?: boolean;
  primaryPlatforms: string[];
  whereToWatch?: {
    flatrate: CatalogProvider[];
    rent: CatalogProvider[];
    buy: CatalogProvider[];
    free: CatalogProvider[];
    tmdbLink: string;
  };
  channel?: {
    id: string;
    name: string;
    icon?: string;
    normalizedName?: string;
  };
  airings?: Array<{
    channelId: string;
    /** M10: canonical channel slug source (see `channelCanonicalPath`). */
    channelNormalizedName?: string;
    channelName: string;
    channelIcon?: string;
    start: string;
    end: string;
    /** Title of the program airing in this slot — show this, not the channel name. */
    title: string;
    catalogId: string;
    detailPath: string;
    /** M10: verified work page of this airing's programme. */
    workPath?: string;
    liveNow?: boolean;
    /** Program poster/still, when the EPG source has one. */
    image?: string;
  }>;
  /** Programme-sourced detail only: the channel's other upcoming programmes, never airings of this work. */
  channelAirings?: CatalogItem['airings'];
  userInteraction?: CatalogUserInteraction;
  cast?: Array<{ name: string; character?: string; profile?: string }>;
  director?: string;
  related?: CatalogItem[];
  socialSummary?: {
    friendsWhoWatched: number;
    avgFriendRating?: number;
  };
  /** true when the backend deliberately left related/social/providers/
   * userInteraction out of this response to stay on the fast path — fetch
   * them via `CatalogService.getDetailEnrichment(catalogId)`. */
  enrichmentPending?: boolean;
}

/** Secondary detail data fetched separately from (and after) the critical
 * `getDetail`/`getBySlug` response — see `enrichmentPending`. */
export interface CatalogDetailEnrichment {
  related: CatalogItem[];
  socialSummary?: {
    friendsWhoWatched: number;
    avgFriendRating?: number;
  };
  whereToWatch?: CatalogItem['whereToWatch'];
  userInteraction?: CatalogUserInteraction;
}

export interface CatalogSuggestion {
  catalogId: string;
  source: 'program' | 'tmdb';
  contentType: CatalogContentType;
  title: string;
  slug?: string;
  detailPath?: string;
  subtitle?: string;
  image?: string;
  primaryPlatforms: string[];
}

export interface CatalogQuery {
  q?: string;
  types?: CatalogContentType[];
  genres?: string[];
  platforms?: string[];
  availability?: CatalogAvailability[];
  date?: string;
  timeSlot?: string;
  sort?: CatalogSort;
  page?: number;
  limit?: number;
}

export interface CatalogResponse {
  items: CatalogItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
  availableGenres: string[];
  availablePlatforms: CatalogPlatform[];
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
}

interface CatalogCacheEntry<T> {
  data: T;
  updatedAt: number;
  expiresAt: number;
}

interface CooldownEntry {
  until: number;
  status?: number;
}

// Bootstrap-only fallback, used while the backend-computed `availableGenres`
// facet is empty (see CatalogService.query). Keep in sync with the canonical
// genre labels in apps/backend/src/shared/taxonomy/genreTaxonomy.ts — the
// frontend and backend are separate deployables so this list is hand-synced
// rather than imported.
export const FALLBACK_CATALOG_GENRES: string[] = [
  'Cine',
  'Series',
  'Acción',
  'Aventura',
  'Comedia',
  'Drama',
  'Suspense',
  'Terror',
  'Crimen',
  'Misterio',
  'Romance',
  'Ciencia ficción',
  'Fantasía',
  'Guerra',
  'Western',
  'Animación',
  'Familia',
  'Infantil',
  'Documental',
  'Historia',
  'Música',
  'Reality',
  'Deportes',
  'Noticias',
];

export { FALLBACK_CATALOG_PLATFORMS } from '../data/catalog-platforms.data';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly isBrowser = typeof window !== 'undefined';
  private readonly baseUrl = environment.API_BASE_URL;
  private readonly cache = new Map<string, CatalogCacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Observable<CatalogRequestState<unknown>>>();
  private readonly cooldowns = new Map<string, CooldownEntry>();
  private readonly ttlByKind = {
    platforms: 10 * 60 * 1000,
    query: 60 * 1000,
    forYou: 60 * 1000,
    suggest: 30 * 1000,
    detail: 10 * 60 * 1000,
  } as const;
  private readonly rateLimitCooldownMs = 30 * 1000;
  private readonly serverCooldownMs = 20 * 1000;

  constructor(private readonly http: HttpClient) {}

  query(params: CatalogQuery = {}): Observable<CatalogResponse> {
    return this.queryState(params).pipe(map((result) => result.data));
  }

  queryState(params: CatalogQuery = {}): Observable<CatalogRequestState<CatalogResponse>> {
    let httpParams = new HttpParams();
    Object.entries({
      q: params.q,
      types: params.types?.join(','),
      genres: params.genres?.join(','),
      platforms: params.platforms?.join(','),
      availability: params.availability?.join(','),
      date: params.date,
      timeSlot: params.timeSlot,
      sort: params.sort,
      page: params.page,
      limit: params.limit,
    }).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        httpParams = httpParams.set(key, String(value));
      }
    });

    return this.requestState<CatalogResponse>({
      key: this.buildCacheKey('query', this.normalizeQuery(params)),
      ttlMs: this.ttlByKind.query,
      fallbackData: this.emptyResponse(),
      requestFactory: () =>
        this.http
          .get<ApiResponse<CatalogResponse>>(`${this.baseUrl}/catalog`, {
            params: httpParams,
            headers: this.getAuthHeaders(),
          })
          .pipe(map((resp) => resp?.data || this.emptyResponse())),
    });
  }

  getDetail(catalogId: string): Observable<CatalogItem | null> {
    return this.getDetailState(catalogId).pipe(map((state) => state.data));
  }

  /** Like `getDetail`, but keeps `unavailable`/`status` so callers can tell "not found" from "backend failed". */
  getDetailState(catalogId: string): Observable<CatalogRequestState<CatalogItem | null>> {
    if (!catalogId) {
      return of(this.toState(null, false, false));
    }

    return this.requestState<CatalogItem | null>({
      key: this.buildCacheKey('detail', catalogId),
      ttlMs: this.ttlByKind.detail,
      fallbackData: null,
      requestFactory: () =>
        this.http
          .get<ApiResponse<CatalogItem>>(
            `${this.baseUrl}/content/${encodeURIComponent(catalogId)}`,
            { headers: this.getAuthHeaders() }
          )
          .pipe(map((resp) => resp?.data || null)),
    });
  }

  getPlatforms(): Observable<CatalogPlatform[]> {
    return this.getPlatformsState().pipe(map((result) => result.data));
  }

  getPlatformsState(): Observable<CatalogRequestState<CatalogPlatform[]>> {
    return this.requestState<CatalogPlatform[]>({
      key: this.buildCacheKey('platforms', 'es'),
      ttlMs: this.ttlByKind.platforms,
      fallbackData: [...FALLBACK_CATALOG_PLATFORMS],
      requestFactory: () =>
        this.http
          .get<ApiResponse<{ items: CatalogPlatform[] }>>(`${this.baseUrl}/catalog/platforms`)
          .pipe(map((resp) => resp?.data?.items || [])),
    });
  }

  suggest(q: string, limit = 8): Observable<CatalogSuggestion[]> {
    if (!String(q || '').trim()) {
      return of([]);
    }

    return this.requestState<CatalogSuggestion[]>({
      key: this.buildCacheKey('suggest', `${String(q).trim().toLowerCase()}|${limit}`),
      ttlMs: this.ttlByKind.suggest,
      fallbackData: [],
      requestFactory: () =>
        this.http
          .get<ApiResponse<{ items: CatalogSuggestion[] }>>(
            `${this.baseUrl}/catalog/suggest`,
            {
              params: new HttpParams().set('q', String(q).trim()).set('limit', String(limit)),
              headers: this.getAuthHeaders(),
            }
          )
          .pipe(map((resp) => resp?.data?.items || [])),
    }).pipe(map((state) => state.data));
  }

  getBySlug(contentType: CatalogContentType, slug: string): Observable<CatalogItem | null> {
    return this.getBySlugState(contentType, slug).pipe(map((state) => state.data));
  }

  /** Like `getBySlug`, but keeps `unavailable`/`status` so callers can tell "not found" from "backend failed". */
  getBySlugState(
    contentType: CatalogContentType,
    slug: string
  ): Observable<CatalogRequestState<CatalogItem | null>> {
    if (!contentType || !slug) {
      return of(this.toState(null, false, false));
    }

    const normalizedSlug = String(slug).trim().toLowerCase();
    return this.requestState<CatalogItem | null>({
      key: this.buildCacheKey('detail', `slug:${contentType}:${normalizedSlug}`),
      ttlMs: this.ttlByKind.detail,
      fallbackData: null,
      requestFactory: () =>
        this.http
          .get<ApiResponse<CatalogItem>>(
            `${this.baseUrl}/catalog/slug/${encodeURIComponent(contentType)}/${encodeURIComponent(normalizedSlug)}`,
            { headers: this.getAuthHeaders() }
          )
          .pipe(map((resp) => resp?.data || null)),
    });
  }

  /**
   * Secondary detail data (related titles, providers, social summary, user
   * interaction) for a page whose critical response came back with
   * `enrichmentPending: true`. Cached/deduped the same way as `getDetail`,
   * but on its own key/TTL so a slow or failing enrichment call never
   * invalidates the already-rendered critical detail.
   */
  getDetailEnrichment(catalogId: string): Observable<CatalogDetailEnrichment> {
    const empty: CatalogDetailEnrichment = { related: [] };
    if (!catalogId) {
      return of(empty);
    }

    return this.requestState<CatalogDetailEnrichment>({
      key: this.buildCacheKey('detail', `enrichment:${catalogId}`),
      ttlMs: this.ttlByKind.detail,
      fallbackData: empty,
      requestFactory: () =>
        this.http
          .get<ApiResponse<CatalogDetailEnrichment>>(
            `${this.baseUrl}/catalog/${encodeURIComponent(catalogId)}/enrichment`,
            { headers: this.getAuthHeaders() }
          )
          .pipe(map((resp) => resp?.data || empty)),
    }).pipe(map((state) => state.data));
  }

  /**
   * Speculatively warms the detail cache/in-flight request for `catalogId`
   * ahead of navigation (hover, pointerdown, or viewport-intent on a card),
   * so that when the user actually lands on the detail route `getDetail`
   * resolves from cache instead of starting a fresh request. Safe to call
   * repeatedly — `getDetail` already dedupes and caches internally; errors
   * are swallowed since a failed *speculative* prefetch must never surface
   * anywhere, the real navigation's own request will simply try again.
   */
  prefetchDetail(catalogId: string | undefined | null): void {
    if (!catalogId || !this.isBrowser) {
      return;
    }
    this.getDetail(catalogId).subscribe({ error: () => undefined });
  }

  /** Same speculative warm-up as `prefetchDetail`, keyed by slug route instead. */
  prefetchBySlug(contentType: CatalogContentType | undefined | null, slug: string | undefined | null): void {
    if (!contentType || !slug || !this.isBrowser) {
      return;
    }
    this.getBySlug(contentType, slug).subscribe({ error: () => undefined });
  }

  getForYou(limit = 12): Observable<any[]> {
    return this.getForYouState(limit).pipe(map((result) => result.data));
  }

  getForYouState(limit = 12): Observable<CatalogRequestState<any[]>> {
    return this.requestState<any[]>({
      key: this.buildCacheKey('forYou', `limit:${limit}`),
      ttlMs: this.ttlByKind.forYou,
      fallbackData: [],
      requestFactory: () =>
        this.http
          .get<ApiResponse<{ items: any[] }>>(`${this.baseUrl}/discovery/for-you`, {
            params: new HttpParams().set('limit', String(limit)),
            headers: this.getAuthHeaders(),
          })
          .pipe(map((resp) => resp?.data?.items || [])),
    });
  }

  private emptyResponse(): CatalogResponse {
    return {
      items: [],
      meta: { page: 1, limit: 24, total: 0, hasMore: false },
      availableGenres: [...FALLBACK_CATALOG_GENRES],
      availablePlatforms: [...FALLBACK_CATALOG_PLATFORMS],
    };
  }

  private requestState<T>(options: {
    key: string;
    ttlMs: number;
    fallbackData: T;
    requestFactory: () => Observable<T>;
  }): Observable<CatalogRequestState<T>> {
    const now = Date.now();
    const cached = this.cache.get(options.key) as CatalogCacheEntry<T> | undefined;
    const cooldown = this.cooldowns.get(options.key);

    if (cached && cached.expiresAt > now) {
      return of(this.toState(cached.data, false, false, undefined, cached.updatedAt));
    }

    if (cooldown && cooldown.until > now && !this.inFlight.has(options.key)) {
      return of(
        cached
          ? this.toState(cached.data, false, true, cooldown.status, cached.updatedAt)
          : this.toState(options.fallbackData, true, false, cooldown.status)
      );
    }

    const pending = this.inFlight.get(options.key) as
      | Observable<CatalogRequestState<T>>
      | undefined;
    if (pending) {
      return cached
        ? concat(
            of(this.toState(cached.data, false, true, undefined, cached.updatedAt)),
            pending
          )
        : pending;
    }

    const request$ = options.requestFactory().pipe(
      map((data) => {
        const updatedAt = Date.now();
        this.cache.set(options.key, {
          data,
          updatedAt,
          expiresAt: updatedAt + options.ttlMs,
        });
        this.cooldowns.delete(options.key);
        return this.toState(data, false, false, undefined, updatedAt);
      }),
      catchError((error: HttpErrorResponse) => {
        this.registerCooldown(options.key, error.status);
        return of(
          cached
            ? this.toState(cached.data, false, true, error.status, cached.updatedAt)
            : this.toState(options.fallbackData, true, false, error.status)
        );
      }),
      finalize(() => this.inFlight.delete(options.key)),
      shareReplay(1)
    );

    this.inFlight.set(options.key, request$ as Observable<CatalogRequestState<unknown>>);

    return cached
      ? concat(
          of(this.toState(cached.data, false, true, undefined, cached.updatedAt)),
          request$
        )
      : request$;
  }

  private normalizeQuery(params: CatalogQuery): string {
    return JSON.stringify({
      q: String(params.q || '').trim().toLowerCase(),
      types: this.normalizeKeyArray(params.types),
      genres: this.normalizeKeyArray(params.genres),
      platforms: this.normalizeKeyArray(params.platforms),
      availability: this.normalizeKeyArray(params.availability),
      date: String(params.date || '').trim(),
      timeSlot: String(params.timeSlot || '').trim(),
      sort: String(params.sort || '').trim(),
      page: Number(params.page || 1),
      limit: Number(params.limit || 24),
    });
  }

  private normalizeKeyArray(values?: readonly string[]): string[] {
    return [...(values || [])]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, 'es'));
  }

  private buildCacheKey(
    kind: 'query' | 'platforms' | 'suggest' | 'forYou' | 'detail',
    value: string
  ): string {
    return `${kind}:${this.getAuthScope()}:${value}`;
  }

  private getAuthScope(): string {
    if (!this.isBrowser) {
      return 'anon';
    }

    const token = localStorage.getItem('gtv_id_token');
    if (!token) {
      return 'anon';
    }

    try {
      const [, payload] = token.split('.');
      if (!payload) {
        return `token:${token.slice(-16)}`;
      }

      const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/');
      const paddedPayload = normalizedPayload.padEnd(
        Math.ceil(normalizedPayload.length / 4) * 4,
        '='
      );
      const decoded = JSON.parse(atob(paddedPayload));
      return String(decoded?.sub || decoded?.userId || decoded?.id || `token:${token.slice(-16)}`);
    } catch {
      return `token:${token.slice(-16)}`;
    }
  }

  private registerCooldown(key: string, status?: number): void {
    if (!status || (status !== 429 && status < 500)) {
      return;
    }

    const cooldownMs = status === 429 ? this.rateLimitCooldownMs : this.serverCooldownMs;
    this.cooldowns.set(key, {
      until: Date.now() + cooldownMs,
      status,
    });
  }

  private toState<T>(
    data: T,
    unavailable: boolean,
    stale: boolean,
    status?: number,
    updatedAt?: number
  ): CatalogRequestState<T> {
    return {
      data,
      unavailable,
      stale,
      status,
      updatedAt: updatedAt ? new Date(updatedAt).toISOString() : undefined,
    };
  }

  private getAuthHeaders(): HttpHeaders {
    if (!this.isBrowser) {
      return new HttpHeaders();
    }

    const token = localStorage.getItem('gtv_id_token');
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }
}
