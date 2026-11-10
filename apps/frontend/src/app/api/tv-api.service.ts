import { isPlatformBrowser } from '@angular/common';
import { Inject, Injectable, PLATFORM_ID, TransferState, makeStateKey } from '@angular/core';
import { Observable, finalize, of, shareReplay, tap } from 'rxjs';
import { ApiClientService } from './api-client.service';
import {
  ApiResponse,
  DateAlias,
  TvChannelSurfaceDTO,
  TvGuideSurfaceDTO,
  TvReadChannelsResponseDTO,
  TvReadItemResponseDTO,
  TvReadResponseDTO,
  TvReadScheduleResponseDTO,
} from './models';
import { ApiCacheService } from './cache.service';

const DEFAULT_TTL = 30_000;
export type UnifiedTvApiView =
  | 'now'
  | 'next'
  | 'night'
  | 'day'
  | 'search'
  | 'tonight'
  | 'all';

@Injectable({ providedIn: 'root' })
export class TvApiService {
  private readonly inFlight = new Map<string, Observable<unknown>>();
  private readonly isBrowser: boolean;

  constructor(
    private client: ApiClientService,
    private cache: ApiCacheService,
    private transferState: TransferState,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  getHealth(): Observable<ApiResponse<any>> {
    return this.client.get<ApiResponse<any>>('/health');
  }

  getTvRead(query: {
    view: UnifiedTvApiView;
    date?: DateAlias;
    group?: string;
    category?: string;
    sport?: string;
    channelId?: string;
    q?: string;
    limit?: number;
    cursor?: string;
    includeChannels?: boolean;
  }): Observable<ApiResponse<TvReadResponseDTO>> {
    const normalizedView = normalizeUnifiedTvView(query.view);
    const params: Record<string, any> = {
      view: normalizedView,
      date: query.date ?? 'today',
      group: query.group,
      category: query.category,
      sport: query.sport,
      channelId: query.channelId,
      q: query.q,
      limit: query.limit,
      cursor: query.cursor,
      includeChannels: query.includeChannels,
    };
    return this.cachedGet<ApiResponse<TvReadResponseDTO>>(
      `/tv/read:${JSON.stringify(params)}`,
      '/tv/read',
      params,
      this.resolveReadTtl(normalizedView)
    );
  }

  getTvReadChannels(
    date: DateAlias = 'today',
    group?: string,
    limit?: number
  ): Observable<ApiResponse<TvReadChannelsResponseDTO>> {
    const params: Record<string, any> = {
      date,
      group,
      limit,
    };
    return this.cachedGet<ApiResponse<TvReadChannelsResponseDTO>>(
      `/tv/read/channels:${JSON.stringify(params)}`,
      '/tv/read/channels',
      params,
      60_000
    );
  }

  getTvReadSchedule(query: {
    date?: DateAlias;
    group?: string;
    category?: string;
    channelId?: string;
    q?: string;
    itemsPerChannel?: number;
    fields?: 'grid';
    /** ISO country code (e.g. 'GB'); omitted or 'es'/'all' keeps today's unfiltered Spanish channels. */
    country?: string;
  }): Observable<ApiResponse<TvReadScheduleResponseDTO>> {
    const params: Record<string, any> = {
      date: query.date ?? 'today',
      group: query.group,
      category: query.category,
      channelId: query.channelId,
      q: query.q,
      itemsPerChannel: query.itemsPerChannel,
      fields: query.fields,
      country: query.country,
    };
    return this.cachedGet<ApiResponse<TvReadScheduleResponseDTO>>(
      `/tv/read/schedule:${JSON.stringify(params)}`,
      '/tv/read/schedule',
      params,
      15 * 60_000
    );
  }

  getTvReadChannelDetail(
    channelId: string,
    date: DateAlias = 'today',
    view: UnifiedTvApiView = 'day'
  ): Observable<ApiResponse<TvReadResponseDTO>> {
    const normalizedView = normalizeUnifiedTvView(view);
    const params: Record<string, any> = {
      date,
      view: normalizedView,
    };
    return this.cachedGet<ApiResponse<TvReadResponseDTO>>(
      `/tv/read/channels/${channelId}:${JSON.stringify(params)}`,
      `/tv/read/channels/${channelId}`,
      params,
      normalizedView === 'now' ? 60_000 : 15 * 60_000
    );
  }

  getTvReadItem(airingId: string): Observable<ApiResponse<TvReadItemResponseDTO>> {
    return this.cachedGet<ApiResponse<TvReadItemResponseDTO>>(
      `/tv/read/items/${airingId}`,
      `/tv/read/items/${airingId}`,
      undefined,
      30 * 60_000
    );
  }

  getTvGuideSurface(params: {
    date?: DateAlias;
    group?: string;
    category?: string;
    sport?: string;
  }): Observable<ApiResponse<TvGuideSurfaceDTO>> {
    return this.cachedGet<ApiResponse<TvGuideSurfaceDTO>>(
      `/tv/surface/guide:${JSON.stringify(params)}`,
      '/tv/surface/guide',
      params,
      60_000
    );
  }

  getTvChannelSurface(
    channelId: string,
    date: DateAlias = 'today'
  ): Observable<ApiResponse<TvChannelSurfaceDTO>> {
    return this.cachedGet<ApiResponse<TvChannelSurfaceDTO>>(
      `/tv/surface/channels/${channelId}:${date}`,
      `/tv/surface/channels/${channelId}`,
      { date },
      60_000
    );
  }

  private cachedGet<T>(
    cacheKey: string,
    path: string,
    params?: Record<string, any>,
    ttlMs: number = DEFAULT_TTL
  ): Observable<T> {
    const stateKey = makeStateKey<T>(`tv-api-v2:${cacheKey}`);
    if (this.isBrowser && this.transferState.hasKey(stateKey)) {
      const transferred = this.transferState.get(stateKey, null as unknown as T);
      if (transferred) {
        this.cache.set(cacheKey, transferred, ttlMs);
        return of(transferred);
      }
    }

    const cached = this.cache.get<T>(cacheKey);
    if (cached) {
      return of(cached);
    }

    const existing = this.inFlight.get(cacheKey) as Observable<T> | undefined;
    if (existing) {
      return existing;
    }

    // The `tv-api-v2:` TransferState key above is this service's own hand-off to the browser; do not also serialise the
    // same response through the HTTP transfer cache.
    const request = this.client.get<T>(path, params, { transferCache: false }).pipe(
      tap((response) => {
        this.cache.set(cacheKey, response, ttlMs);
        if (!this.isBrowser) this.transferState.set(stateKey, response);
      }),
      finalize(() => this.inFlight.delete(cacheKey)),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.inFlight.set(cacheKey, request);
    return request;
  }

  private resolveReadTtl(view: 'now' | 'next' | 'night' | 'day' | 'search'): number {
    if (view === 'now') return 60_000;
    if (view === 'next') return 120_000;
    if (view === 'search') return 30_000;
    return 15 * 60_000;
  }
}

export function normalizeUnifiedTvView(view: UnifiedTvApiView): 'now' | 'next' | 'night' | 'day' | 'search' {
  if (view === 'tonight') {
    return 'night';
  }
  if (view === 'all') {
    return 'day';
  }
  return view;
}
