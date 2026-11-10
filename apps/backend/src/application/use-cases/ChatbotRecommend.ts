import {
  AIRecommendationService,
  ChatbotAffiliateActionDTO,
  ChatbotContext,
  ChatbotMessage,
  ChatbotQueryContext,
  ChatbotRecommendationPayload,
  ChatbotResponse,
} from '@/infrastructure/external/AIRecommendationService';
import { AffiliateResolverService } from '../services/AffiliateResolverService';
import { buildAffiliateContext } from '../dto/AffiliateContext';
import { IUserContentInteractionRepository } from '@/domain/repositories/IUserContentInteractionRepository';
import { MongoUserRepository } from '@/infrastructure/repositories/MongoUserRepository';
import { CatalogService } from '../services/CatalogService';
import {
  CatalogContentType,
  CatalogItemDTO,
  CATALOG_PLATFORM_REGISTRY,
} from '../dto/CatalogDTO';
import { UserProfileModel } from '@/infrastructure/database/models/UserProfile.model';
import {
  AssistantHistoryPayload,
  AssistantMemoryService,
} from '../services/AssistantMemoryService';
import { ICacheRepository } from '@/domain/repositories/ICacheRepository';
import * as crypto from 'crypto';
import { logger } from '../../shared/utils/logger';
import { TvReadQueryService } from '../services/TvReadQueryService';
import { AssistantLaunchContext } from '../dto/AssistantDTO';
import { resolveGroundedRecommendations } from './AssistantGrounding';
import { FootballQueryService } from '../sports/services/FootballQueryService';
import { FootballMatch } from '@/domain/sports/football/types';
import { findCanonicalChannelInText } from '@/shared/utils/tvMetadata';
import { findGenresInText, genreLabelsMatch } from '@/shared/taxonomy/genreTaxonomy';

export interface ChatbotRecommendRequest {
  userId: string;
  messages: ChatbotMessage[];
  conversationId?: string;
  context?: AssistantLaunchContext;
}

interface ChatQueryIntent {
  mode: 'tv_now' | 'tv_tonight' | 'tv_channel_schedule' | 'streaming' | 'football_today' | 'general';
  channelId?: string;
  channelPeriod?: 'now' | 'tonight' | 'today';
  requestedTypes: Array<'movie' | 'series' | 'program'>;
  explicitGenres: string[];
  explicitPlatforms: string[];
  wantsFamily: boolean;
  wantsShort: boolean;
  wantsPrimeTime: boolean;
  negativeSignals: string[];
}

const FAMILY_FRIENDLY_GENRES = ['Familia', 'Infantil', 'Comedia', 'Animación'];

// ─── Explicit channel priority order (user-defined) ──────────────────────────

// Group 1 — Nacional / TDT
// Include both "with space" and "without space" variants as EPG sources differ
const NATIONAL_CHANNELS = [
  'la 1', 'la1', 'la primera', 'tve1',
  'la 2', 'la2', 'la dos', 'tve2',
  'antena 3', 'antena3', 'a3',
  'cuatro',
  'telecinco', 'tele 5',
  'la sexta', 'lasexta', 'la 6',
  'divinity',
  'dkiss',
  'ten',
  'be mad', 'bemad',
  'mega',
  'dmax',
  'energy',
  'fdf',
  'atreseries',
  'neox',
  'nova',
  '13 tv', '13tv', 'trece tv', 'trece',
  'veo7', 'veo 7',
  'squirrel tv', 'squirrel 2',
  'boing',
  'clan',
  'teledeporte',
  'real madrid tv',
  'bom cine',
  'el toro tv',
];

// Group 2 — Autonómicos / Regionales
const REGIONAL_CHANNELS = [
  // Regional La 1/La 2 variants — longer keys match before national 'la 1'/'la 2' keys
  'la 1 canarias', 'la 1 cat', 'la 1 cataluna', 'la 1 catalunya', 'la 1 baleares',
  'la 1 aragon', 'la 1 andalucia', 'la 1 castilla', 'la 1 extremadura', 'la 1 galicia',
  'la 2 canarias', 'la 2 cat', 'la 2 cataluna', 'la 2 catalunya', 'la 2 baleares',
  'la 2 aragon', 'la 2 andalucia', 'la 2 castilla',
  // International/Latin American "Trece" variants — must not match national 'trece' key
  'el trece internacional', 'trece internacional', 'el trece',
  'telemadrid', 'la otra', '8madrid', 'tv3',
  'la 2 cat', 'sx3 33', 'sx3', 'canal 33', '33',
  'esport3', 'esport 3', 'beteve', 'a punt', 'la 8 mediterraneo',
  'canal sur', 'andalucia tv', 'canal andalucia',
  'tvg2', 'tvg',
  'etb 1', 'etb 2', 'etb', 'euskal telebista',
  'tv canaria', 'cmmedia', 'cmm', 'ib3',
  'aragon tv', 'la 7 rm', '7 tv region murcia', '7 tv murcia',
  'canal extremadura', 'tpa', 'rtpa',
  'la 7', 'la 8',
  '3/24', '3 24', '24 hores', 'informatiu',
];

// Group 3 — Pago / Cable (no Movistar)
// Order matches the user's desired sequence: SELEKT → AMC → Canal Hollywood → Sundance →
// DARK → XTRM → Somos → AMC Western → Vin TV → Historia → Odisea →
// AMC Crime → AMC Break → AMC Living → Canal Cocina → Nat Geo → Discovery → STAR →
// Warner → MTV → Cosmo → AXN → Calle 13 → Syfy → TCM → Comedy Central
const PAY_CHANNELS = [
  'selekt',
  'amc',
  'canal hollywood', 'hollywood',
  'sundance',
  'dark',
  'xtrm',
  'somos',
  'amc western',
  'vin tv',
  'historia',
  'odisea',
  'amc crime', 'amc break', 'amc living',
  'canal cocina',
  'national geographic wild', 'national geographic', 'nat geo wild', 'nat geo',
  'discovery channel', 'discovery',
  'star channel',
  'warner tv',
  'mtv',
  'cosmo',
  'axn movies', 'axn',
  'calle 13',
  'syfy',
  'tcm',
  'comedy central',
];

// Group 4 — Movistar (includes channels in the Movistar package)
const MOVISTAR_CHANNELS = [
  'movistar plus', 'm+ estrenos', 'm+ hits', 'm+ comedia', 'm+ accion',
  'm+ drama', 'm+ indie', 'm+ clasicos', 'm+ cine espanol', 'm+ originales',
  'm+ documentales', 'm+ vamos', 'm+ deportes 4', 'm+ deportes 3',
  'm+ deportes 2', 'm+ deportes', 'm+ laliga', 'm+ liga de campeones 3',
  'm+ liga de campeones 2', 'm+ liga de campeones', 'm+ golf',
  // BBC channels available via Movistar
  'bbc earth', 'bbc world', 'bbc history', 'bbc top gear', 'bbc series',
  'bbc lifestyle', 'bbc food', 'bbc entertainment', 'bbc',
  // Other Movistar package channels
  'bloomberg', 'al jazeera', 'baby tv', 'canal de las estrellas',
  'euronews', 'cnn', 'fox news', 'sky news',
  'canal estrella', 'estrella tv',
];

// Group 5 — Deportes / Sports
const SPORTS_CHANNELS = [
  'dazn f1', 'dazn laliga', 'dazn 1', 'dazn', 'eurosport 2', 'eurosport 1',
  'eurosport', 'gol play', 'gol', 'extreme sports', 'garage tv', 'ubeat',
];

interface ChannelEntry { group: number; priority: number; }

function buildChannelMap(): Map<string, ChannelEntry> {
  const map = new Map<string, ChannelEntry>();
  const groups = [
    NATIONAL_CHANNELS,
    REGIONAL_CHANNELS,
    PAY_CHANNELS,
    MOVISTAR_CHANNELS,
    SPORTS_CHANNELS,
  ];
  groups.forEach((arr, g) => {
    arr.forEach((ch, i) => {
      if (!map.has(ch)) map.set(ch, { group: g + 1, priority: (g + 1) * 100 + i });
    });
  });
  return map;
}

const CHANNEL_MAP = buildChannelMap();

// Pre-sorted keys longest-first to avoid substring false matches (e.g. 'amc' inside 'amc western')
const CHANNEL_MAP_KEYS_DESC = [...CHANNEL_MAP.keys()].sort((a, b) => b.length - a.length);

const AUTONOMOUS_COMMUNITIES: Array<{
  canonical: string;
  aliases: string[];
  channelPatterns: string[];
}> = [
  {
    canonical: 'Andalucía',
    aliases: ['andalucia', 'andalucía'],
    channelPatterns: ['andalucia', 'andalucía', 'canal sur', 'sur'],
  },
  {
    canonical: 'Aragón',
    aliases: ['aragon', 'aragón'],
    channelPatterns: ['aragon', 'aragón'],
  },
  {
    canonical: 'Asturias',
    aliases: ['asturias', 'principado de asturias'],
    channelPatterns: ['rtpa', 'tpa'],
  },
  {
    canonical: 'Baleares',
    aliases: ['baleares', 'illes balears', 'islas baleares'],
    channelPatterns: ['ib3'],
  },
  {
    canonical: 'Canarias',
    aliases: ['canarias', 'islas canarias'],
    channelPatterns: ['tv canaria', 'canaria'],
  },
  {
    canonical: 'Castilla-La Mancha',
    aliases: ['castilla la mancha', 'castilla-la-mancha'],
    channelPatterns: ['cmm', 'castilla la mancha'],
  },
  {
    canonical: 'Castilla y León',
    aliases: ['castilla y leon', 'castilla y león'],
    channelPatterns: ['cyl', 'castilla y leon', 'castilla y león'],
  },
  {
    canonical: 'Cataluña',
    aliases: ['cataluna', 'cataluña', 'catalunya'],
    channelPatterns: ['tv3', '324', 'catalunya'],
  },
  {
    canonical: 'Comunidad Valenciana',
    aliases: ['comunidad valenciana', 'valencia', 'pais valenciano', 'país valenciano'],
    channelPatterns: ['apunt', 'à punt', 'punt'],
  },
  {
    canonical: 'Extremadura',
    aliases: ['extremadura'],
    channelPatterns: ['canal extremadura', 'extremadura'],
  },
  {
    canonical: 'Galicia',
    aliases: ['galicia'],
    channelPatterns: ['tvg', 'galicia'],
  },
  {
    canonical: 'Madrid',
    aliases: ['madrid', 'comunidad de madrid'],
    channelPatterns: ['telemadrid', 'la otra', 'madrid'],
  },
  {
    canonical: 'Murcia',
    aliases: ['murcia', 'region de murcia', 'región de murcia'],
    channelPatterns: ['7rm', 'murcia'],
  },
  {
    canonical: 'Navarra',
    aliases: ['navarra'],
    channelPatterns: ['navarra'],
  },
  {
    canonical: 'País Vasco',
    aliases: ['pais vasco', 'país vasco', 'euskadi'],
    channelPatterns: ['etb', 'euskadi'],
  },
];

interface RankedScheduleItem {
  item: CatalogItemDTO;
  displayTitle: string;
  dedupeKey: string;
  groupRank: number;
  contentTypeRank: number;
  channelRank: number;
  liveRank: number;
  startRank: number;
  ratingRank: number;
  historyBoost: number;   // lower = better, -1 for genre match, 0 default
  negativePenalty: number; // 0 default, 1 penalty
  timeBoost: number;       // lower = better, 0 primetime, 1 default
}

interface RankingContext {
  likedGenres?: string[];
  negativeSignals?: string[];
  recentTitles?: string[];
  /** For personal follow-up questions. */
  platforms?: string[];
  references?: string[];
}

interface CommunityPreferenceReply {
  kind: 'none' | 'confirm' | 'decline' | 'set' | 'change';
  community?: string;
  shouldPersist: boolean;
}

export type StreamableChatResponse = {
  kind: 'direct';
  response: ChatbotResponse;
} | {
  kind: 'stream';
  textStream: AsyncGenerator<string>;
  finalize: (fullText: string) => Promise<ChatbotResponse>;
};

// L1 in-process cache — eliminates Redis + Mongo round-trips for data that rarely changes
// within a single session window. TTLs are intentionally short to stay fresh.
interface L1Entry<T> { value: T; expiresAt: number; }

export class ChatbotRecommend {
  private static readonly l1: Map<string, L1Entry<unknown>> = new Map();

  private l1Get<T>(key: string): T | undefined {
    const entry = ChatbotRecommend.l1.get(key) as L1Entry<T> | undefined;
    if (!entry || Date.now() > entry.expiresAt) {
      ChatbotRecommend.l1.delete(key);
      return undefined;
    }
    return entry.value;
  }

  private l1Set<T>(key: string, value: T, ttlMs: number): void {
    ChatbotRecommend.l1.set(key, { value, expiresAt: Date.now() + ttlMs });
    // Evict stale entries when the map grows large (prevents unbounded growth)
    if (ChatbotRecommend.l1.size > 1000) {
      const now = Date.now();
      for (const [k, v] of ChatbotRecommend.l1) {
        if (now > v.expiresAt) ChatbotRecommend.l1.delete(k);
      }
    }
  }

  private async l1Fetch<T>(key: string, ttlMs: number, fetch: () => Promise<T>): Promise<T> {
    const cached = this.l1Get<T>(key);
    if (cached !== undefined) return cached;
    const value = await fetch();
    this.l1Set(key, value, ttlMs);
    return value;
  }

