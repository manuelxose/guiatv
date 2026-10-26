import { Request, Response, NextFunction } from 'express';
import {
  BlogAffiliatePlacementMode,
  BlogContentType,
  BlogPostModel,
  IBlogFaqItem,
  IBlogPostCategory,
  IBlogPostDocument,
} from '../../infrastructure/database/models/BlogPost.model';
import {
  normalizeAffiliatePlacementMode,
  normalizeLowercaseKeys,
  normalizeOfferIds,
} from '../../shared/utils/blogAffiliateFields';
import { CATALOG_PLATFORM_REGISTRY } from '../../application/dto/CatalogDTO';
import { successResponse } from '../../shared/types/ApiResponse';
import { ICacheRepository } from '../../domain/repositories/ICacheRepository';
import { StaleWhileRevalidateCache } from '../../infrastructure/cache/StaleWhileRevalidateCache';
import { measureTiming } from '../../shared/utils/performanceTiming';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors';
import {
  buildEditorialApproval,
  canonicalizeInternalLinks,
  editorialGateFailures,
  EditorialOrigin,
  evaluateEditorialQuality,
  PUBLIC_EDITORIAL_FILTER,
} from '../../application/services/EditorialReviewPolicy';

interface BlogWritePayload {
  title?: string;
  slug?: string;
  status?: string;
  excerpt?: string;
  content?: string;
  categories?: string[] | string;
  contentType?: string;
  featured?: boolean | string;
  primaryIntent?: string;
  targetQuery?: string;
  relatedPlatformKeys?: string[] | string;
  relatedRouteKeys?: string[] | string;
  sportsRelations?: {
    teamIds?: string[] | string;
    competitionIds?: string[] | string;
    matchIds?: string[] | string;
  };
  faqItems?: Array<{ question?: string; answer?: string }> | string;
  evergreen?: boolean | string;
  affiliatePlacementMode?: string;
  relatedOfferCategories?: string[] | string;
  relatedMerchantKeys?: string[] | string;
  manualAffiliateOfferIds?: string[] | string;
  coverImage?: string;
  featuredImage?: string;
  metaTitle?: string;
  metaDescription?: string;
  keywords?: string[] | string;
  ogImage?: string;
  canonicalUrl?: string;
  publishedAt?: string;
  authorName?: string;
  authorId?: string;
  origin?: EditorialOrigin;
}

const CONTENT_TYPES: ReadonlySet<BlogContentType> = new Set([
  'guide',
  'ranking',
  'trend',
  'news',
  'analysis',
  'preview',
  'match-report',
]);
const RELATED_ROUTE_KEYS = new Set([
  'platforms',
  'guide',
  'explore',
  'stats',
  'comparison',
]);
const RELATED_PLATFORM_KEYS = new Set(
  CATALOG_PLATFORM_REGISTRY.map((platform) => platform.key)
);

interface NormalizedBlogPayload {
  title: string;
  slug: string;
  status: 'draft' | 'publish';
  origin: EditorialOrigin;
  excerpt?: string;
  content?: string;
  categories: IBlogPostCategory[];
  contentType: BlogContentType;
  featured: boolean;
  primaryIntent?: string;
  targetQuery?: string;
  relatedPlatformKeys: string[];
  relatedRouteKeys: string[];
  sportsRelations?: {
    teamIds: string[];
    competitionIds: string[];
    matchIds: string[];
  };
  faqItems: IBlogFaqItem[];
  evergreen: boolean;
  affiliatePlacementMode: BlogAffiliatePlacementMode;
  relatedOfferCategories: string[];
  relatedMerchantKeys: string[];
  manualAffiliateOfferIds: string[];
  featuredImage?: {
    sourceUrl?: string;
    caption?: string;
  };
  seo: {
    metaTitle?: string;
    metaDescription?: string;
    keywords?: string[];
    ogImage?: string;
    canonicalUrl?: string;
  };
  publishedAt?: Date;
  author?: { name?: string; id?: string };
}

