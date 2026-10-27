export type EditorialContentType = 'guide' | 'ranking' | 'trend';
/**
 * Editorial monetization controls (Affiliate Engine Phase 8). 'auto' resolves
 * offers contextually from relatedPlatformKeys/relatedMerchantKeys/relatedOfferCategories
 * (plus any manualAffiliateOfferIds pinned ahead of ranking); 'manual' shows
 * only manualAffiliateOfferIds; 'off' disables monetization on this post.
 */
export type EditorialAffiliatePlacementMode = 'auto' | 'manual' | 'off';
export type EditorialRouteRelationKey =
  | 'platforms'
  | 'guide'
  | 'explore'
  | 'stats'
  | 'comparison';

export interface EditorialCategory {
  id: number;
  name: string;
  slug: string;
  description: string;
  count: number;
  canonicalPath: string;
  isRankingCategory: boolean;
}

export interface EditorialFaqItem {
  question: string;
  answer: string;
}

export interface EditorialAuthor {
  name: string;
  id: string | null;
}

export interface EditorialTocItem {
  id: string;
  label: string;
  level: 2 | 3;
}

export interface EditorialPost {
  id: string;
  slug: string;
  title: string;
  excerptHtml: string;
  excerptText: string;
  contentHtml: string;
  coverImage: string;
  /** Alt text stored with the cover (AI illustrations say what they are); absent = the title. */
  coverAlt?: string;
  publishedAt: string;
  modifiedAt: string;
  readingMinutes: number;
  tocItems: EditorialTocItem[];
  author: EditorialAuthor | null;
  reviewedBy?: string | null;
  canonicalPath: string;
  categories: EditorialCategory[];
  primaryCategory: EditorialCategory | null;
  contentType: EditorialContentType;
  featured: boolean;
  primaryIntent: string | null;
  targetQuery: string | null;
  relatedPlatformKeys: string[];
  relatedRouteKeys: EditorialRouteRelationKey[];
  faqItems: EditorialFaqItem[];
  evergreen: boolean;
  affiliatePlacementMode: EditorialAffiliatePlacementMode;
  relatedOfferCategories: string[];
  relatedMerchantKeys: string[];
  manualAffiliateOfferIds: string[];
  isRanking: boolean;
  rankingReason: 'type' | 'category' | 'keyword' | 'none';
  metaTitle: string | null;
  metaDescription: string | null;
  raw: any;
}

export interface EditorialCategorySection {
  category: EditorialCategory;
  posts: EditorialPost[];
}

export interface EditorialHubState {
  hero: EditorialPost | null;
  latestPosts: EditorialPost[];
  guidePosts: EditorialPost[];
  rankingPosts: EditorialPost[];
  trendPosts: EditorialPost[];
  categorySections: EditorialCategorySection[];
  categories: EditorialCategory[];
}

export interface EditorialCategoryPageState {
  category: EditorialCategory;
  featuredPost: EditorialPost | null;
  posts: EditorialPost[];
  relatedRankings: EditorialPost[];
  siblingCategories: EditorialCategory[];
}

export interface EditorialPostPageState {
  post: EditorialPost;
  relatedPosts: EditorialPost[];
}