  constructor(
    private readonly aiService: AIRecommendationService,
    private readonly interactionRepository: IUserContentInteractionRepository,
    private readonly userRepository: MongoUserRepository,
    private readonly catalogService: CatalogService,
    private readonly assistantMemoryService: AssistantMemoryService,
    private readonly cacheRepository?: ICacheRepository,
    private readonly tvReadQueryService?: TvReadQueryService,
    private readonly footballQueryService?: FootballQueryService,
    private readonly affiliateResolverService?: AffiliateResolverService
  ) {}

  async execute(
    request: ChatbotRecommendRequest
  ): Promise<ChatbotResponse> {
    const latestUserMessage = this.getLatestUserMessage(request.messages);

    // --- Response cache: check before heavy processing ---
    if (this.cacheRepository && latestUserMessage) {
      const intent = this.analyzeIntent(latestUserMessage);
      const cacheKey = this.buildCacheKey(request.userId, latestUserMessage, intent.mode);
      try {
        const cached = await this.cacheRepository.get<string>(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as ChatbotResponse;
          return parsed;
        }
      } catch { /* cache miss or parse error – continue normally */ }
    }

    const [history, user, profile, genreProfile, recentInteractions] =
      await Promise.all([
        this.assistantMemoryService.getHistory(request.userId, request.conversationId),
        this.l1Fetch(`user:${request.userId}`, 600_000, () => this.userRepository.findNameById(request.userId)),
        this.l1Fetch(`profile:${request.userId}`, 600_000, () =>
          UserProfileModel.findOne({ userId: request.userId })
            .select('favoriteGenres username preferredPlatforms')
            .lean().exec()
        ),
        this.l1Fetch(`genreProfile:${request.userId}`, 900_000, () => this.interactionRepository.getUserGenreProfile(request.userId)),
        this.l1Fetch(`interactions:${request.userId}`, 300_000, () => this.interactionRepository.findByUser(request.userId, { status: 'seen', limit: 20 })),
      ]);

    const communityReply = this.extractCommunityReply(
      latestUserMessage,
      history.memory?.preferredAutonomousCommunity
    );
    if (communityReply.shouldPersist) {
      await this.assistantMemoryService.saveCommunityPreference({
        userId: request.userId,
        preferredAutonomousCommunity:
          communityReply.kind === 'set'
            ? communityReply.community
            : history.memory?.preferredAutonomousCommunity,
        autonomicOptIn:
          communityReply.kind === 'decline'
            ? false
            : communityReply.kind === 'confirm' || communityReply.kind === 'set'
              ? true
              : undefined,
      });
      if (communityReply.kind === 'set' && history.memory) {
        history.memory.preferredAutonomousCommunity = communityReply.community;
        history.memory.autonomicOptIn = true;
      } else if (communityReply.kind === 'confirm' && history.memory) {
        history.memory.autonomicOptIn = true;
      } else if (communityReply.kind === 'decline' && history.memory) {
        history.memory.autonomicOptIn = false;
      }
    }

    const intent = this.analyzeIntent(latestUserMessage);
    if (intent.mode === 'football_today' && this.footballQueryService && latestUserMessage) {
      const rawResponse = await this.buildFootballTodayResponse();
      const response = await this.attachAffiliateActions(
        rawResponse,
        request.conversationId || history.conversationId
      );
      const persisted = await this.assistantMemoryService.saveChatTurn({
        userId: request.userId,
        conversationId: request.conversationId || history.conversationId || undefined,
        userMessage: latestUserMessage,
        assistantResponse: response,
      });
      return { ...response, conversationId: persisted.conversationId, assistantMemorySnapshot: persisted.memory };
    }
    const liveTypesForExecute = this.resolveLiveTypes(intent);
    const effectiveCommunity =
      communityReply.kind === 'set'
        ? communityReply.community
        : history.memory?.preferredAutonomousCommunity;
    const isLiveIntent = intent.mode === 'tv_now' || intent.mode === 'tv_tonight' || intent.mode === 'tv_channel_schedule';
    const isStreamingIntent = intent.mode === 'streaming' || intent.mode === 'general';
    const emptyResult = { items: [], total: 0 };

    const [
      liveCatalog,
      tonightEarlyCatalog,
      tonightLateCatalog,
      streamingCatalog,
    ] = await Promise.all([
      isLiveIntent && intent.mode !== 'tv_channel_schedule'
        ? this.loadTvCatalog({ view: 'now', limit: 1000, requestedTypes: liveTypesForExecute })
        : emptyResult,
      isLiveIntent && intent.mode === 'tv_tonight'
        ? this.loadTvCatalog({
            view: 'night',
            limit: 500,
            category: undefined,
            slot: '6',
            requestedTypes: liveTypesForExecute,
          })
        : emptyResult,
      isLiveIntent && intent.mode === 'tv_tonight'
        ? this.loadTvCatalog({
            view: 'night',
            limit: 500,
            category: undefined,
            slot: '7',
            requestedTypes: liveTypesForExecute,
          })
        : emptyResult,
      isStreamingIntent ? this.catalogService.query({
        userId: request.userId,
        availability: ['streaming'],
        types: this.resolveStreamingTypes(intent),
        genres: intent.explicitGenres.length ? intent.explicitGenres : undefined,
        platforms: intent.explicitPlatforms.length
          ? intent.explicitPlatforms
          : undefined,
        sort: 'popular',
        limit: 36,
        page: 1,
      }) : emptyResult,
    ]);

    const liveNowItems = this.filterCatalogItems(
      this.dedupeCatalogItems(liveCatalog.items.filter((item) => item.liveNow)),
      intent
    );
    const tonightSourceItems = this.dedupeCatalogItems([
      ...tonightEarlyCatalog.items,
      ...tonightLateCatalog.items,
    ]);
    const tonightItems = this.filterCatalogItems(
      this.extractTonightItems(tonightSourceItems),
      intent
    );
    const streamingMatches = this.filterCatalogItems(
      streamingCatalog.items,
      intent
    );

    const directResponse = await this.buildDirectScheduleResponse(
      intent,
      liveNowItems,
      tonightItems,
      streamingMatches,
      latestUserMessage,
      {
        history,
        effectiveCommunity,
        communityReply,
        rankingCtx: {
          likedGenres: this.mergeUnique(profile?.favoriteGenres || [], history.memory?.likedGenres || []),
          negativeSignals: this.mergeUnique(history.memory?.negativeSignals || [], history.memory?.dislikedGenres || []),
          recentTitles: recentInteractions.map((i: any) => i.title || '').filter(Boolean),
          platforms: this.mergeUnique(profile?.preferredPlatforms || [], history.memory?.preferredPlatforms || []),
          references: history.memory?.favoriteFranchisesOrTitles || [],
        },
      }
    );
    if (directResponse && latestUserMessage) {
      const normalizedDirectResponse = await this.attachAffiliateActions(
        this.finalizeResponse(directResponse, latestUserMessage),
        request.conversationId || history.conversationId
      );
      const persisted = await this.assistantMemoryService.saveChatTurn({
        userId: request.userId,
        conversationId: request.conversationId || history.conversationId || undefined,
        userMessage: latestUserMessage,
        assistantResponse: normalizedDirectResponse,
      });

      return {
        ...normalizedDirectResponse,
        conversationId: persisted.conversationId,
        assistantMemorySnapshot: persisted.memory,
      };
    }

    const context = this.buildContext({
      userId: request.userId,
      history,
      intent,
      userName: user?.name || profile?.username || 'usuario',
      favoriteGenres: this.mergeUnique(
        profile?.favoriteGenres || [],
        history.memory?.likedGenres || []
      ),
      dislikedGenres: this.mergeUnique(
        history.memory?.dislikedGenres || []
      ),
      preferredPlatforms: this.mergeUnique(
        genreProfile.preferredPlatforms || [],
        profile?.preferredPlatforms || [],
        history.memory?.preferredPlatforms || []
      ),
      recentInteractions,
      liveNowItems,
      tonightItems,
      streamingMatches,
      avgRating: genreProfile.avgRating,
      effectiveCommunity,
    });

    const baseResponse = await this.aiService.chat(request.messages, context);
    const [resolvedRecommendations, resolvedMoreRecommendations] = await Promise.all([
      this.resolveRecommendations(baseResponse.recommendations || []),
      this.resolveRecommendations(baseResponse.moreRecommendations || []),
    ]);

    const finalResponse: ChatbotResponse = {
      ...baseResponse,
      recommendations: resolvedRecommendations,
      moreRecommendations: resolvedMoreRecommendations,
    };

    if (!latestUserMessage) {
      return {
        ...finalResponse,
        assistantMemorySnapshot: history.memory || undefined,
      };
    }

    const normalizedFinalResponse = await this.attachAffiliateActions(
      this.finalizeResponse(finalResponse, latestUserMessage),
      request.conversationId || history.conversationId
    );
    const persisted = await this.assistantMemoryService.saveChatTurn({
      userId: request.userId,
      conversationId: request.conversationId || history.conversationId || undefined,
      userMessage: latestUserMessage,
      assistantResponse: normalizedFinalResponse,
    });

    const result = {
      ...normalizedFinalResponse,
      conversationId: persisted.conversationId,
      assistantMemorySnapshot: persisted.memory,
    };

    // --- Store in cache ---
    if (this.cacheRepository && latestUserMessage) {
      const cacheKey = this.buildCacheKey(request.userId, latestUserMessage, intent.mode);
      const ttl = this.getCacheTtl(intent.mode);
      this.cacheRepository.set(cacheKey, JSON.stringify(result), ttl).catch(() => {});
    }

    return result;
  }

