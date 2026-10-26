import { markdownLeftoversToHtml } from '../utils/markdown-leftovers';
import { Injectable } from '@angular/core';
import { Observable, combineLatest, map, shareReplay } from 'rxjs';
import { BlogService } from '../../services/blog.service';
import {
  EditorialAffiliatePlacementMode,
  EditorialCategory,
  EditorialCategoryPageState,
  EditorialCategorySection,
  EditorialContentType,
  EditorialFaqItem,
  EditorialHubState,
  EditorialPost,
  EditorialPostPageState,
  EditorialRouteRelationKey,
} from '../models/editorial.models';

const VALID_AFFILIATE_PLACEMENT_MODES = new Set<EditorialAffiliatePlacementMode>(['auto', 'manual', 'off']);

const RANKING_CATEGORY_SLUGS = new Set([
  'ranking',
  'rankings',
  'top-10',
  'top10',
  'listas',
  'mejores',
]);

const RANKING_KEYWORDS = [
  'top 10',
  'top10',
  'ranking',
  'rankings',
  'mejores',
  'imprescindibles',
  'lista',
  'listas',
];

const TREND_KEYWORDS = ['tendencia', 'tendencias', 'estrenos', 'esta semana', 'fin de semana'];
const EDITORIAL_CATEGORY_PRIORITY = [
  ['cine', 'pelicula'],
  ['series'],
  ['futbol', 'deporte'],
  ['television', 'tv'],
  ['streaming', 'plataforma'],
  ['comparador', 'comparativa'],
] as const;
const VALID_ROUTE_RELATIONS: readonly EditorialRouteRelationKey[] = [
  'platforms',
  'guide',
  'explore',
  'stats',
  'comparison',
];

@Injectable({ providedIn: 'root' })
export class EditorialService {
  private readonly posts$: Observable<EditorialPost[]>;

  constructor(private readonly blogService: BlogService) {
    this.posts$ = this.blogService.getAllPosts().pipe(
      map((posts) => this.adaptPosts(posts || [])),
      shareReplay(1)
    );
  }

  public getPosts(): Observable<EditorialPost[]> {
    return this.posts$;
  }

  public getHubState(): Observable<EditorialHubState> {
    return this.getPosts().pipe(
      map((posts) => {
        const categories = this.extractCategories(posts);
        const rankingPosts = this.getRankingPosts(posts);
        const guidePosts = posts.filter((post) => post.contentType === 'guide');
        const trendPosts = posts.filter((post) => post.contentType === 'trend');
        const hero = posts.find((post) => post.featured) ?? posts[0] ?? null;
        const categorySections = this.buildCategorySections(
          posts.filter((post) => post.contentType !== 'ranking'),
          categories
        );

        return {
          hero,
          latestPosts: posts.filter((post) => post.slug !== hero?.slug).slice(0, 4),
          guidePosts: guidePosts.slice(0, 3),
          rankingPosts: rankingPosts.slice(0, 8),
          trendPosts: trendPosts.slice(0, 4),
          categorySections,
          categories: categories.slice(0, 8),
        };
      })
    );
  }

  public getRankingsPageState(): Observable<{
    featured: EditorialPost | null;
    posts: EditorialPost[];
    categories: EditorialCategory[];
    sections: EditorialCategorySection[];
  }> {
    return this.getPosts().pipe(
      map((posts) => {
        const rankingPosts = this.getRankingPosts(posts);
        const rankingCategories = this.extractCategories(rankingPosts)
          .filter((category) => !category.isRankingCategory)
          .slice(0, 8);

        return {
          featured: rankingPosts.find((post) => post.featured) ?? rankingPosts[0] ?? null,
          posts: rankingPosts,
          categories: rankingCategories,
          sections: this.buildCategorySections(
            rankingPosts,
            rankingCategories,
            3,
            4
          ),
        };
      })
    );
  }

