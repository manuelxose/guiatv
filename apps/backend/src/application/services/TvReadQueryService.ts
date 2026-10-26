import { ICacheRepository } from '@/domain/repositories/ICacheRepository';
import { TVReadAiringModel } from '@/infrastructure/database/models/TVReadAiring.model';
import { DateUtils } from '@/shared/utils/dateUtils';
import { NotFoundError } from '@/shared/errors';
import { l1Cache } from '@/infrastructure/cache/L1Cache';
import { addTiming, measureTiming, setCacheTiming } from '@/shared/utils/performanceTiming';
import { programDetailPath } from '@/domain/services/detailPath';
import {
  buildChannelIdentityMetadata,
  buildLegacyProgramSlug,
  buildSearchTokens,
  getGuideGroupSortOrder,
  inferTimeWindow,
  normalizeSportFacet,
  normalizeTvToken,
} from '@/shared/utils/tvMetadata';
import {
  TvReadChannelsResponseDTO,
  TvReadChannelSummaryDTO,
  TvReadItemDTO,
  TvReadItemResponseDTO,
  TvReadResponseDTO,
  TvReadScheduleResponseDTO,
  TvReadView,
} from '../dto/TvReadDTO';

export interface TvReadQueryParams {
  view: TvReadView;
  date?: string;
  group?: string;
  category?: string;
  sport?: string;
  channelId?: string;
  q?: string;
  limit?: number;
  cursor?: string;
  includeChannels?: boolean;
}

interface TvReadChannelDirectoryRow {
  channel: TvReadChannelSummaryDTO['channel'];
  current?: TvReadItemDTO;
  next?: TvReadItemDTO;
  total: number;
  live: number;
  tonight: number;
}

interface TvReadScheduleRow {
  channel: TvReadChannelSummaryDTO['channel'];
  items: TvReadItemDTO[];
  total: number;
}

export interface TvReadScheduleParams {
  date?: string;
  group?: string;
  category?: string;
  channelId?: string;
  q?: string;
  itemsPerChannel?: number;
}

export interface TvReadProgramSitemapRow {
  title: string;
  start: string | Date;
  /** When the projection row last changed: the sitemap's lastmod (the airing start is not a modification). */
  updatedAt?: string | Date;
}

export function buildTvReadChannelGroupClause(group: string): Record<string, any> {
  const normalized = normalizeTvToken(group, ' ');
  if (normalized === 'movistar') {
    return {
      $or: [
        { 'channel.group': 'movistar' },
        { 'channel.operator': 'Movistar Plus+' },
        { 'channel.providers': 'Movistar Plus+' },
      ],
    };
  }
  if (normalized === 'deporte') {
    return {
      $or: [
        { 'channel.group': 'deporte' },
        { 'channel.contentFacets': 'sports' },
      ],
    };
  }
  if (normalized === 'cable') {
    return {
      $or: [
        { 'channel.group': 'cable' },
        { 'channel.distribution': 'cable' },
      ],
    };
  }
  if (normalized === 'online') {
    return {
      $or: [
        { 'channel.group': 'online' },
        { 'channel.distribution': 'ott' },
      ],
    };
  }
  return { 'channel.group': normalized };
}

export function tvReadChannelMatchesGroup(
  channel: TvReadChannelSummaryDTO['channel'],
  group?: string
): boolean {
  const normalized = normalizeTvToken(group, ' ');
  if (!normalized || normalized === 'all') return true;
  if (normalizeTvToken(channel.group, ' ') === normalized) return true;
  if (normalized === 'movistar') {
    return channel.operator === 'Movistar Plus+' ||
      Boolean(channel.providers?.includes('Movistar Plus+'));
  }
  if (normalized === 'deporte') return Boolean(channel.contentFacets?.includes('sports'));
  if (normalized === 'cable') return channel.distribution === 'cable';
  if (normalized === 'online') return channel.distribution === 'ott';
  return false;
}

export function buildTvReadChannelDirectoryPipeline(
  date: string,
  group?: string,
  reference: Date = new Date(),
  limit?: number
): any[] {
  const match: Record<string, any> = {
    date,
    'channel.id': { $type: 'string', $ne: '' },
    'trustDecision.consumerSuppressed': { $ne: true },
    'program.titleResolutionState': {
      $nin: ['generic_unresolved', 'generic_suppressed'],
    },
  };
  if (group && normalizeTvToken(group, ' ') !== 'all') {
    match.$and = [buildTvReadChannelGroupClause(group)];
  }
  const timestamp = reference.toISOString();

  const pipeline: any[] = [
    { $match: match },
    { $sort: { 'channel.sortOrder': 1, 'airing.start': 1 } },
    {
      $group: {
        _id: '$channel.id',
        channel: { $first: '$channel' },
        total: { $sum: 1 },
        live: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $lte: ['$airing.start', timestamp] },
                  { $gt: ['$airing.end', timestamp] },
                ],
              },
              1,
              0,
            ],
          },
        },
        tonight: {
          $sum: { $cond: [{ $eq: ['$airing.partOfDay', 'noche'] }, 1, 0] },
        },
        currentItems: {
          $push: {
            $cond: [
              {
                $and: [
                  { $lte: ['$airing.start', timestamp] },
                  { $gt: ['$airing.end', timestamp] },
                ],
              },
              '$$ROOT',
              null,
            ],
          },
        },
        nextItems: {
          $push: {
            $cond: [{ $gt: ['$airing.start', timestamp] }, '$$ROOT', null],
          },
        },
      },
    },
    { $sort: { 'channel.sortOrder': 1, 'channel.name': 1 } },
    {
      $project: {
        _id: 0,
        channel: 1,
        total: 1,
        live: 1,
        tonight: 1,
        current: {
          $arrayElemAt: [
            { $filter: { input: '$currentItems', as: 'item', cond: { $ne: ['$$item', null] } } },
            0,
          ],
        },
        next: {
          $arrayElemAt: [
            { $filter: { input: '$nextItems', as: 'item', cond: { $ne: ['$$item', null] } } },
            0,
          ],
        },
      },
    },
  ];
  const boundedLimit = resolveTvReadChannelDirectoryLimit(limit);
  if (boundedLimit) pipeline.push({ $limit: boundedLimit });
  return pipeline;
}

