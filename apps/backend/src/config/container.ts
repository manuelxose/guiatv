import { LegacyEnrichmentService } from '../application/services/LegacyEnrichmentService';
import type { ProgrammeDisposition } from '../application/services/ProgrammeSeoPolicy';
import { logger } from '../shared/utils/logger';
import { connectMongoDB, mongoose as mongooseInstance } from './mongodb';
import { ensureMongoCollectionsAndIndexes } from '../infrastructure/database/initializeMongoCollections';
import { ensureEditorialSeedData } from '../application/services/EditorialSeedService';
import { ensureAffiliateSeedData } from '../application/services/AffiliateMigrationService';

// Lightweight local type aliases to avoid compile-time coupling while
// preserving clearer intent in the container implementation.
type ICacheRepository = any;
type IChannelRepository = any;
type IProgramRepository = any;
type IAnalyticsRepository = any;

/**
 * Lightweight service container responsible for wiring dependencies manually.
 */
export class Container {
  private static instance: Container;
  private dependencies: Map<string, any> = new Map();
  private initialized = false;

  private constructor() {}

  static getInstance(): Container {
    if (!Container.instance) {
      Container.instance = new Container();
    }
    return Container.instance;
  }

  /**
   * Bootstraps all infrastructure, repositories, services, and controllers.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.info('Container already initialized');
      return;
    }

    logger.info('Initializing DI Container...');
    const start = Date.now();

    await this.initializeDatabase();
    const cache = await this.initializeCache();
    await this.registerRepositories(cache);
    await this.registerServices();
    await this.registerUseCases();
    await this.registerControllers();

    this.initialized = true;
    logger.info('DI Container initialized successfully', { totalMs: Date.now() - start });
  }

  private async initializeDatabase(): Promise<void> {
    try {
      await connectMongoDB();

      this.dependencies.set('mongoose', mongooseInstance);
      const nativeDb = mongooseInstance.connection.db;
      this.dependencies.set('mongoDb', nativeDb);

      await ensureMongoCollectionsAndIndexes();
      await ensureEditorialSeedData();
      await ensureAffiliateSeedData();

      logger.info('MongoDB (mongoose) initialized and registered in container');
    } catch (e) {
      logger.error('Failed to initialize MongoDB (mongoose)', { error: e });
      throw e;
    }
  }

  private async initializeCache(): Promise<ICacheRepository> {
    const cacheType = process.env.CACHE_TYPE || 'memory';
    // Valkey is Redis-compatible; prefer VALKEY_URL when CACHE_TYPE=valkey, fallback to REDIS_URL for compatibility.
    const redisUrl =
      cacheType === 'valkey'
        ? process.env.VALKEY_URL || process.env.REDIS_URL
        : process.env.REDIS_URL;

    let cache: ICacheRepository;

    if ((cacheType === 'redis' || cacheType === 'valkey') && redisUrl) {
      logger.info(`Initializing ${cacheType} cache`, { url: redisUrl });
      const { CacheFactory } = await import('../infrastructure/cache/CacheFactory');
      cache = CacheFactory.create({
        type: cacheType as 'redis' | 'valkey',
        redisUrl,
        redisOptions: {
          maxRetries: 10,
          connectTimeout: 10000,
        },
      });

      if (typeof (cache as any).connect === 'function') {
        try {
          const skipConnect = process.env.SKIP_CACHE_CONNECT === '1' || process.env.SKIP_CACHE_CONNECT === 'true';
          if (!skipConnect) {
            const cacheConnectTimeout = Number(process.env.CACHE_CONNECT_TIMEOUT_MS) || 8000;
            logger.info(`Attempting ${cacheType} connect`, { timeoutMs: cacheConnectTimeout });
            await Promise.race([
              (cache as any).connect(),
              new Promise((_, rej) =>
                setTimeout(() => rej(new Error(`${cacheType} connect timed out after ${cacheConnectTimeout}ms`)), cacheConnectTimeout)
              ),
            ]);
            logger.info(`${cacheType} cache connected`);
          } else {
            logger.info('Skipping cache connect due to SKIP_CACHE_CONNECT');
          }
        } catch (error) {
          logger.error(`Failed to connect ${cacheType}, falling back to in-memory`, error as Error);
          const { InMemoryCache } = await import('../infrastructure/cache/InMemoryCache');
          cache = new InMemoryCache();
        }
      }
    } else {
      logger.info('Using in-memory cache');
      const { InMemoryCache } = await import('../infrastructure/cache/InMemoryCache');
      cache = new InMemoryCache();
    }

    this.dependencies.set('cacheRepository', cache);
    return cache;
  }

  private async registerRepositories(cache: ICacheRepository): Promise<void> {
    const { MongoChannelRepository } = await import('../infrastructure/repositories/MongoChannelRepository');
    const { MongoProgramRepository } = await import('../infrastructure/repositories/MongoProgramRepository');
    const { MongoUserRepository } = await import('../infrastructure/repositories/MongoUserRepository');
    const { MongoAnalyticsRepository } = await import('../infrastructure/repositories/MongoAnalyticsRepository');
    const { MongoUserContentInteractionRepository } = await import(
      '../infrastructure/repositories/MongoUserContentInteractionRepository'
    );
    const { MongoAffiliateNetworkRepository } = await import('../infrastructure/repositories/MongoAffiliateNetworkRepository');
    const { MongoAffiliateMerchantRepository } = await import('../infrastructure/repositories/MongoAffiliateMerchantRepository');
    const { MongoAffiliateProgramRepository } = await import('../infrastructure/repositories/MongoAffiliateProgramRepository');
    const { MongoAffiliateOfferRepository } = await import('../infrastructure/repositories/MongoAffiliateOfferRepository');
    const { MongoAffiliatePlacementRepository } = await import('../infrastructure/repositories/MongoAffiliatePlacementRepository');

    const channelRepository = new MongoChannelRepository();
    this.dependencies.set('channelRepository', channelRepository);

    const programRepository = new MongoProgramRepository();
    this.dependencies.set('programRepository', programRepository);

    const userRepository = new MongoUserRepository();
    this.dependencies.set('userRepository', userRepository);

    const interactionRepository = new MongoUserContentInteractionRepository();
    this.dependencies.set('userContentInteractionRepository', interactionRepository);

    const { MongoMediaCatalogRepository } = await import('../infrastructure/repositories/MongoMediaCatalogRepository');
    const mediaCatalogRepository = new MongoMediaCatalogRepository();
    this.dependencies.set('mediaCatalogRepository', mediaCatalogRepository);

    // Affiliate Engine domain repositories — backing store for both MonetizationService
    // (legacy DTO facade, /v2/monetization/*) and AffiliateResolverService (/v2/affiliate/*).
    this.dependencies.set('affiliateNetworkRepository', new MongoAffiliateNetworkRepository());
    this.dependencies.set('affiliateMerchantRepository', new MongoAffiliateMerchantRepository());
    this.dependencies.set('affiliateProgramRepository', new MongoAffiliateProgramRepository());
    this.dependencies.set('affiliateOfferRepository', new MongoAffiliateOfferRepository());
    this.dependencies.set('affiliatePlacementRepository', new MongoAffiliatePlacementRepository());

    const analyticsStore = (process.env.ANALYTICS_STORE || 'mongo').toLowerCase();
    let analyticsRepository: IAnalyticsRepository;

    if (analyticsStore === 'valkey' || analyticsStore === 'redis') {
      const { ValkeyAnalyticsRepository } = await import('../infrastructure/repositories/ValkeyAnalyticsRepository');
      const analyticsRedisUrl = process.env.VALKEY_URL || process.env.REDIS_URL;

      if (!analyticsRedisUrl) {
        logger.error('ANALYTICS_STORE=valkey but no VALKEY_URL/REDIS_URL configured. Falling back to Mongo.');
        analyticsRepository = new MongoAnalyticsRepository();
      } else {
        analyticsRepository = new ValkeyAnalyticsRepository(analyticsRedisUrl, {
          maxRetries: 10,
          connectTimeout: 10000,
        });

        if (typeof (analyticsRepository as any).connect === 'function') {
          try {
            const analyticsConnectTimeout = Number(process.env.ANALYTICS_CONNECT_TIMEOUT_MS) || 8000;
            await Promise.race([
              (analyticsRepository as any).connect(),
              new Promise((_, rej) =>
                setTimeout(
                  () => rej(new Error(`analytics valkey connect timed out after ${analyticsConnectTimeout}ms`)),
                  analyticsConnectTimeout
                )
              ),
            ]);
            logger.info('Analytics Valkey connected');
          } catch (error) {
            logger.error('Failed to connect Analytics Valkey, falling back to Mongo', error as Error);
            analyticsRepository = new MongoAnalyticsRepository();
          }
        }
      }
    } else {
      analyticsRepository = new MongoAnalyticsRepository();
    }

    this.dependencies.set('analyticsRepository', analyticsRepository);

    // Cache Repository (already stored by initializeCache, ensure consistent key)
    this.dependencies.set('cacheRepository', cache);

    const storageAdapter = (process.env.STORAGE_ADAPTER || 'local').toLowerCase();
    if (storageAdapter === 's3') {
      const { S3StorageRepository } = await import('../infrastructure/storage/S3StorageRepository');
      const bucket = process.env.AWS_S3_BUCKET || process.env.STORAGE_BUCKET;
      if (!bucket) {
        throw new Error('AWS_S3_BUCKET is required when STORAGE_ADAPTER=s3');
      }
      const repo = new S3StorageRepository(bucket, process.env.AWS_REGION);
      this.dependencies.set('storageRepository', repo);
    } else if (storageAdapter === 'local') {
      const { LocalStorageRepository } = await import('../infrastructure/storage/LocalStorageRepository');
      const repo = new LocalStorageRepository(process.env.STORAGE_LOCAL_PATH);
      this.dependencies.set('storageRepository', repo);
    } else {
      throw new Error('Unsupported STORAGE_ADAPTER. Use "s3" or "local".');
    }

    logger.info('Repositories registered');
  }

  private async registerServices(): Promise<void> {
    const { ChannelService } = await import('../domain/services/ChannelService');
    const { ProgramService } = await import('../domain/services/ProgramService');
    const { TMDBService } = await import('../infrastructure/external/TMDBService');
    const { StreamingProvidersService } = await import(
      '../infrastructure/external/StreamingProvidersService'
    );
    const { AuthService } = await import('../domain/services/AuthService');
    const { BlogService } = await import('../infrastructure/external/BlogService');
    const { AnalyticsService } = await import('../application/services/AnalyticsService');
    const { MonetizationService } = await import('../application/services/MonetizationService');
    const { AssistantMemoryService } = await import(
      '../application/services/AssistantMemoryService'
    );
    const { TvReadQueryService } = await import('../application/services/TvReadQueryService');
    const { AIRecommendationService } = await import(
      '../infrastructure/external/AIRecommendationService'
    );

    const channelRepository = this.get<IChannelRepository>('channelRepository');
    const channelService = new ChannelService(channelRepository);
    this.dependencies.set('channelService', channelService);

    const programService = new ProgramService();
    this.dependencies.set('programService', programService);

    const tmdbApiKey = process.env.TMDB_API_KEY || '';
    const cacheRepositoryForTmdb = this.has('cacheRepository')
      ? this.get<ICacheRepository>('cacheRepository')
      : null;
    const tmdbService = new TMDBService(tmdbApiKey, cacheRepositoryForTmdb);
    this.dependencies.set('tmdbService', tmdbService);

    const streamingProvidersService = new StreamingProvidersService(
      tmdbApiKey,
      tmdbService,
      cacheRepositoryForTmdb
    );
    tmdbService.attachStreamingProvidersService(streamingProvidersService);
    this.dependencies.set('streamingProvidersService', streamingProvidersService);

    const { MediaCatalogService } = await import('../application/services/MediaCatalogService');
    const mediaCatalogService = new MediaCatalogService(
      this.get('mediaCatalogRepository'),
      tmdbService,
      cacheRepositoryForTmdb
    );
    this.dependencies.set('mediaCatalogService', mediaCatalogService);

    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-me';
    const authService = new AuthService(
      googleClientId,
      jwtSecret,
      this.get('userRepository')
    );
    this.dependencies.set('authService', authService);

    const analyticsRepository = this.get<IAnalyticsRepository>('analyticsRepository');
    const analyticsService = new AnalyticsService(analyticsRepository);
    this.dependencies.set('analyticsService', analyticsService);

    // Phase 10 final migration: MonetizationService is now a facade reading the same
    // Mongo-backed Affiliate Engine repositories AffiliateResolverService uses below —
    // see docs/affiliate-engine-architecture.md §19 (M1). The static monetizationOffers.ts
    // array is no longer its runtime source, only its seed/test fixture and safety fallback.
    const monetizationService = new MonetizationService(analyticsService, {
      offerRepository: this.get('affiliateOfferRepository'),
      merchantRepository: this.get('affiliateMerchantRepository'),
      programRepository: this.get('affiliateProgramRepository'),
    });
    this.dependencies.set('monetizationService', monetizationService);

    // Affiliate Engine — Phase 3+: generic resolution pipeline. Powers every surface except
    // /v2/monetization/*, which now reads the same store through the facade above.
    const { AffiliateAnalyticsService } = await import('../application/services/AffiliateAnalyticsService');
    const { AffiliateCatalogService } = await import('../application/services/AffiliateCatalogService');
    const { AffiliateResolverService } = await import('../application/services/AffiliateResolverService');
    const { DeepLinkStrategyRegistry } = await import('../infrastructure/affiliate/deeplink/DeepLinkStrategyRegistry');

    const affiliateAnalyticsService = new AffiliateAnalyticsService(analyticsService);
    this.dependencies.set('affiliateAnalyticsService', affiliateAnalyticsService);

    const affiliateCatalogService = new AffiliateCatalogService(
      this.get('affiliateOfferRepository'),
      this.get('affiliateMerchantRepository'),
      this.get('affiliateProgramRepository'),
      this.get('affiliatePlacementRepository'),
      this.get('cacheRepository')
    );
    this.dependencies.set('affiliateCatalogService', affiliateCatalogService);

    const affiliateResolverService = new AffiliateResolverService(
      affiliateCatalogService,
      this.get('affiliateOfferRepository'),
      this.get('affiliateMerchantRepository'),
      this.get('affiliateProgramRepository'),
      this.get('affiliatePlacementRepository'),
      this.get('affiliateNetworkRepository'),
      new DeepLinkStrategyRegistry(),
      affiliateAnalyticsService
    );
    this.dependencies.set('affiliateResolverService', affiliateResolverService);

    const assistantMemoryService = new AssistantMemoryService();
    this.dependencies.set('assistantMemoryService', assistantMemoryService);

    const tvReadQueryService = new TvReadQueryService(this.get('cacheRepository'));
    this.dependencies.set('tvReadQueryService', tvReadQueryService);
    const { TvSurfaceService } = await import('../application/services/TvSurfaceService');
    const { ChannelFeedAliasResolver } = await import('../application/services/ChannelFeedAliases');
    const channelFeedAliases = new ChannelFeedAliasResolver(tvReadQueryService);
    this.dependencies.set('channelFeedAliases', channelFeedAliases);
    const tvSurfaceService = new TvSurfaceService(tvReadQueryService, this.get('cacheRepository'), channelFeedAliases);
    this.dependencies.set('tvSurfaceService', tvSurfaceService);

    // Football bounded context (provider abstraction + reconciliation + BFF).
    const { EpgFootballDataProvider } = await import(
      '../infrastructure/sports/providers/EpgFootballDataProvider'
    );
    const { BroadcastReconciliationService } = await import(
      '../application/sports/services/BroadcastReconciliationService'
    );
    const { FootballQueryService } = await import(
      '../application/sports/services/FootballQueryService'
    );

    const footballApiKey = process.env.FOOTBALL_DATA_API_KEY;
    const epgFootballProvider = new EpgFootballDataProvider();
    let footballProvider: any;
    if (footballApiKey) {
      const { FootballDataOrgAdapter } = await import(
        '../infrastructure/sports/providers/FootballDataOrgAdapter'
      );
      const { FallbackFootballDataProvider } = await import(
        '../infrastructure/sports/providers/FallbackFootballDataProvider'
      );
      footballProvider = new FallbackFootballDataProvider(
        new FootballDataOrgAdapter(footballApiKey),
        epgFootballProvider
      );
      logger.info('Football provider: football-data.org (live scores enabled, EPG fallback)');
    } else {
      footballProvider = epgFootballProvider;
      logger.info('Football provider: EPG (real fixtures/broadcasts, no live scores)');
    }
    this.dependencies.set('footballProvider', footballProvider);

    const broadcastReconciliationService = new BroadcastReconciliationService(
      this.get('cacheRepository')
    );
    this.dependencies.set('broadcastReconciliationService', broadcastReconciliationService);

    const footballQueryService = new FootballQueryService(
      footballProvider,
      broadcastReconciliationService,
      this.get('cacheRepository')
    );
    this.dependencies.set('footballQueryService', footballQueryService);

    const blogBaseUrl =
      process.env.BLOG_API_URL ||
      process.env.API_BLOG ||
      process.env.BLOG_BASE_URL;
    if (blogBaseUrl) {
      const blogService = new BlogService({
        baseUrl: blogBaseUrl,
        timeoutMs: Number(process.env.BLOG_API_TIMEOUT_MS) || 5000,
      });
      this.dependencies.set('blogService', blogService);
    }

    if (
      process.env.AI_CHATBOT_ENABLED === 'true' &&
      (process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_API_KEY)
    ) {
      const aiRecommendationService = new AIRecommendationService({
        provider: process.env.AI_PROVIDER,
        deepseekApiKey: process.env.DEEPSEEK_API_KEY,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        deepseekModel: process.env.AI_CHATBOT_MODEL,
        anthropicModel: process.env.AI_CHATBOT_ANTHROPIC_MODEL,
      });
      this.dependencies.set('aiRecommendationService', aiRecommendationService);
    }

    logger.info('Services registered');
  }

  private async registerUseCases(): Promise<void> {
    const channelRepository = this.get<IChannelRepository>('channelRepository');
    const programRepository = this.get<IProgramRepository>('programRepository');
    const cacheRepository = this.get<ICacheRepository>('cacheRepository');
    const channelService = this.get<any>('channelService');
    const tmdbService = this.get<any>('tmdbService');
    const streamingProvidersService = this.get<any>('streamingProvidersService');
    const interactionRepository = this.get<any>('userContentInteractionRepository');
    const userRepository = this.get<any>('userRepository');

    const { GetAllChannels } = await import('../application/use-cases/GetAllChannels');
    const { GetChannelById } = await import('../application/use-cases/GetChannelById');
    const { GetPrograms } = await import('../application/use-cases/GetPrograms');
    const { GetProgramLayouts } = await import('../application/use-cases/GetProgramLayouts');
    const { GetProgramById } = await import('../application/use-cases/GetProgramById');
    const { SyncProgramData } = await import('../application/use-cases/SyncProgramData');
    const { XMLParser } = await import('../infrastructure/parsers/XMLParser');
    const { ProgramDataParser } = await import('../infrastructure/parsers/ProgramDataParser');
    const { SyncEPGData } = await import('../application/use-cases/SyncEPGData');
    const { PrecomputeSchedule } = await import('../application/use-cases/PrecomputeSchedule');
    const { CleanOldPrograms } = await import('../application/use-cases/CleanOldPrograms');
    const { GetNowPlaying } = await import('../application/use-cases/GetNowPlaying');
    const { ResetSystem } = await import('../application/use-cases/ResetSystem');
    const { GetDiscoveryHome } = await import('../application/use-cases/GetDiscoveryHome');
    const { GetDiscoveryBrowse } = await import('../application/use-cases/GetDiscoveryBrowse');
    const { SearchDiscoveryContent } = await import('../application/use-cases/SearchDiscoveryContent');
    const { GetContentDetail } = await import('../application/use-cases/GetContentDetail');
    const { GetContentBatch } = await import('../application/use-cases/GetContentBatch');
    const { CatalogService } = await import('../application/services/CatalogService');
    const { TvReadModelBuilder } = await import('../application/services/TvReadModelBuilder');
    const { GetPersonalizedRecommendations } = await import(
      '../application/use-cases/GetPersonalizedRecommendations'
    );
    const { ChatbotRecommend } = await import('../application/use-cases/ChatbotRecommend');

    const getAllChannels = new GetAllChannels(channelRepository, cacheRepository, channelService);
    this.dependencies.set('getAllChannels', getAllChannels);

    const getChannelById = new GetChannelById(channelRepository, cacheRepository);
    this.dependencies.set('getChannelById', getChannelById);

    const getPrograms = new GetPrograms(programRepository, channelRepository, cacheRepository);
    this.dependencies.set('getPrograms', getPrograms);

    const getProgramLayouts = new GetProgramLayouts(cacheRepository, getPrograms);
    this.dependencies.set('getProgramLayouts', getProgramLayouts);

    const getProgramById = new GetProgramById(programRepository);
    this.dependencies.set('getProgramById', getProgramById);

    const syncProgramData = new SyncProgramData(programRepository, cacheRepository);
    this.dependencies.set('syncProgramData', syncProgramData);

    const storageRepository = this.get<any>('storageRepository');

    const xmlParser = new XMLParser();
    this.dependencies.set('xmlParser', xmlParser);

    const programParser = new ProgramDataParser();
    this.dependencies.set('programParser', programParser);

    const syncEPGData = new SyncEPGData(channelRepository, programRepository, cacheRepository, storageRepository, xmlParser, programParser, tmdbService, this.get('mediaCatalogService'));
    this.dependencies.set('syncEPGData', syncEPGData);

    const tvReadModelBuilder = new TvReadModelBuilder(programRepository, cacheRepository);
    this.dependencies.set('tvReadModelBuilder', tvReadModelBuilder);

    const precomputeSchedule = new PrecomputeSchedule(tvReadModelBuilder);
    this.dependencies.set('precomputeSchedule', precomputeSchedule);

    const cleanOldPrograms = new CleanOldPrograms(programRepository);
    this.dependencies.set('cleanOldPrograms', cleanOldPrograms);

    const getNowPlaying = new GetNowPlaying(channelRepository, programRepository);
    this.dependencies.set('getNowPlaying', getNowPlaying);

    const resetSystem = new ResetSystem(
      cacheRepository,
      storageRepository,
      syncEPGData,
      precomputeSchedule
    );
    this.dependencies.set('resetSystem', resetSystem);

    const catalogService = new CatalogService(
      channelRepository,
      cacheRepository,
      tmdbService,
      streamingProvidersService,
      interactionRepository,
      this.get('tvReadQueryService'),
      this.get('mediaCatalogService'),
      new LegacyEnrichmentService({ catalog: this.get('mediaCatalogRepository') })
    );
    this.dependencies.set('catalogService', catalogService);

    const getPersonalizedRecommendations = new GetPersonalizedRecommendations(
      getPrograms,
      interactionRepository,
      streamingProvidersService,
      catalogService
    );
    this.dependencies.set(
      'getPersonalizedRecommendations',
      getPersonalizedRecommendations
    );

    const getDiscoveryHome = new GetDiscoveryHome(
      cacheRepository,
      this.get('tvReadQueryService'),
      catalogService,
      getPersonalizedRecommendations
    );
    this.dependencies.set('getDiscoveryHome', getDiscoveryHome);

    const searchDiscoveryContent = new SearchDiscoveryContent(
      catalogService,
      this.get('tvReadQueryService')
    );
    this.dependencies.set('searchDiscoveryContent', searchDiscoveryContent);

    const getDiscoveryBrowse = new GetDiscoveryBrowse(
      cacheRepository,
      this.get('tvReadQueryService'),
      catalogService
    );
    this.dependencies.set('getDiscoveryBrowse', getDiscoveryBrowse);

    const getContentDetail = new GetContentDetail(
      programRepository,
      channelRepository,
      cacheRepository,
      tmdbService,
      streamingProvidersService,
      interactionRepository,
      this.get('mediaCatalogService')
    );
    this.dependencies.set('getContentDetail', getContentDetail);

    const getContentBatch = new GetContentBatch(
      programRepository,
      channelRepository
    );
    this.dependencies.set('getContentBatch', getContentBatch);

    if (this.has('aiRecommendationService')) {
      const chatbotRecommend = new ChatbotRecommend(
        this.get('aiRecommendationService'),
        interactionRepository,
        userRepository,
        catalogService,
        this.get('assistantMemoryService'),
        this.has('cacheRepository') ? this.get('cacheRepository') : undefined,
        this.get('tvReadQueryService'),
        this.has('footballQueryService') ? this.get('footballQueryService') : undefined,
        this.has('affiliateResolverService') ? this.get('affiliateResolverService') : undefined
      );
      this.dependencies.set('chatbotRecommend', chatbotRecommend);
    }

    logger.info('Use Cases registered');
  }

  private async registerControllers(): Promise<void> {
    const { AdminController } = await import('../presentation/controllers/AdminController');
    const { AdminEpgDiagnosticsService } = await import('../application/services/AdminEpgDiagnosticsService');
    const { AdminProviderRegistryService } = await import('../application/services/AdminProviderRegistryService');
    const { AdminOperationsService } = await import('../application/services/AdminOperationsService');
    const { AuthController } = await import('../presentation/controllers/AuthController');
    const { DiscoveryController } = await import('../presentation/controllers/DiscoveryController');
    const { ContentController } = await import('../presentation/controllers/ContentController');
    const { CatalogController } = await import('../presentation/controllers/CatalogController');
    const { TvController } = await import('../presentation/controllers/TvController');
    const { BlogController } = await import('../presentation/controllers/BlogController');
    const { AnalyticsController } = await import('../presentation/controllers/AnalyticsController');
    const { MonetizationController } = await import('../presentation/controllers/MonetizationController');
    const { AdminUsersController } = await import('../presentation/controllers/AdminUsersController');
    const { UserController } = await import('../presentation/controllers/UserController');
    const { SocialController } = await import('../presentation/controllers/SocialController');
    const { ChatController } = await import('../presentation/controllers/ChatController');
    const { InteractionController } = await import('../presentation/controllers/InteractionController');
    const { AIController } = await import('../presentation/controllers/AIController');
    const { AssistantOperationalTelemetryService } = await import('../application/services/AssistantOperationalTelemetryService');

    const adminController = new AdminController(
      this.get('syncEPGData'),
      this.get('precomputeSchedule'),
      this.get('cleanOldPrograms'),
      this.get('cacheRepository'),
      this.get('resetSystem'),
      new AdminEpgDiagnosticsService(),
      new AdminProviderRegistryService(),
      new AdminOperationsService(this.get('cacheRepository'), this.has('footballProvider') ? this.get('footballProvider') : undefined, this.has('footballQueryService') ? () => this.get<any>('footballQueryService').getHome() : undefined)
    );
    this.dependencies.set('adminController', adminController);

    const authController = new AuthController(this.get('authService'));
    this.dependencies.set('authController', authController);

    const discoveryController = new DiscoveryController(
      this.get('getDiscoveryHome'),
      this.get('searchDiscoveryContent'),
      this.get('getPersonalizedRecommendations'),
      this.get('getDiscoveryBrowse')
    );
    this.dependencies.set('discoveryController', discoveryController);

    const contentController = new ContentController(
      this.get('getContentDetail'),
      this.get('getContentBatch'),
      this.get('streamingProvidersService'),
      this.get('catalogService')
    );
    this.dependencies.set('contentController', contentController);

    const catalogController = new CatalogController(this.get('catalogService'));
    this.dependencies.set('catalogController', catalogController);

    const tvController = new TvController(
      this.get('tvReadQueryService'),
      this.get('tvSurfaceService')
    );
    this.dependencies.set('tvController', tvController);

    const { FootballController } = await import('../presentation/controllers/FootballController');
    const footballController = new FootballController(
      this.get('footballQueryService'),
      this.get('broadcastReconciliationService')
    );
    this.dependencies.set('footballController', footballController);

    const blogController = new BlogController(this.get('cacheRepository'));
    this.dependencies.set('blogController', blogController);
    const { EditorialOpsController } = await import('../presentation/controllers/EditorialOpsController');
    this.dependencies.set('editorialOpsController', new EditorialOpsController(this.get('storageRepository')));

    const analyticsController = new AnalyticsController(this.get('analyticsService'));
    this.dependencies.set('analyticsController', analyticsController);

    const monetizationController = new MonetizationController(this.get('monetizationService'));
    this.dependencies.set('monetizationController', monetizationController);

    const { AffiliateController } = await import('../presentation/controllers/AffiliateController');
    const affiliateController = new AffiliateController(
      this.get('affiliateResolverService'),
      this.get('affiliateCatalogService'),
      this.get('affiliateOfferRepository'),
      this.get('affiliateAnalyticsService')
    );
    this.dependencies.set('affiliateController', affiliateController);

    // Phase 9 — Affiliate / Monetization admin surface (`/v2/admin/affiliate/*`).
    // Additive alongside the read-only public resolver above; owns every write path
    // (merchants/networks/programs/offers/placements) so commercial configuration
    // no longer needs a source-code change.
    const { AffiliateAdminService } = await import('../application/services/AffiliateAdminService');
    const { AffiliateAdminAnalyticsService } = await import('../application/services/AffiliateAdminAnalyticsService');
    const { AffiliateAdminController } = await import('../presentation/controllers/AffiliateAdminController');

    const affiliateAdminService = new AffiliateAdminService(
      this.get('affiliateMerchantRepository'),
      this.get('affiliateNetworkRepository'),
      this.get('affiliateProgramRepository'),
      this.get('affiliateOfferRepository'),
      this.get('affiliatePlacementRepository'),
      this.get('affiliateAnalyticsService'),
      this.get('cacheRepository')
    );
    const affiliateAdminAnalyticsService = new AffiliateAdminAnalyticsService(
      this.get('analyticsService'),
      this.get('affiliateMerchantRepository'),
      this.get('affiliateOfferRepository')
    );
    const affiliateAdminController = new AffiliateAdminController(affiliateAdminService, affiliateAdminAnalyticsService);
    this.dependencies.set('affiliateAdminController', affiliateAdminController);

    const adminUsersController = new AdminUsersController();
    this.dependencies.set('adminUsersController', adminUsersController);

    const userController = new UserController();
    this.dependencies.set('userController', userController);

    const interactionController = new InteractionController(
      this.get('userContentInteractionRepository')
    );
    this.dependencies.set('interactionController', interactionController);

    const socialController = new SocialController();
    this.dependencies.set('socialController', socialController);

    const chatController = new ChatController();
    this.dependencies.set('chatController', chatController);

    const assistantTelemetry = new AssistantOperationalTelemetryService();
    const aiController = new AIController(
      this.has('chatbotRecommend') ? this.get('chatbotRecommend') : null,
      this.get('cacheRepository'),
      this.get('assistantMemoryService'), assistantTelemetry
    );
    this.dependencies.set('aiController', aiController);

    const { AIAnalyticsService } = await import('../application/services/AIAnalyticsService');
    const { AIAnalyticsController } = await import('../presentation/controllers/AIAnalyticsController');
    const aiAnalyticsService = new AIAnalyticsService(this.get('cacheRepository'));
    this.dependencies.set('aiAnalyticsService', aiAnalyticsService);
    const aiAnalyticsController = new AIAnalyticsController(aiAnalyticsService, assistantTelemetry);
    this.dependencies.set('aiAnalyticsController', aiAnalyticsController);

    const { SitemapController } = await import('../presentation/controllers/SitemapController');
    const sitemapController = new SitemapController(
      this.get('channelRepository'),
      this.get('programRepository'),
      this.has('tmdbService') ? this.get('tmdbService') : undefined,
      this.has('footballQueryService') ? this.get('footballQueryService') : undefined,
      this.get('tvReadQueryService'),
      (slug) => this.get<{ programSlugDisposition(slug: string): Promise<ProgrammeDisposition | null> }>('catalogService').programSlugDisposition(slug),
      async () => (await import('../application/services/WorkSeoPolicy')).indexableWorkPaths(),
      this.get('channelFeedAliases')
    );
    this.dependencies.set('sitemapController', sitemapController);

    logger.info('Controllers registered');
  }

  get<T>(key: string): T {
    const dependency = this.dependencies.get(key);

    if (!dependency) {
      throw new Error(`Dependency '${key}' not found in container`);
    }

    return dependency as T;
  }

  has(key: string): boolean {
    return this.dependencies.has(key);
  }

  async cleanup(): Promise<void> {
    logger.info('Cleaning up container...');

    const cache = this.dependencies.get('cacheRepository');
    if (cache && typeof (cache as any).disconnect === 'function') {
      try {
        await (cache as any).disconnect();
      } catch (e) {
        logger.warn('Error while disconnecting cache', { error: e });
      }
    }

    if (cache && typeof (cache as any).destroy === 'function') {
      try {
        (cache as any).destroy();
      } catch (e) {
        logger.warn('Error while destroying cache', { error: e });
      }
    }

    this.dependencies.clear();
    this.initialized = false;

    logger.info('Container cleaned up');
  }
}

export function createContainer(): Container {
  return Container.getInstance();
}