  async executeStream(
    request: ChatbotRecommendRequest
  ): Promise<StreamableChatResponse> {
    const t0 = Date.now();
    const latestUserMessage = this.getLatestUserMessage(request.messages);
    // Keep streaming and JSON clients on the same deterministic EPG path for
    // explicit channel requests; never let this fall through to AI streaming.
    if (this.analyzeIntent(latestUserMessage).mode === 'tv_channel_schedule') {
      return { kind: 'direct', response: await this.execute(request) };
    }
    logger.info('[ChatbotRecommend] executeStream start', { userId: request.userId, conversationId: request.conversationId });

    // --- Cache check: skip all DB + catalog + AI work if we have a recent answer ---
    if (this.cacheRepository && latestUserMessage) {
      const intentForCache = this.analyzeIntent(latestUserMessage);
      if (intentForCache.mode === 'tv_now' || intentForCache.mode === 'tv_tonight' || intentForCache.mode === 'streaming') {
        const cacheKey = this.buildCacheKey(request.userId, latestUserMessage, intentForCache.mode);
        try {
          const cached = await this.cacheRepository.get<string>(cacheKey);
          if (cached) {
            const parsed = JSON.parse(cached) as ChatbotResponse;
            logger.info('[ChatbotRecommend] executeStream cache hit', { userId: request.userId, mode: intentForCache.mode, elapsedMs: Date.now() - t0 });
            return { kind: 'direct', response: parsed };
          }
        } catch { /* cache miss or parse error — continue */ }
      }
    }

    const [history, user, profile, genreProfile, recentInteractions] =
      await Promise.all([
        this.assistantMemoryService.getHistory(request.userId, request.conversationId),
        // L1: user name changes rarely — 10 min TTL
        this.l1Fetch(`user:${request.userId}`, 600_000, () => this.userRepository.findNameById(request.userId)),
        // L1: profile genres/platforms change rarely — 10 min TTL
        this.l1Fetch(`profile:${request.userId}`, 600_000, () =>
          UserProfileModel.findOne({ userId: request.userId })
            .select('favoriteGenres username preferredPlatforms')
            .lean().exec()
        ),
        // L1: 3 aggregations on interactions — expensive, cache 15 min
        this.l1Fetch(`genreProfile:${request.userId}`, 900_000, () => this.interactionRepository.getUserGenreProfile(request.userId)),
        // L1: recent interactions for context — 5 min TTL
        this.l1Fetch(`interactions:${request.userId}`, 300_000, () => this.interactionRepository.findByUser(request.userId, { status: 'seen', limit: 20 })),
      ]);
    logger.info('[ChatbotRecommend] DB queries done', { userId: request.userId, elapsedMs: Date.now() - t0 });

    const communityReply = this.extractCommunityReply(
      latestUserMessage,
      history.memory?.preferredAutonomousCommunity
    );
    if (communityReply.shouldPersist) {
      await this.assistantMemoryService.saveCommunityPreference({
        userId: request.userId,
        preferredAutonomousCommunity:
          communityReply.kind === 'set'
            ? communityReply.community
            : history.memory?.preferredAutonomousCommunity,
        autonomicOptIn:
          communityReply.kind === 'decline'
            ? false
            : communityReply.kind === 'confirm' || communityReply.kind === 'set' ? true : undefined,
      });
      if (communityReply.kind === 'set' && history.memory) {
        history.memory.preferredAutonomousCommunity = communityReply.community;
        history.memory.autonomicOptIn = true;
      } else if (communityReply.kind === 'confirm' && history.memory) {
        history.memory.autonomicOptIn = true;
      } else if (communityReply.kind === 'decline' && history.memory) {
        history.memory.autonomicOptIn = false;
      }
    }

    const intent = this.analyzeIntent(latestUserMessage);
    if (intent.mode === 'football_today' && this.footballQueryService && latestUserMessage) {
      const rawResponse = await this.buildFootballTodayResponse();
      const response = await this.attachAffiliateActions(
        rawResponse,
        request.conversationId || history.conversationId
      );
      const persisted = await this.assistantMemoryService.saveChatTurn({
        userId: request.userId,
        conversationId: request.conversationId || history.conversationId || undefined,
        userMessage: latestUserMessage,
        assistantResponse: response,
      });
      return { kind: 'direct', response: { ...response, conversationId: persisted.conversationId, assistantMemorySnapshot: persisted.memory } };
    }
    const liveTypesForStream = this.resolveLiveTypes(intent);
    const effectiveCommunity =
      communityReply.kind === 'set'
        ? communityReply.community
        : history.memory?.preferredAutonomousCommunity;
    // Only fetch what the intent requires — avoids heavy parallel queries for chat/streaming questions
    const isLiveIntent = intent.mode === 'tv_now' || intent.mode === 'tv_tonight';
    const isStreamingIntent = intent.mode === 'streaming' || intent.mode === 'general';
    const emptyResult = { items: [], total: 0 };

    const t1 = Date.now();
    const [liveCatalog, tonightEarlyCatalog, tonightLateCatalog, streamingCatalog] =
      await Promise.all([
        isLiveIntent
          ? this.loadTvCatalog({ view: 'now', limit: 1000, requestedTypes: liveTypesForStream })
          : emptyResult,
        isLiveIntent && intent.mode === 'tv_tonight'
          ? this.loadTvCatalog({ view: 'night', limit: 500, slot: '6', requestedTypes: liveTypesForStream })
          : emptyResult,
        isLiveIntent && intent.mode === 'tv_tonight'
          ? this.loadTvCatalog({ view: 'night', limit: 500, slot: '7', requestedTypes: liveTypesForStream })
          : emptyResult,
        isStreamingIntent ? this.catalogService.query({ userId: request.userId, availability: ['streaming'], types: this.resolveStreamingTypes(intent), genres: intent.explicitGenres.length ? intent.explicitGenres : undefined, platforms: intent.explicitPlatforms.length ? intent.explicitPlatforms : undefined, sort: 'popular', limit: 36, page: 1 }) : emptyResult,
      ]);
    logger.info('[ChatbotRecommend] catalog queries done', { userId: request.userId, mode: intent.mode, elapsedMs: Date.now() - t1, totalElapsedMs: Date.now() - t0 });

    const liveNowItems = this.filterCatalogItems(this.dedupeCatalogItems(liveCatalog.items.filter((item) => item.liveNow)), intent);
    const tonightSourceItems = this.dedupeCatalogItems([...tonightEarlyCatalog.items, ...tonightLateCatalog.items]);
    const tonightItems = this.filterCatalogItems(this.extractTonightItems(tonightSourceItems), intent);
    const streamingMatches = this.filterCatalogItems(streamingCatalog.items, intent);

    // Direct schedule responses return immediately (no streaming needed)
    const directResponse = await this.buildDirectScheduleResponse(intent, liveNowItems, tonightItems, streamingMatches, latestUserMessage, { history, effectiveCommunity, communityReply, rankingCtx: {
      likedGenres: this.mergeUnique(profile?.favoriteGenres || [], history.memory?.likedGenres || []),
      negativeSignals: this.mergeUnique(history.memory?.negativeSignals || [], history.memory?.dislikedGenres || []),
      recentTitles: recentInteractions.map((i: any) => i.title || '').filter(Boolean),
      platforms: this.mergeUnique(profile?.preferredPlatforms || [], history.memory?.preferredPlatforms || []),
      references: history.memory?.favoriteFranchisesOrTitles || [],
    } });
    if (directResponse && latestUserMessage) {
      const normalizedDirectResponse = await this.attachAffiliateActions(
        this.finalizeResponse(directResponse, latestUserMessage),
        request.conversationId || history.conversationId
      );
      const persisted = await this.assistantMemoryService.saveChatTurn({
        userId: request.userId,
        conversationId: request.conversationId || history.conversationId || undefined,
        userMessage: latestUserMessage,
        assistantResponse: normalizedDirectResponse,
      });
      const directResult = { ...normalizedDirectResponse, conversationId: persisted.conversationId, assistantMemorySnapshot: persisted.memory };
      // Cache direct responses so future identical queries skip the full DB + catalog flow
      if (this.cacheRepository) {
        const cacheKey = this.buildCacheKey(request.userId, latestUserMessage, intent.mode);
        const ttl = this.getCacheTtl(intent.mode);
        this.cacheRepository.set(cacheKey, JSON.stringify(directResult), ttl).catch(() => {});
      }
      return { kind: 'direct', response: directResult };
    }

    // Build AI context and stream text from provider
    const context = this.buildContext({
      userId: request.userId,
      history,
      intent,
      userName: user?.name || profile?.username || 'usuario',
      favoriteGenres: this.mergeUnique(profile?.favoriteGenres || [], history.memory?.likedGenres || []),
      dislikedGenres: this.mergeUnique(history.memory?.dislikedGenres || []),
      preferredPlatforms: this.mergeUnique(genreProfile.preferredPlatforms || [], profile?.preferredPlatforms || [], history.memory?.preferredPlatforms || []),
      recentInteractions,
      liveNowItems,
      tonightItems,
      streamingMatches,
      avgRating: genreProfile.avgRating,
      effectiveCommunity,
    });

    logger.info('[ChatbotRecommend] starting AI stream', { userId: request.userId, provider: this.aiService['provider'], totalElapsedMs: Date.now() - t0 });
    const textStream = this.aiService.chatStream(request.messages, context);

    const finalize = async (fullText: string): Promise<ChatbotResponse> => {
      logger.info('[ChatbotRecommend] finalize start', { userId: request.userId, fullTextLength: fullText.length, totalElapsedMs: Date.now() - t0 });
      const baseResponse = this.aiService.parseStreamedResponse(fullText);
      const [resolvedRecommendations, resolvedMoreRecommendations] = await Promise.all([
        this.resolveRecommendations(baseResponse.recommendations || []),
        this.resolveRecommendations(baseResponse.moreRecommendations || []),
      ]);

      const finalResponse: ChatbotResponse = {
        ...baseResponse,
        recommendations: resolvedRecommendations,
        moreRecommendations: resolvedMoreRecommendations,
      };

      if (!latestUserMessage) {
        return { ...finalResponse, assistantMemorySnapshot: history.memory || undefined };
      }

      const normalizedFinalResponse = await this.attachAffiliateActions(
        this.finalizeResponse(finalResponse, latestUserMessage),
        request.conversationId || history.conversationId
      );
      const persisted = await this.assistantMemoryService.saveChatTurn({
        userId: request.userId,
        conversationId: request.conversationId || history.conversationId || undefined,
        userMessage: latestUserMessage,
        assistantResponse: normalizedFinalResponse,
      });
      logger.info('[ChatbotRecommend] saveChatTurn done', { userId: request.userId, conversationId: persisted.conversationId, totalElapsedMs: Date.now() - t0 });

      const streamResult = {
        ...normalizedFinalResponse,
        conversationId: persisted.conversationId,
        assistantMemorySnapshot: persisted.memory,
      };

      // Write to cache so future identical queries skip DB + AI entirely
      if (this.cacheRepository && latestUserMessage) {
        const cacheKey = this.buildCacheKey(request.userId, latestUserMessage, intent.mode);
        const ttl = this.getCacheTtl(intent.mode);
        this.cacheRepository.set(cacheKey, JSON.stringify(streamResult), ttl).catch(() => {});
      }

      return streamResult;
    };

    return { kind: 'stream', textStream, finalize };
  }

  // --- Cache helpers ---

  buildCacheKey(userId: string, message: string, mode: string): string {
    const normalized = message.toLowerCase().trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
    const hash = crypto.createHash('sha256').update(`${normalized}:${mode}`).digest('hex').slice(0, 16);
    return `ai:response:${userId}:${hash}`;
  }

  getCacheTtl(mode: string): number {
    switch (mode) {
      case 'tv_now': return 180;
      case 'tv_tonight': return 300;
      case 'streaming': return 600;
      default: return 300;
    }
  }