function resolveTvReadChannelDirectoryLimit(value?: number): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(48, Math.floor(parsed));
}

export function resolveTvReadItemsPerChannel(value?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 32;
  return Math.max(1, Math.min(192, Math.floor(parsed)));
}

export function buildTvReadSchedulePipeline(params: {
  date: string;
  group?: string;
  category?: string;
  channelId?: string;
  q?: string;
  itemsPerChannel?: number;
}): any[] {
  const match: Record<string, any> = {
    date: params.date,
    'channel.id': { $type: 'string', $ne: '' },
    'trustDecision.consumerSuppressed': { $ne: true },
    'program.titleResolutionState': {
      $nin: ['generic_unresolved', 'generic_suppressed'],
    },
  };
  const andClauses: Record<string, any>[] = [];
  if (params.category && normalizeTvToken(params.category, ' ') !== 'all') {
    match['program.editorialCategory'] = params.category;
  }
  if (params.group && normalizeTvToken(params.group, ' ') !== 'all') {
    andClauses.push(buildTvReadChannelGroupClause(params.group));
  }
  if (params.channelId) {
    const raw = String(params.channelId).trim();
    const normalized = normalizeTvToken(raw);
    const values = Array.from(new Set([raw, normalized].filter(Boolean)));
    andClauses.push({
      $or: [
        { 'channel.id': { $in: values } },
        { 'channel.sourceIds': { $in: values } },
        { 'channel.aliases': { $in: values } },
      ],
    });
  }
  if (String(params.q || '').trim()) {
    const q = String(params.q).trim();
    const tokens = buildSearchTokens([q]);
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    andClauses.push({
      $or: [
        { searchTokens: { $in: tokens } },
        { 'program.title': new RegExp(escaped, 'i') },
        { 'channel.name': new RegExp(escaped, 'i') },
      ],
    });
  }
  if (andClauses.length) match.$and = andClauses;

  return [
    { $match: match },
    { $sort: { 'channel.sortOrder': 1, 'airing.start': 1 } },
    {
      $group: {
        _id: '$channel.id',
        channel: { $first: '$channel' },
        total: { $sum: 1 },
        items: { $push: '$$ROOT' },
      },
    },
    { $sort: { 'channel.sortOrder': 1, 'channel.name': 1 } },
    {
      $project: {
        _id: 0,
        channel: 1,
        total: 1,
        items: { $slice: ['$items', resolveTvReadItemsPerChannel(params.itemsPerChannel)] },
      },
    },
  ];
}

const TV_READ_LIMITS: Record<TvReadView, { default: number; max: number }> = {
  now: { default: 120, max: 500 },
  next: { default: 120, max: 500 },
  night: { default: 240, max: 1500 },
  // The day view is also the canonical channel-directory/read-model feed.
  // Keeping this at 1,000 silently dropped later guide groups (usually pay TV)
  // because the query is sorted by channel order. Hot views remain bounded.
  day: { default: 240, max: 5000 },
  search: { default: 60, max: 200 },
};

export const PRIME_TIME_WINDOW = {
  startMinutes: 21 * 60 + 45,
  endMinutes: 24 * 60 + 30,
  startLabel: '21:45',
  endLabel: '00:30',
} as const;

export function normalizeTvReadView(input: unknown): TvReadView {
  const value = String(input || '').trim().toLowerCase();
  if (value === 'now' || value === 'next' || value === 'night' || value === 'day' || value === 'search') {
    return value;
  }
  return 'day';
}

export function resolveTvReadLimit(
  view: TvReadView,
  requestedLimit?: number
): number {
  const policy = TV_READ_LIMITS[view];
  const parsed = Number(requestedLimit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return policy.default;
  }

  return Math.max(1, Math.min(policy.max, Math.floor(parsed)));
}

export function applyTvReadTemporalBounds(
  query: Record<string, any>,
  view: TvReadView,
  reference: Date
): Record<string, any> {
  if (view === 'now') {
    const timestamp = reference.toISOString();
    query['airing.start'] = { $lte: timestamp };
    query['airing.end'] = { $gt: timestamp };
  }

  return query;
}

export function scopeChannelSummariesToPage(
  view: TvReadView,
  summaries: TvReadChannelSummaryDTO[],
  pagedItems: TvReadItemDTO[]
): TvReadChannelSummaryDTO[] {
  if (view === 'day') return summaries;
  const channelIds = new Set(pagedItems.map((item) => item.channel.id));
  return summaries.filter((summary) => channelIds.has(summary.channel.id));
}

/**
 * Airings still on air or yet to start at `reference`, compared as instants (the EPG day groups overnight
 * airings under the previous date, so a calendar-date comparison would keep last night's late show).
 */
export function airingsNotEnded(items: TvReadItemDTO[], reference: Date = new Date()): TvReadItemDTO[] {
  return items.filter((item) => new Date(item.airing.end).getTime() > reference.getTime());
}

