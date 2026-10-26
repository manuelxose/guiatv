import { cleanEpgDescription } from '../../shared/utils/epgDescription';
import { IProgramRepository } from '@/domain/repositories/IProgramRepository';
import { IChannelRepository } from '@/domain/repositories/IChannelRepository';
import { ICacheRepository } from '@/domain/repositories/ICacheRepository';
import { NotFoundError } from '@/shared/errors';
import { ProgramLayoutBuilder, ProgramLayoutDTO } from '../services/ProgramLayoutBuilder';
import { TMDBDetailResult, TMDBService } from '@/infrastructure/external/TMDBService';
import {
  StreamingProvidersService,
  WatchProvidersResult,
} from '@/infrastructure/external/StreamingProvidersService';
import { IUserContentInteractionRepository } from '@/domain/repositories/IUserContentInteractionRepository';
import { aggregateFriendActivity, findFolloweeIds } from '@/application/services/SocialSummaryQuery';
import { UserListItemModel } from '@/infrastructure/database/models/UserListItem.model';
import { UserListModel } from '@/infrastructure/database/models/UserList.model';
import { DateUtils } from '@/shared/utils/dateUtils';
import { DateRange } from '@/domain/value-objects/DateRange';
import { MediaCatalogService } from '@/application/services/MediaCatalogService';

export interface GetContentDetailRequest {
  programId: string;
  userId?: string;
  expand?: string[];
}

export interface NormalizedProvider {
  id: number;
  name: string;
  logoUrl: string;
  type: 'flatrate' | 'rent' | 'buy' | 'free';
  price?: string;
  deepLink?: string;
}

export interface GetContentDetailResponse {
  program: ProgramLayoutDTO & {
    tmdbId?: number;
    synopsis?: string;
    cast?: Array<{ name: string; character: string; profile?: string }>;
    director?: string;
    year?: number;
    runtime?: number;
    tmdbRating?: number;
    tmdbRatingCount?: number;
  };
  whereToWatch?: {
    flatrate: NormalizedProvider[];
    rent: NormalizedProvider[];
    buy: NormalizedProvider[];
    free: NormalizedProvider[];
    tmdbLink: string;
  };
  userInteraction?: {
    status: string;
    rating?: number;
    liked?: boolean;
    inWatchlist: boolean;
    lists: string[];
  };
  related?: ProgramLayoutDTO[];
  upcomingAirings?: Array<{
    channelName: string;
    channelIcon?: string;
    start: string;
    end: string;
  }>;
  socialSummary?: {
    friendsWhoWatched: number;
    avgFriendRating?: number;
    topReview?: { userName: string; text: string; rating: number };
  };
}

type TmdbContentType = 'movie' | 'tv';

export class GetContentDetail {
  private readonly ttlSeconds =
    Number(process.env.CONTENT_DETAIL_CACHE_TTL_SEC || 1800) || 1800;
  private readonly layoutBuilder = new ProgramLayoutBuilder();
  private readonly timeSlots = this.layoutBuilder.buildTimeSlots();

  constructor(
    private readonly programRepository: IProgramRepository,
    private readonly channelRepository: IChannelRepository,
    private readonly cacheRepository: ICacheRepository,
    private readonly tmdbService: TMDBService,
    private readonly streamingProvidersService: StreamingProvidersService,
    private readonly interactionRepository: IUserContentInteractionRepository,
    // Optional: routes TMDB detail lookups through the local persistent media
    // catalog instead of hitting TMDB directly. See CatalogService for the
    // same pattern; kept optional to avoid breaking existing call sites.
    private readonly mediaCatalogService?: MediaCatalogService
  ) {}

