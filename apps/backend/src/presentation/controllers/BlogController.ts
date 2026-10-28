import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
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
import { bumpEditorialEpoch } from '../../shared/utils/editorialEpoch';
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
  assertEditorialPostCanBeApproved,
  EditorialOrigin,
  evaluateEditorialQuality,
  POLICY_REVIEWER,
  policyGateFailures,
  PUBLIC_EDITORIAL_FILTER,
} from '../../application/services/EditorialReviewPolicy';
import { EditorialProvenance, evaluateEvidence, provenanceSignatureFindings, provenanceSignatureValid } from '../../application/services/EditorialEvidence';
import { policyProviderProblem } from '../../application/services/EditorialAgentPipeline';
import { editorialPolicyState } from './EditorialOpsController';
import { generatedImageFindings } from '../../application/services/EditorialImages';

const MAX_REVISIONS = 20;
const MAX_REVISIONS_BYTES = 6 * 1024 * 1024;
const MAX_PROVENANCE_BYTES = 512 * 1024;

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
  coverAlt?: string;
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
  editorial?: EditorialProvenance;
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
    alt?: string;
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
  editorial?: EditorialProvenance;
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
      } else if (!isAdminRequest) {
        query.select({ revisions: 0, 'editorial.bundle': 0, 'editorial.draftMarkdown': 0, 'editorial.critic': 0, 'editorial.cost': 0 });
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

      this.pushRevision(existing, 'update');
      this.applyAsDraft(existing, normalized);

      await this.saveUnchanged(existing);
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

      const findings = await this.qualityFindings(post);
      const acknowledged = ([] as unknown[])
        .concat(req.body?.acknowledge ?? [])
        .flatMap((code) => String(code).split(','))
        .map((code) => code.trim());
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
      await this.saveUnchanged(post);
      await this.invalidatePublicReads();

      res.status(200).json(successResponse({ post: this.mapPost(post.toObject()), qualityFindings: findings }));
    } catch (error) {
      next(error);
    }
  };

  /**
   * M11-B: publication of an AI-written post on its evidence alone. Off unless EDITORIAL_POLICY_PUBLISHING=enabled
   * (an owner decision); also needs the review key, a post with provenance, and no finding a person must judge.
   */
  public approveByPolicy = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { policy, postId, post } = await this.policyTarget(req);
      if (post.status === 'publish') throw new ConflictError('Editorial post is already published');
      const findings = await this.publishByPolicy(post, postId, policy.dailyLimit);
      res.status(200).json(successResponse({ post: this.mapPost(post.toObject()), qualityFindings: findings }));
    } catch (error) {
      next(error);
    }
  };

  /**
   * M11-F maintenance: replaces a guide the policy published with a new pipeline revision, under every gate of
   * approve-by-policy. The candidate is checked in memory and saved only if it passes, so a failed maintenance
   * leaves the published version untouched; the old version is kept as a revision (rollback).
   * `expectedDraftHash` is the version the runner re-verified: anything else changed meanwhile → 409.
   */
  public reviseByPolicy = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { policy, postId, post } = await this.policyTarget(req);
      // A person's approval is never overridden by the policy, and a draft goes through approve-by-policy.
      if (post.status !== 'publish' || post.reviewedBy !== POLICY_REVIEWER) {
        throw new ConflictError('Only a guide published by the policy can be revised by the policy');
      }
      if (String(req.body?.expectedDraftHash || '') !== post.editorial?.draftHash) {
        throw new ConflictError('The published version changed since it was verified; read it again');
      }
      const payload = (req.body?.post ?? {}) as BlogWritePayload;
      // Only what the pipeline signs (text, excerpt, title, metadata) or re-checks; canonical, categories, affiliate
      // and every other field stay as published, so a revision cannot move or monetise a live guide.
      const { title, slug, excerpt, content, metaTitle, metaDescription, editorial } = payload;
      const normalized = this.normalizePayload({ title, slug, excerpt, content, metaTitle, metaDescription, editorial, status: 'draft' }, post);
      if (normalized.slug !== post.slug || normalized.origin !== 'ai-assisted' || !payload.editorial) {
        throw new ValidationError('Editorial quality gate failed', [
          { field: 'editorial', message: 'A policy revision keeps the slug and brings new pipeline provenance', value: postId },
        ]);
      }
      const publishedAt = post.publishedAt;
      this.pushRevision(post, 'maintenance by policy');
      this.applyAsDraft(post, normalized);
      post.publishedAt = publishedAt;
      const findings = await this.publishByPolicy(post, postId, policy.dailyLimit, 'Maintenance revision');
      res.status(200).json(successResponse({ post: this.mapPost(post.toObject()), qualityFindings: findings }));
    } catch (error) {
      next(error);
    }
  };

  private async policyTarget(req: Request) {
    const policy = await editorialPolicyState();
    if (!policy.envEnabled) throw new ForbiddenError('Policy publishing is disabled (EDITORIAL_POLICY_PUBLISHING)');
    if (policy.paused) throw new ForbiddenError(`Policy publishing is paused by the Admin emergency stop (${policy.pausedReason ?? 'no reason'})`);
    if (!policy.activated) throw new ForbiddenError('Policy publishing has not been activated from the Admin (human review key)');
    const postId = String(req.params.id || '').trim();
    const post = await BlogPostModel.findById(postId).exec();
    if (!post) throw new NotFoundError('Editorial post not found');
    return { policy, postId, post };
  }

  /** Every policy gate, the cap ledger and the stop re-check, then publication. Throws before saving on any failure. */
  private async publishByPolicy(post: InstanceType<typeof BlogPostModel>, postId: string, dailyLimit: number, kind = 'Approved') {
    if (!post.editorial || post.origin !== 'ai-assisted') {
      throw new ValidationError('Editorial quality gate failed', [
        { field: 'editorial', message: 'Policy approval needs an ai-assisted post with M11-B provenance', value: postId },
      ]);
    }
    // Only provenance the pipeline runner signed, from live models: replayed or hand-made bundles need a person.
    const providerProblem = policyProviderProblem(post.editorial);
    if (!provenanceSignatureValid(post.editorial, process.env.EDITORIAL_PIPELINE_SIGNING_KEY) || providerProblem) {
      throw new ValidationError('Editorial quality gate failed', [
        { field: 'editorial', message: `Provenance is not signed by the pipeline with live providers${providerProblem ? ` (${providerProblem})` : ''} — use the named-reviewer approval`, value: postId },
      ]);
    }
    try {
      assertEditorialPostCanBeApproved(post.toObject());
    } catch (error) {
      throw new ValidationError('Editorial quality gate failed', [
        { field: 'review', message: error instanceof Error ? error.message : 'Approval rejected', value: postId },
      ]);
    }
    const findings = await this.qualityFindings(post);
    const failures = policyGateFailures(findings);
    // The canonical is not signed: a policy publication is always its own /guias/<slug> page.
    const canonical = String(post.seo?.canonicalUrl || `/guias/${post.slug}`).replace(/^https:\/\/(?:www\.)?guiaprogramaciontv\.com/, '');
    if (canonical !== `/guias/${post.slug}`) failures.push({ severity: 'block', code: 'canonicalUrl', message: `A policy publication is canonical to /guias/${post.slug}` });
    if (failures.length) {
      throw new ValidationError('Editorial quality gate failed', failures.map((f) => ({ field: f.code, message: f.message, value: postId })));
    }
    // Append-only ledger, insert first: concurrent approvals both count, and a later PUT cannot erase one.
    // One row per post and reviewed draft: a duplicate attempt, concurrent or later, is refused, not published twice.
    // Maintenance revisions count too (dailyLimit is set from the Admin, see DAILY_LIMIT).
    const ledger = BlogPostModel.db.collection<{ _id: string; postId: unknown; at: Date }>('editorial_policy_approvals');
    const { insertedId } = await ledger.insertOne({ _id: `${post._id}:${post.editorial.draftHash}`, postId: post._id, at: new Date() }).catch((error) => {
      if (error?.code === 11000) throw new ConflictError('This draft was already published by policy once; a person must approve it again');
      throw error;
    });
    if (await ledger.countDocuments({ at: { $gte: new Date(Date.now() - 864e5) } }) > dailyLimit) {
      await ledger.deleteOne({ _id: insertedId });
      throw new ForbiddenError(`Policy publishing limit reached (${dailyLimit} in 24 h)`);
    }
    // An emergency stop pressed while the gates ran still wins.
    if (!(await editorialPolicyState()).active) {
      await ledger.deleteOne({ _id: insertedId });
      throw new ForbiddenError('Policy publishing was stopped while this approval ran');
    }
    const now = new Date();
    post.status = 'publish';
    post.reviewState = 'approved';
    post.reviewedBy = POLICY_REVIEWER;
    post.reviewedAt = now;
    post.publishedAt = post.publishedAt || now;
    post.reviewNotes = `${kind} by the M11-B evidence policy: every stated fact verified against its source, independent AI review passed. Automatic certification, no per-article human review.`;
    post.editorial = { ...post.editorial, state: 'published' };
    // A failed save publishes nothing, so it must not keep a slot or lock this draft out.
    await this.saveUnchanged(post).catch(async (error) => {
      await ledger.deleteOne({ _id: insertedId });
      throw error;
    });
    await this.invalidatePublicReads();
    return findings;
  }

  private applyAsDraft(post: InstanceType<typeof BlogPostModel>, normalized: NormalizedBlogPayload): void {
    post.editorial = normalized.editorial;
    post.title = normalized.title;
    post.slug = normalized.slug;
    post.status = 'draft';
    post.reviewState = 'unreviewed';
    post.reviewedBy = undefined;
    post.reviewedAt = undefined;
    post.reviewNotes = undefined;
    post.origin = normalized.origin;
    post.excerpt = normalized.excerpt;
    post.content = normalized.content;
    post.categories = normalized.categories;
    post.contentType = normalized.contentType;
    post.featured = normalized.featured;
    post.primaryIntent = normalized.primaryIntent;
    post.targetQuery = normalized.targetQuery;
    post.relatedPlatformKeys = normalized.relatedPlatformKeys;
    post.relatedRouteKeys = normalized.relatedRouteKeys;
    post.sportsRelations = normalized.sportsRelations;
    post.faqItems = normalized.faqItems;
    post.evergreen = normalized.evergreen;
    post.affiliatePlacementMode = normalized.affiliatePlacementMode;
    post.relatedOfferCategories = normalized.relatedOfferCategories;
    post.relatedMerchantKeys = normalized.relatedMerchantKeys;
    post.manualAffiliateOfferIds = normalized.manualAffiliateOfferIds;
    post.featuredImage = normalized.featuredImage;
    post.seo = normalized.seo;
    post.publishedAt = normalized.publishedAt;
    post.author = normalized.author;
  }

  /**
   * Restores a stored revision. The text comes back with the review it had: an approved version stays public
   * (it is exactly what was approved), anything else returns as a draft. The current version is kept as a revision.
   */
  public rollbackPost = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const postId = String(req.params.id || '').trim();
      const version = Number(req.body?.version);
      const post = await BlogPostModel.findById(postId).exec();
      if (!post) throw new NotFoundError('Editorial post not found');
      const target = (post.revisions || []).find((r) => r.version === version);
      if (!target) {
        throw new ValidationError('Unknown revision', [{ field: 'version', message: 'No stored revision with this version', value: req.body?.version }]);
      }
      this.pushRevision(post, `rollback to ${version}`);
      const snap = target.snapshot;
      // It stays public only as exactly what was approved: a policy approval needs the policy switch still on,
      // and AI text whose facts are past their review date comes back as a draft.
      const expired = Date.parse(snap.editorial?.nextReviewAt || '') < Date.now();
      const policyOff = String(snap.reviewedBy || '').startsWith('policy:') && !(await editorialPolicyState()).active;
      const keepReview = snap.status === 'publish' && snap.reviewState === 'approved' && !expired && !policyOff;
      post.set({
        ...snap,
        status: keepReview ? 'publish' : 'draft', reviewState: keepReview ? 'approved' : 'unreviewed',
        reviewedBy: keepReview ? snap.reviewedBy : undefined, reviewedAt: keepReview ? snap.reviewedAt : undefined,
        reviewNotes: `Restored revision ${version} by ${String(req.header('x-editorial-reviewer') || 'unnamed operator').trim()}`,
      });
      await this.saveUnchanged(post);
      await this.invalidatePublicReads();
      res.status(200).json(successResponse({ post: this.mapPost(post.toObject()), restored: version }));
    } catch (error) {
      next(error);
    }
  };

  /** Saves only if nobody wrote the post since it was read (optimisticConcurrency on the schema). */
  private async saveUnchanged(post: InstanceType<typeof BlogPostModel>): Promise<void> {
    try {
      await post.save();
    } catch (error) {
      if (error instanceof mongoose.Error.VersionError) throw new ConflictError('The post changed while this request ran; read it again');
      throw error;
    }
  }

  /** Existing CMS gate plus, for posts with M11-B provenance, the evidence gate. */
  private async qualityFindings(post: InstanceType<typeof BlogPostModel>) {
    // Only public posts are compared, so only their content is loaded.
    const [publicPosts, unpublished] = await Promise.all([
      BlogPostModel.find({ ...PUBLIC_EDITORIAL_FILTER, _id: { $ne: post._id } }).select({ slug: 1, content: 1 }).lean().exec(),
      BlogPostModel.find({ _id: { $ne: post._id }, $nor: [PUBLIC_EDITORIAL_FILTER] }).select({ slug: 1 }).lean().exec(),
    ]);
    const plain = post.toObject();
    return [
      ...(plain.editorial
        ? [...evaluateEvidence(plain, plain.editorial), ...provenanceSignatureFindings(plain.editorial, process.env.EDITORIAL_PIPELINE_SIGNING_KEY)]
        : []),
      ...generatedImageFindings(plain),
      ...evaluateEditorialQuality(plain, {
        others: publicPosts.map((other) => ({ slug: String(other.slug), content: other.content })),
        unpublishedSlugs: unpublished.map((other) => String(other.slug)),
      }),
    ];
  }

  private pushRevision(post: InstanceType<typeof BlogPostModel>, reason: string): void {
    const revisions = post.revisions || [];
    const version = Math.max(0, ...revisions.map((r) => r.version)) + 1;
    // The whole document (FAQ, author, affiliate fields included), so a rollback cannot mix versions.
    const { _id, __v, revisions: _r, createdAt, updatedAt, ...snapshot } = post.toObject() as IBlogPostDocument & { _id: unknown; __v?: number };
    const kept = [...revisions, { version, savedAt: new Date(), reason, snapshot }].slice(-MAX_REVISIONS);
    // Stay far below Mongo's 16 MB document limit; the oldest revisions go first.
    while (kept.length > 1 && JSON.stringify(kept).length > MAX_REVISIONS_BYTES) kept.shift();
    post.revisions = kept;
  }

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
        alt_text: post.featuredImage?.alt || '',
      },
      seo: post.seo,
      contentType: post.contentType || 'guide',
      featured: Boolean(post.featured),
      author: post.author || null,
      // Shown as the byline's reviewer; only an approval made through the human review gate sets it.
      reviewedBy: post.reviewState === 'approved' && !String(post.reviewedBy || '').startsWith('policy:') ? post.reviewedBy || null : null,
      editorial: post.editorial
        ? { state: post.editorial.state, lastVerifiedAt: post.editorial.lastVerifiedAt || null, nextReviewAt: post.editorial.nextReviewAt || null, version: post.editorial.version ?? null }
        : null,
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
        alt_text: post.featuredImage?.alt || '',
      },
      seo: post.seo,
      contentType: post.contentType || 'guide',
      featured: Boolean(post.featured),
      author: post.author || null,
      ...this.mapAffiliateFields(post),
    };
  }

  private async invalidatePublicReads(): Promise<void> {
    bumpEditorialEpoch();
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
    // A pipeline post keeps its origin and provenance: dropping either would also drop the evidence gate and the critic verdict.
    if (existing?.editorial && (origin !== 'ai-assisted' || payload.editorial === null)) {
      throw new ValidationError('An ai-assisted post keeps its origin and provenance', [
        { field: 'origin', message: 'Create a new post instead of relabelling AI text or removing its evidence', value: payload.origin },
      ]);
    }
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
    const editorial = this.normalizeEditorial(payload.editorial, existing?.editorial, origin);

    return {
      editorial,
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
        ? {
          sourceUrl: featuredImageSource,
          // Kept only while the cover is the same picture it describes.
          alt: this.resolveOptionalString(payload.coverAlt, featuredImageSource === existing?.featuredImage?.sourceUrl ? existing?.featuredImage?.alt : undefined),
        }
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

  // Shape check only: whether the evidence holds is decided at approval (evaluateEvidence).
  private normalizeEditorial(value: unknown, fallback: EditorialProvenance | undefined, origin: EditorialOrigin): EditorialProvenance | undefined {
    // Kept as it was, but no longer the published state: the post is a draft again after any edit.
    if (value === undefined) return fallback && { ...fallback, state: 'draft' };
    if (value === null) return undefined;
    const p = value as Partial<EditorialProvenance>;
    const valid = typeof p === 'object' && origin === 'ai-assisted'
      && typeof p.pipelineVersion === 'string' && typeof p.bundleHash === 'string' && typeof p.draftHash === 'string'
      && typeof p.draftMarkdown === 'string' && Array.isArray(p.bundle?.claims) && Array.isArray(p.bundle?.sources)
      && (p.images === undefined || (Array.isArray(p.images) && p.images.every((i) => i && typeof i === 'object'
        && ['url', 'sha256', 'provider', 'model', 'altText', 'rights', 'assetId'].every((k) => typeof (i as unknown as Record<string, unknown>)[k] === 'string'))))
      && JSON.stringify(p).length <= MAX_PROVENANCE_BYTES;
    if (!valid) {
      throw new ValidationError('Invalid editorial provenance', [
        { field: 'editorial', message: 'Expected M11-B provenance (bundle, hashes, draft) on an ai-assisted post, under 512 KB', value: undefined },
      ]);
    }
    return { ...p, state: 'draft' } as EditorialProvenance;
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