  /**
   * Distinct homepage compositions for Cine / Series / Streaming plus any
   * remaining category clusters as "Especiales" collections. Reuses the same
   * category-cluster classification as buildCategorySections (no parallel
   * taxonomy) but gives each vertical its own post count/shape instead of
   * repeating one grid three times (Phase 7/8 IA).
   */
  public getEditorialSections(): Observable<{
    cine: EditorialCategorySection | null;
    series: EditorialCategorySection | null;
    streaming: EditorialCategorySection | null;
    collections: EditorialCategorySection[];
  }> {
    return this.getPosts().pipe(
      map((posts) => {
        const nonRanking = posts.filter((post) => post.contentType !== 'ranking');
        const categories = this.extractCategories(posts).filter(
          (category) => !category.isRankingCategory
        );
        const byCluster = new Map<string, EditorialCategory[]>();
        categories.forEach((category) => {
          const cluster = this.getCategoryCluster(category.slug);
          const list = byCluster.get(cluster) ?? [];
          list.push(category);
          byCluster.set(cluster, list);
        });

        const sectionFor = (
          cluster: string,
          postsPerSection: number,
          excludeSlugs: Set<string>
        ): EditorialCategorySection | null => {
          const category = byCluster.get(cluster)?.[0];
          if (!category) return null;
          const sectionPosts = nonRanking
            .filter(
              (post) =>
                !excludeSlugs.has(post.slug) &&
                post.categories.some((item) => item.slug === category.slug)
            )
            .slice(0, postsPerSection);
          return sectionPosts.length ? { category, posts: sectionPosts } : null;
        };

        const usedSlugs = new Set<string>();
        const cine = sectionFor('movies', 5, usedSlugs);
        cine?.posts.forEach((post) => usedSlugs.add(post.slug));
        const series = sectionFor('series', 4, usedSlugs);
        series?.posts.forEach((post) => usedSlugs.add(post.slug));
        const streaming = sectionFor('streaming', 4, usedSlugs);
        streaming?.posts.forEach((post) => usedSlugs.add(post.slug));

        const usedClusters = new Set(['movies', 'series', 'streaming']);
        const collections: EditorialCategorySection[] = [];
        for (const category of categories) {
          const cluster = this.getCategoryCluster(category.slug);
          if (usedClusters.has(cluster)) continue;
          const sectionPosts = nonRanking
            .filter(
              (post) =>
                !usedSlugs.has(post.slug) &&
                post.categories.some((item) => item.slug === category.slug)
            )
            .slice(0, 3);
          if (!sectionPosts.length) continue;
          collections.push({ category, posts: sectionPosts });
          usedClusters.add(cluster);
          sectionPosts.forEach((post) => usedSlugs.add(post.slug));
          if (collections.length >= 3) break;
        }

        return { cine, series, streaming, collections };
      })
    );
  }

  public getCategoryPageState(
    slug: string
  ): Observable<EditorialCategoryPageState | null> {
    return this.getPosts().pipe(
      map((posts) => {
        const categories = this.extractCategories(posts);
        const category = categories.find((item) => item.slug === slug);
        if (!category) {
          return null;
        }

        const categoryPosts = posts.filter((post) =>
          post.categories.some((item) => item.slug === slug)
        );
        const featuredPost =
          categoryPosts.find((post) => post.featured) ?? categoryPosts[0] ?? null;
        const relatedRankings = categoryPosts
          .filter((post) => post.isRanking && post.slug !== featuredPost?.slug)
          .slice(0, 3);
        const promotedSlugs = new Set([
          ...(featuredPost ? [featuredPost.slug] : []),
          ...relatedRankings.map((post) => post.slug),
        ]);

        return {
          category,
          featuredPost,
          posts: categoryPosts.filter((post) => !promotedSlugs.has(post.slug)),
          relatedRankings,
          siblingCategories: categories
            .filter((item) => item.slug !== slug)
            .slice(0, 8),
        };
      })
    );
  }

  public getPostPageState(slug: string): Observable<EditorialPostPageState | null> {
    return combineLatest([
      this.getPosts(),
      this.blogService.getPostBySlug(slug).pipe(
        map((posts) => posts[0] ? this.adaptPost(posts[0]) : null)
      ),
    ]).pipe(
      map(([posts, detailPost]) => {
        const post = detailPost ?? posts.find((entry) => entry.slug === slug);
        if (!post) {
          return null;
        }

        const categorySlugs = new Set(post.categories.map((category) => category.slug));
        const relatedPosts = posts
          .filter((entry) => entry.slug !== slug)
          .map((entry) => ({
            entry,
            sharedCategories: entry.categories.filter((category) => categorySlugs.has(category.slug)).length,
          }))
          .filter(({ entry, sharedCategories }) =>
            categorySlugs.size ? sharedCategories > 0 : entry.contentType === post.contentType
          )
          .sort((left, right) => right.sharedCategories - left.sharedCategories)
          .map(({ entry }) => entry)
          .slice(0, 3);

        return { post, relatedPosts };
      })
    );
  }

  public getPostBySlug(slug: string): Observable<EditorialPost | null> {
    return this.getPostPageState(slug).pipe(map((state) => state?.post ?? null));
  }