export function hydrateTvReadItemRuntime(
  item: TvReadItemDTO,
  reference: Date = new Date()
): TvReadItemDTO {
  const start = new Date(item.airing.start);
  const end = new Date(item.airing.end);
  const liveNow =
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime()) &&
    start.getTime() <= reference.getTime() &&
    reference.getTime() < end.getTime();
  const window = inferTimeWindow(start, end, reference);

  return {
    ...item,
    detailPath: programDetailPath(item.id),
    airing: {
      ...item.airing,
      liveNow,
    },
    timingContext: {
      ...item.timingContext,
      start: item.airing.start,
      end: item.airing.end,
      liveNow,
      window: window === 'next' ? 'today' : window,
    },
  };
}

export function isFeaturedTvReadItem(item: TvReadItemDTO): boolean {
  return !item.trustDecision?.featuredSuppressed;
}

export function isConsumerVisibleTvReadItem(item: TvReadItemDTO): boolean {
  if (item.trustDecision?.consumerSuppressed) {
    return false;
  }

  return item.program.titleResolutionState !== 'generic_unresolved' &&
    item.program.titleResolutionState !== 'generic_suppressed';
}

/** Compact card/grid representation; full provenance remains on item detail. */
export function compactTvReadItem(item: TvReadItemDTO): TvReadItemDTO {
  return {
    id: item.id,
    channel: {
      id: item.channel.id,
      name: item.channel.name,
      normalizedName: item.channel.normalizedName,
      aliases: [],
      sourceIds: [],
      type: item.channel.type,
      group: item.channel.group,
      subgroups: item.channel.subgroups || [],
      sortOrder: item.channel.sortOrder,
      icon: item.channel.icon,
      country: item.channel.country,
      countryCode: item.channel.countryCode,
      region: item.channel.region,
      distribution: item.channel.distribution,
      access: item.channel.access,
      operator: item.channel.operator,
      providers: item.channel.providers || [],
      contentFacets: item.channel.contentFacets || [],
      market: item.channel.market || {
        country: 'unknown',
        countryCode: 'unknown',
        region: 'unknown',
        scope: 'unknown',
      },
      quality: item.channel.quality || { resolution: 'unknown', timeshift: 'unknown' },
      capabilities: item.channel.capabilities || {
        linear: 'unknown',
        catchup: 'unknown',
        streaming: 'unknown',
      },
      provenance: item.channel.provenance || {
        classification: 'unknown',
        sourceIds: [],
      },
    },
    program: {
      brandKey: item.program.brandKey,
      title: item.program.title,
      subtitle: item.program.subtitle,
      normalizedTitle: item.program.normalizedTitle,
      titleAliases: [],
      editorialCategory: item.program.editorialCategory,
      genre: item.program.genre,
      subgenre: item.program.subgenre,
      sportFacet: item.program.sportFacet,
      tmdbId: item.program.tmdbId,
      workPath: item.program.workPath,
      description: item.program.description?.slice(0, 320),
      titleResolutionState: item.program.titleResolutionState,
      isResolvedTitle: item.program.isResolvedTitle,
    },
    airing: item.airing,
    assets: {
      primary: item.assets?.primary,
      poster: item.assets?.poster,
      backdrop: item.assets?.backdrop,
      channelLogo: item.assets?.channelLogo,
      platformLogo: item.assets?.platformLogo,
      fallbackChain: (item.assets?.fallbackChain || []).slice(0, 2),
    },
    availability: item.availability,
    sourceProvenance: { schedule: [], metadata: [], assets: [] },
    timingContext: item.timingContext,
    relevance: item.relevance,
    detailPath: item.detailPath,
  };
}

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

function hasVisualAsset(item: TvReadItemDTO): boolean {
  return Boolean(item.assets?.poster?.url || item.assets?.backdrop?.url);
}

function pickPreferredChannelItem(
  current: TvReadItemDTO | undefined,
  candidate: TvReadItemDTO
): TvReadItemDTO {
  if (!current) {
    return candidate;
  }

  if (hasVisualAsset(current) !== hasVisualAsset(candidate)) {
    return hasVisualAsset(candidate) ? candidate : current;
  }

  if (Boolean(current.program.tmdbId) !== Boolean(candidate.program.tmdbId)) {
    return candidate.program.tmdbId ? candidate : current;
  }

  const currentScore = Number(current.relevance?.score || 0);
  const candidateScore = Number(candidate.relevance?.score || 0);
  if (currentScore !== candidateScore) {
    return candidateScore > currentScore ? candidate : current;
  }

  const currentStart = new Date(current.airing.start).getTime();
  const candidateStart = new Date(candidate.airing.start).getTime();
  if (currentStart !== candidateStart) {
    return candidateStart < currentStart ? candidate : current;
  }

  return current;
}

function airingsOverlap(left: TvReadItemDTO, right: TvReadItemDTO): boolean {
  const leftStart = new Date(left.airing.start).getTime();
  const leftEnd = new Date(left.airing.end).getTime();
  const rightStart = new Date(right.airing.start).getTime();
  const rightEnd = new Date(right.airing.end).getTime();
  return leftStart < rightEnd && rightStart < leftEnd;
}

function buildPrimeTimeRange(dateKey: string): { start: Date; end: Date } {
  const safe = String(dateKey || '').trim();
  const year = Number(safe.slice(0, 4));
  const month = Number(safe.slice(4, 6));
  const day = Number(safe.slice(6, 8));
  const start = new Date(year, month - 1, day, 21, 45, 0, 0);
  const end = new Date(year, month - 1, day + 1, 0, 30, 0, 0);
  return { start, end };
}

