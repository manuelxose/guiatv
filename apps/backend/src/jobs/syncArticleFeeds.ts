import {
  ArticleFeedProvider,
  AUCTORIO_BASE_URL,
  BABYLOVEGROWTH_BASE_URL,
  SyndicatedArticlesClient,
} from '../infrastructure/external/SyndicatedArticlesClient';
import { ArticleFeedSyncStats, syncArticleFeed } from '../application/services/SyndicatedArticlesSyncService';
import { logger } from '../shared/utils/logger';

const log = logger.child('ArticleFeedJob');

export interface ArticleFeedSource {
  provider: ArticleFeedProvider;
  baseUrl: string;
  apiKey: string;
  /** Extra query parameters on every request (Auctorio scopes its feed with the destination site key). */
  defaults?: Record<string, string>;
}

/**
 * The feeds this deployment pulls from. An unset key means that feed is skipped, so GuíaTV can run with either
 * producer, both, or neither without a code change.
 */
export function configuredArticleFeeds(env: NodeJS.ProcessEnv = process.env): ArticleFeedSource[] {
  const feeds: ArticleFeedSource[] = [];

  const babyLoveGrowthKey = String(env.BABYLOVEGROWTH_API_KEY || '').trim();
  if (babyLoveGrowthKey) {
    feeds.push({
      provider: 'babylovegrowth',
      apiKey: babyLoveGrowthKey,
      baseUrl: String(env.BABYLOVEGROWTH_BASE_URL || BABYLOVEGROWTH_BASE_URL).trim(),
    });
  }

  const auctorioKey = String(env.AUCTORIO_FEED_API_KEY || '').trim();
  if (auctorioKey) {
    const site = String(env.AUCTORIO_FEED_SITE || '').trim();
    feeds.push({
      provider: 'auctorio',
      apiKey: auctorioKey,
      baseUrl: String(env.AUCTORIO_FEED_BASE_URL || AUCTORIO_BASE_URL).trim(),
      ...(site ? { defaults: { site } } : {}),
    });
  }

  return feeds;
}

export interface SyncArticleFeedsJobOptions {
  /** Clears the API's public editorial caches; the cron passes the running container's, so new guides show up now. */
  invalidateEditorialReads?: () => Promise<void>;
  env?: NodeJS.ProcessEnv;
}

export async function syncArticleFeedsJob(options: SyncArticleFeedsJobOptions = {}): Promise<ArticleFeedSyncStats[]> {
  const feeds = configuredArticleFeeds(options.env);
  if (!feeds.length) {
    log.info('No article feed configured (BABYLOVEGROWTH_API_KEY / AUCTORIO_FEED_API_KEY): sync skipped');
    return [];
  }

  const results: ArticleFeedSyncStats[] = [];
  for (const feed of feeds) {
    try {
      const stats = await syncArticleFeed({
        client: new SyndicatedArticlesClient({ apiKey: feed.apiKey, baseUrl: feed.baseUrl, defaults: feed.defaults }),
        provider: feed.provider,
      });
      log.info('Article feed synced', { ...stats });
      for (const error of stats.errors) log.warn(error);
      results.push(stats);
    } catch (error) {
      // One producer being down must not stop the other from publishing.
      log.warn('Article feed could not be synced', { provider: feed.provider, error: String(error) });
    }
  }

  if (results.some((stats) => stats.created + stats.updated > 0) && options.invalidateEditorialReads) {
    try {
      await options.invalidateEditorialReads();
    } catch (error) {
      log.warn('Published editorial caches could not be invalidated', { error: String(error) });
    }
  }

  return results;
}
