import { ICacheRepository } from '@/domain/repositories/ICacheRepository';
import {
  PRIME_TIME_WINDOW,
  hydrateTvReadItemRuntime,
  selectCurrentTvItems,
  selectNextTvItems,
  selectPrimeTimeTvItems,
  tvReadChannelMatchesGroup,
  TvReadQueryService,
} from './TvReadQueryService';
import {
  GUIDE_GROUP_ORDER,
  TvSportFacet,
  getGuideGroupSortOrder,
  normalizeSportFacet,
  normalizeTvToken,
} from '@/shared/utils/tvMetadata';
import { TvReadChannelSummaryDTO, TvReadItemDTO } from '../dto/TvReadDTO';
import type { ChannelFeedAliasResolver, FeedAliasTarget } from './ChannelFeedAliases';

function sortTvItems(left: TvReadItemDTO, right: TvReadItemDTO): number {
  return (
    getGuideGroupSortOrder(left.channel.group) - getGuideGroupSortOrder(right.channel.group) ||
    left.channel.sortOrder - right.channel.sortOrder ||
    String(left.channel.name || '').localeCompare(String(right.channel.name || ''), 'es', {
      sensitivity: 'base',
    }) ||
    new Date(left.airing.start).getTime() - new Date(right.airing.start).getTime()
  );
}

type GuideGroupKey =
  | 'all'
  | 'tdt'
  | 'cable'
  | 'movistar'
  | 'online'
  | 'deporte'
  | 'autonomico';

type GuideSportKey =
  | 'all'
  | 'futbol'
  | 'baloncesto'
  | 'f1'
  | 'tenis'
  | 'motogp'
  | 'mas';

function normalizeGuideGroup(group?: string): GuideGroupKey | undefined {
  const normalized = normalizeTvToken(group, ' ');
  if (!normalized || normalized === 'all' || normalized === 'todos') {
    return undefined;
  }

  if (
    normalized === 'tdt' ||
    normalized === 'cable' ||
    normalized === 'movistar' ||
    normalized === 'online' ||
    normalized === 'deporte' ||
    normalized === 'autonomico'
  ) {
    return normalized;
  }

  return undefined;
}

function normalizeGuideCategory(category?: string): string | undefined {
  const normalized = String(category || '').trim();
  if (!normalized || normalizeTvToken(normalized, ' ') === 'all') {
    return undefined;
  }
  return normalized;
}

function shouldHideFromMixedGuide(group?: string): boolean {
  return normalizeTvToken(group, ' ') === 'autonomico';
}

