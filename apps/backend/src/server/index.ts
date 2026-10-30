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

/**
 * Entry point for the standalone Express server.
 */
async function startServer() {
  try {
    logger.info('Starting Express server', { env: config.nodeEnv, port: config.port });

    validateConfig();

    const container = createContainer();
    await container.initialize();
    logger.info('Container initialized');
    // M10-C: load the channel feed-alias list now, so the first pages after a restart already redirect and hide
    // aliases (requests never wait for it; a failure is logged and retried after a minute).
    container.get<{ current(date?: string): unknown }>('channelFeedAliases').current('today');

    const app = createRoutesApp({
      adminController: container.get('adminController'),
      adminUsersController: container.get('adminUsersController'),
      authController: container.get('authController'),
      authService: container.get('authService'),
      discoveryController: container.get('discoveryController'),
      contentController: container.get('contentController'),
      catalogController: container.get('catalogController'),
      tvController: container.get('tvController'),
      footballController: container.get('footballController'),
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
    });

    if (process.env.DISABLE_SCHEDULED_JOBS !== 'true') {
      const { initializeJobs } = await import('../jobs');
      initializeJobs({
        refreshFootballHome: () => container.get<any>('footballQueryService').getHome(),
      });
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

    await ChatSocketHub.getInstance().initialize(
      httpServer,
      container.get('authService'),
      hubDeps
    );

    const server = httpServer.listen(config.port, () => {
      logger.info(`Server listening on http://localhost:${config.port}`);
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
