import { createHash } from 'node:crypto';
import { BlogPostModel } from '../../infrastructure/database/models/BlogPost.model';
import {
  ArticleFeedProvider,
  SYNDICATED_MAX_PAGE,
  SyndicatedArticle,
  SyndicatedArticlesClient,
} from '../../infrastructure/external/SyndicatedArticlesClient';
import { canonicalizeInternalLinks } from './EditorialReviewPolicy';
import { isRetiredEditorialSlug } from './RetiredEditorialSlugs';
import { logger } from '../../shared/utils/logger';

/**
 * Syncs an article feed (BabyLoveGrowth, Auctorio) into the CMS, keyed by `slug`. Run on a schedule
 * (`jobs/index.ts`) and by `npm run job:sync-blog`: the article pages are then served from Mongo, never from the
 * rate-limited API.
 *
 * Articles publish as soon as they arrive (`reviewState: approved`, reviewer `policy:<provider>`), which is what
 * makes "new article at the producer" become "public guide" without a human in the loop. A post that a person
 * unpublishes or rejects is left alone on the next run.
 */

export const FEED_PROVIDER_LABELS: Record<ArticleFeedProvider, string> = {
  babylovegrowth: 'BabyLoveGrowth',
  auctorio: 'Auctorio',
};

export interface ArticleFeedSyncStats {
  provider: ArticleFeedProvider;
  scanned: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface ArticleFeedSyncOptions {
  client: SyndicatedArticlesClient;
  provider: ArticleFeedProvider;
  /** Article pages per list request (the feeds cap it at 50). */
  pageSize?: number;
  /** Safety net for a paginated endpoint that never returns a short page. */
  maxPages?: number;
  now?: () => Date;
}

const MAX_REPORTED_ERRORS = 20;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const dateOf = (value: unknown): Date | undefined => {
  const raw = text(value);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};
const visibleText = (html: string): string =>
  html.replace(/<[^>]+>/g, ' ').replace(/&[a-z0-9#]+;/gi, ' ').replace(/\s+/g, ' ').trim();

/** `excerpt` is required by the cards and the editorial gates; the feed only ships a meta description. */
const excerptOf = (metaDescription: string, contentHtml: string): string => {
  if (metaDescription) return metaDescription;
  const plain = visibleText(contentHtml);
  return plain.length > 200 ? `${plain.slice(0, 200).replace(/\s+\S*$/, '')}…` : plain;
};

const schemaEntries = (value: unknown): Record<string, unknown>[] => {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
};

const faqItemsFrom = (faqJsonLd: unknown): Array<{ question: string; answer: string }> =>
  schemaEntries(faqJsonLd)
    .flatMap((schema) => (Array.isArray(schema.mainEntity) ? schema.mainEntity : []))
    .map((entity) => {
      const row = entity as { name?: unknown; acceptedAnswer?: { text?: unknown } };
      return { question: text(row.name), answer: text(row.acceptedAnswer?.text) };
    })
    .filter((item) => item.question && item.answer);

const authorFrom = (jsonLd: unknown, provider: ArticleFeedProvider): { name: string; id: string } | undefined => {
  for (const schema of schemaEntries(jsonLd)) {
    const author = Array.isArray(schema.author) ? schema.author[0] : schema.author;
    const name = typeof author === 'string' ? author : text((author as { name?: unknown } | undefined)?.name);
    if (name) return { name, id: provider };
  }
  return undefined;
};

export interface MappedFeedArticle {
  slug: string;
  fields: Record<string, unknown>;
  sourceHash: string;
}

export type FeedArticleMapping = ({ ok: true } & MappedFeedArticle) | { ok: false; reason: string };

/** Pure mapping, so the field contract with each feed is testable without HTTP or Mongo. */
export function mapSyndicatedArticle(
  article: SyndicatedArticle,
  now: Date,
  provider: ArticleFeedProvider
): FeedArticleMapping {
  const slug = text(article.slug).toLowerCase();
  const title = text(article.title);
  const contentHtml = text(article.content_html);
  if (!slug) return { ok: false, reason: 'sin slug' };
  if (!title) return { ok: false, reason: 'sin título' };
  if (!contentHtml) return { ok: false, reason: 'sin content_html' };

  const metaDescription = text(article.meta_description);
  const heroImage = text(article.hero_image_url);
  const language = text(article.languageCode) || undefined;
  const publishedUrl = text(article.published_url) || undefined;
  const publishedAt = dateOf(article.publishedAt);
  const content = canonicalizeInternalLinks(contentHtml);
  const faqItems = faqItemsFrom(article.faqJsonLd);
  const structuredData = {
    ...(article.jsonLd ? { jsonLd: article.jsonLd } : {}),
    ...(article.faqJsonLd ? { faqJsonLd: article.faqJsonLd } : {}),
  };
  const sourceHash = createHash('sha256')
    .update(
      JSON.stringify({
        provider,
        title,
        content,
        metaDescription,
        heroImage,
        language: language ?? '',
        publishedAt: publishedAt?.toISOString() ?? '',
        publishedUrl: publishedUrl ?? '',
        structuredData,
      })
    )
    .digest('hex');

  return {
    ok: true,
    slug,
    sourceHash,
    fields: {
      title,
      slug,
      status: 'publish',
      reviewState: 'approved',
      reviewedBy: `policy:${provider}`,
      reviewedAt: publishedAt ?? now,
      origin: 'automated-import',
      excerpt: excerptOf(metaDescription, content),
      content,
      contentType: 'guide',
      featuredImage: { sourceUrl: heroImage || undefined, alt: title },
      ...(faqItems.length ? { faqItems } : {}),
      ...(Object.keys(structuredData).length ? { structuredData } : {}),
      ...(language ? { language } : {}),
      seo: { metaDescription: metaDescription || undefined, ogImage: heroImage || undefined },
      ...(publishedAt ? { publishedAt } : {}),
      author: authorFrom(article.jsonLd, provider) ?? { name: FEED_PROVIDER_LABELS[provider], id: provider },
      external: {
        provider,
        articleId: article.id,
        languageCode: language,
        publishedUrl,
        contentMarkdown: text(article.content_markdown) || undefined,
        sourceHash,
        syncedAt: now,
      },
    },
  };
}

export type SyncDecision = 'create' | 'update' | 'unchanged' | 'keep-native' | 'keep-rejected';

export interface StoredSyncState {
  reviewState?: string;
  external?: { provider?: string; sourceHash?: string };
}

/**
 * What a run may do with a slug that is already in the CMS. A native guide owns its slug, a post written by
 * another producer is not ours to rewrite, and a post a person rejected stays rejected: the sync overwrites only
 * what it wrote itself and nobody has withdrawn.
 */
export function syncDecisionFor(
  existing: StoredSyncState | null,
  mapped: MappedFeedArticle,
  provider: ArticleFeedProvider
): SyncDecision {
  if (!existing) return 'create';
  if (existing.external?.provider !== provider) return 'keep-native';
  if (existing.reviewState === 'rejected') return 'keep-rejected';
  return existing.external.sourceHash === mapped.sourceHash ? 'unchanged' : 'update';
}

const report = (stats: ArticleFeedSyncStats, message: string): void => {
  if (stats.errors.length < MAX_REPORTED_ERRORS) stats.errors.push(message);
};

async function upsertArticle(
  mapped: MappedFeedArticle,
  provider: ArticleFeedProvider,
  stats: ArticleFeedSyncStats
): Promise<void> {
  const existing = await BlogPostModel.findOne({ slug: mapped.slug })
    .select({ status: 1, reviewState: 1, origin: 1, 'external.provider': 1, 'external.sourceHash': 1 })
    .lean()
    .exec();

  switch (syncDecisionFor(existing as StoredSyncState | null, mapped, provider)) {
    case 'keep-native':
      stats.skipped++;
      report(stats, `${mapped.slug}: el slug ya existe y no lo gestiona esta fuente`);
      return;
    case 'keep-rejected':
      stats.skipped++;
      report(stats, `${mapped.slug}: retirado por revisión editorial`);
      return;
    case 'unchanged':
      stats.unchanged++;
      return;
  }

  const result = await BlogPostModel.updateOne({ slug: mapped.slug }, { $set: mapped.fields }, { upsert: true }).exec();
  if (result.upsertedCount) stats.created++;
  else stats.updated++;
}

export async function syncArticleFeed(options: ArticleFeedSyncOptions): Promise<ArticleFeedSyncStats> {
  const pageSize = Math.min(options.pageSize ?? SYNDICATED_MAX_PAGE, SYNDICATED_MAX_PAGE);
  const maxPages = options.maxPages ?? 200;
  const now = options.now ?? (() => new Date());
  const log = logger.child('ArticleFeedSync');
  const stats: ArticleFeedSyncStats = {
    provider: options.provider,
    scanned: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (let page = 0; page < maxPages; page++) {
    const summaries = await options.client.listArticles(pageSize, page * pageSize);
    if (!summaries.length) break;

    for (const summary of summaries) {
      stats.scanned++;
      try {
        // The list ships summaries; the full body only comes from the detail endpoint.
        const detail = await options.client.getArticle(summary.id);
        const mapped = mapSyndicatedArticle({ ...summary, ...detail }, now(), options.provider);
        if (!mapped.ok) {
          stats.skipped++;
          report(stats, `${summary.id}: ${mapped.reason}`);
          continue;
        }
        // The site 301s retired slugs to a canonical guide: the article is already there under its real URL.
        if (isRetiredEditorialSlug(mapped.slug)) {
          stats.skipped++;
          report(stats, `${mapped.slug}: el slug está retirado en el sitio (redirige a una guía canónica)`);
          continue;
        }
        await upsertArticle(mapped, options.provider, stats);
      } catch (error) {
        stats.failed++;
        report(stats, `${summary.id}: ${error instanceof Error ? error.message : String(error)}`);
        log.warn('Article could not be synced', { provider: options.provider, id: summary.id, error: String(error) });
      }
    }

    if (summaries.length < pageSize) break;
  }

  return stats;
}