const BLOG_LIST_PROJECTION = {
  title: 1,
  slug: 1,
  status: 1,
  origin: 1,
  reviewState: 1,
  excerpt: 1,
  categories: 1,
  contentType: 1,
  featured: 1,
  featuredImage: 1,
  author: 1,
  publishedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  'seo.metaTitle': 1,
  'seo.metaDescription': 1,
  'seo.ogImage': 1,
} as const;

/**
 * Blog controller that serves posts from MongoDB with a WordPress-like shape.
 */
export class BlogController {
  private readonly cache: StaleWhileRevalidateCache;

  constructor(cacheRepository?: ICacheRepository) {
    this.cache = new StaleWhileRevalidateCache(cacheRepository);
  }

  public getPosts = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const {
        slug,
        limit,
        status,
        categories,
        categorySlug,
        search,
        contentType,
        featured,
      } = req.query;
      const filters: Record<string, any> = {};
      const limitValue = this.parseNumber(limit, 50);
      const isAdminRequest = this.isAdminRequest(req);

      if (slug && typeof slug === 'string') {
        filters.slug = slug;
      }

      if (status && typeof status === 'string') {
        if (status === 'all') {
          if (!isAdminRequest) {
            throw new ForbiddenError('Admin access required to list all editorial posts');
          }
        } else if (status === 'draft') {
          if (!isAdminRequest) {
            throw new ForbiddenError('Admin access required to list draft editorial posts');
          }
          filters.status = 'draft';
        } else if (status === 'publish') {
          filters.status = 'publish';
        } else {
          throw new ValidationError('Invalid status', [
            { field: 'status', message: 'Expected all, draft or publish', value: status },
          ]);
        }
      } else {
        filters.status = 'publish';
      }
      if (!isAdminRequest) filters.reviewState = 'approved';

      if (categories && typeof categories === 'string') {
        const ids = categories
          .split(',')
          .map((value) => Number(value.trim()))
          .filter((value) => Number.isFinite(value));
        if (ids.length) {
          filters['categories.id'] = { $in: ids };
        }
      }

      if (categorySlug && typeof categorySlug === 'string') {
        const slugs = categorySlug
          .split(',')
          .map((value) => this.slugify(value))
          .filter(Boolean);
        if (slugs.length) {
          filters['categories.slug'] = { $in: slugs };
        }
      }

      if (contentType && typeof contentType === 'string') {
        const normalizedType = String(contentType).trim().toLowerCase() as BlogContentType;
        if (!CONTENT_TYPES.has(normalizedType)) {
          throw new ValidationError('Invalid contentType', [
            {
              field: 'contentType',
              message: 'Expected guide, ranking, trend, news, analysis, preview or match-report',
              value: contentType,
            },
          ]);
        }
        filters.contentType = normalizedType;
      }

      if (typeof featured === 'string') {
        const parsed = this.parseOptionalBoolean(featured);
        if (parsed == null) {
          throw new ValidationError('Invalid featured flag', [
            { field: 'featured', message: 'Expected true or false', value: featured },
          ]);
        }
        filters.featured = parsed;
      }

      if (search && typeof search === 'string' && search.trim()) {
        filters.$text = { $search: search.trim() };
      }

      const includeDetailFields = Boolean(filters.slug) || isAdminRequest;
      const query = BlogPostModel.find(filters)
        .sort({ featured: -1, publishedAt: -1, createdAt: -1 })
        .limit(limitValue);

      if (!includeDetailFields) {
        query.select(BLOG_LIST_PROJECTION);
      }

      const cacheKey = `v2:editorial:${filters.slug
        ? `detail:${encodeURIComponent(String(filters.slug))}`
        : `list:${stableQueryKey(req.query)}`}`;
      const posts = isAdminRequest
        ? await measureTiming('db', () => query.lean().exec())
        : await this.cache.getOrLoad(
            cacheKey,
            filters.slug
              ? { freshSeconds: 15 * 60, staleSeconds: 60 * 60 }
              : { freshSeconds: 5 * 60, staleSeconds: 30 * 60 },
            () => measureTiming('db', () => query.lean().exec())
          );