  async execute(
    request: GetContentDetailRequest
  ): Promise<GetContentDetailResponse> {
    const expand = Array.from(
      new Set((request.expand || []).map((item) => String(item).toLowerCase()))
    ).sort();
    const cacheKey = [
      'content:detail',
      request.programId,
      request.userId || 'anon',
      expand.join('|') || 'base',
    ].join(':');

    const cached =
      await this.cacheRepository.get<GetContentDetailResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const program = await this.programRepository.findById(request.programId);
    if (!program) {
      throw new NotFoundError('Program', request.programId);
    }

    const inferredType = this.inferTmdbContentType(program.genre);
    const resolvedTmdb = await this.resolveTmdb(
      program.tmdbId,
      inferredType,
      program.title,
      program.year
    );

    const layout =
      this.layoutBuilder.buildProgramLayouts(
        [program],
        program.date,
        this.timeSlots,
        undefined,
        'full'
      )[0] || this.fallbackLayout(program);

    const response: GetContentDetailResponse = {
      program: {
        ...layout,
        tmdbId: resolvedTmdb.tmdbId,
        synopsis: resolvedTmdb.detail?.overview || cleanEpgDescription(program.description),
        cast: this.mapCast(resolvedTmdb.detail),
        director: this.getDirector(resolvedTmdb.detail),
        year: this.resolveYear(program.year, resolvedTmdb.detail),
        runtime: this.resolveRuntime(resolvedTmdb.detail),
        tmdbRating:
          typeof resolvedTmdb.detail?.vote_average === 'number'
            ? resolvedTmdb.detail.vote_average
            : program.rating
              ? Number(program.rating)
              : undefined,
        tmdbRatingCount:
          typeof resolvedTmdb.detail?.vote_count === 'number'
            ? resolvedTmdb.detail.vote_count
            : undefined,
      },
    };

    if (resolvedTmdb.providers) {
      response.whereToWatch = this.mapWatchProviders(resolvedTmdb.providers);
    }

    if (request.userId) {
      response.userInteraction = await this.loadUserInteraction(
        request.userId,
        request.programId
      );
    }

    if (!expand.length || expand.includes('related')) {
      response.related = await this.loadRelated(program.id, program.date, program.genre);
    }

    if (!expand.length || expand.includes('schedule')) {
      response.upcomingAirings = await this.loadUpcomingAirings(
        program.title,
        program.date
      );
    }

    if (expand.includes('social') && request.userId) {
      response.socialSummary = await this.loadSocialSummary(
        request.userId,
        request.programId,
        resolvedTmdb.tmdbId,
        program.title
      );
    }

    await this.cacheRepository.set(cacheKey, response, this.ttlSeconds);
    return response;
  }

  private async resolveTmdb(
    existingTmdbId: number | undefined,
    type: TmdbContentType | null,
    title: string,
    year?: string
  ): Promise<{
    tmdbId?: number;
    detail: TMDBDetailResult | null;
    providers: WatchProvidersResult | null;
  }> {
    if (!type) {
      return { tmdbId: existingTmdbId, detail: null, providers: null };
    }

    let tmdbId = existingTmdbId;
    if (!tmdbId) {
      const resolved =
        type === 'movie'
          ? await this.tmdbService.searchMovie(title, year ? Number(year) : undefined)
          : await this.tmdbService.searchSeries(title.replace(/T\\d+.*/, '').trim());
      tmdbId = resolved?.id;
    }

    if (!tmdbId) {
      return { tmdbId: undefined, detail: null, providers: null };
    }

    const [detail, providers] = await Promise.all([
      this.mediaCatalogService
        ? this.mediaCatalogService.getDetail(tmdbId, type)
        : type === 'movie'
          ? this.tmdbService.getMovieById(tmdbId)
          : this.tmdbService.getTVById(tmdbId),
      type === 'movie'
        ? this.streamingProvidersService.getMovieProviders(tmdbId)
        : this.streamingProvidersService.getTVProviders(tmdbId),
    ]);

    return { tmdbId, detail, providers };
  }

  private async loadUserInteraction(userId: string, contentId: string) {
    const [interaction, listItems] = await Promise.all([
      this.interactionRepository.findByUserAndContent(userId, contentId),
      UserListItemModel.find({ userId, contentId }).lean().exec(),
    ]);

    const listIds = listItems.map((item: any) => item.listId).filter(Boolean);
    const lists = listIds.length
      ? await UserListModel.find({ _id: { $in: listIds } }).lean().exec()
      : [];

    if (!interaction && !listItems.length) {
      return undefined;
    }

    return {
      status: interaction?.status || (listItems.length ? 'pending' : 'unknown'),
      rating: interaction?.rating,
      liked: interaction?.liked,
      inWatchlist: listItems.length > 0,
      lists: lists.map((list: any) => String(list.title || '')),
    };
  }

  private async loadRelated(
    programId: string,
    date: string,
    genre?: string
  ): Promise<ProgramLayoutDTO[]> {
    // Pushes the genre filter and a bounded limit into Mongo instead of
    // pulling every program for the day (full fields, unbounded) just to
    // filter/sort/slice(0, 8) in process — that pattern was scanning
    // thousands of documents per detail-page render for an 8-item rail.
    const { start, end } = DateUtils.getDayRangeYYYYMMDD(date);
    const candidates = await this.programRepository.findByDateRange(
      DateRange.create(start, end),
      { genre, limit: 30 }
    );
    const related = candidates
      .filter((program) => program.id !== programId)
      .sort((a, b) => {
        const imageDiff = Number(Boolean(b.image)) - Number(Boolean(a.image));
        if (imageDiff !== 0) return imageDiff;
        return a.startTime.getTime() - b.startTime.getTime();
      })
      .slice(0, 8);

    return this.layoutBuilder.buildProgramLayouts(
      related,
      date,
      this.timeSlots,
      undefined,
      'full'
    );
  }