function overlapsPrimeTimeWindow(item: TvReadItemDTO, dateKey: string): boolean {
  const window = buildPrimeTimeRange(dateKey);
  const start = new Date(item.airing.start).getTime();
  const end = new Date(item.airing.end).getTime();
  return start < window.end.getTime() && end > window.start.getTime();
}

function startsInsidePrimeTimeWindow(item: TvReadItemDTO, dateKey: string): boolean {
  const window = buildPrimeTimeRange(dateKey);
  const start = new Date(item.airing.start).getTime();
  return start >= window.start.getTime() && start < window.end.getTime();
}

function getPrimeTimeOverlapMinutes(item: TvReadItemDTO, dateKey: string): number {
  const window = buildPrimeTimeRange(dateKey);
  const start = Math.max(new Date(item.airing.start).getTime(), window.start.getTime());
  const end = Math.min(new Date(item.airing.end).getTime(), window.end.getTime());
  return Math.max(0, Math.round((end - start) / 60000));
}

function pickPreferredPrimeTimeItem(
  current: TvReadItemDTO | undefined,
  candidate: TvReadItemDTO,
  dateKey: string
): TvReadItemDTO {
  if (!current) {
    return candidate;
  }

  if (
    startsInsidePrimeTimeWindow(current, dateKey) !==
    startsInsidePrimeTimeWindow(candidate, dateKey)
  ) {
    return startsInsidePrimeTimeWindow(candidate, dateKey) ? candidate : current;
  }

  if (hasVisualAsset(current) !== hasVisualAsset(candidate)) {
    return hasVisualAsset(candidate) ? candidate : current;
  }

  if (Boolean(current.program.tmdbId) !== Boolean(candidate.program.tmdbId)) {
    return candidate.program.tmdbId ? candidate : current;
  }

  const currentScore = Number(current.relevance?.score || 0);
  const candidateScore = Number(candidate.relevance?.score || 0);
  if (currentScore !== candidateScore) {
    return candidateScore > currentScore ? candidate : current;
  }

  const currentOverlap = getPrimeTimeOverlapMinutes(current, dateKey);
  const candidateOverlap = getPrimeTimeOverlapMinutes(candidate, dateKey);
  if (currentOverlap !== candidateOverlap) {
    return candidateOverlap > currentOverlap ? candidate : current;
  }

  const currentStart = new Date(current.airing.start).getTime();
  const candidateStart = new Date(candidate.airing.start).getTime();
  return candidateStart < currentStart ? candidate : current;
}

export function selectCurrentTvItems(items: TvReadItemDTO[]): TvReadItemDTO[] {
  const liveByChannel = new Map<string, TvReadItemDTO>();
  items.forEach((item) => {
    if (!item.airing.liveNow || !isFeaturedTvReadItem(item)) {
      return;
    }
    const current = liveByChannel.get(item.channel.id);
    liveByChannel.set(item.channel.id, pickPreferredChannelItem(current, item));
  });

  return Array.from(liveByChannel.values()).sort(sortTvItems);
}

export function selectNextTvItems(
  items: TvReadItemDTO[],
  reference: Date
): TvReadItemDTO[] {
  const nextByChannel = new Map<string, TvReadItemDTO>();
  items.forEach((item) => {
    if (!isFeaturedTvReadItem(item)) {
      return;
    }
    const start = new Date(item.airing.start).getTime();
    if (start <= reference.getTime()) return;

    const current = nextByChannel.get(item.channel.id);
    if (!current) {
      nextByChannel.set(item.channel.id, item);
      return;
    }

    const currentStart = new Date(current.airing.start).getTime();
    if (start < currentStart) {
      nextByChannel.set(item.channel.id, item);
      return;
    }

    if (start === currentStart || airingsOverlap(current, item)) {
      nextByChannel.set(item.channel.id, pickPreferredChannelItem(current, item));
    }
  });

  return Array.from(nextByChannel.values()).sort(sortTvItems);
}

export function selectPrimeTimeTvItems(
  items: TvReadItemDTO[],
  dateKey: string,
  options: { uniquePerChannel?: boolean; requireStartInsideWindow?: boolean } = {}
): TvReadItemDTO[] {
  const candidates = items.filter((item) => {
    if (!isFeaturedTvReadItem(item)) {
      return false;
    }

    if (options.requireStartInsideWindow) {
      return startsInsidePrimeTimeWindow(item, dateKey);
    }

    return overlapsPrimeTimeWindow(item, dateKey);
  });

  if (options.uniquePerChannel === false) {
    return [...candidates].sort(sortTvItems);
  }

  const byChannel = new Map<string, TvReadItemDTO>();
  candidates.forEach((item) => {
    const current = byChannel.get(item.channel.id);
    byChannel.set(item.channel.id, pickPreferredPrimeTimeItem(current, item, dateKey));
  });

  return Array.from(byChannel.values()).sort(sortTvItems);
}

export class TvReadQueryService {
  constructor(
    private readonly cacheRepository: ICacheRepository,
    private readonly readAiringModel: typeof TVReadAiringModel = TVReadAiringModel
  ) {}

  private readonly inFlight = new Map<string, Promise<unknown>>();

