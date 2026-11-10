import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import { TvApiService } from '../api/tv-api.service';
import { TvReadItemDTO } from '../api/models';
import { CatalogItem, CatalogService } from '../services/catalog.service';
import { DiscoveryService, DiscoveryBrowseResponse } from '../services/discovery.service';
import { TvDataFacade } from './tv-data.facade';

describe('TvDataFacade', () => {
  let service: TvDataFacade;
  let tvApiSpy: jasmine.SpyObj<TvApiService>;
  let discoverySpy: jasmine.SpyObj<DiscoveryService>;
  let catalogSpy: jasmine.SpyObj<CatalogService>;

  beforeEach(() => {
    tvApiSpy = jasmine.createSpyObj<TvApiService>('TvApiService', [
      'getTvRead',
      'getTvReadChannels',
      'getTvReadSchedule',
      'getTvGuideSurface',
    ]);
    discoverySpy = jasmine.createSpyObj<DiscoveryService>('DiscoveryService', ['browse', 'search']);
    catalogSpy = jasmine.createSpyObj<CatalogService>('CatalogService', [
      'getPlatformsState',
      'getForYouState',
    ]);

    catalogSpy.getPlatformsState.and.returnValue(
      of({
        data: [],
        unavailable: false,
        stale: false,
      })
    );
    catalogSpy.getForYouState.and.returnValue(
      of({
        data: [],
        unavailable: false,
        stale: false,
      })
    );

    TestBed.configureTestingModule({
      providers: [
        TvDataFacade,
        { provide: TvApiService, useValue: tvApiSpy },
        { provide: DiscoveryService, useValue: discoverySpy },
        { provide: CatalogService, useValue: catalogSpy },
        { provide: DOCUMENT, useValue: { visibilityState: 'visible' } },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });

    service = TestBed.inject(TvDataFacade);
  });

  it('maps tonight programs through the unified tv API contract', async () => {
    const tvItem = makeTvItem();
    tvApiSpy.getTvRead.and.returnValue(
      of({
        success: true,
        data: {
          date: '20260326',
          view: 'night',
          items: [tvItem],
          channels: [],
          filters: {},
          meta: {
            total: 1,
            limit: 30,
            generatedAt: '2026-03-26T00:00:00.000Z',
          },
        },
      })
    );

    const result = await firstValueFrom(service.getTonightPrograms({ date: 'today', category: 'Deportes' }));

    expect(tvApiSpy.getTvRead).toHaveBeenCalledWith(
      jasmine.objectContaining({
        view: 'tonight',
        date: 'today',
        category: 'Deportes',
      })
    );
    expect(result).toEqual([tvItem]);
  });

  it('loads the day guide from channel-bounded schedules', async () => {
    const tvItem = makeTvItem();
    tvApiSpy.getTvReadSchedule.and.returnValue(of({
      success: true,
      data: {
        date: '20260326',
        group: 'movistar',
        channels: [{
          channel: tvItem.channel,
          items: [tvItem],
          counts: { total: 34, returned: 1, complete: false },
        }],
        meta: {
          totalChannels: 1,
          totalItems: 34,
          itemsPerChannel: 32,
          truncatedChannels: 1,
          generatedAt: '2026-03-26T00:00:00.000Z',
        },
      },
    }));

    const result = await firstValueFrom(service.getDaySchedule({
      date: 'today',
      group: 'movistar',
      channelType: 'TDT',
      country: 'GB',
    }));

    expect(tvApiSpy.getTvReadSchedule).toHaveBeenCalledWith(jasmine.objectContaining({
      date: 'today',
      group: 'movistar',
      itemsPerChannel: 32,
      fields: 'grid',
      country: 'GB',
    }));
    expect(result).toEqual([tvItem]);
  });

  it('loads a bounded channel directory for compact discovery surfaces', async () => {
    const tvItem = makeTvItem();
    const summary = {
      channel: tvItem.channel,
      current: tvItem,
      counts: { total: 10, live: 1, tonight: 2 },
    };
    tvApiSpy.getTvReadChannels.and.returnValue(of({
      success: true,
      data: {
        date: '20260326',
        group: 'tdt',
        channels: [summary],
        meta: { total: 1, generatedAt: '2026-03-26T00:00:00.000Z' },
      },
    }));

    const result = await firstValueFrom(service.getChannelDirectory('tdt', 'today', 6));

    expect(tvApiSpy.getTvReadChannels).toHaveBeenCalledWith('today', 'tdt', 6);
    expect(result).toEqual([summary]);
  });

  it('propagates a day-schedule outage so the guide can offer retry', async () => {
    tvApiSpy.getTvReadSchedule.and.returnValue(throwError(() => new Error('offline')));

    await expectAsync(firstValueFrom(service.getDaySchedule())).toBeRejectedWithError('offline');
  });

  it('merges TV and catalog sources in discover mode', async () => {
    const tvItem = makeTvItem();
    const movieItem = makeCatalogItem('tmdb:movie:1', 'Película', 'movie');

    tvApiSpy.getTvRead.and.returnValue(
      of({
        success: true,
        data: {
          date: '20260326',
          view: 'now',
          items: [tvItem],
          channels: [],
          filters: {},
          meta: {
            total: 1,
            limit: 48,
            generatedAt: '2026-03-26T00:00:00.000Z',
          },
        },
      })
    );
    discoverySpy.browse.and.returnValue(of(makeBrowseResponse('movie', [movieItem])));

    const result = await firstValueFrom(
      service.discoverContent({
        types: ['program', 'movie'],
        availability: ['live'],
        page: 1,
        limit: 24,
      })
    );

    expect(tvApiSpy.getTvRead).toHaveBeenCalledWith(
      jasmine.objectContaining({
        view: 'now',
      })
    );
    expect(discoverySpy.browse).toHaveBeenCalledWith(
      jasmine.objectContaining({
        type: 'movie',
      })
    );
    expect(result.items.length).toBe(2);
  });
});

function makeBrowseResponse(
  type: 'movie' | 'series',
  items: CatalogItem[]
): DiscoveryBrowseResponse {
  return {
    contentType: type,
    items,
    liveItems: [],
    availableGenres: ['Drama'],
    availablePlatforms: [],
    meta: {
      page: 1,
      limit: 24,
      total: items.length,
      hasMore: false,
    },
    generatedAt: '2026-03-26T00:00:00.000Z',
  };
}

function makeCatalogItem(
  catalogId: string,
  title: string,
  contentType: 'movie' | 'series'
): CatalogItem {
  return {
    catalogId,
    source: 'tmdb',
    contentType,
    title,
    genres: ['Drama'],
    primaryPlatforms: ['Netflix'],
    liveNow: true,
  };
}

function makeTvItem(): TvReadItemDTO {
  return {
    id: 'airing-1',
    channel: {
      id: 'la-1',
      name: 'La 1',
      icon: 'https://img.example.com/channel.png',
      sortOrder: 1,
      type: 'TDT',
      group: 'tdt',
    },
    program: {
      brandKey: 'brand-1',
      title: 'Programa en directo',
      normalizedTitle: 'programa en directo',
      titleAliases: [],
      editorialCategory: 'Noticias',
      genre: 'Noticias',
      description: 'Resumen del día',
      isResolvedTitle: true,
    },
    airing: {
      id: 'airing-1',
      date: '20260326',
      start: '2026-03-26T20:00:00.000Z',
      end: '2026-03-26T21:00:00.000Z',
      durationMinutes: 60,
      liveNow: true,
      partOfDay: 'noche',
      timeSlotKey: 'night',
    },
    assets: {
      fallbackChain: [],
    },
    availability: {
      live: true,
      catchup: false,
      streaming: false,
    },
    sourceProvenance: {
      schedule: [],
      metadata: [],
      assets: [],
    },
    timingContext: {
      liveNow: true,
    },
    relevance: {
      score: 1,
      reason: 'test',
    },
  };
}