function deriveGroupCountsFromItems(items: TvReadItemDTO[]): Record<string, number> {
  const seen = new Set<string>();
  const counts: Record<string, number> = {};

  items.forEach((item) => {
    const group = normalizeTvToken(item.channel.group, ' ');
    const channelId = String(item.channel.id || '').trim();
    if (!group || !channelId) {
      return;
    }

    const key = `${group}:${channelId}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    counts[group] = (counts[group] || 0) + 1;
  });

  return counts;
}

function getAvailableSports(items: TvReadItemDTO[]): TvSportFacet[] {
  const available = new Set<TvSportFacet>();
  items.forEach((item) => {
    if (item.program.sportFacet) {
      available.add(item.program.sportFacet);
    }
  });

  return Array.from(available).sort((left, right) => left.localeCompare(right, 'es'));
}

function applyGuideFilters(
  items: TvReadItemDTO[],
  params: {
    category?: string;
    sport?: GuideSportKey;
    group?: GuideGroupKey;
  }
): TvReadItemDTO[] {
  const category = normalizeGuideCategory(params.category);
  const sport = normalizeSportFacet(params.sport);

  return items.filter((item) => {
    if (params.group !== 'deporte' && sport && sport !== 'all') {
      return false;
    }

    if (category && item.program.editorialCategory !== category) {
      return false;
    }

    if (params.group === 'deporte' && sport && sport !== 'all') {
      return normalizeSportFacet(item.program.sportFacet) === sport;
    }

    return true;
  });
}

function filterGuideChannels(
  channels: TvReadChannelSummaryDTO[],
  group?: GuideGroupKey
): TvReadChannelSummaryDTO[] {
  return channels.filter((summary) => {
    if (!group) {
      return !shouldHideFromMixedGuide(summary.channel.group);
    }
    return tvReadChannelMatchesGroup(summary.channel, group);
  });
}

function filterGuideItemsByGroup(
  items: TvReadItemDTO[],
  group?: GuideGroupKey
): TvReadItemDTO[] {
  return items.filter((item) => {
    if (!group) {
      return !shouldHideFromMixedGuide(item.channel.group);
    }
    return tvReadChannelMatchesGroup(item.channel, group);
  });
}

function sortChannels(
  channels: TvReadChannelSummaryDTO[]
): TvReadChannelSummaryDTO[] {
  return [...channels].sort(
    (left, right) =>
      getGuideGroupSortOrder(left.channel.group) - getGuideGroupSortOrder(right.channel.group) ||
      left.channel.sortOrder - right.channel.sortOrder ||
      String(left.channel.name || '').localeCompare(String(right.channel.name || ''), 'es', {
        sensitivity: 'base',
      })
  );
}

function buildPrimeTimeItems(items: TvReadItemDTO[], dateKey: string): TvReadItemDTO[] {
  return selectPrimeTimeTvItems(items, dateKey, {
    uniquePerChannel: true,
    requireStartInsideWindow: true,
  }).sort(sortTvItems);
}

function buildChannelPrimeTimeItems(items: TvReadItemDTO[], dateKey: string): TvReadItemDTO[] {
  return selectPrimeTimeTvItems(items, dateKey, {
    uniquePerChannel: false,
    requireStartInsideWindow: true,
  }).sort(sortTvItems);
}

function normalizeGuideSport(
  sport?: string
): GuideSportKey | undefined {
  const normalized = normalizeSportFacet(sport);
  return normalized || undefined;
}

function resolveCacheTtl(group?: GuideGroupKey): number {
  if (group === 'deporte') {
    return 60;
  }

  return 60;
}

export interface TvGuideSurfaceDTO {
  date: string;
  filters: {
    group?: string;
    category?: string;
    sport?: string;
  };
  nowItems: TvReadItemDTO[];
  nextItems: TvReadItemDTO[];
  nightItems: TvReadItemDTO[];
  channels: TvReadChannelSummaryDTO[];
  meta: {
    totalChannels: number;
    totalItems: number;
    group?: string;
    category?: string;
    sport?: string;
    primeTimeWindowStart: string;
    primeTimeWindowEnd: string;
    groupOrder: string[];
    availableSports?: TvSportFacet[];
    groupCounts: Record<string, number>;
    generatedAt: string;
    cached?: boolean;
  };
}

export interface TvChannelSurfaceDTO {
  date: string;
  channel: TvReadChannelSummaryDTO['channel'] | null;
  /** M10-C: set when `channel` is a verified second feed of this channel; its page redirects there. */
  canonicalChannel?: FeedAliasTarget;
  current?: TvReadItemDTO;
  next?: TvReadItemDTO;
  tonightItems: TvReadItemDTO[];
  scheduleItems: TvReadItemDTO[];
  relatedChannels: TvReadChannelSummaryDTO[];
  meta: {
    totalItems: number;
    generatedAt: string;
    cached?: boolean;
  };
}

export class TvSurfaceService {
  constructor(
    private readonly tvReadQueryService: TvReadQueryService,
    private readonly cacheRepository: ICacheRepository,
    private readonly channelFeedAliases?: Pick<ChannelFeedAliasResolver, 'resolve'>
  ) {}

  /** Never fails the page: without the alias list every channel is served as itself, as before M10-C. */
  private async feedAliases(): Promise<Map<string, FeedAliasTarget>> {
    if (!this.channelFeedAliases) return new Map();
    try {
      return await this.channelFeedAliases.resolve('today');
    } catch {
      return new Map();
    }
  }

  async getGuideSurface(params: {
    date?: string;
    group?: string;
    category?: string;
    sport?: string;
  }): Promise<TvGuideSurfaceDTO> {
    const group = normalizeGuideGroup(params.group);
    const category = normalizeGuideCategory(params.category);
    const sport = normalizeGuideSport(params.sport);
    const cacheKey = `tv:surface:guide:${params.date || 'today'}:${group || 'all'}:${category || 'all'}:${sport || 'all'}`;
    const cached = await this.cacheRepository.get<TvGuideSurfaceDTO>(cacheKey);
    if (cached) {
      return {
        ...cached,
        meta: { ...cached.meta, cached: true },
      };
    }

    const day = await this.tvReadQueryService.query({
      view: 'day',
      date: params.date,
      group,
      limit: 20000,
    });
    const groupCounts = group
      ? await this.tvReadQueryService.getGroupChannelCounts(day.date)
      : deriveGroupCountsFromItems(day.items);
    // M10-C: a verified second feed repeats its channel's schedule; the guide shows the channel once.
    const aliases = await this.feedAliases();
    const channelSource = day.channels.filter((entry) => !aliases.has(entry.channel.id));
    const visibleChannels = sortChannels(filterGuideChannels(channelSource, group));
    const groupScopedItems = filterGuideItemsByGroup(day.items.filter((item) => !aliases.has(item.channel?.id)), group);
    const preFilteredSports = group === 'deporte'
      ? getAvailableSports(groupScopedItems)
      : undefined;
    const filteredItems = applyGuideFilters(groupScopedItems, {
      category,
      sport,
      group,
    });
    const nowItems = selectCurrentTvItems(filteredItems);
    const nextItems = selectNextTvItems(filteredItems, new Date());
    const nightItems = buildPrimeTimeItems(filteredItems, day.date);
    const surface: TvGuideSurfaceDTO = {
      date: day.date,
      filters: {
        group,
        category,
        sport: group === 'deporte' ? sport : undefined,
      },
      nowItems,
      nextItems,
      nightItems,
      channels: visibleChannels,
      meta: {
        totalChannels: visibleChannels.length,
        totalItems: filteredItems.length,
        group,
        category,
        sport: group === 'deporte' ? sport : undefined,
        primeTimeWindowStart: PRIME_TIME_WINDOW.startLabel,
        primeTimeWindowEnd: PRIME_TIME_WINDOW.endLabel,
        groupOrder: GUIDE_GROUP_ORDER,
        availableSports: group === 'deporte' ? preFilteredSports : undefined,
        groupCounts,
        generatedAt: new Date().toISOString(),
      },
    };

    await this.cacheRepository.set(cacheKey, surface, resolveCacheTtl(group));
    return surface;
  }

  async getChannelSurface(channelId: string, date?: string): Promise<TvChannelSurfaceDTO> {
    const cacheKey = `tv:surface:channel:${channelId}:${date || 'today'}`;
    const cached = await this.cacheRepository.get<TvChannelSurfaceDTO>(cacheKey);
    if (cached) {
      const hydrated = this.hydrateChannelSurface(cached);
      return {
        ...hydrated,
        meta: { ...hydrated.meta, cached: true },
      };
    }

    const response = await this.tvReadQueryService.getChannelDetail(channelId, date || 'today', 'day');
    const detailChannel = response.channels[0]?.channel || response.items[0]?.channel || null;
    const relatedSource = detailChannel
      ? await this.tvReadQueryService.getChannels(date || 'today', detailChannel.group)
      : { channels: [] };
    const channel = detailChannel
      ? (relatedSource.channels || []).find((entry) =>
          entry.channel.id === detailChannel.id ||
          entry.channel.normalizedName === detailChannel.normalizedName
        )?.channel || detailChannel
      : null;
    const current = selectCurrentTvItems(response.items)[0];
    const next = selectNextTvItems(response.items, new Date())[0];
    const tonightItems = buildChannelPrimeTimeItems(response.items, response.date);
    // M10-C: today's verified feed aliases (a property of the feeds, not of the day shown). An alias page names its
    // channel; no page lists an alias among its related channels (it would link a redirect).
    const aliases = await this.feedAliases();
    const canonicalChannel = channel ? aliases.get(channel.id) : undefined;
    const relatedChannels = (relatedSource.channels || [])
      .filter((entry) => entry.channel.id !== channel?.id && !aliases.has(entry.channel.id))
      .slice(0, 8);

    const surface: TvChannelSurfaceDTO = {
      date: response.date,
      channel,
      ...(canonicalChannel ? { canonicalChannel } : {}),
      current,
      next,
      tonightItems,
      scheduleItems: response.items,
      relatedChannels,
      meta: {
        totalItems: response.items.length,
        generatedAt: new Date().toISOString(),
      },
    };

    await this.cacheRepository.set(cacheKey, surface, 60);
    return surface;
  }

  private hydrateChannelSurface(surface: TvChannelSurfaceDTO): TvChannelSurfaceDTO {
    const reference = new Date();
    const scheduleItems = surface.scheduleItems.map((item) => ({
      ...hydrateTvReadItemRuntime(item, reference),
      detailPath: item.detailPath,
    }));
    const current = selectCurrentTvItems(scheduleItems)[0];
    const next = selectNextTvItems(scheduleItems, reference)[0];
    const tonightItems = buildChannelPrimeTimeItems(scheduleItems, surface.date);

    return {
      ...surface,
      scheduleItems,
      current,
      next,
      tonightItems,
    };
  }
}
