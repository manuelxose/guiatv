import { PLATFORM_ID } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { NEVER, of } from 'rxjs';
import { EditorialService } from '../blog/services/editorial.service';
import { EditorialPost } from '../blog/models/editorial.models';
import { DiscoveryService } from '../services/discovery.service';
import { TvDataFacade } from './tv-data.facade';
import { PortalHomeFacade } from './portal-home.facade';
import { FootballFacade } from '../features/football/football.facade';

describe('PortalHomeFacade', () => {
  it('emits a terminal home state when the editorial hub does not settle', fakeAsync(() => {
    const discovery = jasmine.createSpyObj<DiscoveryService>('DiscoveryService', ['getHome', 'browse']);
    discovery.getHome.and.returnValue(
      of({
        personalized: [],
        platformItems: [],
        freeItems: [],
        liveItems: [],
        tonightItems: [],
        trendingItems: [],
        platforms: [],
        generatedAt: '2026-08-13T00:00:00.000Z',
      })
    );
    discovery.browse.and.returnValue(of({
      contentType: 'movie',
      items: [],
      liveItems: [],
      availableGenres: [],
      availablePlatforms: [],
      meta: { page: 1, limit: 8, total: 0, hasMore: false },
      generatedAt: '2026-08-13T00:00:00.000Z',
    }));

    const tvData = jasmine.createSpyObj<TvDataFacade>('TvDataFacade', [
      'getLivePrograms',
      'getTonightPrograms',
      'getPlatforms',
      'getChannelDirectory',
    ]);
    tvData.getLivePrograms.and.returnValue(of([]));
    tvData.getTonightPrograms.and.returnValue(of([]));
    tvData.getPlatforms.and.returnValue(of([]));
    tvData.getChannelDirectory.and.returnValue(of([]));

    const editorial = jasmine.createSpyObj<EditorialService>('EditorialService', [
      'getHubState',
      'getRankingsPageState',
    ]);
    editorial.getHubState.and.returnValue(NEVER);
    const ranking = {
      id: 'ranking',
      title: 'Qué ver esta semana',
      canonicalPath: '/guias/rankings/esta-semana',
      coverImage: '/ranking.webp',
      readingMinutes: 4,
      contentHtml: '<p>Full article body</p>',
    } as EditorialPost;
    editorial.getRankingsPageState.and.returnValue(of({
      featured: null,
      posts: [ranking, ranking],
      categories: [],
      sections: [],
    }));
    const football = jasmine.createSpyObj<FootballFacade>('FootballFacade', ['getHome']);
    football.getHome.and.returnValue(of({
      liveMatches: [],
      todayMatches: [],
      featuredMatches: [],
      upcomingMatches: [],
      featuredCompetitions: [],
      standingsSnapshot: null,
      latestNews: [],
      generatedAt: '2026-08-13T00:00:00.000Z',
    }));

    TestBed.configureTestingModule({
      providers: [
        PortalHomeFacade,
        { provide: DiscoveryService, useValue: discovery },
        { provide: TvDataFacade, useValue: tvData },
        { provide: EditorialService, useValue: editorial },
        { provide: FootballFacade, useValue: football },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });

    let emitted = false;
    TestBed.inject(PortalHomeFacade).getHomeState().subscribe((state) => {
      emitted = true;
      expect(state.guidePosts).toEqual([{
        id: ranking.id,
        title: ranking.title,
        canonicalPath: ranking.canonicalPath,
        coverImage: ranking.coverImage,
        coverAlt: undefined,
        readingMinutes: ranking.readingMinutes,
        categoryName: 'Guía',
      }]);
      expect(state.tvMovies).toEqual([]);
      expect(state.featuredChannels).toEqual([]);
      expect(state.movieHighlights).toEqual([]);
      expect(state.seriesHighlights).toEqual([]);
      expect(state.footballHighlights).toEqual([]);
    });

    tick(4_999);
    expect(emitted).toBeFalse();
    tick(1);
    expect(emitted).toBeTrue();
  }));
});