  /**
   * Identical concurrent reads share one load. Each cache expiry otherwise
   * lets every simultaneous caller (SSR renders, bots) start the same heavy
   * aggregation, each holding a MongoDB connection until the pool's wait
   * queue times out.
   */
  private singleFlight<T>(key: string, load: () => Promise<T>): Promise<T> {
    const running = this.inFlight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const operation = load().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, operation);
    return operation;
  }

  query(params: TvReadQueryParams): Promise<TvReadResponseDTO> {
    return this.singleFlight(`query:${JSON.stringify(params)}`, () => this.loadQuery(params));
  }

  getChannels(
    dateAliasOrDate: string,
    group?: string,
    limit?: number
  ): Promise<TvReadChannelsResponseDTO> {
    return this.singleFlight(
      `channels:${JSON.stringify([dateAliasOrDate, group, limit])}`,
      () => this.loadChannels(dateAliasOrDate, group, limit)
    );
  }

  getSchedule(params: TvReadScheduleParams): Promise<TvReadScheduleResponseDTO> {
    return this.singleFlight(`schedule:${JSON.stringify(params)}`, () => this.loadSchedule(params));
  }

  private async loadQuery(params: TvReadQueryParams): Promise<TvReadResponseDTO> {
    const date = DateUtils.parseDateAlias(params.date || 'today');
    const view = normalizeTvReadView(params.view);
    const group =
      normalizeTvToken(params.group, ' ') === 'all' ? undefined : params.group;
    const category =
      normalizeTvToken(params.category, ' ') === 'all' ? undefined : params.category;
    const sport = normalizeSportFacet(params.sport);
    const limit = resolveTvReadLimit(view, params.limit);
    const offset = Number(params.cursor || '0') || 0;
    const includeChannels = params.includeChannels !== false;
    // v3 separates the compact list-item schema from responses cached before
    // payload compaction was introduced.
    const cacheKey = `v3:tv:read:${date}:${view}:${group || 'all'}:${category || 'all'}:${sport || 'all'}:${params.channelId || 'all'}:${params.q || ''}:${limit}:${offset}:${includeChannels ? 'channels' : 'items'}`;
    const l1Cached = l1Cache.get(cacheKey) as TvReadResponseDTO | undefined;
    if (l1Cached) {
      setCacheTiming('hit');
      const hydrated = this.hydrateResponseRuntimeState(l1Cached);
      return {
        ...hydrated,
        meta: { ...hydrated.meta, cached: true },
      };
    }

    const cached = await measureTiming('cache', () => this.cacheRepository.get<TvReadResponseDTO>(cacheKey));
    if (cached) {
      setCacheTiming('hit');
      // Skip the in-process L1 cache for 'day' view: it can hold up to
      // TV_READ_LIMITS.day.max (20000) items in a single response, and
      // L1Cache is bounded by entry COUNT (200), not byte size - a handful
      // of these can dominate guiatv-api's own Node heap. Redis (above)
      // stays the cache for this view; only the small-response views
      // (now/next/night/search) get the extra in-process hot-path cache.
      // See docs/rebuild-scoreboard.md's residual-OOM investigation.
      if (view !== 'day') {
        l1Cache.set(cacheKey, cached, this.resolveTtlMs(view));
      }
      const hydrated = this.hydrateResponseRuntimeState(cached);
      return {
        ...hydrated,
        meta: { ...hydrated.meta, cached: true },
      };
    }
    setCacheTiming('miss');

    const reference = new Date();
    const baseQuery = applyTvReadTemporalBounds({ date }, view, reference);
    const andClauses: Record<string, any>[] = [];

    // Visibility is persisted in the public read model, so Mongo can reject
    // suppressed rows before hydration/serialization instead of making Node
    // scan and discard them.
    baseQuery['trustDecision.consumerSuppressed'] = { $ne: true };
    baseQuery['program.titleResolutionState'] = {
      $nin: ['generic_unresolved', 'generic_suppressed'],
    };

    if (group) andClauses.push(buildTvReadChannelGroupClause(group));
    if (category) baseQuery['program.editorialCategory'] = category;
    if (params.channelId) {
      andClauses.push(this.buildChannelFilterClause(params.channelId));
    }

    if (params.q) {
      const tokens = buildSearchTokens([params.q]);
      andClauses.push({
        $or: [
          { searchTokens: { $in: tokens } },
          { 'program.title': new RegExp(this.escapeRegex(String(params.q)), 'i') },
          { 'channel.name': new RegExp(this.escapeRegex(String(params.q)), 'i') },
        ],
      });
    }

    if (view === 'night') {
      baseQuery['airing.partOfDay'] = 'noche';
      const primeTime = buildPrimeTimeRange(date);
      baseQuery['airing.start'] = {
        $gte: primeTime.start.toISOString(),
        $lt: primeTime.end.toISOString(),
      };
    }

    if (view === 'next') {
      baseQuery['airing.start'] = { $gt: reference.toISOString() };
    }

    if (sport && sport !== 'all') {
      baseQuery['program.sportFacet'] = sport;
    }

    if (andClauses.length) {
      baseQuery.$and = andClauses;
    }

    const databasePaged = view === 'day' || view === 'search';
    const itemQuery = TVReadAiringModel.find(baseQuery)
      .sort({ 'channel.sortOrder': 1, 'airing.start': 1 });
    if (databasePaged) {
      itemQuery.skip(offset).limit(limit + 1);
    }

    // Dual-tagged: 'db' keeps this in the generic Mongo latency bucket used
    // across all use cases, 'epg' isolates it as its own metric — this is the
    // canonical read-model query behind live-now/tonight/day-grid/channel
    // lookups, so its latency shouldn't be diluted into an aggregate that
    // also includes unrelated user/catalog/social queries.
    const [rawItems, databaseTotal] = await measureTiming('epg', () => measureTiming('db', () => Promise.all([
      itemQuery.lean().exec() as unknown as Promise<TvReadItemDTO[]>,
      databasePaged ? TVReadAiringModel.countDocuments(baseQuery).exec() : Promise.resolve(0),
    ])));

    const hasMoreDatabaseRows = databasePaged && rawItems.length > limit;
    const boundedRawItems = databasePaged ? rawItems.slice(0, limit) : rawItems;

    const transformStarted = process.hrtime.bigint();
    const allMatching = boundedRawItems
      .map((item) => hydrateTvReadItemRuntime(item, reference))
      .filter((item) => isConsumerVisibleTvReadItem(item));
    const filteredMatching = this.applySportFilter(allMatching, sport);
    const items = this.applyViewTransform(view, filteredMatching, reference, date);
    const allChannelSummaries = this.buildChannelSummaries(
      filteredMatching,
      group,
      params.channelId,
      reference,
      date
    );
    const paged = databasePaged ? items : items.slice(offset, offset + limit);
    const channelSummaries = includeChannels
      ? scopeChannelSummariesToPage(view, allChannelSummaries, paged)
      : [];
    const publicItems = paged.map(compactTvReadItem);
    const response: TvReadResponseDTO = {
      date,
      view,
      items: publicItems,
      channels: channelSummaries,
      filters: {
        group,
        category,
        sport,
        channelId: params.channelId,
        q: params.q,
      },
      meta: {
        total: databasePaged ? databaseTotal : items.length,
        limit,
        nextCursor: databasePaged
          ? (hasMoreDatabaseRows ? String(offset + limit) : undefined)
          : (offset + limit < items.length ? String(offset + limit) : undefined),
        generatedAt: new Date().toISOString(),
      },
    };
    addTiming('transform', Number(process.hrtime.bigint() - transformStarted) / 1_000_000);

    await this.cacheRepository.set(cacheKey, response, this.resolveTtlSeconds(view));
    if (view !== 'day') {
      l1Cache.set(cacheKey, response, this.resolveTtlMs(view));
    }
    return response;
  }

  private async loadChannels(
    dateAliasOrDate: string,
    group?: string,
    limit?: number
  ): Promise<TvReadChannelsResponseDTO> {
    const date = DateUtils.parseDateAlias(dateAliasOrDate || 'today');
    const normalizedGroup =
      normalizeTvToken(group, ' ') === 'all' ? undefined : group;
    const boundedLimit = resolveTvReadChannelDirectoryLimit(limit);
    const cacheKey = `tv:channels:${date}:${normalizedGroup || 'all'}:${boundedLimit || 'complete'}`;
    const cached = await this.cacheRepository.get<TvReadChannelsResponseDTO>(cacheKey);
    if (cached) {
      return { ...cached, meta: { ...cached.meta, cached: true } };
    }
    const rows = (await this.readAiringModel
      .aggregate(buildTvReadChannelDirectoryPipeline(date, normalizedGroup, new Date(), boundedLimit))
      .exec()) as TvReadChannelDirectoryRow[];
    const channels = rows.map((row) => {
      const channel = row.channel;
      const needsLegacyFallback =
        !channel.distribution ||
        !channel.access ||
        !channel.operator ||
        !channel.providers ||
        !channel.contentFacets ||
        !channel.market ||
        !channel.quality ||
        !channel.capabilities ||
        !channel.provenance;
      const metadata = needsLegacyFallback
        ? buildChannelIdentityMetadata({
            name: channel.name,
            sourceId: channel.sourceIds?.[0] || channel.id,
            country: channel.country,
            countryCode: channel.countryCode,
            region: channel.region,
          })
        : undefined;
      return {
        channel: {
          ...channel,
          distribution:
            channel.distribution && channel.distribution !== 'unknown'
              ? channel.distribution
              : metadata?.distribution || 'unknown',
          access:
            channel.access && channel.access !== 'unknown'
              ? channel.access
              : metadata?.access || 'unknown',
          operator:
            channel.operator && channel.operator !== 'unknown'
              ? channel.operator
              : metadata?.operator || 'unknown',
          providers: channel.providers?.length
            ? channel.providers
            : metadata?.providers || [],
          contentFacets: channel.contentFacets?.length
            ? channel.contentFacets
            : metadata?.contentFacets || ['unknown'],
          market: channel.market || metadata?.market,
          quality: channel.quality || metadata?.quality,
          capabilities: channel.capabilities || metadata?.capabilities,
          provenance: channel.provenance || metadata?.provenance,
        },
        current: row.current
          ? compactTvReadItem(hydrateTvReadItemRuntime(row.current))
          : undefined,
        next: row.next
          ? compactTvReadItem(hydrateTvReadItemRuntime(row.next))
          : undefined,
        tonight: [],
        counts: {
          total: Number(row.total || 0),
          live: Number(row.live || 0),
          tonight: Number(row.tonight || 0),
        },
      } satisfies TvReadChannelSummaryDTO;
    });

    const response: TvReadChannelsResponseDTO = {
      date,
      group: normalizedGroup,
      channels,
      meta: {
        total: channels.length,
        generatedAt: new Date().toISOString(),
      },
    };
    await this.cacheRepository.set(cacheKey, response, 60);
    return response;
  }

  async getIndexableProgramSitemapRows(
    dates: string[]
  ): Promise<TvReadProgramSitemapRow[]> {
    const normalizedDates = Array.from(new Set(dates.map((date) => String(date).trim()).filter(Boolean)));
    if (!normalizedDates.length) return [];

    const rows = await this.readAiringModel.find({
      date: { $in: normalizedDates },
      'program.tmdbId': { $type: 'number' },
      'program.title': { $type: 'string', $ne: '' },
      'program.titleResolutionState': { $nin: ['generic_unresolved', 'generic_suppressed'] },
      'trustDecision.consumerSuppressed': { $ne: true },
    })
      .select({ _id: 0, 'program.title': 1, 'airing.start': 1, searchTokens: 1, updatedAt: 1 })
      .sort({ date: 1, 'airing.start': 1 })
      .lean()
      .exec() as Array<{
        program?: { title?: string };
        airing?: { start?: string | Date };
        searchTokens?: string[];
        updatedAt?: Date;
      }>;

    return rows.flatMap((row) => {
      const title = String(row.program?.title || '').trim();
      const start = row.airing?.start;
      const slug = buildLegacyProgramSlug(title);
      const lookupTokens = buildSearchTokens([slug.replace(/-/g, ' ')])
        .filter((token) => !token.includes(' ') && !token.includes('_') && token.length >= 3);
      const indexedTokens = new Set(row.searchTokens || []);
      const searchable = lookupTokens.some((token) => indexedTokens.has(token));
      return title && start && searchable ? [{ title, start, updatedAt: row.updatedAt }] : [];
    });
  }

  private async loadSchedule(params: TvReadScheduleParams): Promise<TvReadScheduleResponseDTO> {
    const date = DateUtils.parseDateAlias(params.date || 'today');
    const group = normalizeTvToken(params.group, ' ') === 'all' ? undefined : params.group;
    const category = normalizeTvToken(params.category, ' ') === 'all'
      ? undefined
      : params.category;
    const itemsPerChannel = resolveTvReadItemsPerChannel(params.itemsPerChannel);
    const q = String(params.q || '').trim() || undefined;
    const cacheKey = `tv:schedule:${date}:${group || 'all'}:${category || 'all'}:${params.channelId || 'all'}:${q || ''}:${itemsPerChannel}`;
    const cached = await this.cacheRepository.get<TvReadScheduleResponseDTO>(cacheKey);
    if (cached) return { ...cached, meta: { ...cached.meta, cached: true } };

    const rows = (await this.readAiringModel
      .aggregate(buildTvReadSchedulePipeline({
        date,
        group,
        category,
        channelId: params.channelId,
        q,
        itemsPerChannel,
      }))
      .exec()) as TvReadScheduleRow[];
    const reference = new Date();
    const channels = rows.map((row) => ({
      channel: row.channel,
      items: row.items
        .map((item) => hydrateTvReadItemRuntime(item, reference))
        .filter(isConsumerVisibleTvReadItem)
        .map(compactTvReadItem),
      counts: {
        total: Number(row.total || 0),
        returned: row.items.length,
        complete: Number(row.total || 0) <= row.items.length,
      },
    }));
    const response: TvReadScheduleResponseDTO = {
      date,
      group,
      channels,
      meta: {
        totalChannels: channels.length,
        totalItems: channels.reduce((total, entry) => total + entry.counts.total, 0),
        itemsPerChannel,
        truncatedChannels: channels.filter((entry) => !entry.counts.complete).length,
        generatedAt: new Date().toISOString(),
      },
    };
    await this.cacheRepository.set(cacheKey, response, 15 * 60);
    return response;
  }

  async getGroupChannelCounts(dateAliasOrDate: string): Promise<Record<string, number>> {
    const date = DateUtils.parseDateAlias(dateAliasOrDate || 'today');
    const rows = await TVReadAiringModel.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          date,
          'channel.group': { $type: 'string', $ne: '' },
          'channel.id': { $type: 'string', $ne: '' },
          'trustDecision.consumerSuppressed': { $ne: true },
          'program.titleResolutionState': {
            $nin: ['generic_unresolved', 'generic_suppressed'],
          },
        },
      },
      { $group: { _id: { group: '$channel.group', channelId: '$channel.id' } } },
      { $group: { _id: '$_id.group', count: { $sum: 1 } } },
    ]).exec();

    return Object.fromEntries(
      rows.map((row) => [normalizeTvToken(row._id, ' '), row.count])
    );
  }

  async getChannelDetail(
    channelId: string,
    dateAliasOrDate: string,
    view: TvReadView = 'day'
  ): Promise<TvReadResponseDTO> {
    return this.query({
      view,
      date: dateAliasOrDate,
      channelId,
      limit: 1000,
    });
  }

  async getItem(airingId: string): Promise<TvReadItemResponseDTO> {
    const cacheKey = `tv:read:item:${airingId}`;
    const l1Cached = l1Cache.get(cacheKey) as TvReadItemResponseDTO | undefined;
    if (l1Cached) {
      return this.hydrateItemResponseRuntimeState(l1Cached, true);
    }

    const cached = await this.cacheRepository.get<TvReadItemResponseDTO>(cacheKey);
    if (cached) {
      l1Cache.set(cacheKey, cached, 30 * 60_000);
      return this.hydrateItemResponseRuntimeState(cached, true);
    }

    const item = (await this.readAiringModel.findOne({ id: airingId }).lean().exec()) as unknown as TvReadItemDTO | null;
    // A 404, not a plain Error: the error handler turned that into a 500, which the SSR serves to crawlers
    // as a 503 on every expired legacy `/contenido/program:*` URL. Database failures still throw as 5xx.
    if (!item || !isConsumerVisibleTvReadItem(item)) {
      throw new NotFoundError('TV read item', airingId);
    }

    // The channel's next airings, not the first twelve of its EPG day (which listed finished ones as upcoming).
    const relatedChannelItems = (await this.readAiringModel.find({
      date: item.airing.date,
      'channel.id': item.channel.id,
      id: { $ne: item.id },
      'airing.end': { $gt: new Date().toISOString() },
    })
      .sort({ 'airing.start': 1 })
      .limit(12)
      .lean()
      .exec()) as unknown as TvReadItemDTO[];

    const response: TvReadItemResponseDTO = {
      item,
      relatedChannelItems: relatedChannelItems.filter((entry) =>
        isConsumerVisibleTvReadItem(entry)
      ),
      meta: {
        generatedAt: new Date().toISOString(),
      },
    };
    await this.cacheRepository.set(cacheKey, response, 30 * 60);
    l1Cache.set(cacheKey, response, 30 * 60_000);
    return this.hydrateItemResponseRuntimeState(response, false);
  }

  private applyViewTransform(
    view: TvReadView,
    items: TvReadItemDTO[],
    reference: Date,
    dateKey: string
  ): TvReadItemDTO[] {
    if (view === 'now') {
      return selectCurrentTvItems(items);
    }

    if (view === 'next') {
      return selectNextTvItems(items, reference);
    }

    if (view === 'night') {
      return selectPrimeTimeTvItems(items, dateKey, { requireStartInsideWindow: true });
    }

    return items.sort(sortTvItems);
  }

  private buildChannelSummaries(
    items: TvReadItemDTO[],
    group?: string,
    channelId?: string,
    reference: Date = new Date(),
    dateKey?: string
  ): TvReadChannelSummaryDTO[] {
    const map = new Map<string, TvReadChannelSummaryDTO>();
    const sortedItems = [...items].sort(sortTvItems);

    sortedItems.forEach((item) => {
      if (!tvReadChannelMatchesGroup(item.channel, group)) return;
      if (channelId && !this.channelMatches(item.channel, channelId)) return;

      const current = map.get(item.channel.id) || {
        channel: item.channel,
        current: undefined,
        next: undefined,
        tonight: [],
        counts: { total: 0, live: 0, tonight: 0 },
      };

      current.counts.total += 1;
      if (item.airing.liveNow && isFeaturedTvReadItem(item)) {
        const preferredCurrent = pickPreferredChannelItem(current.current, item);
        if (!current.current) {
          current.counts.live += 1;
        }
        current.current = preferredCurrent;
      }
      if (isFeaturedTvReadItem(item) && new Date(item.airing.start).getTime() > reference.getTime()) {
        const preferredNext = pickPreferredChannelItem(current.next, item);
        if (
          !current.next ||
          new Date(item.airing.start).getTime() < new Date(current.next.airing.start).getTime() ||
          airingsOverlap(current.next, item)
        ) {
          current.next = preferredNext;
        }
      }
      if (dateKey && overlapsPrimeTimeWindow(item, dateKey) && isFeaturedTvReadItem(item)) {
        current.tonight = [...(current.tonight || []), item].slice(0, 6);
        current.counts.tonight += 1;
      }

      map.set(item.channel.id, current);
    });

    return Array.from(map.values()).sort(
      (left, right) =>
        getGuideGroupSortOrder(left.channel.group) - getGuideGroupSortOrder(right.channel.group) ||
        left.channel.sortOrder - right.channel.sortOrder ||
        String(left.channel.name || '').localeCompare(String(right.channel.name || ''), 'es', {
          sensitivity: 'base',
        })
    );
  }

  private buildChannelFilterClause(channelId: string): Record<string, any> {
    const raw = String(channelId || '').trim();
    const normalized = normalizeTvToken(raw);
    const values = Array.from(new Set([raw, normalized].filter(Boolean)));

    return {
      $or: [
        { 'channel.id': { $in: values } },
        { 'channel.normalizedName': { $in: values } },
        { 'channel.aliases': { $in: values } },
        { 'channel.sourceIds': { $in: values } },
      ],
    };
  }

  private channelMatches(channel: TvReadItemDTO['channel'], channelId: string): boolean {
    const raw = String(channelId || '').trim();
    const normalized = normalizeTvToken(raw);
    return [
      channel.id,
      channel.normalizedName,
      ...(channel.aliases || []),
      ...(channel.sourceIds || []),
    ].some((candidate) => {
      const safe = String(candidate || '').trim();
      return safe === raw || safe === normalized;
    });
  }

  private hydrateResponseRuntimeState(
    response: TvReadResponseDTO
  ): TvReadResponseDTO {
    const reference = new Date();
    const hydratedItems = response.items.map((item) =>
      hydrateTvReadItemRuntime(item, reference)
    );
    const channels = response.channels.length
      ? this.buildChannelSummaries(
          hydratedItems,
          response.filters.group,
          response.filters.channelId,
          reference,
          response.date
        )
      : [];

    return {
      ...response,
      items: this.applyViewTransform(response.view, hydratedItems, reference, response.date),
      channels,
    };
  }

  private hydrateItemResponseRuntimeState(
    response: TvReadItemResponseDTO,
    cached: boolean
  ): TvReadItemResponseDTO {
    const reference = new Date();
    return {
      item: hydrateTvReadItemRuntime(response.item, reference),
      // The response is cached for 30 minutes: drop what has ended since.
      relatedChannelItems: airingsNotEnded(response.relatedChannelItems, reference).map((item) =>
        hydrateTvReadItemRuntime(item, reference)
      ),
      meta: {
        ...response.meta,
        cached,
      },
    };
  }

  private resolveTtlSeconds(view: TvReadView): number {
    if (view === 'now') return 60;
    if (view === 'next') return 120;
    return 15 * 60;
  }

  private resolveTtlMs(view: TvReadView): number {
    return this.resolveTtlSeconds(view) * 1000;
  }

  private escapeRegex(value: string): string {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private applySportFilter(
    items: TvReadItemDTO[],
    sport: ReturnType<typeof normalizeSportFacet>
  ): TvReadItemDTO[] {
    if (!sport || sport === 'all') {
      return items;
    }

    return items.filter(
      (item) => normalizeSportFacet(item.program.sportFacet) === sport
    );
  }
}