  buildProactiveCacheKey(community: string, mode: string): string {
    const now = new Date();
    const window = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(Math.floor(now.getMinutes() / 5) * 5).padStart(2, '0')}`;
    return `ai:proactive:${community || 'default'}:${mode}:${window}`;
  }

  private buildContext(input: {
    userId: string;
    history: AssistantHistoryPayload;
    intent: ChatQueryIntent;
    userName: string;
    favoriteGenres: string[];
    dislikedGenres: string[];
    preferredPlatforms: string[];
    recentInteractions: Array<{
      contentTitle: string;
      platform?: string;
      rating?: number;
      contentType: string;
    }>;
    liveNowItems: CatalogItemDTO[];
    tonightItems: CatalogItemDTO[];
    streamingMatches: CatalogItemDTO[];
    avgRating: number;
    effectiveCommunity?: string;
  }): ChatbotContext {
    return {
      userId: input.userId,
      userProfile: {
        name: input.userName,
        favoriteGenres: input.favoriteGenres,
        dislikedGenres: input.dislikedGenres,
        topRatedContent: input.recentInteractions
          .filter((interaction) => interaction.rating && interaction.rating >= 7)
          .map((interaction) => ({
            title: interaction.contentTitle,
            rating: interaction.rating || 0,
            type: interaction.contentType,
          }))
          .slice(0, 10),
        recentlyWatched: input.recentInteractions.slice(0, 10).map((interaction) => ({
          title: interaction.contentTitle,
          platform: interaction.platform,
        })),
        preferredPlatforms: input.preferredPlatforms,
        avgRating: input.avgRating,
      },
      assistantMemory: {
        likedGenres: input.history.memory?.likedGenres || [],
        dislikedGenres: input.history.memory?.dislikedGenres || [],
        preferredPlatforms: input.history.memory?.preferredPlatforms || [],
        avoidedPlatforms: input.history.memory?.avoidedPlatforms || [],
        preferredDurations: input.history.memory?.preferredDurations || [],
        preferredViewingContexts:
          input.history.memory?.preferredViewingContexts || [],
        favoriteFranchisesOrTitles:
          input.history.memory?.favoriteFranchisesOrTitles || [],
        recentTopics: input.history.memory?.recentTopics || [],
        negativeSignals: input.history.memory?.negativeSignals || [],
        preferredAutonomousCommunity:
          input.effectiveCommunity ||
          input.history.memory?.preferredAutonomousCommunity,
        autonomicOptIn: input.history.memory?.autonomicOptIn || 'unknown',
        lastCommunityConfirmationAt:
          input.history.memory?.lastCommunityConfirmationAt,
      },
      conversationHistory: input.history.messages
        .slice(-6)
        .map((message) => ({
          role: message.role,
          content: message.role === 'user'
            ? message.content.slice(0, 300)
            : message.content.slice(0, 200),
        })),
      queryIntent: input.intent,
      liveNow: input.liveNowItems.slice(0, 6).map((item) => ({
        title: item.title,
        type: item.contentType,
        channel: item.channel?.name || '',
        platform: item.primaryPlatforms[0],
        time: item.start ? this.formatTime(item.start) : '',
        genre: item.genres[0] || '',
        tmdbRating: item.rating,
      })),
      tonight: input.tonightItems.slice(0, 6).map((item) => ({
        title: item.title,
        type: item.contentType,
        channel: item.channel?.name || '',
        platform: item.primaryPlatforms[0],
        time: item.start ? this.formatTime(item.start) : '',
        genre: item.genres[0] || '',
        tmdbRating: item.rating,
      })),
      streamingMatches: input.streamingMatches.slice(0, 8).map((item) => ({
        title: item.title,
        type: item.contentType,
        channel: item.channel?.name,
        platform: item.primaryPlatforms[0],
        time: item.start ? this.formatTime(item.start) : undefined,
        genre: item.genres[0] || '',
        tmdbRating: item.rating,
      })),
    };
  }

  private async buildDirectScheduleResponse(
    intent: ChatQueryIntent,
    liveNowItems: CatalogItemDTO[],
    tonightItems: CatalogItemDTO[],
    streamingMatches: CatalogItemDTO[],
    latestUserMessage: string,
    context: {
      history: AssistantHistoryPayload;
      effectiveCommunity?: string;
      communityReply: CommunityPreferenceReply;
      rankingCtx?: RankingContext;
    }
  ): Promise<ChatbotResponse | null> {
    // Title-specific schedule query ("a qué hora emiten X", "en qué canal dan Y")
    if (latestUserMessage) {
      if (intent.mode === 'tv_channel_schedule' && intent.channelId) {
        const schedule = await this.loadTvCatalog({
          view: 'day', channelId: intent.channelId, limit: 120, requestedTypes: this.resolveLiveTypes(intent),
        });
        const items = this.filterCatalogItems(this.dedupeCatalogItems(schedule.items), intent);
        const channelName = items[0]?.channel?.name || intent.channelId;
        const periodItems = intent.channelPeriod === 'now'
          ? items.filter((item) => item.liveNow)
          : intent.channelPeriod === 'tonight'
            ? this.extractTonightItems(items)
            : items;
        if (!periodItems.length) {
          logger.warn('[ChatbotRecommend] explicit_channel_schedule_empty', {
            requestedChannel: intent.channelId, scheduleCount: items.length, period: intent.channelPeriod,
          });
          return {
            text: `No he encontrado programación actual de ${channelName} para este periodo.`,
            recommendations: [], moreRecommendations: [], followUpSuggestions: ['¿Qué hay ahora mismo en TV?', '¿Qué hay esta noche?'],
          };
        }
        const ranked = intent.requestedTypes.includes('movie')
          ? this.rankMovieItems(periodItems, intent.channelPeriod === 'now' ? 'tv_now' : 'tv_tonight', context.rankingCtx, intent.wantsPrimeTime)
          : this.rankScheduleItems(periodItems, intent.channelPeriod === 'now' ? 'tv_now' : 'tv_tonight', context.rankingCtx);
        const picks = ranked.slice(0, 6);
        return {
          text: `${intent.channelPeriod === 'now' ? 'Ahora mismo' : intent.channelPeriod === 'tonight' ? 'Esta noche' : 'Hoy'} en ${channelName}:`,
          recommendations: picks.map((entry) => this.mapRankedItemToRecommendation(entry, entry.item.liveNow ? `En emisión ahora en ${channelName}.` : `Empieza a las ${entry.item.start ? this.formatTime(entry.item.start) : 'próximamente'} en ${channelName}.`)),
          moreRecommendations: ranked.slice(6).map((entry) => this.mapRankedItemToRecommendation(entry, `En ${channelName}.`)),
          followUpSuggestions: ['¿Qué están echando ahora?', '¿Qué hay esta noche?'],
        };
      }
      const titleQuery = this.detectTitleScheduleQuery(latestUserMessage);
      if (titleQuery) {
        const titleResponse = this.buildTitleScheduleResponse(titleQuery, liveNowItems, tonightItems);
        if (titleResponse) return titleResponse;
        // EPG fallback: broader catalog search within 48 h window
        const epgFallback = await this.tryEpgTitleFallback(titleQuery);
        if (epgFallback) return epgFallback;
        // No match anywhere — return a clear no-result rather than falling through to AI
        return {
          text: `No he encontrado "${titleQuery}" en la parrilla de hoy ni de mañana. Puede que el título sea diferente o que no esté programado en las próximas 48 horas.`,
          recommendations: [],
          moreRecommendations: [],
          followUpSuggestions: ['¿Qué hay ahora mismo en TV?', '¿Qué hay esta noche?'],
        };
      }
    }

    const previousTvContext = this.getLastAutonomicPromptContext(
      context.history.messages
    );
    if (
      previousTvContext &&
      (context.communityReply.kind === 'confirm' ||
        context.communityReply.kind === 'set' ||
        context.communityReply.kind === 'decline')
    ) {
      return this.buildAutonomicFollowUpResponse(
        previousTvContext,
        liveNowItems,
        tonightItems,
        latestUserMessage,
        context.effectiveCommunity,
        context.communityReply.kind
      );
    }

    const requestedLabel = this.buildRequestedLabel(intent.requestedTypes);
    if (!this.isDirectScheduleIntent(intent)) {
      return null;
    }

    const rankedLiveNowItems = intent.requestedTypes[0] === 'movie'
      ? this.rankMovieItems(liveNowItems, 'tv_now', context.rankingCtx, intent.wantsPrimeTime)
      : this.rankScheduleItems(liveNowItems, 'tv_now', context.rankingCtx);
    const rankedTonightItems = intent.requestedTypes[0] === 'movie'
      ? this.rankMovieItems(tonightItems, 'tv_tonight', context.rankingCtx, intent.wantsPrimeTime)
      : this.rankScheduleItems(tonightItems, 'tv_tonight', context.rankingCtx);
    const uniqueStreamingMatches = this.dedupeCatalogItems(streamingMatches);

    // A saved community the user has not turned down is simply used: its regional channels join the results
    // instead of asking "¿sigo usando X?" on every answer. After a "no", regional channels are never offered again.
    const regionalChoice = this.resolveRegionalChoice(context.effectiveCommunity, context.history.memory?.autonomicOptIn);
    const keepInPrimary = (item: RankedScheduleItem, regional: RankedScheduleItem[]) =>
      item.groupRank !== 2 || (regionalChoice === 'include' && regional.includes(item));
    const rankedAutonomicLiveNowItems = regionalChoice === 'never'
      ? []
      : this.filterAutonomicMatches(rankedLiveNowItems, context.effectiveCommunity);
    const rankedAutonomicTonightItems = regionalChoice === 'never'
      ? []
      : this.filterAutonomicMatches(rankedTonightItems, context.effectiveCommunity);
    const rankedPrimaryLiveNowItems = rankedLiveNowItems.filter((item) => keepInPrimary(item, rankedAutonomicLiveNowItems));
    const rankedPrimaryTonightItems = rankedTonightItems.filter((item) => keepInPrimary(item, rankedAutonomicTonightItems));
    const askRegional = (regional: RankedScheduleItem[]) => regionalChoice === 'ask' && regional.length > 0;

    const rankedPrimaryItems =
      intent.mode === 'tv_now'
        ? rankedPrimaryLiveNowItems
        : rankedPrimaryTonightItems;
    const rankedAutonomicItems =
      intent.mode === 'tv_now'
        ? rankedAutonomicLiveNowItems
        : rankedAutonomicTonightItems;

    if (rankedPrimaryItems.length) {
      const picks = rankedPrimaryItems.slice(0, 3);
      const more = rankedPrimaryItems.slice(3);
      const hasNationalMatches = rankedPrimaryItems.some(
        (item) => item.groupRank === 1
      );
      const regionalNote =
        regionalChoice === 'include' && picks.some((item) => item.groupRank === 2)
          ? ` Incluyo también la tele autonómica de ${context.effectiveCommunity}.`
          : '';
      const textLead =
        intent.mode === 'tv_now'
          ? hasNationalMatches
            ? `Ahora mismo sí tienes ${requestedLabel} en emisión. Te dejo primero TDT y canales nacionales, y después pago si hace falta.`
            : `Ahora mismo no veo ${requestedLabel} en TDT o nacionales. Lo más relevante que sí tienes va por canales de pago.`
          : hasNationalMatches
            ? `Esta noche sí tienes ${requestedLabel} en TV. Te muestro primero TDT y canales nacionales, y después pago si hace falta.`
            : `Esta noche no veo ${requestedLabel} destacados en TDT o nacionales. Lo más útil ahora mismo está en canales de pago.`;

      return {
        text: this.appendAutonomicPrompt(
          `${textLead}${regionalNote}`,
          askRegional(rankedAutonomicItems),
          context.effectiveCommunity
        ),
        recommendations: picks.map((item) =>
          this.mapRankedItemToRecommendation(
            item,
            item.item.liveNow
              ? `En emisión ahora en ${item.item.channel?.name || 'TV'}.`
              : `Empieza a las ${
                  item.item.start ? this.formatTime(item.item.start) : 'próximamente'
                } en ${item.item.channel?.name || 'TV'}.`
          )
        ),
        moreRecommendations: more.map((item) =>
          this.mapRankedItemToRecommendation(
            item,
            item.item.liveNow
              ? `En emisión ahora en ${item.item.channel?.name || 'TV'}.`
              : `Empieza a las ${
                  item.item.start ? this.formatTime(item.item.start) : 'próximamente'
                } en ${item.item.channel?.name || 'TV'}.`
          )
        ),
        followUpSuggestions: this.buildFollowUpSuggestions(intent, latestUserMessage, context.rankingCtx),
        queryContext: this.buildQueryContext(
          intent.mode === 'tv_channel_schedule' ? 'tv_tonight' : intent.mode,
          intent.requestedTypes,
          rankedPrimaryItems.length,
          picks.length,
          more.length > 0,
          intent.mode === 'tv_now' ? 'Ahora' : 'Esta noche',
          {
            primaryMatches: rankedPrimaryItems.length,
            hasAutonomicMatches: rankedAutonomicItems.length > 0,
            autonomicPromptRequired: askRegional(rankedAutonomicItems),
            savedAutonomousCommunity: context.effectiveCommunity,
          }
        ),
      };
    }

    if (askRegional(rankedAutonomicItems)) {
      return {
        text: this.appendAutonomicPrompt(
          `No veo ${requestedLabel} en TDT o canales de pago para ${
            intent.mode === 'tv_now' ? 'ahora mismo' : 'esta noche'
          }.`,
          true,
          context.effectiveCommunity
        ),
        recommendations: [],
        moreRecommendations: [],
        followUpSuggestions: this.buildFallbackFollowUpSuggestions(
          intent,
          latestUserMessage,
          context.rankingCtx
        ),
        queryContext: this.buildQueryContext(
          intent.mode === 'tv_channel_schedule' ? 'tv_tonight' : intent.mode,
          intent.requestedTypes,
          0,
          0,
          false,
          intent.mode === 'tv_now' ? 'Ahora' : 'Esta noche',
          {
            primaryMatches: 0,
            hasAutonomicMatches: true,
            autonomicPromptRequired: true,
            savedAutonomousCommunity: context.effectiveCommunity,
          }
        ),
      };
    }

    if (intent.mode === 'tv_now' && rankedPrimaryTonightItems.length) {
      const picks = rankedPrimaryTonightItems.slice(0, 3);
      const more = rankedPrimaryTonightItems.slice(3);
      return {
        text: `Ahora mismo no veo ${requestedLabel} en emisión. Lo más útil que llega en TV durante esta noche es esto.`,
        recommendations: picks.map((item) =>
          this.mapRankedItemToRecommendation(
            item,
            item.item.liveNow
              ? `En emisión ahora en ${item.item.channel?.name || 'TV'}.`
              : `Empieza a las ${
                  item.item.start ? this.formatTime(item.item.start) : 'próximamente'
                } en ${item.item.channel?.name || 'TV'}.`
          )
        ),
        moreRecommendations: more.map((item) =>
          this.mapRankedItemToRecommendation(
            item,
            item.item.liveNow
              ? `En emisión ahora en ${item.item.channel?.name || 'TV'}.`
              : `Empieza a las ${
                  item.item.start ? this.formatTime(item.item.start) : 'próximamente'
                } en ${item.item.channel?.name || 'TV'}.`
          )
        ),
        followUpSuggestions: this.buildFallbackFollowUpSuggestions(
          intent,
          latestUserMessage,
          context.rankingCtx
        ),
        queryContext: this.buildQueryContext(
          'tv_now',
          intent.requestedTypes,
          rankedPrimaryTonightItems.length,
          picks.length,
          more.length > 0,
          'Esta noche',
          {
            primaryMatches: rankedPrimaryTonightItems.length,
            hasAutonomicMatches: rankedAutonomicTonightItems.length > 0,
            autonomicPromptRequired: askRegional(rankedAutonomicTonightItems),
            savedAutonomousCommunity: context.effectiveCommunity,
          }
        ),
      };
    }

    if (uniqueStreamingMatches.length) {
      const picks = uniqueStreamingMatches.slice(0, 3);
      const more = uniqueStreamingMatches.slice(3);
      return {
        text: `Ahora mismo no veo ${requestedLabel} en TV con esa búsqueda concreta. En streaming sí he encontrado alternativas útiles.`,
        recommendations: picks.map((item) =>
          this.mapCatalogItemToRecommendation(
            item,
            `Está disponible en ${item.primaryPlatforms[0] || 'streaming'} y encaja con lo que has pedido.`
          )
        ),
        moreRecommendations: more.map((item) =>
          this.mapCatalogItemToRecommendation(
            item,
            `Está disponible en ${item.primaryPlatforms[0] || 'streaming'} y encaja con lo que has pedido.`
          )
        ),
        followUpSuggestions: this.buildStreamingFallbackSuggestions(
          intent,
          latestUserMessage
        ),
        queryContext: this.buildQueryContext(
          'streaming',
          this.resolveStreamingTypes(intent) || [],
          uniqueStreamingMatches.length,
          picks.length,
          more.length > 0,
          'En streaming',
          {
            primaryMatches: uniqueStreamingMatches.length,
          }
        ),
      };
    }

    return {
      text: `Ahora mismo no veo ${requestedLabel} en la parrilla con esa búsqueda concreta. Si quieres, puedo mirar qué llega más tarde esta noche o proponerte alternativas reales en streaming.`,
      recommendations: [],
      moreRecommendations: [],
      followUpSuggestions: this.buildFallbackFollowUpSuggestions(
        intent,
        latestUserMessage,
        context.rankingCtx
      ),
      queryContext: this.buildQueryContext(
        intent.mode === 'tv_channel_schedule' ? 'tv_tonight' : intent.mode,
        intent.requestedTypes,
        0,
        0,
        false,
        intent.mode === 'tv_now' ? 'Ahora' : 'Esta noche',
        {
          primaryMatches: 0,
        }
      ),
    };
  }

  private mapCatalogItemToRecommendation(
    item: CatalogItemDTO,
    reason: string
  ): ChatbotRecommendationPayload {
    return {
      catalogId: item.catalogId,
      detailPath: item.detailPath,
      source: item.source,
      title: this.cleanDisplayTitle(item.title, item.contentType),
      subtitle:
        item.genres.length > 1 ? item.genres.slice(0, 2).join(' · ') : item.genres[0],
      type: item.contentType,
      platform: item.primaryPlatforms[0],
      channel: item.channel?.name,
      time: item.start ? this.formatTime(item.start) : undefined,
      channelOrPlatform: item.channel?.name || item.primaryPlatforms[0],
      startTime: item.start ? this.formatTime(item.start) : undefined,
      endTime: item.end ? this.formatTime(item.end) : undefined,
      liveNow: Boolean(item.liveNow),
      reason,
      tmdbId: item.tmdbId,
      image: item.image || undefined,
      actions: {
        canOpenDetail: true,
        canSave: true,
        canTrack: true,
      },
      badges: this.buildRecommendationBadges(item),
      rating: typeof item.rating === 'number' && !isNaN(item.rating) ? item.rating : undefined,
      durationMinutes: item.durationMinutes,
      synopsis: item.synopsis ? item.synopsis.slice(0, 200) : undefined,
      platformLogo:
        item.assets?.channelLogo?.url ||
        item.assets?.platformLogo?.url ||
        item.channel?.icon ||
        this.resolvePlatformLogo(item.primaryPlatforms[0]),
    };
  }

  private resolvePlatformLogo(platformKey?: string): string | undefined {
    if (!platformKey) return undefined;
    const platform = CATALOG_PLATFORM_REGISTRY.find(
      (p) => p.key === platformKey
    );
    return platform?.logoUrl;
  }

  private mapRankedItemToRecommendation(
    rankedItem: RankedScheduleItem,
    reason: string
  ): ChatbotRecommendationPayload {
    return {
      ...this.mapCatalogItemToRecommendation(rankedItem.item, reason),
      title: rankedItem.displayTitle,
    };
  }

  private filterCatalogItems(
    items: CatalogItemDTO[],
    intent: ChatQueryIntent
  ): CatalogItemDTO[] {
    return items
      .filter((item) => {
        if (intent.requestedTypes.length && !intent.requestedTypes.includes(item.contentType)) {
          return false;
        }

        if (
          intent.explicitGenres.length &&
          !intent.explicitGenres.some((genre) =>
            item.genres.some((itemGenre) => genreLabelsMatch(itemGenre, genre))
          )
        ) {
          return false;
        }

        if (
          intent.explicitPlatforms.length &&
          !intent.explicitPlatforms.some((platform) =>
            item.primaryPlatforms.some(
              (itemPlatform) =>
                this.normalize(itemPlatform) === this.normalize(platform)
            )
          )
        ) {
          return false;
        }

        if (
          intent.wantsFamily &&
          !item.genres.some((genre) =>
            FAMILY_FRIENDLY_GENRES.some((familyGenre) => genreLabelsMatch(genre, familyGenre))
          )
        ) {
          return false;
        }

        if (
          intent.wantsShort &&
          item.durationMinutes &&
          item.durationMinutes > 120 &&
          item.contentType !== 'series'
        ) {
          return false;
        }

        return true;
      })
      .sort((left, right) => {
        const livePriority = Number(Boolean(right.liveNow)) - Number(Boolean(left.liveNow));
        if (livePriority !== 0) {
          return livePriority;
        }

        return (right.rating || 0) - (left.rating || 0);
      });
  }

  private extractTonightItems(items: CatalogItemDTO[]): CatalogItemDTO[] {
    const now = new Date();
    const tonightStart = this.buildTonightWindowStart(now);
    const tonightEnd = this.buildTonightWindowEnd(now);
    const isBeforeTonightWindow = now.getTime() < tonightStart.getTime();
    const activeWindowStart = isBeforeTonightWindow ? tonightStart : now;

    return items.filter((item) => {
      if (!item.start) {
        return false;
      }

      const startDate = new Date(item.start);
      if (Number.isNaN(startDate.getTime())) {
        return false;
      }

      const endDate = item.end ? new Date(item.end) : null;
      if (endDate && Number.isNaN(endDate.getTime())) {
        return false;
      }

      if (isBeforeTonightWindow) {
        return (
          startDate.getTime() >= tonightStart.getTime() &&
          startDate.getTime() <= tonightEnd.getTime()
        );
      }

      const intervalEnd = endDate || startDate;
      return (
        startDate.getTime() <= tonightEnd.getTime() &&
        intervalEnd.getTime() >= activeWindowStart.getTime()
      );
    });
  }

  private analyzeIntent(message: string): ChatQueryIntent {
    const normalized = this.normalize(message);
    const explicitPlatforms = CATALOG_PLATFORM_REGISTRY
      .map((platform) => platform.name)
      .filter((platform) => normalized.includes(this.normalize(platform)));
    const explicitGenres = findGenresInText(message);

    const channelId = findCanonicalChannelInText(message);
    const wantsTv =
      /television|televisión|tv|parrilla|canal|canales|emision|emisión|directo/.test(
        normalized
      );
    const wantsNow =
      /ahora mismo|ahora|en este momento|actualmente|ya\b/.test(normalized);
    const wantsTonight =
      /esta noche|hoy por la noche|mas tarde|más tarde|noche/.test(normalized);
    const wantsStreaming =
      explicitPlatforms.length > 0 ||
      /streaming|netflix|prime|disney|movistar|max|filmin|apple tv|rakuten/.test(
        normalized
      );

    const requestedTypes: Array<'movie' | 'series' | 'program'> = [];
    if (/pelicula|peliculas|cine/.test(normalized)) {
      requestedTypes.push('movie');
    }
    if (/serie|series|miniserie/.test(normalized)) {
      requestedTypes.push('series');
    }
    if (!requestedTypes.length && /programa|programas/.test(normalized)) {
      requestedTypes.push('program');
    }

    const negativeSignals = [
      /sin deportes|no deportes/.test(normalized) ? 'sin deportes' : '',
      /sin terror|no terror/.test(normalized) ? 'sin terror' : '',
      /sin noticias|no noticias/.test(normalized) ? 'sin noticias' : '',
    ].filter(Boolean);

    let mode: ChatQueryIntent['mode'] = 'general';
    if (channelId) {
      mode = 'tv_channel_schedule';
    } else if (/futbol|fútbol|partidos?|champions|laliga|liga de campeones/.test(normalized)) {
      mode = 'football_today';
    } else if ((wantsTv && wantsNow) || /en parrilla ahora/.test(normalized) || (wantsNow && !wantsStreaming)) {
      mode = 'tv_now';
    } else if ((wantsTv && wantsTonight) || (wantsTonight && !wantsStreaming)) {
      mode = 'tv_tonight';
    } else if (wantsStreaming) {
      mode = 'streaming';
    }

    return {
      mode,
      channelId,
      channelPeriod: wantsNow ? 'now' : wantsTonight ? 'tonight' : 'today',
      requestedTypes,
      explicitGenres,
      explicitPlatforms,
      wantsFamily: /familia|familiar|con ninos|con niños/.test(normalized),
      wantsShort: /corta|corto|menos de|rapida|rápida/.test(normalized),
      wantsPrimeTime: /prime\s*time/.test(normalized),
      negativeSignals,
    };
  }

  private async buildFootballTodayResponse(): Promise<ChatbotResponse> {
    const { matches } = await this.footballQueryService!.getMatches({ date: 'today', limit: 12 });
    return buildFootballTodayPayload(matches);
  }

  private resolveStreamingTypes(
    intent: ChatQueryIntent
  ): CatalogContentType[] | undefined {
    const streamingTypes = intent.requestedTypes.filter(
      (type) => type === 'movie' || type === 'series'
    );
    return streamingTypes.length ? streamingTypes : ['movie', 'series'];
  }

  private resolveLiveTypes(
    intent: ChatQueryIntent
  ): Array<'movie' | 'series' | 'program'> {
    if (!intent.requestedTypes.length) {
      return ['movie', 'series', 'program'];
    }

    return Array.from(
      new Set(
        intent.requestedTypes.filter(
          (type): type is 'movie' | 'series' | 'program' =>
            type === 'movie' || type === 'series' || type === 'program'
        )
      )
    );
  }

  /**
   * Detects title-specific schedule queries like "a qué hora emiten X" or "en qué canal dan Y".
   * Also handles title-first phrasings: "Succession ¿a qué hora?" and "Élite, en qué canal".
   * Returns the extracted title preserving original casing/accents (for catalog text search),
   * null if no pattern matched.
   */
  private detectTitleScheduleQuery(message: string): string | null {
    const normalized = this.normalize(message);
    const original = message.trim();

    // Helper: extract the original-cased substring that corresponds to the
    // normalized match offset, so MongoDB text search can use accented titles.
    const originalSlice = (normStart: number, normEnd: number): string => {
      // Approximate: normalize both sides char-by-char alignment is complex,
      // so we use the normalized match to find character count and slice original.
      const normPrefix = normalized.slice(0, normStart);
      // Count original chars that map to normPrefix length (rough heuristic: 1:1)
      return original.slice(normPrefix.length, normPrefix.length + (normEnd - normStart)).trim().replace(/[¿?.,!¡]+$/, '').trim();
    };

    // Verb-first patterns: "a qué hora emiten <title>"
    const verbFirstPatterns = [
      /a que hora(?:\s+emite|\s+echan|\s+ponen|\s+sale|\s+da|\s+empieza)?\s+(.+)/,
      /en que canal(?:\s+emite|\s+echan|\s+ponen|\s+dan|\s+va)?\s+(.+)/,
      /cuando emiten?\s+(.+)/,
      /cuando ponen?\s+(.+)/,
      /donde echan\s+(.+)/,
      /donde emiten?\s+(.+)/,
      /que canal(?:\s+da|\s+emite|\s+echa|\s+pone|\s+tiene)?\s+(.+)/,
      /en que cadena(?:\s+ponen|\s+echan|\s+emiten?)?\s+(.+)/,
    ];
    for (const pattern of verbFirstPatterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) {
        const normTitleStart = (match.index ?? 0) + match[0].length - match[1].length;
        const orig = originalSlice(normTitleStart, normTitleStart + match[1].length);
        return orig || match[1].trim().replace(/[¿?.,!¡]+$/, '').trim();
      }
    }

    // Title-first patterns: "<title> a qué hora" / "<title> en qué canal"
    const titleFirstPatterns = [
      /^(.+?)\s+a\s+que\s+hora/,
      /^(.+?)\s+en\s+que\s+canal/,
      /^(.+?)\s+cuando\s+(?:emiten?|ponen?|echan)/,
      /^(.+?)\s+donde\s+(?:echan|emiten?|lo\s+ponen)/,
    ];
    for (const pattern of titleFirstPatterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) {
        const normLen = match[1].length;
        const origCandidate = original.slice(0, normLen).trim().replace(/[¿?.,!¡]+$/, '').trim();
        const candidate = origCandidate || match[1].trim().replace(/[¿?.,!¡]+$/, '').trim();
        // Minimum 3 chars and not a mode keyword to avoid false positives
        if (candidate && candidate.length >= 3 && !/^(que|una|un|los|las|algo|hay|hay algo)$/i.test(this.normalize(candidate))) {
          return candidate;
        }
      }
    }

    return null;
  }

  private fuzzyTitleMatch(a: string, b: string): boolean {
    const wordsA = a.split(' ').filter((w) => w.length > 2);
    const wordsB = b.split(' ').filter((w) => w.length > 2);
    if (!wordsA.length || !wordsB.length) return false;

    const minWords = Math.min(wordsA.length, wordsB.length);

    // Single-word titles (e.g. "Succession", "Élite", "Friends"):
    // match if the one meaningful word appears in the other's word list
    if (minWords === 1) {
      return wordsA.some((w) => wordsB.includes(w));
    }

    // Multi-word titles: require at least 2 shared meaningful words
    const shared = wordsA.filter((w) => wordsB.includes(w));
    return shared.length >= Math.min(2, minWords);
  }

  private buildTitleScheduleResponse(
    titleQuery: string,
    liveNowItems: CatalogItemDTO[],
    tonightItems: CatalogItemDTO[]
  ): ChatbotResponse | null {
    const qNorm = this.normalize(titleQuery);
    const now = Date.now();
    const allItems = [...liveNowItems, ...tonightItems];
    const matches = allItems
      .filter((item) => {
        const tNorm = this.normalize(item.title);
        const titleMatches = tNorm.includes(qNorm) || qNorm.includes(tNorm) || this.fuzzyTitleMatch(tNorm, qNorm);
        if (!titleMatches) return false;
        // EPG staleness: skip items that ended more than 30 minutes ago
        if (item.end) {
          const endMs = new Date(item.end).getTime();
          if (endMs < now - 30 * 60_000) return false;
        }
        return true;
      })
      .slice(0, 3);

    if (!matches.length) return null;

    const first = matches[0];
    const where = first.channel?.name || 'TV';
    const when = first.start ? this.formatTime(first.start) : 'próximamente';
    const displayTitle = this.cleanDisplayTitle(first.title, first.contentType);
    const text = first.liveNow
      ? `"${displayTitle}" está en emisión ahora mismo en ${where}.`
      : `"${displayTitle}" empieza a las ${when} en ${where}.`;

    return {
      text,
      recommendations: matches.map((item) => ({
        catalogId: item.catalogId,
        detailPath: item.detailPath,
        title: this.cleanDisplayTitle(item.title, item.contentType),
        type: item.contentType,
        channel: item.channel?.name,
        time: item.start ? this.formatTime(item.start) : undefined,
        startTime: item.start ? this.formatTime(item.start) : undefined,
        endTime: item.end ? this.formatTime(item.end) : undefined,
        liveNow: Boolean(item.liveNow),
        image: item.image || undefined,
        platformLogo: item.channel?.icon,
        channelOrPlatform: item.channel?.name,
        reason: item.liveNow
          ? `En emisión ahora en ${item.channel?.name || 'TV'}.`
          : `Empieza a las ${item.start ? this.formatTime(item.start) : 'próximamente'} en ${item.channel?.name || 'TV'}.`,
      })),
      moreRecommendations: [],
      followUpSuggestions: ['¿Qué más hay esta noche?', '¿Qué hay ahora mismo en TV?'],
    };
  }

  /**
   * Broader EPG title search across today + tomorrow when liveNow/tonight arrays don't match.
   * Uses the canonical TV read model so chatbot and guide share the same payload.
   */
  private async tryEpgTitleFallback(titleQuery: string): Promise<ChatbotResponse | null> {
    try {
      const [todayResult, tomorrowResult] = await Promise.all([
        this.loadTvCatalog({ view: 'search', q: titleQuery, limit: 10 }),
        this.loadTvCatalog({ view: 'search', q: titleQuery, date: 'tomorrow', limit: 10 }),
      ]);

      const qNorm = this.normalize(titleQuery);
      const candidates = [...todayResult.items, ...tomorrowResult.items]
        .filter((item) => {
          const tNorm = this.normalize(item.title);
          return tNorm.includes(qNorm) || qNorm.includes(tNorm) || this.fuzzyTitleMatch(tNorm, qNorm);
        })
        .slice(0, 3);

      if (!candidates.length) return null;

      const first = candidates[0];
      const where = first.channel?.name || 'TV';
      const when = first.start ? this.formatTime(first.start) : 'próximamente';
      const text = first.liveNow
        ? `"${first.title}" está en emisión ahora mismo en ${where}.`
        : `"${first.title}" empieza a las ${when} en ${where}.`;

      return {
        text,
        recommendations: candidates.map((item) =>
          this.mapCatalogItemToRecommendation(
            item,
            item.liveNow
              ? `En emisión ahora en ${item.channel?.name || 'TV'}.`
              : `Empieza a las ${item.start ? this.formatTime(item.start) : 'próximamente'} en ${item.channel?.name || 'TV'}.`
          )
        ),
        moreRecommendations: [],
        followUpSuggestions: ['¿Qué más hay esta noche?', '¿Qué hay ahora mismo en TV?'],
      };
    } catch {
      return null;
    }
  }

  private async loadTvCatalog(input: {
    view: 'now' | 'night' | 'day' | 'search';
    date?: string;
    q?: string;
    limit: number;
    slot?: '6' | '7';
    category?: string;
    channelId?: string;
    requestedTypes?: Array<'movie' | 'series' | 'program'>;
  }): Promise<{ items: CatalogItemDTO[]; total: number }> {
    if (!this.tvReadQueryService) {
      const fallback = await this.catalogService.query({
        q: input.q,
        date: input.date,
        availability: ['live'],
        types: input.requestedTypes,
        sort: 'airtime',
        timeSlot: input.slot,
        limit: input.limit,
        page: 1,
      });
      return {
        items: fallback.items,
        total: fallback.meta.total,
      };
    }

    const response = await this.tvReadQueryService.query({
      view: input.view,
      date: input.date,
      q: input.q,
      channelId: input.channelId,
      category: input.category,
      limit: input.limit,
    });

    const slot = input.slot;
    const requestedTypes = input.requestedTypes?.length
      ? new Set(input.requestedTypes)
      : null;
    const items = response.items
      .map((item) => this.catalogService.mapTvReadItemToCatalogItem(item))
      .filter((item) =>
        requestedTypes ? requestedTypes.has(item.contentType) : true
      )
      .filter((item) => {
        if (!slot) return true;
        const hours = item.start ? new Date(item.start).getHours() : -1;
        if (slot === '6') {
          return hours >= 18 && hours < 21;
        }
        return hours >= 21 || hours < 3;
      });

    return {
      items,
      total: items.length,
    };
  }

  private isDirectScheduleIntent(intent: ChatQueryIntent): boolean {
    return intent.mode === 'tv_now' || intent.mode === 'tv_tonight';
  }

  private buildRequestedLabel(
    types: Array<'movie' | 'series' | 'program'>
  ): string {
    if (types.includes('movie') && types.includes('series')) {
      return 'películas y series';
    }
    if (types.includes('movie') && !types.includes('series')) {
      return 'películas';
    }
    if (types.includes('series') && !types.includes('movie')) {
      return 'series';
    }
    return 'contenido relevante';
  }

  private getLatestUserMessage(messages: ChatbotMessage[]): string {
    const latest = [...messages]
      .reverse()
      .find((message) => message.role === 'user');
    return String(latest?.content || '').trim();
  }

  private formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private normalize(value: string): string {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  private mergeUnique(...groups: string[][]): string[] {
    const merged = new Map<string, string>();
    groups.flat().forEach((entry) => {
      const safe = String(entry || '').trim();
      if (!safe) {
        return;
      }
      merged.set(this.normalize(safe), safe);
    });
    return Array.from(merged.values());
  }

  private dedupeCatalogItems(items: CatalogItemDTO[]): CatalogItemDTO[] {
    const deduped = new Map<string, CatalogItemDTO>();

    items.forEach((item) => {
      const key = `${this.normalize(item.title)}::${this.normalize(
        item.channel?.name || item.primaryPlatforms[0] || item.catalogId
      )}`;
      if (!deduped.has(key)) {
        deduped.set(key, item);
      }
    });

    return Array.from(deduped.values());
  }

  private async resolveRecommendations(
    recommendations: ChatbotRecommendationPayload[]
  ): Promise<ChatbotRecommendationPayload[]> {
    const resolved = await resolveGroundedRecommendations(
      recommendations,
      (recommendation) => this.catalogService.resolveRecommendation({
          title: recommendation.title,
          type: recommendation.type,
          platform: recommendation.platform,
          channel: recommendation.channel,
        }),
      (recommendation, match) => {
        // Validate EPG timing: don't surface stale airtime data from the catalog match
        const matchStartMs = match.start ? new Date(match.start).getTime() : null;
        const now = Date.now();
        const epgIsStale = matchStartMs !== null && matchStartMs < now - 3 * 3_600_000;
        const epgIsFutureTooFar = matchStartMs !== null && matchStartMs > now + 48 * 3_600_000;
        const useEpgTimes = matchStartMs !== null && !epgIsStale && !epgIsFutureTooFar;

        return {
          ...recommendation,
          catalogId: match.catalogId,
          detailPath: match.detailPath,
          source: match.source,
          tmdbId: match.tmdbId,
          image: match.image,
          title: this.cleanDisplayTitle(recommendation.title, recommendation.type),
          platform:
            recommendation.platform ||
            match.primaryPlatforms[0] ||
            recommendation.channel,
          channel: recommendation.channel || match.channel?.name,
          liveNow: useEpgTimes ? Boolean(match.liveNow) : false,
          time:
            recommendation.time ||
            (useEpgTimes && match.start
              ? new Date(match.start).toLocaleTimeString('es-ES', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : undefined),
          platformLogo:
            recommendation.platformLogo ||
            match.assets?.channelLogo?.url ||
            match.assets?.platformLogo?.url ||
            match.channel?.icon,
          startTime: useEpgTimes ? (match.start ? this.formatTime(match.start) : undefined) : undefined,
          endTime: useEpgTimes ? (match.end ? this.formatTime(match.end) : undefined) : undefined,
        };
      }
    );

    return this.dedupeRecommendations(resolved);
  }

  /**
   * Deterministic, post-hoc affiliate CTA resolution — see the exported
   * `attachChatbotAffiliateActions` for the implementation (kept as a free
   * function, not an instance method, so it's unit-testable with a minimal
   * resolver mock instead of the full `ChatbotRecommend` dependency graph).
   */
  private async attachAffiliateActions(
    response: ChatbotResponse,
    conversationId?: string | null
  ): Promise<ChatbotResponse> {
    return attachChatbotAffiliateActions(response, this.affiliateResolverService, conversationId);
  }

  private finalizeResponse(
    response: ChatbotResponse,
    latestUserMessage: string
  ): ChatbotResponse {
    const recommendations = this.dedupeRecommendations(response.recommendations || []);
    const moreRecommendations = this.dedupeRecommendations(
      (response.moreRecommendations || []).filter(
        (candidate) =>
          !recommendations.some((existing) =>
            this.buildRecommendationKey(existing) ===
            this.buildRecommendationKey(candidate)
          )
      )
    );

    const shownCount = recommendations.length;
    const totalMatches =
      response.queryContext?.totalMatches ||
      recommendations.length + moreRecommendations.length;
    const primaryMatches =
      typeof response.queryContext?.primaryMatches === 'number'
        ? response.queryContext.primaryMatches
        : recommendations.length;

    return {
      ...response,
      recommendations,
      moreRecommendations,
      followUpSuggestions: this.sanitizeFollowUpSuggestions(
        response.followUpSuggestions || [],
        latestUserMessage
      ),
      queryContext: response.queryContext
        ? {
            ...response.queryContext,
            totalMatches,
            primaryMatches,
            shownCount,
            hasMore: moreRecommendations.length > 0,
          }
        : undefined,
    };
  }

  private rankScheduleItems(
    items: CatalogItemDTO[],
    mode: 'tv_now' | 'tv_tonight',
    ctx?: RankingContext
  ): RankedScheduleItem[] {
    const likedSet = new Set((ctx?.likedGenres || []).map((g) => g.toLowerCase()));
    const negativeSet = new Set((ctx?.negativeSignals || []).map((s) => s.toLowerCase()));
    const recentSet = new Set((ctx?.recentTitles || []).map((t) => this.normalizeTitleKey(t)));

    return items
      .filter((item) => {
        if (mode === 'tv_now' && !item.liveNow) {
          return false;
        }

        if (mode === 'tv_tonight') {
          const isUpcomingTonight = Boolean(
            item.start && this.isTonightWindow(item.start, item.end)
          );
          if (!item.liveNow && !isUpcomingTonight) {
            return false;
          }
        }

        return true;
      })
      .map((item) => {
        const displayTitle = this.cleanDisplayTitle(item.title, item.contentType);
        const channelName = item.channel?.name || '';
        const itemGenres = (item.genres || []).map((g: string) => g.toLowerCase());

        // History boost: -1 if genres match user's liked genres
        const genreMatch = itemGenres.some((g: string) => likedSet.has(g));
        const historyBoost = genreMatch ? -1 : 0;

        // Negative penalty: 1 if title matches a negative signal or recently seen
        const titleKey = this.normalizeTitleKey(displayTitle);
        const isNegative = itemGenres.some((g: string) => negativeSet.has(g))
          || negativeSet.has(titleKey)
          || recentSet.has(titleKey);
        const negativePenalty = isNegative ? 1 : 0;

        // Time boost: primetime (20-23) gets 0, else 1
        const startHour = item.start ? new Date(item.start).getHours() : -1;
        const timeBoost = (startHour >= 20 && startHour < 23) ? 0 : 1;

        return {
          item,
          displayTitle,
          dedupeKey: this.buildScheduleDedupeKey(item, displayTitle),
          groupRank: this.getChannelGroupRank(item),
          contentTypeRank: this.getContentTypePriority(item.contentType),
          channelRank: this.getChannelPriority(channelName),
          liveRank: item.liveNow ? 0 : 1,
          startRank: item.start ? new Date(item.start).getTime() : Number.MAX_SAFE_INTEGER,
          ratingRank: -(item.rating || 0),
          historyBoost,
          negativePenalty,
          timeBoost,
        };
      })
      .sort((left, right) => {
        if (left.groupRank !== right.groupRank) {
          return left.groupRank - right.groupRank;
        }
        if (left.liveRank !== right.liveRank) {
          return left.liveRank - right.liveRank;
        }
        // Channel order (explicit priority) always respected before any personalization or penalties
        if (left.channelRank !== right.channelRank) {
          return left.channelRank - right.channelRank;
        }
        // Penalized items go last within the same channel slot
        if (left.negativePenalty !== right.negativePenalty) {
          return left.negativePenalty - right.negativePenalty;
        }
        // History boost: genre-matched items rise within the same channel slot
        if (left.historyBoost !== right.historyBoost) {
          return left.historyBoost - right.historyBoost;
        }
        if (left.contentTypeRank !== right.contentTypeRank) {
          return left.contentTypeRank - right.contentTypeRank;
        }
        // Time-aware: primetime items first
        if (left.timeBoost !== right.timeBoost) {
          return left.timeBoost - right.timeBoost;
        }
        if (left.startRank !== right.startRank) {
          return left.startRank - right.startRank;
        }
        return left.ratingRank - right.ratingRank;
      })
      .filter((candidate, index, candidates) =>
        index === candidates.findIndex((entry) => entry.dedupeKey === candidate.dedupeKey)
      )
      // For tv_now: each channel can only be airing one program; deduplicate by channelId
      // to remove EPG overlap entries (e.g. two simultaneous liveNow programs on BE MAD).
      .filter((candidate, index, candidates) =>
        mode !== 'tv_now' ||
        index === candidates.findIndex((entry) => entry.item.channel?.id === candidate.item.channel?.id)
      );
  }

  /**
   * Movie-specific ranking: filters to TDT (group 1) + Movistar (group 4) only,
   * sorts by groupRank → ratingRank (best first) → channelRank.
   */
  private rankMovieItems(
    items: CatalogItemDTO[],
    mode: 'tv_now' | 'tv_tonight',
    ctx?: RankingContext,
    primeTimeOnly?: boolean
  ): RankedScheduleItem[] {
    const negativeSet = new Set((ctx?.negativeSignals || []).map((s) => s.toLowerCase()));
    const recentSet = new Set((ctx?.recentTitles || []).map((t) => this.normalizeTitleKey(t)));

    return items
      .filter((item) => {
        if (item.contentType !== 'movie') return false;
        const group = this.getChannelGroupRank(item);
        if (group !== 1 && group !== 4) return false; // TDT or Movistar only
        if (mode === 'tv_now' && !item.liveNow) return false;
        if (mode === 'tv_tonight') {
          const ok = item.liveNow || Boolean(item.start && this.isTonightWindow(item.start, item.end));
          if (!ok) return false;
        }
        if (primeTimeOnly && item.start) {
          const h = new Date(item.start).getHours();
          if (h < 20 || h >= 23) return false;
        }
        return true;
      })
      .map((item) => {
        const displayTitle = this.cleanDisplayTitle(item.title, item.contentType);
        const channelName = item.channel?.name || '';
        const titleKey = this.normalizeTitleKey(displayTitle);
        const isNegative = negativeSet.has(titleKey) || recentSet.has(titleKey);
        return {
          item,
          displayTitle,
          dedupeKey: this.buildScheduleDedupeKey(item, displayTitle),
          groupRank: this.getChannelGroupRank(item),
          contentTypeRank: 0,
          channelRank: this.getChannelPriority(channelName),
          liveRank: item.liveNow ? 0 : 1,
          startRank: item.start ? new Date(item.start).getTime() : Number.MAX_SAFE_INTEGER,
          ratingRank: -(item.rating || 0),
          historyBoost: 0,
          negativePenalty: isNegative ? 1 : 0,
          timeBoost: 0,
        };
      })
      .sort((a, b) => {
        if (a.negativePenalty !== b.negativePenalty) return a.negativePenalty - b.negativePenalty;
        if (a.groupRank !== b.groupRank) return a.groupRank - b.groupRank; // TDT(1) before Movistar(4)
        if (a.ratingRank !== b.ratingRank) return a.ratingRank - b.ratingRank; // best rating first
        return a.channelRank - b.channelRank;
      })
      .filter((c, i, arr) => i === arr.findIndex((e) => e.dedupeKey === c.dedupeKey));
  }

  private buildScheduleDedupeKey(
    item: CatalogItemDTO,
    displayTitle: string
  ): string {
    if (item.contentType === 'series') {
      return this.normalizeTitleKey(this.extractSeriesBaseTitle(displayTitle));
    }

    return this.normalizeTitleKey(displayTitle);
  }

  private buildRecommendationKey(
    recommendation: ChatbotRecommendationPayload
  ): string {
    return [
      recommendation.type || '',
      this.normalizeTitleKey(recommendation.title) ||
        this.normalize(recommendation.catalogId || ''),
      this.normalize(
        recommendation.channelOrPlatform ||
          recommendation.channel ||
          recommendation.platform ||
          recommendation.detailPath ||
          ''
      ),
      this.normalize(
        recommendation.startTime || recommendation.time || recommendation.endTime || ''
      ),
    ]
      .filter(Boolean)
      .join('::');
  }

  private dedupeRecommendations(
    recommendations: ChatbotRecommendationPayload[]
  ): ChatbotRecommendationPayload[] {
    const deduped = new Map<string, ChatbotRecommendationPayload>();

    recommendations.forEach((recommendation) => {
      const normalized = {
        ...recommendation,
        title: this.cleanDisplayTitle(recommendation.title, recommendation.type),
      };
      const key = this.buildRecommendationKey(normalized);
      if (!deduped.has(key)) {
        deduped.set(key, normalized);
      }
    });

    return Array.from(deduped.values());
  }

  private buildAutonomicFollowUpResponse(
    previousContext: ChatbotQueryContext,
    liveNowItems: CatalogItemDTO[],
    tonightItems: CatalogItemDTO[],
    latestUserMessage: string,
    effectiveCommunity: string | undefined,
    replyKind: CommunityPreferenceReply['kind']
  ): ChatbotResponse | null {
    const followUpIntent: ChatQueryIntent = {
      mode: previousContext.mode,
      requestedTypes: previousContext.requestedTypes || [],
      explicitGenres: [],
      explicitPlatforms: [],
      wantsFamily: false,
      wantsShort: false,
      wantsPrimeTime: false,
      negativeSignals: [],
    };

    if (replyKind === 'decline') {
      return {
        text: 'Perfecto. Mantengo la recomendación centrada en TDT y canales de pago, sin incluir autonómicas.',
        recommendations: [],
        moreRecommendations: [],
        followUpSuggestions: this.sanitizeFollowUpSuggestions(
          [
            '¿Qué merece la pena ahora mismo?',
            '¿Qué películas hay esta noche en TV?',
            '¿Qué series hay esta noche?'
          ],
          latestUserMessage
        ),
        queryContext: this.buildQueryContext(
          previousContext.mode,
          previousContext.requestedTypes || [],
          0,
          0,
          false,
          previousContext.answerWindowLabel || 'TV',
          {
            primaryMatches: 0,
            hasAutonomicMatches: false,
            autonomicPromptRequired: false,
            savedAutonomousCommunity: effectiveCommunity,
          }
        ),
      };
    }

    const sourceItems =
      previousContext.mode === 'tv_now'
        ? this.rankScheduleItems(
            this.filterCatalogItems(liveNowItems, followUpIntent),
            'tv_now'
          )
        : this.rankScheduleItems(
            this.filterCatalogItems(tonightItems, followUpIntent),
            'tv_tonight'
          );
    const autonomicMatches = this.filterAutonomicMatches(
      sourceItems,
      effectiveCommunity
    );

    if (!autonomicMatches.length) {
      return {
        text: effectiveCommunity
          ? `No veo una opción clara en autonómicas de ${effectiveCommunity} para ${
              previousContext.mode === 'tv_now' ? 'ahora mismo' : 'esta noche'
            }. Si quieres, sigo buscando en TDT, pago o streaming.`
          : 'No he podido filtrar autonómicas sin una comunidad concreta. Si quieres, dime cuál es tu comunidad y vuelvo a mirar.',
        recommendations: [],
        moreRecommendations: [],
        followUpSuggestions: this.sanitizeFollowUpSuggestions(
          [
            '¿Qué merece la pena esta noche?',
            '¿Qué tengo en mis plataformas?',
            'Algo corto para ver hoy',
          ],
          latestUserMessage
        ),
        queryContext: this.buildQueryContext(
          previousContext.mode,
          previousContext.requestedTypes || [],
          0,
          0,
          false,
          previousContext.answerWindowLabel || 'TV',
          {
            primaryMatches: 0,
            hasAutonomicMatches: false,
            autonomicPromptRequired: !effectiveCommunity,
            savedAutonomousCommunity: effectiveCommunity,
          }
        ),
      };
    }

    const picks = autonomicMatches.slice(0, 3);
    const more = autonomicMatches.slice(3);
    return {
      text: `Perfecto. También puedo incluir autonómicas de ${
        effectiveCommunity || 'tu comunidad'
      }. Estas son las más útiles para ${
        previousContext.mode === 'tv_now' ? 'ahora mismo' : 'esta noche'
      }.`,
      recommendations: picks.map((item) =>
        this.mapRankedItemToRecommendation(
          item,
          item.item.liveNow
            ? `En emisión ahora en ${item.item.channel?.name || 'TV'}.`
            : `Empieza a las ${
                item.item.start ? this.formatTime(item.item.start) : 'próximamente'
              } en ${item.item.channel?.name || 'TV'}.`
        )
      ),
      moreRecommendations: more.map((item) =>
        this.mapRankedItemToRecommendation(
          item,
          item.item.liveNow
            ? `En emisión ahora en ${item.item.channel?.name || 'TV'}.`
            : `Empieza a las ${
                item.item.start ? this.formatTime(item.item.start) : 'próximamente'
              } en ${item.item.channel?.name || 'TV'}.`
        )
      ),
      followUpSuggestions: this.sanitizeFollowUpSuggestions(
        [
          '¿Qué merece la pena ahora mismo?',
          '¿Qué películas hay esta noche en TV?',
          '¿Qué series hay esta noche?',
        ],
        latestUserMessage
      ),
      queryContext: this.buildQueryContext(
        previousContext.mode,
        previousContext.requestedTypes || [],
        autonomicMatches.length,
        picks.length,
        more.length > 0,
        previousContext.answerWindowLabel || 'TV',
        {
          primaryMatches: 0,
          hasAutonomicMatches: true,
          autonomicPromptRequired: false,
          savedAutonomousCommunity: effectiveCommunity,
        }
      ),
    };
  }

  private getLastAutonomicPromptContext(
    messages: AssistantHistoryPayload['messages']
  ): ChatbotQueryContext | null {
    const lastAssistant = [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === 'assistant' &&
          message.queryContext?.autonomicPromptRequired &&
          (message.queryContext.mode === 'tv_now' ||
            message.queryContext.mode === 'tv_tonight')
      );

    return lastAssistant?.queryContext || null;
  }

  /** include: saved community, use it. never: the user said no. ask: no choice yet. */
  private resolveRegionalChoice(community: string | undefined, optIn: boolean | 'unknown' | undefined): 'include' | 'never' | 'ask' {
    if (optIn === false) return 'never';
    return community ? 'include' : 'ask';
  }

  private filterAutonomicMatches(
    items: RankedScheduleItem[],
    community?: string
  ): RankedScheduleItem[] {
    const patterns = community
      ? this.getAutonomicCommunityPatterns(community)
      : [];

    return items.filter((item) => {
      if (item.groupRank !== 2) {
        return false;
      }

      if (!patterns.length) {
        return true;
      }

      const channelName = this.normalize(item.item.channel?.name || '');
      return patterns.some((pattern) => channelName.includes(this.normalize(pattern)));
    });
  }

  /** The chat draws its own community chooser under the answer, so the text never repeats the question. */
  private appendAutonomicPrompt(baseText: string, _hasAutonomicMatches: boolean, _savedCommunity?: string): string {
    return baseText;
  }

  private extractCommunityReply(
    message: string,
    savedCommunity?: string
  ): CommunityPreferenceReply {
    const normalized = this.normalize(message);
    const matchedCommunity = AUTONOMOUS_COMMUNITIES.find((community) =>
      community.aliases.some((alias) =>
        normalized.includes(this.normalize(alias))
      )
    );

    if (
      /no incluir autonomic|sin autonomic|no auton[oó]mic|sin cadenas autonomic/.test(
        normalized
      )
    ) {
      return { kind: 'decline', shouldPersist: true };
    }

    if (matchedCommunity) {
      return {
        kind: 'set',
        community: matchedCommunity.canonical,
        shouldPersist: true,
      };
    }

    if (
      savedCommunity &&
      /^(si|sí|vale|ok|de acuerdo|usa esa|usa la misma|la misma)$/.test(
        normalized
      )
    ) {
      return {
        kind: 'confirm',
        community: savedCommunity,
        shouldPersist: true,
      };
    }

    if (/cambiar comunidad|otra comunidad/.test(normalized)) {
      return { kind: 'change', shouldPersist: false };
    }

    return { kind: 'none', shouldPersist: false };
  }

  private buildQueryContext(
    mode: ChatbotQueryContext['mode'],
    requestedTypes: Array<'movie' | 'series' | 'program'>,
    totalMatches: number,
    shownCount: number,
    hasMore: boolean,
    answerWindowLabel: string,
    extra: Partial<ChatbotQueryContext> = {}
  ): ChatbotQueryContext {
    return {
      mode,
      requestedTypes,
      totalMatches,
      primaryMatches:
        typeof extra.primaryMatches === 'number'
          ? Number(extra.primaryMatches)
          : totalMatches,
      shownCount,
      hasMore,
      answerWindowLabel,
      ...extra,
    };
  }

  private buildFollowUpSuggestions(
    intent: ChatQueryIntent,
    latestUserMessage: string,
    profile?: RankingContext
  ): string[] {
    const genreLabel = intent.explicitGenres[0] ? ` de ${intent.explicitGenres[0].toLowerCase()}` : '';
    const platform = intent.explicitPlatforms[0];

    let candidates: string[];

    // Streaming-specific: suggest genre alternatives and platform cross-checks
    if (intent.mode === 'streaming') {
      if (intent.requestedTypes[0] === 'movie') {
        candidates = [
          genreLabel ? `¿Más películas${genreLabel} en streaming?` : '¿Qué películas tienen mejor valoración ahora?',
          platform ? `¿Qué series hay en ${platform}?` : '¿Qué series hay en Netflix ahora mismo?',
          '¿Qué hay esta noche en TV?',
        ];
      } else if (intent.requestedTypes[0] === 'series') {
        candidates = [
          genreLabel ? `¿Más series${genreLabel} en streaming?` : '¿Qué series tienen mejor valoración ahora?',
          platform ? `¿Qué películas hay en ${platform}?` : '¿Qué películas hay en streaming ahora?',
          '¿Qué hay esta noche en TV?',
        ];
      } else {
        candidates = [
          platform ? `¿Qué más hay en ${platform}?` : '¿Qué hay en Netflix ahora?',
          genreLabel ? `¿Más contenido${genreLabel} en streaming?` : '¿Qué series están de moda ahora?',
          '¿Qué hay esta noche en TV?',
        ];
      }
    } else if (intent.requestedTypes[0] === 'movie') {
      candidates = [
        '¿Solo películas en prime time (20h-23h)?',
        '¿Películas en todo el día en TDT y Movistar?',
        intent.mode === 'tv_now' ? '¿Qué series hay ahora mismo?' : '¿Qué series hay esta noche?',
      ];
    } else if (intent.requestedTypes[0] === 'series') {
      candidates = [
        intent.mode === 'tv_now'
          ? `¿Qué series${genreLabel} hay más tarde esta noche?`
          : `¿Qué merece la pena${genreLabel} ahora mismo?`,
        intent.mode === 'tv_now'
          ? '¿Qué películas hay ahora mismo en TV?'
          : '¿Qué películas hay esta noche en TV?',
        platform ? `¿Qué más hay en ${platform}?` : '¿Qué series hay en streaming ahora?',
      ];
    } else {
      candidates = [
        genreLabel ? `¿Más contenido${genreLabel} ahora?` : '¿Qué merece la pena ahora mismo?',
        '¿Qué hay esta noche en TV?',
        platform ? `¿Qué más hay en ${platform}?` : '¿Qué películas hay esta noche en TV?',
      ];
    }

    return this.sanitizeFollowUpSuggestions([...this.personalFollowUps(intent, profile), ...candidates], latestUserMessage);
  }

  /**
   * Follow-ups built from the user's own profile ("Algo como Fleabag", "¿Y en Netflix?"), at most two,
   * skipping what the current question already asked for.
   */
  private personalFollowUps(intent: ChatQueryIntent, profile?: RankingContext): string[] {
    if (!profile) return [];
    const out: string[] = [];
    const reference = (profile.references || []).find((title) => title.length <= 30);
    if (reference) out.push(`Algo parecido a ${reference}`);
    const platform = (profile.platforms || []).find((p) => !intent.explicitPlatforms.includes(p));
    if (platform && intent.mode !== 'streaming') out.push(`¿Y qué hay en ${platform}?`);
    else if (platform) out.push(`¿Y en ${platform}?`);
    const genre = (profile.likedGenres || []).find((g) => !intent.explicitGenres.map((e) => e.toLowerCase()).includes(g.toLowerCase()));
    if (genre && out.length < 2) out.push(intent.mode === 'tv_now' ? `Algo de ${genre.toLowerCase()} ahora` : `Más ${genre.toLowerCase()} para esta noche`);
    return out.slice(0, 2);
  }

  private buildFallbackFollowUpSuggestions(
    intent: ChatQueryIntent,
    latestUserMessage: string,
    profile?: RankingContext
  ): string[] {
    const typeQuestion = intent.requestedTypes[0] === 'movie'
      ? '¿Qué películas hay esta noche en TV?'
      : '¿Qué series hay esta noche?';
    const platform = intent.explicitPlatforms[0];
    return this.sanitizeFollowUpSuggestions(
      [
        ...this.personalFollowUps(intent, profile),
        typeQuestion,
        intent.mode === 'tv_tonight'
          ? '¿Qué hay ahora mismo en TV?'
          : intent.mode === 'tv_now'
            ? '¿Qué hay esta noche en TV?'
            : '¿Qué hay ahora mismo en TV?',
        platform ? `¿Qué hay en ${platform}?` : '¿Qué tengo en streaming ahora?',
      ],
      latestUserMessage
    );
  }

  private buildStreamingFallbackSuggestions(
    intent: ChatQueryIntent,
    latestUserMessage: string
  ): string[] {
    const platform = intent.explicitPlatforms[0];
    const genreLabel = intent.explicitGenres[0] ? ` de ${intent.explicitGenres[0].toLowerCase()}` : '';
    return this.sanitizeFollowUpSuggestions(
      [
        intent.requestedTypes[0] === 'movie'
          ? `¿Qué películas${genreLabel} hay esta noche en TV?`
          : `¿Qué series${genreLabel} hay esta noche en TV?`,
        platform ? `¿Qué más hay en ${platform}?` : '¿Qué tengo en mis plataformas?',
        genreLabel ? `¿Algo${genreLabel} más corto para hoy?` : 'Algo corto para ver hoy',
      ],
      latestUserMessage
    );
  }

  private sanitizeFollowUpSuggestions(
    suggestions: string[],
    latestUserMessage: string
  ): string[] {
    const normalizedLastUserMessage = this.normalize(latestUserMessage);
    const unique = new Map<string, string>();

    suggestions.forEach((suggestion) => {
      const safe = String(suggestion || '').trim();
      if (!safe) {
        return;
      }

      const normalized = this.normalize(safe);
      if (!normalized || normalized === normalizedLastUserMessage) {
        return;
      }

      unique.set(normalized, safe);
    });

    return Array.from(unique.values()).slice(0, 3);
  }

  private cleanDisplayTitle(
    value: string,
    contentType: 'movie' | 'series' | 'program'
  ): string {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }

    const segments = raw
      .split(/·|\||—|-/)
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length >= 2) {
      const first = segments[0];
      const second = segments[1];
      if (this.normalize(first) === this.normalize(second)) {
        return first;
      }
    }

    if (contentType === 'series') {
      return this.extractSeriesBaseTitle(raw);
    }

    return raw;
  }

  private extractSeriesBaseTitle(title: string): string {
    return String(title || '')
      .replace(/\s*T\d+\s*E\d+.*$/i, '')
      .replace(/\s*S\d+\s*E\d+.*$/i, '')
      .replace(/\s*\([^)]*dobles[^)]*\).*$/i, '')
      .replace(/\s*·.*$/i, '')
      .trim();
  }

  private resolveChannelEntry(channelName: string): ChannelEntry | undefined {
    const norm = this.normalize(channelName);
    for (const key of CHANNEL_MAP_KEYS_DESC) {
      // Word-boundary match: key must be the entire string, or preceded/followed by a space.
      // This prevents short keys like 'ten' from matching 'antena', 'tennis', 'rakuten', etc.
      if (
        norm === key ||
        norm.startsWith(key + ' ') ||
        norm.endsWith(' ' + key) ||
        norm.includes(' ' + key + ' ')
      ) {
        return CHANNEL_MAP.get(key);
      }
    }
    return undefined;
  }

  private getChannelGroupRank(item: CatalogItemDTO): number {
    return this.resolveChannelEntry(item.channel?.name || '')?.group ?? 3;
  }

  private getChannelPriority(channelName: string): number {
    return this.resolveChannelEntry(channelName)?.priority ?? 999;
  }

  private getAutonomicCommunityPatterns(community: string): string[] {
    return (
      AUTONOMOUS_COMMUNITIES.find(
        (entry) => this.normalize(entry.canonical) === this.normalize(community)
      )?.channelPatterns || []
    );
  }

  private isTonightWindow(start: string, end?: string): boolean {
    const now = new Date();
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : null;
    if (Number.isNaN(startDate.getTime())) {
      return false;
    }
    if (endDate && Number.isNaN(endDate.getTime())) {
      return false;
    }

    const tonightStart = this.buildTonightWindowStart(now);
    const tonightEnd = this.buildTonightWindowEnd(now);
    const isBeforeTonightWindow = now.getTime() < tonightStart.getTime();
    const activeWindowStart = isBeforeTonightWindow ? tonightStart : now;

    if (isBeforeTonightWindow) {
      return (
        startDate.getTime() >= tonightStart.getTime() &&
        startDate.getTime() <= tonightEnd.getTime()
      );
    }

    const intervalEnd = endDate || startDate;

    return (
      startDate.getTime() <= tonightEnd.getTime() &&
      intervalEnd.getTime() >= activeWindowStart.getTime()
    );
  }

  private buildTonightWindowStart(reference: Date): Date {
    const tonightStart = new Date(reference);
    tonightStart.setHours(20, 0, 0, 0);
    return tonightStart;
  }

  private buildTonightWindowEnd(reference: Date): Date {
    const tonightEnd = new Date(reference);
    tonightEnd.setHours(23, 59, 59, 999);
    return tonightEnd;
  }

  private getContentTypePriority(
    contentType: CatalogItemDTO['contentType']
  ): number {
    switch (contentType) {
      case 'movie':
        return 0;
      case 'series':
        return 1;
      default:
        return 2;
    }
  }

  private normalizeTitleKey(value: string): string {
    return this.normalize(value)
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\b(el|la|los|las|un|una|unos|unas)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildRecommendationBadges(item: CatalogItemDTO): string[] {
    const badges: string[] = [];

    if (item.liveNow) {
      badges.push('En emisión ahora');
    } else if (item.start) {
      badges.push(`Empieza a las ${this.formatTime(item.start)}`);
    }

    const groupRank = this.getChannelGroupRank(item);
    if (groupRank === 1) {
      badges.push('TDT / nacional');
    } else if (groupRank === 2) {
      badges.push('Autonómica');
    } else if (groupRank === 3) {
      badges.push('Canal de pago');
    } else if (groupRank === 4) {
      badges.push('Movistar');
    } else if (groupRank === 5) {
      badges.push('Deportes');
    }

    return badges.slice(0, 3);
  }
}

/** Pure presenter kept outside the use case so grounding invariants remain regression-testable. */
export function buildFootballTodayPayload(matches: FootballMatch[]): ChatbotResponse {
  const visible = matches.slice(0, 8);
  return {
    text: visible.length
      ? `He encontrado ${visible.length} ${visible.length === 1 ? 'partido' : 'partidos'} para hoy con datos verificados de GuíaTV.`
      : 'No encuentro partidos confirmados para hoy en las fuentes de GuíaTV.',
    intent: 'football_today',
    confidence: 1,
    sections: [{ id: 'football-today', kind: 'matches', title: 'Fútbol hoy' }],
    matches: visible.map((match) => ({
      id: match.id,
      slug: match.slug,
      competition: match.competition.shortName || match.competition.name,
      kickoffAt: match.kickoffAt,
      status: match.status,
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      homeScore: match.score.home,
      awayScore: match.score.away,
      broadcasters: match.broadcasts.map((broadcast) => ({
        name: broadcast.channelName,
        path: broadcast.channelPath,
      })),
      detailPath: `/futbol/partido/${match.slug}`,
    })),
    sources: [{
      id: 'football-provider-today',
      kind: 'football_provider',
      label: 'Datos de fútbol de GuíaTV',
      retrievedAt: new Date().toISOString(),
    }],
    followUpSuggestions: ['¿Qué hay ahora en TV?', 'Películas para esta noche'],
  };
}

const AFFILIATE_RESOLVE_TIMEOUT_MS = 350;
const AFFILIATE_PLACEMENT = 'chatbot-answer';

/** Minimal shape `attachChatbotAffiliateActions` needs — lets tests pass a lightweight mock instead of a full `AffiliateResolverService`. */
export interface ChatbotAffiliateResolver {
  resolveOffers: AffiliateResolverService['resolveOffers'];
}

async function resolveAffiliateActionForProvider(
  resolver: ChatbotAffiliateResolver,
  providerKey: string,
  conversationId?: string | null
): Promise<ChatbotAffiliateActionDTO | undefined> {
  try {
    const timeout = new Promise<undefined>((resolve) =>
      setTimeout(() => resolve(undefined), AFFILIATE_RESOLVE_TIMEOUT_MS)
    );
    const result = await Promise.race([
      resolver.resolveOffers({
        context: buildAffiliateContext({
          market: 'ES',
          placement: AFFILIATE_PLACEMENT,
          providerKey,
          chatbotConversationId: conversationId ?? undefined,
        }),
        providerKeys: [providerKey],
        maxResults: 1,
      }),
      timeout,
    ]);
    const top = result?.items?.[0];
    if (!top) return undefined;
    return {
      offerId: top.offerId,
      label: top.cta.label,
      provider: top.merchant.name,
      outboundPath: top.outbound.path,
      disclosure: top.display.disclosure,
      sponsored: top.cta.sponsored,
    };
  } catch (error) {
    logger.warn('[ChatbotRecommend] affiliate resolve failed for provider', {
      providerKey,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return undefined;
  }
}

/**
 * Deterministic, post-hoc affiliate CTA resolution — never seen by the LLM,
 * never blocks or degrades the chat answer. Called once per response, after
 * the recommendation list (and, for football, the match/broadcaster list) is
 * already final. Dedupes by provider key so N recommendations sharing one
 * channel/platform only resolve once (`Promise.all` over unique keys, not
 * over items). Any resolver failure or slow response is caught/time-boxed
 * and simply leaves `affiliateActions` unset — the chat text and
 * recommendations themselves are already fully built by this point, so a
 * broken/unavailable affiliate backend never turns into a broken/degraded
 * chat answer. Exported as a free function (not a method) so it's directly
 * unit-testable with a minimal `{ resolveOffers }` mock.
 */
export async function attachChatbotAffiliateActions(
  response: ChatbotResponse,
  resolver: ChatbotAffiliateResolver | undefined,
  conversationId?: string | null
): Promise<ChatbotResponse> {
  if (!resolver) return response;

  try {
    const recommendations = response.recommendations || [];
    const moreRecommendations = response.moreRecommendations || [];
    const broadcasters = (response.matches || []).flatMap((match) => match.broadcasters || []);

    const providerKeys = new Set<string>();
    for (const rec of [...recommendations, ...moreRecommendations]) {
      const key = rec.channelOrPlatform || rec.channel || rec.platform;
      if (key) providerKeys.add(key);
    }
    for (const broadcaster of broadcasters) {
      if (broadcaster.name) providerKeys.add(broadcaster.name);
    }
    if (!providerKeys.size) return response;

    const resolvedByProvider = new Map<string, ChatbotAffiliateActionDTO | undefined>();
    await Promise.all(
      Array.from(providerKeys).map(async (providerKey) => {
        const action = await resolveAffiliateActionForProvider(resolver, providerKey, conversationId);
        resolvedByProvider.set(providerKey, action);
      })
    );

    const applyTo = (rec: ChatbotRecommendationPayload): ChatbotRecommendationPayload => {
      const key = rec.channelOrPlatform || rec.channel || rec.platform;
      const action = key ? resolvedByProvider.get(key) : undefined;
      return action ? { ...rec, affiliateActions: [action] } : rec;
    };

    return {
      ...response,
      recommendations: recommendations.length ? recommendations.map(applyTo) : response.recommendations,
      moreRecommendations: moreRecommendations.length
        ? moreRecommendations.map(applyTo)
        : response.moreRecommendations,
      matches: response.matches?.map((match) => ({
        ...match,
        broadcasters: (match.broadcasters || []).map((broadcaster) => {
          const action = broadcaster.name ? resolvedByProvider.get(broadcaster.name) : undefined;
          return action ? { ...broadcaster, affiliateActions: [action] } : broadcaster;
        }),
      })),
    };
  } catch (error) {
    logger.warn('[ChatbotRecommend] attachAffiliateActions failed; returning response without CTAs', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return response;
  }
}
