import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, finalize, map, shareReplay } from 'rxjs/operators';
import { ApiConfigService } from '../api/api-config.service';
import {
  CatalogItem,
  CatalogPlatform,
  CatalogQuery,
  CatalogResponse,
} from './catalog.service';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
}

interface DiscoveryCacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface DiscoveryHomeResponse {
  personalized: CatalogItem[];
  platformItems: CatalogItem[];
  freeItems: CatalogItem[];
  liveItems: CatalogItem[];
  tonightItems: CatalogItem[];
  trendingItems: CatalogItem[];
  platforms: CatalogPlatform[];
  generatedAt: string;
}

export interface DiscoveryBrowseResponse {
  contentType: 'movie' | 'series';
  items: CatalogItem[];
  liveItems: CatalogItem[];
  availableGenres: string[];
  availablePlatforms: CatalogPlatform[];
  meta: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
  generatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class DiscoveryService {
  private readonly baseUrl: string;
  private readonly cache = new Map<string, DiscoveryCacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Observable<unknown>>();

  constructor(
    private readonly http: HttpClient,
    private readonly apiConfig: ApiConfigService
  ) {
    this.baseUrl = this.apiConfig.getBaseUrl();
  }

  getHome(date?: string, transferCache = true): Observable<DiscoveryHomeResponse> {
    const params = date ? { date } : undefined;
    return this.request<DiscoveryHomeResponse>(
      `discovery:home:${date || 'today'}`,
      60_000,
      this.emptyHome(),
      () =>
        this.http
          .get<ApiResponse<DiscoveryHomeResponse>>(`${this.baseUrl}/discovery/home`, { params, transferCache })
          .pipe(map((resp) => resp?.data || this.emptyHome()))
    );
  }

  search(query: {
    q: string;
    type?: string;
    genre?: string;
    platform?: string;
    limit?: number;
    page?: number;
  }): Observable<CatalogResponse> {
    const normalizedQuery = String(query.q || '').trim();
    if (!normalizedQuery) {
      return of(this.emptyCatalog());
    }

    const params = compactParams({
      q: normalizedQuery,
      type: query.type,
      genre: query.genre,
      platform: query.platform,
      limit: query.limit || 24,
      page: query.page || 1,
    });

    return this.request<CatalogResponse>(
      `discovery:search:${JSON.stringify(params)}`,
      30_000,
      this.emptyCatalog(),
      () =>
        this.http
          .get<ApiResponse<CatalogResponse>>(`${this.baseUrl}/discovery/search`, { params })
          .pipe(map((resp) => resp?.data || this.emptyCatalog()))
    );
  }

  browse(query: {
    type: 'movie' | 'series';
    q?: string;
    genre?: string;
    platform?: string;
    availability?: string;
    sort?: string;
    limit?: number;
    page?: number;
  }, transferCache = true): Observable<DiscoveryBrowseResponse> {
    const params = compactParams({
      type: query.type,
      q: query.q,
      genre: query.genre,
      platform: query.platform,
      availability: query.availability,
      sort: query.sort,
      limit: query.limit || 24,
      page: query.page || 1,
    });

    return this.request<DiscoveryBrowseResponse>(
      `discovery:browse:${JSON.stringify(params)}`,
      30_000,
      this.emptyBrowse(query.type),
      () =>
        this.http
          .get<ApiResponse<DiscoveryBrowseResponse>>(
            `${this.baseUrl}/discovery/browse`,
            { params, transferCache }
          )
          .pipe(map((resp) => resp?.data || this.emptyBrowse(query.type)))
    );
  }

  private request<T>(
    key: string,
    ttlMs: number,
    fallback: T,
    factory: () => Observable<T>
  ): Observable<T> {
    const cached = this.cache.get(key) as DiscoveryCacheEntry<T> | undefined;
    if (cached && cached.expiresAt > Date.now()) {
      return of(cached.value);
    }

    const pending = this.inFlight.get(key) as Observable<T> | undefined;
    if (pending) {
      return pending;
    }

    const request$ = factory().pipe(
      map((value) => {
        this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
        return value;
      }),
      catchError(() => of(fallback)),
      finalize(() => this.inFlight.delete(key)),
      // Keep an initiated GET alive through route/hydration subscriber churn;
      // otherwise refCount teardown can cancel and immediately repeat it.
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.inFlight.set(key, request$);
    return request$;
  }

  private emptyHome(): DiscoveryHomeResponse {
    return {
      personalized: [],
      platformItems: [],
      freeItems: [],
      liveItems: [],
      tonightItems: [],
      trendingItems: [],
      platforms: [],
      generatedAt: new Date().toISOString(),
    };
  }

  private emptyCatalog(): CatalogResponse {
    return {
      items: [],
      meta: {
        page: 1,
        limit: 24,
        total: 0,
        hasMore: false,
      },
      availableGenres: [],
      availablePlatforms: [],
    };
  }

  private emptyBrowse(type: 'movie' | 'series'): DiscoveryBrowseResponse {
    return {
      contentType: type,
      items: [],
      liveItems: [],
      availableGenres: [],
      availablePlatforms: [],
      meta: {
        page: 1,
        limit: 24,
        total: 0,
        hasMore: false,
      },
      generatedAt: new Date().toISOString(),
    };
  }
}

function compactParams(
  params: Record<string, string | number | undefined>
): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, string | number] =>
      entry[1] !== undefined
    )
  );
}