      res.json(posts.map((post) => includeDetailFields ? this.mapPost(post) : this.mapPostListItem(post)));
    } catch (error) {
      next(error);
    }
  };

  public createPost = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const payload = req.body as BlogWritePayload;
      const normalized = this.normalizePayload(payload);
      if (normalized.status === 'publish') {
        throw new ValidationError('Direct publication is disabled', [
          { field: 'status', message: 'Save as draft, then use the editorial approval endpoint', value: payload.status },
        ]);
      }
      await this.assertUniqueSlug(normalized.slug);

      const created = await BlogPostModel.create({
        ...normalized,
        status: 'draft',
        reviewState: 'unreviewed',
      });
      await this.invalidatePublicReads();

      res.status(201).json(
        successResponse({
          post: this.mapPost(created.toObject()),
        })
      );
    } catch (error) {
      next(error);
    }
  };

  public updatePost = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const postId = String(req.params.id || '').trim();
      if (!postId) {
        throw new ValidationError('Post id is required', [
          { field: 'id', message: 'Required', value: postId },
        ]);
      }

      const existing = await BlogPostModel.findById(postId).exec();
      if (!existing) {
        throw new NotFoundError('Editorial post not found');
      }

      const payload = req.body as BlogWritePayload;
      const normalized = this.normalizePayload(payload, existing);
      if (normalized.status === 'publish') {
        throw new ValidationError('Direct publication is disabled', [
          { field: 'status', message: 'Save as draft, then use the editorial approval endpoint', value: payload.status },
        ]);
      }
      await this.assertUniqueSlug(normalized.slug, postId);

      existing.title = normalized.title;
      existing.slug = normalized.slug;
      existing.status = 'draft';
      existing.reviewState = 'unreviewed';
      existing.reviewedBy = undefined;
      existing.reviewedAt = undefined;
      existing.reviewNotes = undefined;
      existing.origin = normalized.origin;
      existing.excerpt = normalized.excerpt;
      existing.content = normalized.content;
      existing.categories = normalized.categories;
      existing.contentType = normalized.contentType;
      existing.featured = normalized.featured;
      existing.primaryIntent = normalized.primaryIntent;
      existing.targetQuery = normalized.targetQuery;
      existing.relatedPlatformKeys = normalized.relatedPlatformKeys;
      existing.relatedRouteKeys = normalized.relatedRouteKeys;
      existing.sportsRelations = normalized.sportsRelations;
      existing.faqItems = normalized.faqItems;
      existing.evergreen = normalized.evergreen;
      existing.affiliatePlacementMode = normalized.affiliatePlacementMode;
      existing.relatedOfferCategories = normalized.relatedOfferCategories;
      existing.relatedMerchantKeys = normalized.relatedMerchantKeys;
      existing.manualAffiliateOfferIds = normalized.manualAffiliateOfferIds;
      existing.featuredImage = normalized.featuredImage;
      existing.seo = normalized.seo;
      existing.publishedAt = normalized.publishedAt;
      existing.author = normalized.author;

      await existing.save();
      await this.invalidatePublicReads();

      res.status(200).json(
        successResponse({
          post: this.mapPost(existing.toObject()),
        })
      );
    } catch (error) {
      next(error);
    }
  };

  public approvePost = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const postId = String(req.params.id || '').trim();
      const reviewer = String(req.header('x-editorial-reviewer') || req.body?.reviewer || '').trim();
      const post = await BlogPostModel.findById(postId).exec();
      if (!post) throw new NotFoundError('Editorial post not found');

      let approval;
      try {
        approval = buildEditorialApproval(post.toObject(), reviewer);
      } catch (error) {
        throw new ValidationError('Editorial quality gate failed', [
          { field: 'review', message: error instanceof Error ? error.message : 'Approval rejected', value: postId },
        ]);
      }

      const others = await BlogPostModel.find({ ...PUBLIC_EDITORIAL_FILTER, _id: { $ne: post._id } })
        .select({ slug: 1, content: 1 })
        .lean()
        .exec();
      const findings = evaluateEditorialQuality(post.toObject(), {
        others: others.map((other) => ({ slug: String(other.slug), content: other.content })),
      });
      const acknowledged = ([] as unknown[]).concat(req.body?.acknowledge ?? []).map(String);
      const failures = editorialGateFailures(findings, acknowledged);
      if (failures.length) {
        throw new ValidationError(
          'Editorial quality gate failed',
          failures.map((f) => ({
            field: f.severity === 'human' ? `acknowledge:${f.code}` : f.code,
            message: f.message,
            value: postId,
          }))
        );
      }

      post.status = approval.status;
      post.reviewState = approval.reviewState;
      post.reviewedBy = approval.reviewedBy;
      post.reviewedAt = approval.reviewedAt;
      post.publishedAt = approval.publishedAt;
      post.reviewNotes = String(req.body?.notes || '').trim() || undefined;
      await post.save();
      await this.invalidatePublicReads();

      res.status(200).json(successResponse({ post: this.mapPost(post.toObject()), qualityFindings: findings }));
    } catch (error) {
      next(error);
    }
  };

  public deletePost = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const postId = String(req.params.id || '').trim();
      if (!postId) {
        throw new ValidationError('Post id is required', [
          { field: 'id', message: 'Required', value: postId },
        ]);
      }

      const deleted = await BlogPostModel.findByIdAndDelete(postId).lean().exec();
      if (!deleted) {
        throw new NotFoundError('Editorial post not found');
      }
      await this.invalidatePublicReads();

      res.status(200).json(
        successResponse({
          deleted: true,
          id: postId,
        })
      );
    } catch (error) {
      next(error);
    }
  };

  public getCategories = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const isAdminRequest = this.isAdminRequest(req);
      const match = isAdminRequest ? {} : PUBLIC_EDITORIAL_FILTER;
      const loadCategories = () => BlogPostModel.aggregate<{
        _id: number;
        count: number;
        name: string;
        slug: string;
      }>([
        { $match: match },
        { $unwind: '$categories' },
        {
          $group: {
            _id: '$categories.id',
            count: { $sum: 1 },
            name: { $first: '$categories.name' },
            slug: { $first: '$categories.slug' },
          },
        },
        { $sort: { count: -1, name: 1 } },
      ]).exec();
      const categories = isAdminRequest
        ? await measureTiming('db', loadCategories)
        : await this.cache.getOrLoad('v2:editorial:categories', {
            freshSeconds: 30 * 60,
            staleSeconds: 6 * 60 * 60,
          }, () => measureTiming('db', loadCategories));

      res.json(categories.map((category) => ({
        id: category._id,
        count: category.count,
        description: '',
        link: `/guias/categoria/${category.slug}`,
        name: category.name,
        slug: category.slug,
        taxonomy: 'category',
        parent: 0,
        meta: [],
      })));
    } catch (error) {
      next(error);
    }
  };

  private mapPost(post: any): any {
    return {
      id: String(post._id || post.id),
      date: post.publishedAt || post.createdAt || new Date().toISOString(),
      date_gmt: post.publishedAt || post.createdAt || new Date().toISOString(),
      modified: post.updatedAt || post.modified || new Date().toISOString(),
      modified_gmt: post.updatedAt || post.modified || new Date().toISOString(),
      slug: post.slug,
      status: post.status,
      reviewState: post.reviewState || 'unreviewed',
      origin: post.origin || 'legacy',
      type: 'post',
      link: `/guias/${post.slug}`,
      title: { rendered: post.title },
      content: { rendered: canonicalizeInternalLinks(post.content || '') },
      excerpt: { rendered: post.excerpt || '' },
      categories: (post.categories || []).map((cat: IBlogPostCategory) => cat.id),
      categories_name: post.categories || [],
      featured_image: {
        source_url:
          post.featuredImage?.sourceUrl ||
          post.seo?.ogImage ||
          post.image?.url ||
          '',
        caption: post.featuredImage?.caption || '',
      },
      seo: post.seo,
      contentType: post.contentType || 'guide',
      featured: Boolean(post.featured),
      author: post.author || null,
      // Shown as the byline's reviewer; only an approval made through the human review gate sets it.
      reviewedBy: post.reviewState === 'approved' ? post.reviewedBy || null : null,
      primaryIntent: post.primaryIntent || '',
      targetQuery: post.targetQuery || '',
      relatedPlatformKeys: Array.isArray(post.relatedPlatformKeys)
        ? post.relatedPlatformKeys
        : [],
      relatedRouteKeys: Array.isArray(post.relatedRouteKeys)
        ? post.relatedRouteKeys
        : [],
      sportsRelations: post.sportsRelations || { teamIds: [], competitionIds: [], matchIds: [] },
      faqItems: Array.isArray(post.faqItems) ? post.faqItems : [],
      evergreen: post.evergreen !== false,
      ...this.mapAffiliateFields(post),
    };
  }

  private mapAffiliateFields(post: any): {
    affiliatePlacementMode: BlogAffiliatePlacementMode;
    relatedOfferCategories: string[];
    relatedMerchantKeys: string[];
    manualAffiliateOfferIds: string[];
  } {
    return {
      affiliatePlacementMode: normalizeAffiliatePlacementMode(post.affiliatePlacementMode),
      relatedOfferCategories: Array.isArray(post.relatedOfferCategories) ? post.relatedOfferCategories : [],
      relatedMerchantKeys: Array.isArray(post.relatedMerchantKeys) ? post.relatedMerchantKeys : [],
      manualAffiliateOfferIds: Array.isArray(post.manualAffiliateOfferIds) ? post.manualAffiliateOfferIds : [],
    };
  }

  private mapPostListItem(post: any): any {
    return {
      id: String(post._id || post.id),
      date: post.publishedAt || post.createdAt || new Date().toISOString(),
      date_gmt: post.publishedAt || post.createdAt || new Date().toISOString(),
      modified: post.updatedAt || post.publishedAt || post.createdAt || new Date().toISOString(),
      modified_gmt: post.updatedAt || post.publishedAt || post.createdAt || new Date().toISOString(),
      slug: post.slug,
      status: post.status,
      reviewState: post.reviewState || 'unreviewed',
      origin: post.origin || 'legacy',
      type: 'post',
      link: `/guias/${post.slug}`,
      title: { rendered: post.title },
      excerpt: { rendered: post.excerpt || '' },
      categories: (post.categories || []).map((cat: IBlogPostCategory) => cat.id),
      categories_name: post.categories || [],
      featured_image: {
        source_url: post.featuredImage?.sourceUrl || post.seo?.ogImage || '',
        caption: post.featuredImage?.caption || '',
      },
      seo: post.seo,
      contentType: post.contentType || 'guide',
      featured: Boolean(post.featured),
      author: post.author || null,
      ...this.mapAffiliateFields(post),
    };
  }

  private async invalidatePublicReads(): Promise<void> {
    await Promise.all([
      this.cache.clear('v2:editorial:*'),
      this.cache.clear('v2:football:news:*'),
      this.cache.clear('v2:football:home*'),
    ]);
  }

  private normalizePayload(
    payload: BlogWritePayload,
    existing?: IBlogPostDocument
  ): NormalizedBlogPayload {
    const title = this.resolveRequiredString(payload.title, existing?.title, 'title');
    const slug = this.slugify(payload.slug || title || existing?.slug || '');
    if (!slug) {
      throw new ValidationError('Slug is required', [
        { field: 'slug', message: 'Provide a title or slug', value: payload.slug },
      ]);
    }

    const status = this.normalizeStatus(payload.status, existing?.status);
    const origin = this.normalizeOrigin(payload.origin, existing?.origin);
    const excerpt = this.resolveOptionalString(payload.excerpt, existing?.excerpt);
    const rawContent = this.resolveOptionalString(payload.content, existing?.content);
    const content = rawContent === undefined ? undefined : canonicalizeInternalLinks(rawContent);
    const categories = this.normalizeCategories(payload.categories, existing?.categories);
    const contentType = this.normalizeContentType(payload.contentType, existing?.contentType);
    const featured = this.normalizeBoolean(payload.featured, existing?.featured, false);
    const primaryIntent = this.resolveOptionalString(
      payload.primaryIntent,
      existing?.primaryIntent
    );
    const targetQuery = this.resolveOptionalString(payload.targetQuery, existing?.targetQuery);
    const relatedPlatformKeys = this.normalizeStringArray(
      payload.relatedPlatformKeys,
      existing?.relatedPlatformKeys,
      RELATED_PLATFORM_KEYS,
      'relatedPlatformKeys'
    );
    const relatedRouteKeys = this.normalizeStringArray(
      payload.relatedRouteKeys,
      existing?.relatedRouteKeys,
      RELATED_ROUTE_KEYS,
      'relatedRouteKeys'
    );
    const sportsRelations = this.normalizeSportsRelations(payload.sportsRelations, existing?.sportsRelations);
    const faqItems = this.normalizeFaqItems(payload.faqItems, existing?.faqItems);
    const evergreen = this.normalizeBoolean(payload.evergreen, existing?.evergreen, true);
    const affiliatePlacementMode = normalizeAffiliatePlacementMode(
      payload.affiliatePlacementMode,
      existing?.affiliatePlacementMode
    );
    const relatedOfferCategories = normalizeLowercaseKeys(
      payload.relatedOfferCategories,
      existing?.relatedOfferCategories
    );
    const relatedMerchantKeys = normalizeLowercaseKeys(payload.relatedMerchantKeys, existing?.relatedMerchantKeys);
    const manualAffiliateOfferIds = normalizeOfferIds(
      payload.manualAffiliateOfferIds,
      existing?.manualAffiliateOfferIds
    );
    const featuredImageSource = this.resolveFeaturedImage(payload, existing);
    const metaTitle = this.resolveOptionalString(payload.metaTitle, existing?.seo?.metaTitle);
    const metaDescription = this.resolveOptionalString(
      payload.metaDescription,
      existing?.seo?.metaDescription
    );
    const ogImage = this.resolveOptionalString(payload.ogImage, existing?.seo?.ogImage);
    const canonicalUrl = this.normalizeCanonicalUrl(
      payload.canonicalUrl,
      existing?.seo?.canonicalUrl
    );
    const keywords = this.normalizeKeywords(payload.keywords, existing?.seo?.keywords);
    const publishedAt = this.normalizePublishedAt(payload.publishedAt, status, existing?.publishedAt);
    const authorName = this.resolveOptionalString(payload.authorName, existing?.author?.name);
    const authorId = this.resolveOptionalString(payload.authorId, existing?.author?.id);

    return {
      title,
      slug,
      status,
      origin,
      excerpt,
      content,
      categories,
      contentType,
      featured,
      primaryIntent,
      targetQuery,
      relatedPlatformKeys,
      relatedRouteKeys,
      sportsRelations,
      faqItems,
      evergreen,
      affiliatePlacementMode,
      relatedOfferCategories,
      relatedMerchantKeys,
      manualAffiliateOfferIds,
      featuredImage: featuredImageSource
        ? { sourceUrl: featuredImageSource }
        : undefined,
      seo: {
        metaTitle,
        metaDescription,
        keywords,
        ogImage,
        canonicalUrl: canonicalUrl || `/guias/${slug}`,
      },
      publishedAt,
      author: authorName || authorId ? { name: authorName, id: authorId } : undefined,
    };
  }

  private normalizeOrigin(value: unknown, fallback?: EditorialOrigin): EditorialOrigin {
    const normalized = String(value || fallback || 'automated-import').trim().toLowerCase();
    if (['human', 'ai-assisted', 'automated-import', 'legacy'].includes(normalized)) {
      return normalized as EditorialOrigin;
    }
    throw new ValidationError('Invalid editorial origin', [
      { field: 'origin', message: 'Expected human, ai-assisted, automated-import or legacy', value },
    ]);
  }

  private resolveRequiredString(
    value: unknown,
    fallback: string | undefined,
    field: string
  ): string {
    const normalized = this.resolveOptionalString(value, fallback);
    if (!normalized) {
      throw new ValidationError(`${field} is required`, [
        { field, message: 'Required', value },
      ]);
    }
    return normalized;
  }

  private resolveOptionalString(value: unknown, fallback?: string): string | undefined {
    if (value === undefined) {
      return fallback;
    }
    const normalized = String(value || '').trim();
    return normalized || undefined;
  }

  private normalizeStatus(
    value: unknown,
    fallback?: 'draft' | 'publish'
  ): 'draft' | 'publish' {
    const normalized = String(value || fallback || 'draft').trim().toLowerCase();
    return normalized === 'publish' ? 'publish' : 'draft';
  }

  private normalizeContentType(value: unknown, fallback?: BlogContentType): BlogContentType {
    const normalized = String(value || fallback || 'guide').trim().toLowerCase() as BlogContentType;
    if (!CONTENT_TYPES.has(normalized)) {
      throw new ValidationError('Invalid contentType', [
        {
          field: 'contentType',
          message: 'Expected guide, ranking, trend, news, analysis, preview or match-report',
          value,
        },
      ]);
    }
    return normalized;
  }

  private normalizeSportsRelations(
    input: BlogWritePayload['sportsRelations'],
    fallback?: IBlogPostDocument['sportsRelations']
  ): NonNullable<IBlogPostDocument['sportsRelations']> {
    if (input === undefined) {
      return fallback || { teamIds: [], competitionIds: [], matchIds: [] };
    }
    return {
      teamIds: this.normalizeStringArray(
        input.teamIds,
        fallback?.teamIds,
        undefined,
        'sportsRelations.teamIds'
      ),
      competitionIds: this.normalizeStringArray(
        input.competitionIds,
        fallback?.competitionIds,
        undefined,
        'sportsRelations.competitionIds'
      ),
      matchIds: this.normalizeStringArray(
        input.matchIds,
        fallback?.matchIds,
        undefined,
        'sportsRelations.matchIds'
      ),
    };
  }

  private normalizeCategories(
    input: string[] | string | undefined,
    fallback?: IBlogPostCategory[]
  ): IBlogPostCategory[] {
    if (input === undefined) {
      return Array.isArray(fallback) ? [...fallback] : [];
    }

    const list = Array.isArray(input)
      ? input
      : String(input || '')
          .split(',')
          .map((item) => item.trim());

    return list
      .map((name) => String(name || '').trim())
      .filter(Boolean)
      .map((name) => {
        const slug = this.slugify(name);
        return {
          id: this.hashCategoryId(slug),
          name,
          slug,
        };
      });
  }

  private normalizeKeywords(input: string[] | string | undefined, fallback?: string[]): string[] {
    if (input === undefined) {
      return Array.isArray(fallback) ? [...fallback] : [];
    }
    const list = Array.isArray(input)
      ? input
      : String(input || '')
          .split(',')
          .map((item) => item.trim());
    return list.map((item) => String(item || '').trim()).filter(Boolean);
  }

  private normalizeFaqItems(
    input: Array<{ question?: string; answer?: string }> | string | undefined,
    fallback?: IBlogFaqItem[]
  ): IBlogFaqItem[] {
    if (input === undefined) {
      return Array.isArray(fallback) ? [...fallback] : [];
    }

    const items = Array.isArray(input)
      ? input
      : String(input || '')
          .split('\n')
          .map((line) => {
            const [question, answer] = line.split('::');
            return { question, answer };
          });

    return items
      .map((item) => ({
        question: String(item?.question || '').trim(),
        answer: String(item?.answer || '').trim(),
      }))
      .filter((item) => item.question && item.answer);
  }

  private normalizeStringArray(
    input: string[] | string | undefined,
    fallback: string[] | undefined,
    allowlist: ReadonlySet<string> | undefined,
    field: string
  ): string[] {
    if (input === undefined) {
      return Array.isArray(fallback) ? [...fallback] : [];
    }
    const list = Array.isArray(input)
      ? input
      : String(input || '')
          .split(',')
          .map((item) => item.trim());

    const normalized = list
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean);
    const invalid = allowlist ? normalized.filter((value) => !allowlist.has(value)) : [];
    if (invalid.length) {
      throw new ValidationError(`Invalid ${field}`, [
        {
          field,
          message: `Unexpected values: ${invalid.join(', ')}`,
          value: invalid.join(','),
        },
      ]);
    }
    return normalized;
  }

  private resolveFeaturedImage(
    payload: BlogWritePayload,
    existing?: IBlogPostDocument
  ): string | undefined {
    const hasExplicitValue =
      payload.coverImage !== undefined ||
      payload.featuredImage !== undefined ||
      payload.ogImage !== undefined;

    if (!hasExplicitValue) {
      return existing?.featuredImage?.sourceUrl;
    }

    const preferred = this.resolveOptionalString(payload.coverImage)
      || this.resolveOptionalString(payload.featuredImage)
      || this.resolveOptionalString(payload.ogImage);
    return preferred;
  }

  private normalizeCanonicalUrl(value: unknown, fallback?: string): string | undefined {
    if (value === undefined) {
      return fallback;
    }

    const normalized = String(value || '').trim();
    if (!normalized) {
      return undefined;
    }
    if (normalized.startsWith('/')) {
      return normalized;
    }
    try {
      const url = new URL(normalized);
      return `${url.origin}${url.pathname}`;
    } catch {
      throw new ValidationError('Invalid canonicalUrl', [
        {
          field: 'canonicalUrl',
          message: 'Expected an absolute URL or internal path',
          value,
        },
      ]);
    }
  }

  private normalizeBoolean(
    value: unknown,
    fallback: boolean | undefined,
    defaultValue: boolean
  ): boolean {
    if (value === undefined) {
      return typeof fallback === 'boolean' ? fallback : defaultValue;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off', ''].includes(normalized)) {
      return false;
    }
    throw new ValidationError('Invalid boolean flag', [
      { field: 'boolean', message: 'Expected true or false', value },
    ]);
  }

  private parseOptionalBoolean(value: string): boolean | null {
    const normalized = String(value || '').trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return null;
  }

  private normalizePublishedAt(
    value: unknown,
    status: 'draft' | 'publish',
    fallback?: Date
  ): Date | undefined {
    if (value === undefined) {
      if (status === 'publish') {
        return fallback || new Date();
      }
      return fallback;
    }

    const normalized = String(value || '').trim();
    if (!normalized) {
      return status === 'publish' ? fallback || new Date() : fallback;
    }
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
      throw new ValidationError('Invalid publishedAt', [
        { field: 'publishedAt', message: 'Expected a valid date', value },
      ]);
    }
    return date;
  }

  private async assertUniqueSlug(slug: string, excludeId?: string): Promise<void> {
    const existing = await BlogPostModel.findOne({
      slug,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    })
      .select({ _id: 1 })
      .lean()
      .exec();

    if (existing) {
      throw new ConflictError('An editorial post with this slug already exists');
    }
  }

  private parseNumber(value: any, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private slugify(value: string): string {
    return value
      .toString()
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/\-\-+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
  }

  private hashCategoryId(slug: string): number {
    let hash = 0;
    for (let i = 0; i < slug.length; i += 1) {
      hash = (hash << 5) - hash + slug.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  private isAdminRequest(req: Request): boolean {
    const requiredKey = process.env.ANALYTICS_ADMIN_KEY;
    if (!requiredKey) {
      return false;
    }
    const headerKey = req.header('x-admin-key');
    const authHeader = req.header('authorization') || '';
    const bearerKey = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7)
      : undefined;
    return headerKey === requiredKey || bearerKey === requiredKey;
  }
}

function stableQueryKey(query: Request['query']): string {
  return Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&') || 'default';
}