  private async loadUpcomingAirings(title: string, _date: string) {
    // Was fetching every channel's full program list for two whole days
    // ('minimal' fields, still unbounded) and filtering by exact normalized
    // title in process. `findByTitleApprox` pushes the title match and the
    // rolling time window into Mongo via the title/normalizedTitle indexes
    // and returns at most 10 lean documents — the same result, without the
    // two full-day collection scans.
    const [channels, matches] = await Promise.all([
      this.channelRepository.findAll(),
      this.programRepository.findByTitleApprox(title, 48),
    ]);
    const channelMap = new Map(channels.map((channel) => [channel.id, channel]));
    const normalizedTitle = this.normalizeTitle(title);

    return matches
      .filter((program) => this.normalizeTitle(program.title) === normalizedTitle)
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
      .slice(0, 6)
      .map((program) => {
        const channel = channelMap.get(program.channelId);
        return {
          channelName: channel?.name || program.channelId,
          channelIcon: channel?.icon || undefined,
          start: program.startTime.toISOString(),
          end: program.endTime.toISOString(),
        };
      });
  }

  private async loadSocialSummary(
    userId: string,
    contentId: string,
    tmdbId: number | undefined,
    title: string
  ) {
    const friendIds = await findFolloweeIds(userId);
    if (!friendIds.length) {
      return {
        friendsWhoWatched: 0,
      };
    }

    const orConditions: Array<Record<string, unknown>> = [
      { contentId },
      { contentTitle: title },
    ];
    if (tmdbId) {
      orConditions.push({ tmdbId });
    }

    const stats = await aggregateFriendActivity(friendIds, orConditions);
    return {
      friendsWhoWatched: stats?.friendsWhoWatched || 0,
      avgFriendRating: stats?.avgFriendRating,
    };
  }

  private mapWatchProviders(providers: WatchProvidersResult) {
    return {
      flatrate: this.normalizeProviders(providers, 'flatrate'),
      rent: this.normalizeProviders(providers, 'rent'),
      buy: this.normalizeProviders(providers, 'buy'),
      free: this.normalizeProviders(providers, 'free'),
      tmdbLink: providers.link,
    };
  }

  private normalizeProviders(
    providers: WatchProvidersResult,
    type: 'flatrate' | 'rent' | 'buy' | 'free'
  ): NormalizedProvider[] {
    return (providers[type] || []).map((provider) => ({
      id: provider.providerId,
      name: provider.providerName,
      logoUrl: provider.logoPath
        ? this.streamingProvidersService.getLogoUrl(provider.logoPath)
        : '',
      type,
      deepLink: providers.link || undefined,
    }));
  }

  private mapCast(detail: TMDBDetailResult | null) {
    if (!detail?.credits?.cast?.length) {
      return [];
    }

    return detail.credits.cast.slice(0, 8).map((castMember) => ({
      name: castMember.name,
      character: String(castMember.character || ''),
      profile: this.tmdbService.getImageUrl(castMember.profile_path || null),
    }));
  }

  private getDirector(detail: TMDBDetailResult | null): string | undefined {
    const crew = detail?.credits?.crew || [];
    const director = crew.find(
      (person) => person.job === 'Director' || person.job === 'Creator'
    );
    return director?.name;
  }

  private resolveYear(
    year: string | undefined,
    detail: TMDBDetailResult | null
  ): number | undefined {
    const rawYear =
      year ||
      detail?.release_date?.split('-')[0] ||
      detail?.first_air_date?.split('-')[0];
    return rawYear ? Number(rawYear) : undefined;
  }

  private resolveRuntime(detail: TMDBDetailResult | null): number | undefined {
    if (!detail) {
      return undefined;
    }

    if (typeof detail.runtime === 'number') {
      return detail.runtime;
    }

    if (Array.isArray(detail.episode_run_time) && detail.episode_run_time.length) {
      return Number(detail.episode_run_time[0]);
    }

    return undefined;
  }

  private inferTmdbContentType(genre?: string): TmdbContentType | null {
    const normalized = String(genre || '').toLowerCase();
    if (!normalized) return null;
    if (normalized.includes('serie')) {
      return 'tv';
    }
    if (normalized.includes('cine') || normalized.includes('pel')) {
      return 'movie';
    }
    return null;
  }

  private normalizeTitle(value: string): string {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private fallbackLayout(program: any): ProgramLayoutDTO {
    return {
      id: program.id,
      channelId: program.channelId,
      title: program.title,
      start: program.startTime.toISOString(),
      end: program.endTime.toISOString(),
      durationMinutes: program.duration,
      category: program.genre,
      image: program.image,
      rating: program.rating,
      tmdbId: program.tmdbId,
      description: program.description,
      timeSlotIndex: null,
      crossesMidnight: false,
      fieldsProvided: 'full',
    };
  }
}