  public searchCategoryBySlug(slug: string): Observable<EditorialCategory | null> {
    return this.getPosts().pipe(
      map((posts) => this.extractCategories(posts).find((item) => item.slug === slug) ?? null)
    );
  }

  private adaptPosts(rawPosts: any[]): EditorialPost[] {
    return [...rawPosts]
      .map((post) => this.adaptPost(post))
      .sort((left, right) => {
        if (left.featured !== right.featured) {
          return left.featured ? -1 : 1;
        }
        return (
          new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime()
        );
      });
  }

  private adaptPost(rawPost: any): EditorialPost {
    const categories = Array.isArray(rawPost?.categories_name)
      ? rawPost.categories_name.map((category: any) => this.adaptCategory(category))
      : [];
    const contentType = this.resolveContentType(rawPost, categories);
    const rankingReason = this.getRankingReason(rawPost, categories, contentType);
    const excerptHtml = this.ensureString(rawPost?.excerpt?.rendered || rawPost?.excerpt);
    const optimizedContentHtml = this.optimizeContentHtml(
      this.ensureString(rawPost?.content?.rendered || rawPost?.content)
    );
    const readingMinutes = this.calculateReadingTime(optimizedContentHtml);
    const contentWithHeadings = this.addHeadingAnchors(optimizedContentHtml);
    const contentHtml = contentWithHeadings.contentHtml;
    const title = this.ensureString(rawPost?.title?.rendered || rawPost?.title);

    return {
      id: String(rawPost?.id || ''),
      slug: String(rawPost?.slug || '').trim(),
      title,
      excerptHtml,
      excerptText: this.stripHtml(excerptHtml),
      contentHtml,
      coverImage: this.normalizeCoverImage(
        rawPost?.featured_image?.source_url || rawPost?.seo?.ogImage
      ),
      publishedAt: String(rawPost?.date || rawPost?.publishedAt || new Date().toISOString()),
      modifiedAt: String(
        rawPost?.modified || rawPost?.updatedAt || rawPost?.date || new Date().toISOString()
      ),
      readingMinutes,
      tocItems: readingMinutes >= 5 ? contentWithHeadings.tocItems : [],
      author: this.normalizeAuthor(rawPost?.author),
      reviewedBy: this.ensureString(rawPost?.reviewedBy) || null,
      canonicalPath: `/guias/${rawPost?.slug}`,
      categories,
      primaryCategory: categories[0] ?? null,
      contentType,
      featured: Boolean(rawPost?.featured),
      primaryIntent: this.ensureString(rawPost?.primaryIntent) || null,
      targetQuery: this.ensureString(rawPost?.targetQuery) || null,
      relatedPlatformKeys: this.normalizeStringArray(rawPost?.relatedPlatformKeys),
      relatedRouteKeys: this.normalizeRouteKeys(rawPost?.relatedRouteKeys),
      faqItems: this.normalizeFaqItems(rawPost?.faqItems),
      evergreen: rawPost?.evergreen !== false,
      affiliatePlacementMode: this.resolveAffiliatePlacementMode(rawPost?.affiliatePlacementMode),
      relatedOfferCategories: this.normalizeStringArray(rawPost?.relatedOfferCategories),
      relatedMerchantKeys: this.normalizeStringArray(rawPost?.relatedMerchantKeys),
      manualAffiliateOfferIds: this.normalizeStringArray(rawPost?.manualAffiliateOfferIds),
      isRanking: contentType === 'ranking' || rankingReason !== 'none',
      rankingReason,
      metaTitle: this.ensureString(rawPost?.seo?.metaTitle) || null,
      metaDescription: this.ensureString(rawPost?.seo?.metaDescription) || null,
      raw: rawPost,
    };
  }

  private normalizeCoverImage(value: unknown): string {
    const image = String(value || '').trim();
    if (
      !image ||
      image.endsWith('/assets/images/blog-og-image.jpg') ||
      image.endsWith('/assets/images/top10-og-image.jpg')
    ) {
      return '/assets/images/blog-og-image.webp';
    }
    return image;
  }

  private normalizeAuthor(value: unknown): EditorialPost['author'] {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const author = value as { name?: unknown; id?: unknown };
    const name = this.ensureString(author.name);
    if (!name) {
      return null;
    }
    return {
      name,
      id: this.ensureString(author.id) || null,
    };
  }

