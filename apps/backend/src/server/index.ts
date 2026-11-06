// Shared bootstrap: sets TZ=Europe/Madrid and loads env vars.
// Must be the very first import.
import '../config/bootstrap';

import { createServer } from 'http';
import { createApp as createRoutesApp } from '../presentation/routes/app';
import { config, validateConfig } from './config';
import { createContainer } from '../config/container';
import { logger } from '../shared/utils/logger';
import { ChatSocketHub } from '../presentation/realtime/ChatSocketHub';
import { createShutdown } from './shutdown';
import { startEventLoopDiagnostics } from '../shared/utils/eventLoopDiagnostics';
import { startStartupCpuProfile } from '../shared/utils/cpuProfile';
import { recordElapsedStep, timeStep, timeStepSync } from '../shared/utils/stepTimeline';
import { performance } from 'node:perf_hooks';

/**
 * Entry point for the standalone Express server.
 */
async function startServer() {
  try {
    // M13-B1: diagnostics first, so a start-up stall is already inside the monitored window. Both are bounded; the CPU
    // profile is off unless DIAG_CPU_PROFILE=startup and DIAG_CPU_PROFILE_DIR are set.
    try {
      recordElapsedStep('boot.modules_loaded', performance.now());
      startEventLoopDiagnostics();
      startStartupCpuProfile();
    } catch (error) {
      logger.warn('Diagnostics could not start', { reason: (error as Error).name });
    }
    logger.info('Starting Express server', { env: config.nodeEnv, port: config.port });

    timeStepSync('boot.validate_config', () => validateConfig());

    const container = timeStepSync('boot.create_container', () => createContainer());
    await timeStep('boot.container_initialize', () => container.initialize());
    logger.info('Container initialized');
    // M10-C: load the channel feed-alias list now, so the first pages after a restart already redirect and hide
    // aliases (requests never wait for it; a failure is logged and retried after a minute).
    timeStepSync('boot.channel_alias_kickoff', () => container.get<{ current(date?: string): unknown }>('channelFeedAliases').current('today'));

    const app = timeStepSync('boot.create_routes_app', () => createRoutesApp({
      adminController: container.get('adminController'),
      adminUsersController: container.get('adminUsersController'),
      authController: container.get('authController'),
      authService: container.get('authService'),
      discoveryController: container.get('discoveryController'),
      contentController: container.get('contentController'),
      catalogController: container.get('catalogController'),
      tvController: container.get('tvController'),
      footballController: container.get('footballController'),
      footballOpsController: container.get('footballOpsController'),
      blogController: container.get('blogController'),
      editorialOpsController: container.get('editorialOpsController'),
      analyticsController: container.get('analyticsController'),
      monetizationController: container.get('monetizationController'),
      affiliateController: container.get('affiliateController'),
      affiliateAdminController: container.get('affiliateAdminController'),
      userController: container.get('userController'),
      interactionController: container.get('interactionController'),
      socialController: container.get('socialController'),
      chatController: container.get('chatController'),
      aiController: container.get('aiController'),
      aiAnalyticsController: container.get('aiAnalyticsController'),
      editorialAIAssistantController: container.get('editorialAIAssistantController'),
      sitemapController: container.get('sitemapController'),
    }));

    if (process.env.DISABLE_SCHEDULED_JOBS !== 'true') {
      const { initializeJobs } = await timeStep('boot.import_jobs', () => import('../jobs'));
      const operations = container.get<any>('adminOperationsService');
      timeStepSync('boot.initialize_jobs', () => initializeJobs({
        track: (type, by, task) => operations.enqueue(type, by, task),
        // minMs: the per-minute refresh is only stored when it is slow; the first run (set at boot) always is.
        refreshFootballHome: () => timeStep('background.football_home_refresh', () => container.get<any>('footballQueryService').getHome(), { minMs: 50 }),
      }));

      // M05 football ingestion: create its indexes once, then start the adaptive loop.
      // A failure here must never stop the server from serving TV data, so it is logged
      // and retried by the loop's own backoff rather than thrown.
      try {
        const { createFootballIndexes } = await timeStep('boot.import_football_indexes', () =>
          import('../infrastructure/sports/persistence/createFootballIndexes')
        );
        await timeStep('boot.football_indexes', () => createFootballIndexes());
      } catch (error) {
        logger.warn('Football ingestion indexes could not be created; ingestion will retry', { error: String(error) });
      }
      const { startFootballIngestionLoop } = await timeStep('boot.import_football_loop', () =>
        import('../jobs/football/footballIngestionLoop')
      );
      const footballLoop = startFootballIngestionLoop({ runOnStart: true });
      const shutdownFootballLoop = () => footballLoop.stop();
      process.once('SIGTERM', shutdownFootballLoop);
      process.once('SIGINT', shutdownFootballLoop);
    }

    const httpServer = createServer(app);

    // Realtime wiring. Single-instance defaults keep in-memory presence and
    // the local adapter. Set REALTIME_PRESENCE=redis and/or
    // REALTIME_ADAPTER=redis (with VALKEY_URL/REDIS_URL) when running more
    // than one backend instance.
    const realtimePresence = process.env.REALTIME_PRESENCE;
    const realtimeAdapter = process.env.REALTIME_ADAPTER;
    const redisUrl =
      process.env.VALKEY_URL || process.env.REDIS_URL || '';

    const hubDeps: {
      presenceStore?: import('../presentation/realtime/PresenceStore').PresenceStore;
      useRedisAdapter?: boolean;
      redisUrl?: string;
    } = {
      useRedisAdapter: realtimeAdapter === 'redis',
      redisUrl,
    };

    if (realtimePresence === 'redis' && redisUrl) {
      try {
        const { RedisPresenceStore } = await import(
          '../presentation/realtime/RedisPresenceStore'
        );
        const store = new RedisPresenceStore(redisUrl);
        await store.connect();
        hubDeps.presenceStore = store;
        logger.info('Realtime presence store: redis');
      } catch (error) {
        logger.error(
          'Failed to initialize Redis presence store, falling back to in-memory',
          { error }
        );
      }
    }

    await timeStep('boot.chat_socket_hub', () => ChatSocketHub.getInstance().initialize(
      httpServer,
      container.get('authService'),
      hubDeps
    ));

    const server = httpServer.listen(config.port, () => {
      logger.info(`Server listening on http://localhost:${config.port}`);
      timeStepSync('boot.listening', () => undefined);
      // M10-B: read the related-works set once in the background, so no work page waits for that catalogue scan.
      void import('../application/services/RelatedWorks').then(({ relatedWorkIndex }) => relatedWorkIndex.warm());
    });

    const shutdown = createShutdown({
      server,
      closeRealtime: () => ChatSocketHub.getInstance().close(),
      cleanup: () => container.cleanup(),
      exit: (code) => {
        if (code !== 0) logger.error('Forcefully exiting after timeout');
        process.exit(code);
      },
      warn: (message, meta) => logger.warn(message, meta as Record<string, unknown>),
    });

    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.on(signal, () => {
        logger.warn(`${signal} received, shutting down HTTP server`);
        void shutdown();
      });
    }
  } catch (error) {
    logger.error('Fatal error while starting server', { error });
    process.exit(1);
  }
}

startServer();
