import * as mongoose from 'mongoose';
import { Schema } from 'mongoose';
import type {
  EditorialOrigin,
  EditorialReviewState,
} from '../../../application/services/EditorialReviewPolicy';
import type { EditorialProvenance } from '../../../application/services/EditorialEvidence';

export type BlogContentType =
  | 'guide'
  | 'ranking'
  | 'trend'
  | 'news'
  | 'analysis'
  | 'preview'
  | 'match-report';

export interface IBlogPostCategory {
  id: number;
  name: string;
  slug: string;
}

export interface IBlogFaqItem {
  question: string;
  answer: string;
}

/**
 * Editorial monetization controls (Affiliate Engine Phase 8, see
 * docs/affiliate-engine-architecture.md §15). Deliberately store no raw
 * affiliate URLs or offer content here — only context signals the resolver
 * (`AffiliateResolverService`, via `POST /v2/affiliate/resolve`) uses to pick
 * offers at render time: 'auto' resolves contextually from
 * relatedPlatformKeys/relatedMerchantKeys/relatedOfferCategories, 'manual'
 * shows only manualAffiliateOfferIds, 'off' disables monetization on this
 * post entirely. See shared/utils/blogAffiliateFields.ts for normalization.
 */
export type BlogAffiliatePlacementMode = 'auto' | 'manual' | 'off';

export interface IBlogPostDocument {
  title: string;
  slug: string;
  status: 'draft' | 'publish';
  origin: EditorialOrigin;
  reviewState: EditorialReviewState;
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNotes?: string;
  excerpt?: string;
  content?: string;
  categories: IBlogPostCategory[];
  contentType: BlogContentType;
  featured?: boolean;
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
  evergreen?: boolean;
  /** Defaults to 'auto' — see BlogAffiliatePlacementMode. */
  affiliatePlacementMode?: BlogAffiliatePlacementMode;
  /** AffiliateOffer.category values (e.g. 'smart-tv') this post is relevant to — narrows automatic resolution. */
  relatedOfferCategories?: string[];
  /** Additional AffiliateMerchant hints beyond relatedPlatformKeys (e.g. a non-streaming retailer) — resolved via the same alias matching as any other providerKey. */
  relatedMerchantKeys?: string[];
  /** Editor-pinned AffiliateOffer ids — shown first in 'auto' mode, exclusively in 'manual' mode. */
  manualAffiliateOfferIds?: string[];
  seo?: {
    metaTitle?: string;
    metaDescription?: string;
    keywords?: string[];
    ogImage?: string;
    canonicalUrl?: string;
  };
  featuredImage?: {
    sourceUrl?: string;
    caption?: string;
    alt?: string;
  };
  author?: {
    name?: string;
    id?: string;
  };
  publishedAt?: Date;
  /** M11-B provenance of AI-written posts (EditorialProvenance): evidence, critic review, cost, freshness. */
  editorial?: EditorialProvenance;
  /** Earlier versions, newest last (capped): what a rollback restores. */
  revisions?: IBlogPostRevision[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IBlogPostRevision {
  version: number;
  savedAt: Date;
  reason: string;
  /** The whole post at that moment, without _id, timestamps and revisions. */
  snapshot: Omit<IBlogPostDocument, 'revisions' | 'createdAt' | 'updatedAt'>;
}

const BlogPostCategorySchema = new Schema<IBlogPostCategory>(
  {
    id: { type: Number, required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, index: true },
  },
  { _id: false }
);

const BlogFaqItemSchema = new Schema<IBlogFaqItem>(
  {
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const BlogPostSchema = new Schema<IBlogPostDocument>(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, unique: true, index: true },
    status: {
      type: String,
      enum: ['draft', 'publish'],
      default: 'draft',
      index: true,
    },
    origin: {
      type: String,
      enum: ['human', 'ai-assisted', 'automated-import', 'legacy'],
      default: 'legacy',
      index: true,
    },
    reviewState: {
      type: String,
      enum: ['unreviewed', 'in-review', 'approved', 'rejected'],
      default: 'unreviewed',
      index: true,
    },
    reviewedBy: { type: String, trim: true },
    reviewedAt: { type: Date },
    reviewNotes: { type: String, trim: true },
    excerpt: { type: String, trim: true },
    content: { type: String },
    categories: { type: [BlogPostCategorySchema], default: [] },
    contentType: {
      type: String,
      enum: ['guide', 'ranking', 'trend', 'news', 'analysis', 'preview', 'match-report'],
      default: 'guide',
      index: true,
    },
    featured: { type: Boolean, default: false, index: true },
    primaryIntent: { type: String, trim: true },
    targetQuery: { type: String, trim: true },
    relatedPlatformKeys: { type: [String], default: [] },
    relatedRouteKeys: { type: [String], default: [] },
    sportsRelations: {
      teamIds: { type: [String], default: [] },
      competitionIds: { type: [String], default: [] },
      matchIds: { type: [String], default: [] },
    },
    faqItems: { type: [BlogFaqItemSchema], default: [] },
    evergreen: { type: Boolean, default: true, index: true },
    affiliatePlacementMode: {
      type: String,
      enum: ['auto', 'manual', 'off'],
      default: 'auto',
    },
    relatedOfferCategories: { type: [String], default: [] },
    relatedMerchantKeys: { type: [String], default: [] },
    manualAffiliateOfferIds: { type: [String], default: [] },
    seo: {
      metaTitle: { type: String, trim: true },
      metaDescription: { type: String, trim: true },
      keywords: { type: [String], default: [] },
      ogImage: { type: String, trim: true },
      canonicalUrl: { type: String, trim: true },
    },
    featuredImage: {
      sourceUrl: { type: String, trim: true },
      caption: { type: String, trim: true },
      alt: { type: String, trim: true },
    },
    author: {
      name: { type: String, trim: true },
      id: { type: String, trim: true },
    },
    publishedAt: { type: Date, index: true },
    editorial: { type: Schema.Types.Mixed },
    revisions: { type: [Schema.Types.Mixed], default: undefined },
  },
  {
    timestamps: true,
    collection: 'blog_posts',
    // An approval must save exactly the version its gates read: a concurrent edit makes the save fail.
    optimisticConcurrency: true,
  }
);

BlogPostSchema.index({ status: 1, publishedAt: -1 });
BlogPostSchema.index({ status: 1, reviewState: 1, publishedAt: -1 });
BlogPostSchema.index({ contentType: 1, status: 1, publishedAt: -1 });
BlogPostSchema.index({ 'categories.slug': 1, publishedAt: -1 });
BlogPostSchema.index(
  { status: 1, featured: -1, publishedAt: -1, createdAt: -1 },
  { name: 'idx_blog_public_featured_published' }
);
BlogPostSchema.index(
  { status: 1, contentType: 1, featured: -1, publishedAt: -1 },
  { name: 'idx_blog_public_type_featured' }
);
BlogPostSchema.index(
  { status: 1, 'categories.slug': 1, featured: -1, publishedAt: -1 },
  { name: 'idx_blog_public_category_featured' }
);
BlogPostSchema.index({ title: 'text', excerpt: 'text', content: 'text' });

export const BlogPostModel = mongoose.model<IBlogPostDocument>(
  'BlogPost',
  BlogPostSchema
);