  private optimizeContentHtml(contentHtml: string): string {
    return markdownLeftoversToHtml(contentHtml)
      .replace(/https:\/\/image\.tmdb\.org\/t\/p\/original\//g, 'https://image.tmdb.org/t/p/w780/')
      .replace(/<img\b(?![^>]*\bloading=)([^>]*)>/gi, '<img loading="lazy"$1>')
      .replace(/<img\b(?![^>]*\bdecoding=)([^>]*)>/gi, '<img decoding="async"$1>')
      // Stored bodies still link the pre-2026-10-20 section path; link the current one instead of a 301 hop.
      .replace(/href="(?:https:\/\/guiaprogramaciontv\.com)?\/editorial(?=[/"#?])/g, 'href="/guias');
  }

  private addHeadingAnchors(contentHtml: string): {
    contentHtml: string;
    tocItems: EditorialPost['tocItems'];
  } {
    const usedIds = new Set<string>();
    const tocItems: EditorialPost['tocItems'] = [];
    const html = contentHtml.replace(
      /<h([23])([^>]*)>([\s\S]*?)<\/h\1>/gi,
      (_match, rawLevel: string, rawAttributes: string, rawLabel: string) => {
        const level = Number(rawLevel) as 2 | 3;
        const label = this.stripHtml(rawLabel);
        if (!label) {
          return _match;
        }

        const existingId = rawAttributes.match(/\sid=["']([^"']+)["']/i)?.[1];
        const baseId = this.normalizeSlug(existingId || label) || `seccion-${tocItems.length + 1}`;
        let id = baseId;
        let suffix = 2;
        while (usedIds.has(id)) {
          id = `${baseId}-${suffix}`;
          suffix += 1;
        }
        usedIds.add(id);
        tocItems.push({ id, label, level });

        const attributes = existingId
          ? rawAttributes.replace(/\sid=["'][^"']+["']/i, ` id="${id}"`)
          : `${rawAttributes} id="${id}"`;
        return `<h${level}${attributes}>${rawLabel}</h${level}>`;
      }
    );

    return { contentHtml: html, tocItems };
  }

  private adaptCategory(rawCategory: any): EditorialCategory {
    const slug = this.normalizeSlug(rawCategory?.slug || rawCategory?.name || '');
    return {
      id: Number(rawCategory?.id || 0),
      name: this.ensureString(rawCategory?.name) || 'Categoria',
      slug,
      description: this.ensureString(rawCategory?.description),
      count: Number(rawCategory?.count || 0),
      // Same rule as ssr-server.mjs `categoryPath`: the rankings category lives at /guias/rankings (the other URL 301s).
      canonicalPath: slug === 'rankings' ? '/guias/rankings' : `/guias/categoria/${slug}`,
      isRankingCategory: this.isRankingCategory(rawCategory),
    };
  }

  private extractCategories(posts: EditorialPost[]): EditorialCategory[] {
    const categories = new Map<string, EditorialCategory>();

    posts.forEach((post) => {
      post.categories.forEach((category) => {
        const existing = categories.get(category.slug);
        if (existing) {
          existing.count += 1;
          return;
        }

        categories.set(category.slug, { ...category, count: category.count || 1 });
      });
    });

    return Array.from(categories.values()).sort((left, right) => {
      if (left.isRankingCategory !== right.isRankingCategory) {
        return left.isRankingCategory ? 1 : -1;
      }
      const leftPriority = this.getCategoryPriority(left.slug);
      const rightPriority = this.getCategoryPriority(right.slug);
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return right.count - left.count;
    });
  }

  private getCategoryPriority(slug: string): number {
    if (slug === 'cine') {
      return 0;
    }
    if (slug.includes('pelicula')) {
      return 1;
    }
    const priority = EDITORIAL_CATEGORY_PRIORITY.findIndex((keywords) =>
      keywords.some((keyword) => slug.includes(keyword))
    );
    return priority === -1 ? EDITORIAL_CATEGORY_PRIORITY.length + 2 : priority + 2;
  }

  private buildCategorySections(
    posts: EditorialPost[],
    categories: EditorialCategory[],
    maxSections = 3,
    postsPerSection = 3
  ): EditorialCategorySection[] {
    const usedClusters = new Set<string>();
    const usedPostSlugs = new Set<string>();
    const sections: EditorialCategorySection[] = [];

    for (const category of categories) {
      if (category.isRankingCategory) {
        continue;
      }

      const cluster = this.getCategoryCluster(category.slug);
      if (usedClusters.has(cluster)) {
        continue;
      }

      const sectionPosts = posts
        .filter(
          (post) =>
            !usedPostSlugs.has(post.slug) &&
            post.categories.some((item) => item.slug === category.slug)
        )
        .slice(0, postsPerSection);

      if (sectionPosts.length === 0) {
        continue;
      }

      sections.push({ category, posts: sectionPosts });
      usedClusters.add(cluster);
      sectionPosts.forEach((post) => usedPostSlugs.add(post.slug));

      if (sections.length >= maxSections) {
        break;
      }
    }

    return sections;
  }

  private getCategoryCluster(slug: string): string {
    if (slug === 'cine' || slug.includes('pelicula')) {
      return 'movies';
    }
    if (slug.includes('serie')) {
      return 'series';
    }
    if (slug.includes('futbol') || slug.includes('deporte')) {
      return 'football';
    }
    if (slug.includes('streaming') || slug.includes('plataforma')) {
      return 'streaming';
    }
    if (slug.includes('compar')) {
      return 'comparison';
    }
    if (
      slug.includes('television') ||
      slug === 'tv' ||
      slug === 'tdt' ||
      slug.includes('canal')
    ) {
      return 'television';
    }
    return slug;
  }

  private getRankingPosts(posts: EditorialPost[]): EditorialPost[] {
    return posts.filter((post) => post.contentType === 'ranking' || post.isRanking);
  }

  private resolveContentType(
    rawPost: any,
    categories: EditorialCategory[]
  ): EditorialContentType {
    const explicit = this.ensureString(rawPost?.contentType).toLowerCase() as EditorialContentType;
    if (explicit === 'guide' || explicit === 'ranking' || explicit === 'trend') {
      return explicit;
    }

    if (categories.some((category) => category.isRankingCategory)) {
      return 'ranking';
    }

    const haystack = `${this.ensureString(rawPost?.slug)} ${this.ensureString(
      rawPost?.title?.rendered || rawPost?.title
    )}`.toLowerCase();
    if (RANKING_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
      return 'ranking';
    }
    if (TREND_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
      return 'trend';
    }
    return 'guide';
  }

  private getRankingReason(
    rawPost: any,
    categories: EditorialCategory[],
    contentType: EditorialContentType
  ): 'type' | 'category' | 'keyword' | 'none' {
    if (contentType === 'ranking' && this.ensureString(rawPost?.contentType)) {
      return 'type';
    }
    if (categories.some((category) => category.isRankingCategory)) {
      return 'category';
    }

    const haystack = `${this.ensureString(rawPost?.slug)} ${this.ensureString(
      rawPost?.title?.rendered || rawPost?.title
    )}`.toLowerCase();

    return RANKING_KEYWORDS.some((keyword) => haystack.includes(keyword))
      ? 'keyword'
      : 'none';
  }

  private isRankingCategory(rawCategory: any): boolean {
    const slug = this.normalizeSlug(rawCategory?.slug || rawCategory?.name || '');
    if (RANKING_CATEGORY_SLUGS.has(slug)) {
      return true;
    }

    return RANKING_KEYWORDS.some((keyword) => slug.includes(this.normalizeSlug(keyword)));
  }

  private normalizeFaqItems(value: any): EditorialFaqItem[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => ({
        question: this.ensureString(item?.question),
        answer: this.ensureString(item?.answer),
      }))
      .filter((item) => item.question && item.answer);
  }

  private normalizeRouteKeys(value: any): EditorialRouteRelationKey[] {
    const valid = new Set(VALID_ROUTE_RELATIONS);
    return this.normalizeStringArray(value).filter(
      (item): item is EditorialRouteRelationKey => valid.has(item as EditorialRouteRelationKey)
    );
  }

  private resolveAffiliatePlacementMode(value: unknown): EditorialAffiliatePlacementMode {
    const normalized = this.ensureString(value).trim().toLowerCase();
    return VALID_AFFILIATE_PLACEMENT_MODES.has(normalized as EditorialAffiliatePlacementMode)
      ? (normalized as EditorialAffiliatePlacementMode)
      : 'auto';
  }

  private normalizeStringArray(value: any): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  private normalizeSlug(value: string): string {
    return String(value || '')
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private stripHtml(value: string): string {
    return String(value || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private ensureString(value: any): string {
    if (typeof value === 'string') {
      return value;
    }
    if (value == null) {
      return '';
    }
    if (typeof value === 'object') {
      if (typeof value.rendered === 'string') {
        return value.rendered;
      }
      if (typeof value.value === 'string') {
        return value.value;
      }
    }
    return String(value);
  }

  private calculateReadingTime(contentHtml: string): number {
    const words = this.stripHtml(contentHtml).split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
  }
}
