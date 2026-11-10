import { isPlatformBrowser } from '@angular/common';
import { Inject, Injectable, PLATFORM_ID, TransferState, makeStateKey } from '@angular/core';
import { catchError, combineLatest, map, Observable, of, tap, timeout } from 'rxjs';
import { TvReadChannelSummaryDTO, TvReadItemDTO } from '../api/models';
import { EditorialHubState, EditorialPost } from '../blog/models/editorial.models';
import { EditorialService } from '../blog/services/editorial.service';
import { DiscoveryHomeResponse, DiscoveryService } from '../services/discovery.service';
import { CatalogItem, CatalogPlatform } from '../services/catalog.service';
import { TvDataFacade } from './tv-data.facade';
import { FootballFacade } from '../features/football/football.facade';
import { FootballMatchDTO } from '../features/football/football.models';

export interface PortalHomeState {
  liveNow: TvReadItemDTO[];
  tonight: TvReadItemDTO[];
  streamingHighlights: DiscoveryHomeResponse['platformItems'];
  editorialHub: EditorialHubState;
  rankingHighlights: EditorialPost[];
  featuredPlatforms: CatalogPlatform[];
  trendingItems: DiscoveryHomeResponse['trendingItems'];
  freeItems: DiscoveryHomeResponse['freeItems'];
  featuredChannels: TvReadChannelSummaryDTO[];
  movieHighlights: CatalogItem[];
  seriesHighlights: CatalogItem[];
  footballHighlights: FootballMatchDTO[];
}

const PORTAL_HOME_STATE = makeStateKey<PortalHomeState>('portal-home-state-v3');

@Injectable({ providedIn: 'root' })
export class PortalHomeFacade {
  private static readonly HOME_EDITORIAL_TIMEOUT_MS = 5_000;
  private readonly isBrowser: boolean;

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly tvDataFacade: TvDataFacade,
    private readonly editorialService: EditorialService,
    private readonly footballFacade: FootballFacade,
    private readonly transferState: TransferState,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  getHomeState(): Observable<PortalHomeState> {
    if (this.isBrowser && this.transferState.hasKey(PORTAL_HOME_STATE)) {
      const transferred = this.transferState.get(PORTAL_HOME_STATE, null as unknown as PortalHomeState);
      // Keep this route-level snapshot for the whole hydration pass. Angular
      // can construct the routed component more than once while reconciling
      // nested outlets; removing it on first read makes the second instance
      // fall through to the network and briefly render an empty state.
      if (transferred) return of(transferred);
    }

    return combineLatest({
      discovery: this.discoveryService.getHome().pipe(
        catchError(() =>
          of({
            personalized: [],
            platformItems: [],
            freeItems: [],
            liveItems: [],
            tonightItems: [],
            trendingItems: [],
            platforms: [],
            generatedAt: new Date().toISOString(),
          })
        )
      ),
      // These TvDataFacade sources previously had no catchError, unlike
      // every other source in this combineLatest: a single one erroring
      // (e.g. a genuine backend outage) meant combineLatest itself would
      // error and never emit again, leaving the home page's loading state
      // stuck forever - an infinite spinner, caught by e2e/specs/
      // error-states.spec.ts's "API unavailable" test. Same
      // catchError-to-safe-default pattern as discovery/editorialHub/
      // rankings below.
      liveNow: this.tvDataFacade
        .getLivePrograms({ date: 'today', limit: 8 })
        .pipe(catchError(() => of([] as TvReadItemDTO[]))),
      tonight: this.tvDataFacade
        .getTonightPrograms({ date: 'today', limit: 12 })
        .pipe(catchError(() => of([] as TvReadItemDTO[]))),
      platforms: this.tvDataFacade
        .getPlatforms()
        .pipe(catchError(() => of([] as CatalogPlatform[]))),
      featuredChannels: combineLatest([
        this.tvDataFacade.getChannelDirectory('tdt', 'today', 8),
        this.tvDataFacade.getChannelDirectory('cable', 'today', 4),
      ]).pipe(
        map(([freeChannels, payChannels]) => [...freeChannels, ...payChannels]),
        catchError(() => of([] as TvReadChannelSummaryDTO[]))
      ),
      movieHighlights: this.discoveryService.browse({ type: 'movie', page: 1, limit: 8 }).pipe(
        map((response) => response.items || []),
        catchError(() => of([] as CatalogItem[]))
      ),
      seriesHighlights: this.discoveryService.browse({ type: 'series', page: 1, limit: 8 }).pipe(
        map((response) => response.items || []),
        catchError(() => of([] as CatalogItem[]))
      ),
      footballHighlights: this.footballFacade.getHome().pipe(
        map((home) => selectFootballHighlights(home)),
        catchError(() => of([] as FootballMatchDTO[]))
      ),
      editorialHub: this.editorialService.getHubState().pipe(
        // BlogService deliberately retries transient client failures for up
        // to 14 seconds. That policy is useful on editorial pages, but the
        // home combineLatest must not keep the entire portal in its loading
        // state while those retries run. Fail soft here without changing the
        // shared editorial service's resilience policy.
        timeout({ first: PortalHomeFacade.HOME_EDITORIAL_TIMEOUT_MS }),
        catchError(() =>
          of({
            hero: null,
            latestPosts: [],
            guidePosts: [],
            rankingPosts: [],
            trendPosts: [],
            categorySections: [],
            categories: [],
          })
        )
      ),
      rankings: this.editorialService.getRankingsPageState().pipe(
        timeout({ first: PortalHomeFacade.HOME_EDITORIAL_TIMEOUT_MS }),
        catchError(() =>
          of({
            featured: null,
            posts: [],
            categories: [],
            sections: [],
          })
        )
      ),
    }).pipe(
      map(({
        discovery,
        liveNow,
        tonight,
        platforms,
        featuredChannels,
        movieHighlights,
        seriesHighlights,
        footballHighlights,
        editorialHub,
        rankings,
      }) => ({
        liveNow,
        tonight,
        streamingHighlights: discovery.platformItems || [],
        editorialHub,
        rankingHighlights: rankings.posts.slice(0, 6),
        featuredPlatforms: (discovery.platforms?.length ? discovery.platforms : platforms).slice(0, 8),
        trendingItems: discovery.trendingItems || [],
        freeItems: discovery.freeItems || [],
        featuredChannels,
        movieHighlights,
        seriesHighlights,
        footballHighlights,
      })),
      tap((state) => {
        if (!this.isBrowser) this.transferState.set(PORTAL_HOME_STATE, state);
      })
    );
  }
}

function selectFootballHighlights(home: {
  liveMatches: FootballMatchDTO[];
  todayMatches: FootballMatchDTO[];
  featuredMatches: FootballMatchDTO[];
}): FootballMatchDTO[] {
  const matches = new Map<string, FootballMatchDTO>();
  [...home.liveMatches, ...home.todayMatches, ...home.featuredMatches].forEach((match) => {
    if (!matches.has(match.id)) matches.set(match.id, match);
  });
  return Array.from(matches.values()).slice(0, 4);
}
