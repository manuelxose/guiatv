import { Request, Response, NextFunction } from 'express';
import { IChannelRepository } from '../../domain/repositories/IChannelRepository';
import { IProgramRepository } from '../../domain/repositories/IProgramRepository';
import { BlogPostModel } from '../../infrastructure/database/models/BlogPost.model';
import { TMDBService } from '../../infrastructure/external/TMDBService';
import { ChannelType } from '../../domain/entities/Channel';
import { FootballQueryService } from '../../application/sports/services/FootballQueryService';
import { normalizeTvToken, channelPagePath } from '../../shared/utils/tvMetadata';
import { slugifyTitle } from '../../domain/services/detailPath';
import { programmePolicyApplies, type ProgrammeDisposition } from '../../application/services/ProgrammeSeoPolicy';
import { TvReadQueryService } from '../../application/services/TvReadQueryService';
import { PUBLIC_EDITORIAL_FILTER } from '../../application/services/EditorialReviewPolicy';
import { logger } from '../../shared/utils/logger';
import { entityPublicReadPolicy, normalizeEntityPath } from '../../application/services/EntityPublicReadPolicy';

type Changefreq =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

interface SitemapUrlEntry {
  loc: string;
  lastmod?: string;
  changefreq?: Changefreq;
  priority?: number;
}

const DEFAULT_BASE_URL = 'https://guiaprogramaciontv.com';
// Was 5 minutes - far shorter than this content needs (the streaming
// sitemap declares changefreq:'weekly' for its own URLs) and far shorter
// than its build cost justifies: appendStreamingContent() can make up to
// 78 sequential TMDB calls (13 platforms x up to 3 pages x movies+TV).
// In-flight dedup (inflightMap below) already prevents concurrent
// requests from each re-running that build, but a 5-minute TTL still
// meant it re-ran ~12x/hour under any steady traffic, plus once per
// guiatv-api restart (this is an in-process Map, not Redis-backed, so it
// doesn't survive a restart) - a real contributor to memory pressure
// during this session's residual-OOM investigation
// (docs/rebuild-scoreboard.md). 6h keeps the sitemap far fresher than its
// own declared weekly changefreq while cutting rebuild frequency ~72x.
const CACHE_TTL_MS = Number(process.env.SITEMAP_CACHE_TTL_MS) || 6 * 60 * 60 * 1000;

/** Channel types included in the sitemap (curated subset) */
const INDEXABLE_CHANNEL_TYPES: ReadonlySet<ChannelType> = new Set<ChannelType>([
  'TDT',
  'Autonomico',
]);

const cache = new Map<string, { value: string; expiresAt: number }>();
const inflightMap = new Map<string, Promise<string>>();
/** Last successful build per key. Survives invalidation (an EPG rebuild is when a build is most likely to fail). */
const lastGood = new Map<string, { xml: string; at: number }>();
const STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STALE_RETRY_MS = 60 * 1000;
const log = logger.child('SitemapController');

export const clearSitemapLastGood = (): void => lastGood.clear();

/** Bumped on invalidation: a build already running when its key was invalidated must not cache its older answer. */
let generation = 0;
/** No keys: every sitemap. With keys: only those (a guide publish must not force the EPG sitemap rebuild). */
export const invalidateSitemapCache = (keys?: string[]): void => {
  generation++;
  for (const map of [cache, inflightMap]) {
    for (const key of [...map.keys()]) if (!keys || keys.includes(key.slice(key.lastIndexOf(':') + 1))) map.delete(key);
  }
};

export class SitemapController {
  constructor(
    private readonly channelRepository: IChannelRepository,
    private readonly programRepository: IProgramRepository,
    _tmdbService?: TMDBService,
    _footballQueryService?: FootballQueryService,
    private readonly tvReadQueryService?: Pick<
      TvReadQueryService,
      'getChannels' | 'getIndexableProgramSitemapRows'
    >,
    /** Same lookup the `/programas/:slug` page uses: null (the page 404s) or its M09-B disposition. */
    private readonly programSlugDisposition?: (slug: string) => Promise<ProgrammeDisposition | null>
  ) {}

  /* ------------------------------------------------------------------ */
  /*  Public route handlers                                              */
  /* ------------------------------------------------------------------ */

  /** GET /sitemap.xml — sitemap index */
  async getSitemapIndex(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const xml = await this.getCached('index', () => this.buildSitemapIndex());
      this.sendXml(res, xml);
    } catch (error) { next(error); }
  }

  /** GET /sitemap-static.xml */
  async getStaticSitemap(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const xml = await this.getCached('static', () => this.buildStaticSitemap());
      this.sendXml(res, xml);
    } catch (error) { next(error); }
  }

  /** GET /sitemap-channels.xml */
  async getChannelsSitemap(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const xml = await this.getCached('channels', () => this.buildChannelsSitemap());
      this.sendXml(res, xml);
    } catch (error) { next(error); }
  }

  /** GET /sitemap-programs.xml */
  async getProgramsSitemap(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const xml = await this.getCached('programs', () => this.buildProgramsSitemap());
      this.sendXml(res, xml);
    } catch (error) { next(error); }
  }

  /** GET /sitemap-blog.xml */
  async getBlogSitemap(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const xml = await this.getCached('blog', () => this.buildBlogSitemap());
      this.sendXml(res, xml);
    } catch (error) { next(error); }
  }

  /** GET /sitemap-streaming.xml */
  async getStreamingSitemap(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const xml = await this.getCached('streaming', () => this.buildStreamingSitemap());
      this.sendXml(res, xml);
    } catch (error) { next(error); }
  }

  /** GET /sitemap-football.xml — competitions, matches, teams (spec §79-81). */
  async getFootballSitemap(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const xml = await this.getCached('football', () => this.buildFootballSitemap());
      this.sendXml(res, xml);
    } catch (error) { next(error); }
  }

  /** @deprecated — kept for backwards compat; now returns sitemap index */
  async getSitemap(req: Request, res: Response, next: NextFunction): Promise<void> {
    return this.getSitemapIndex(req, res, next);
  }

  /* ------------------------------------------------------------------ */
  /*  Cache layer                                                        */
  /* ------------------------------------------------------------------ */

  private async getCached(key: string, builder: () => Promise<string>): Promise<string> {
    key = `${entityPublicReadPolicy().partition()}:${key}`;
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;

    const existing = inflightMap.get(key);
    if (existing) return existing;

    const started = generation;
    const promise = builder()
      .then((xml) => {
        // Invalidated while building (a guide went live meanwhile): answer this request, cache nothing.
        if (started !== generation && inflightMap.get(key) !== promise) return xml;
        cache.set(key, { value: xml, expiresAt: Date.now() + CACHE_TTL_MS });
        lastGood.set(key, { xml, at: Date.now() });
        inflightMap.delete(key);
        return xml;
      })
      .catch((err) => {
        inflightMap.delete(key);
        // A transient failure serves the last good build instead of a 5xx to crawlers.
        log.error('Sitemap build failed', { key, error: err });
        const stale = lastGood.get(key);
        if (stale && Date.now() - stale.at < STALE_MAX_AGE_MS) {
          // Retry in a minute, not on every request: the failed build is the expensive part.
          cache.set(key, { value: stale.xml, expiresAt: Date.now() + STALE_RETRY_MS });
          return stale.xml;
        }
        throw err;
      });
    inflightMap.set(key, promise);
    return promise;
  }

  private sendXml(res: Response, xml: string): void {
    const maxAgeSec = Math.max(60, Math.floor(CACHE_TTL_MS / 1000));
    res.set('Content-Type', 'application/xml; charset=UTF-8');
    res.set('Cache-Control', `public, max-age=${maxAgeSec}, stale-while-revalidate=${maxAgeSec}`);
    res.set('Pragma', '');
    res.set('Expires', new Date(Date.now() + maxAgeSec * 1000).toUTCString());
    res.status(200).send(xml);
  }

  /* ------------------------------------------------------------------ */
  /*  Sitemap index builder                                              */
  /* ------------------------------------------------------------------ */

  private async buildSitemapIndex(): Promise<string> {
    const baseUrl = this.getBaseUrl();

    const subs: Array<[string, string, () => Promise<string>]> = [
      ['sitemap-static.xml', 'static', () => this.buildStaticSitemap()],
      ['sitemap-channels.xml', 'channels', () => this.buildChannelsSitemap()],
      ['sitemap-programs.xml', 'programs', () => this.buildProgramsSitemap()],
      ['sitemap-blog.xml', 'blog', () => this.buildBlogSitemap()],
    ];

    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ];
    for (const [file, key, build] of subs) {
      // M11-G: the blog child is dated by its newest guide change, so Google re-reads it when a guide is published or
      // revised (it kept a 2-day-old copy missing the new guides). The schedule-driven children would say "today" every
      // day, and Google stops trusting a site's lastmod when it is not consistently accurate: they carry none.
      // A child that fails to build or has no dated entry gets none either.
      const lastmod = key !== 'blog' ? undefined : await this.getCached(key, build).then(
        (xml) => [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]).sort().pop(),
        () => undefined,
      );
      lines.push('  <sitemap>');
      lines.push(`    <loc>${this.escapeXml(`${baseUrl}/${file}`)}</loc>`);
      if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
      lines.push('  </sitemap>');
    }
    lines.push('</sitemapindex>');
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ */
  /*  Sub-sitemap builders                                               */
  /* ------------------------------------------------------------------ */

  private async buildStaticSitemap(): Promise<string> {
    const todayIso = this.formatLastmod(new Date());
    return this.renderUrlset(this.getStaticUrls(todayIso));
  }

  private async buildChannelsSitemap(): Promise<string> {
    // A channel page is its schedule, regenerated every day.
    const todayIso = this.formatLastmod(new Date());
    const urls: SitemapUrlEntry[] = [];

    if (this.tvReadQueryService) {
      const directory = await this.tvReadQueryService.getChannels('today');
      for (const entry of directory.channels) {
        const channel = entry.channel;
        if (channel.group !== 'tdt' && channel.group !== 'autonomico') continue;
        const slug = channel.normalizedName || normalizeTvToken(channel.name);
        if (!slug) continue;
        urls.push({
          loc: channelPagePath(slug),
          lastmod: todayIso,
          changefreq: 'weekly',
          priority: 0.7,
        });
      }
      return this.renderUrlset(urls);
    }

    // Compatibility fallback for installations without the public TV read
    // model. Production injects tvReadQueryService above so sitemap eligibility
    // uses the same consumer-visible rows as the channel detail surface.
    const todayYmd = this.formatYmd(new Date());
    const [channels, programsToday] = await Promise.all([
      this.channelRepository.findAll({ isActive: true }),
      this.programRepository.findByDate(todayYmd, 'minimal'),
    ]);
    const scheduledChannelIds = new Set(
      programsToday.flatMap((program) => [
        normalizeTvToken(program.channelId),
        normalizeTvToken(program.canonicalChannelId),
      ])
    );

    for (const channel of channels) {
      if (!INDEXABLE_CHANNEL_TYPES.has(channel.type)) continue;
      const slug = channel.normalizedName;
      if (!slug) continue;
      const channelIdentifiers = [channel.id, slug, ...channel.aliases, ...channel.sourceIds]
        .map((value) => normalizeTvToken(value));
      if (!channelIdentifiers.some((identifier) => scheduledChannelIds.has(identifier))) continue;
      urls.push({
        loc: channelPagePath(slug),
        lastmod: todayIso,
        changefreq: 'weekly',
        priority: 0.7,
      });
    }
    return this.renderUrlset(urls);
  }

  private async buildProgramsSitemap(): Promise<string> {
    const today = new Date();
    const todayYmd = this.formatYmd(today);

    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowYmd = this.formatYmd(tomorrow);

    const urls: SitemapUrlEntry[] = [];
    const seenSlugs = new Set<string>();

    if (this.tvReadQueryService) {
      const rows = await this.tvReadQueryService.getIndexableProgramSitemapRows([
        todayYmd,
        tomorrowYmd,
      ]);
      // lastmod = the newest change among the airings the page lists, never the airing start (tomorrow's airings
      // made it a future date).
      const lastChanged = new Map<string, number>();
      for (const row of rows) {
        const slug = slugifyTitle(row.title);
        if (slug === 'sin-titulo') continue;
        const changed = row.updatedAt ? new Date(row.updatedAt).getTime() : NaN;
        lastChanged.set(slug, Math.max(lastChanged.get(slug) ?? -Infinity, Number.isNaN(changed) ? -Infinity : changed));
      }
      const resolvable = await this.filterEligible([...lastChanged.keys()]);
      for (const [slug, changed] of lastChanged) {
        if (!resolvable.has(slug)) continue;
        urls.push({
          loc: `/programas/${slug}`,
          lastmod: Number.isFinite(changed) ? this.formatLastmod(new Date(changed)) : undefined,
          changefreq: 'daily',
          priority: 0.6,
        });
      }
      return this.renderUrlset(urls);
    }

    // Compatibility fallback for installations that have not enabled the TV
    // read model. Production uses the branch above, matching the collection
    // queried by the public slug resolver.
    const [programsToday, programsTomorrow] = await Promise.all([
      this.programRepository.findByDate(todayYmd, 'minimal'),
      this.programRepository.findByDate(tomorrowYmd, 'minimal'),
    ]);
    const allPrograms = [...programsToday, ...programsTomorrow];

    for (const program of allPrograms) {
      // Only include TMDB-enriched programs (not ephemeral EPG-only). M09-B: with no page lookup there is no
      // disposition, and a TMDB-matched programme is never `standalone`, so the policy keeps it out.
      if (!program.tmdbId) continue;
      const slug = slugifyTitle(program.title);
      if (slug === 'sin-titulo' || seenSlugs.has(slug) || programmePolicyApplies(slug)) continue;
      seenSlugs.add(slug);
      // The repository rows carry no change time; the airing start is not one.
      urls.push({
        loc: `/programas/${slug}`,
        changefreq: 'daily',
        priority: 0.6,
      });
    }
    return this.renderUrlset(urls);
  }

  /**
   * Slugs whose page resolves and, where the M09-B policy applies, is `standalone` (ProgrammeSeoPolicy). Bounded
   * parallel check; a lookup failure propagates so a database outage never caches a truncated sitemap.
   */
  private async filterEligible(slugs: string[]): Promise<Set<string>> {
    if (!this.programSlugDisposition) return new Set(slugs.filter((slug) => !programmePolicyApplies(slug)));
    const ok = new Set<string>();
    const queue = [...slugs];
    await Promise.all(Array.from({ length: 8 }, async () => {
      for (let slug = queue.shift(); slug !== undefined; slug = queue.shift()) {
        try {
          const disposition = await this.programSlugDisposition!(slug);
          if (disposition && (disposition === 'standalone' || !programmePolicyApplies(slug))) ok.add(slug);
        } catch (error) {
          queue.length = 0; // stop the other workers: the build fails as a whole
          throw error;
        }
      }
    }));
    return ok;
  }

  private async buildBlogSitemap(): Promise<string> {
    const urls: SitemapUrlEntry[] = [];

    const posts = await BlogPostModel.find(PUBLIC_EDITORIAL_FILTER)
      .select({ slug: 1, publishedAt: 1, updatedAt: 1, categories: 1, contentType: 1 })
      .lean()
      .exec();
    const postChanged = (post: (typeof posts)[number]) => new Date(post.updatedAt || post.publishedAt || NaN).getTime();
    // A listing changes when one of its posts does.
    const newest = (list: typeof posts) => this.formatLastmod(new Date(Math.max(...list.map(postChanged).filter(Number.isFinite))));

    // The rankings hub is only worth indexing once at least one ranking is published.
    const rankings = posts.filter((post) => (post as { contentType?: string }).contentType === 'ranking');
    if (rankings.length) {
      urls.push({ loc: '/guias/rankings', lastmod: newest(rankings), changefreq: 'weekly', priority: 0.7 });
    }

    const categoryPosts = new Map<string, typeof posts>();
    for (const post of posts) {
      if (post.slug) {
        urls.push({
          loc: `/guias/${post.slug}`,
          lastmod: this.formatLastmod(post.updatedAt || post.publishedAt),
          changefreq: 'weekly',
          priority: 0.7,
        });
      }
      const postCategorySlugs = new Set<string>();
      for (const category of (post.categories || []) as any[]) {
        if (category?.slug) postCategorySlugs.add(category.slug);
      }
      for (const slug of postCategorySlugs) {
        categoryPosts.set(slug, [...(categoryPosts.get(slug) || []), post]);
      }
    }

    for (const [slug, list] of categoryPosts) {
      // `/guias/categoria/rankings` 301s to the rankings hub listed above.
      if (list.length < 3 || slug === 'rankings') continue;
      urls.push({
        loc: `/guias/categoria/${slug}`,
        lastmod: newest(list),
        changefreq: 'weekly',
        priority: 0.5,
      });
    }
    return this.renderUrlset(urls);
  }

  /** Provider-only detail pages stay discoverable to users but are not SEO inventory. */
  private async buildFootballSitemap(): Promise<string> {
    return this.renderUrlset([]);
  }

  private async buildStreamingSitemap(): Promise<string> {
    const todayIso = this.formatLastmod(new Date());

    // Keep this child sitemap non-empty: Search Console rejects an empty
    // urlset even though it is well-formed XML. These are stable, public
    // streaming surfaces; provider-only catalogue detail pages stay out
    // until they have a guaranteed indexable resolver.
    return this.renderUrlset([
      { loc: '/plataformas', lastmod: todayIso, changefreq: 'daily', priority: 0.9 },
      { loc: '/comparador-streaming', lastmod: todayIso, changefreq: 'weekly', priority: 0.8 },
      { loc: '/programacion-tv/peliculas', lastmod: todayIso, changefreq: 'daily', priority: 0.9 },
      { loc: '/programacion-tv/series', lastmod: todayIso, changefreq: 'daily', priority: 0.9 },
    ]);
  }

  /* ------------------------------------------------------------------ */
  /*  Static URL definitions                                             */
  /* ------------------------------------------------------------------ */

  /**
   * `today` only on pages whose content is the day's schedule or catalogue (regenerated daily). Hubs and stable
   * pages carry no lastmod: the sitemap is built on every request, so "today" there would claim a change that
   * did not happen.
   */
  private getStaticUrls(today: string | undefined): SitemapUrlEntry[] {
    return [
      { loc: '/', lastmod: today, changefreq: 'daily', priority: 1.0 },
      { loc: '/programacion-tv/que-ver-hoy', lastmod: today, changefreq: 'daily', priority: 0.9 },
      { loc: '/programacion-tv/en-directo', lastmod: today, changefreq: 'hourly', priority: 0.9 },
      { loc: '/canales', lastmod: today, changefreq: 'hourly', priority: 0.8 },
      { loc: '/programacion-tv/peliculas', lastmod: today, changefreq: 'daily', priority: 0.9 },
      { loc: '/programacion-tv/series', lastmod: today, changefreq: 'daily', priority: 0.9 },
      { loc: '/plataformas', lastmod: today, changefreq: 'daily', priority: 0.9 },
      { loc: '/deportes/futbol', lastmod: today, changefreq: 'hourly', priority: 0.9 },
      { loc: '/deportes/futbol/partidos-hoy', lastmod: today, changefreq: 'hourly', priority: 0.8 },
      { loc: '/deportes/futbol/competiciones', lastmod: today, changefreq: 'daily', priority: 0.8 },
      { loc: '/deportes/futbol/noticias', changefreq: 'daily', priority: 0.7 },
      { loc: '/comparador-streaming', changefreq: 'weekly', priority: 0.8 },
      { loc: '/guias', changefreq: 'daily', priority: 0.8 },
      { loc: '/sobre-nosotros', changefreq: 'monthly', priority: 0.6 },
      { loc: '/prensa', changefreq: 'monthly', priority: 0.5 },
      { loc: '/developers', changefreq: 'monthly', priority: 0.5 },
      { loc: '/embed', changefreq: 'monthly', priority: 0.4 },
      { loc: '/avisolegal', changefreq: 'monthly', priority: 0.3 },
      { loc: '/politica-editorial', changefreq: 'monthly', priority: 0.3 },
      { loc: '/privacidad', changefreq: 'monthly', priority: 0.3 },
      { loc: '/cookies', changefreq: 'monthly', priority: 0.3 },
      { loc: '/terminos', changefreq: 'monthly', priority: 0.3 },
      { loc: '/accesibilidad', changefreq: 'monthly', priority: 0.3 },
    ];
  }

  /* ------------------------------------------------------------------ */
  /*  XML rendering                                                      */
  /* ------------------------------------------------------------------ */

  private renderUrlset(urls: SitemapUrlEntry[]): string {
    const baseUrl = this.getBaseUrl();
    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ];

    const policy = entityPublicReadPolicy();
    const mode = policy.readMode();
    const canary = mode === 'canary' ? policy.canaryPaths() : null;
    for (const url of urls) {
      if (mode === 'all' && /^\/(peliculas|series|programas)\/[^/]+\/?$/.test(url.loc)) continue;
      if (canary?.has(normalizeEntityPath(url.loc))) continue;
      const loc = this.escapeXml(this.joinUrl(baseUrl, url.loc));
      lines.push('  <url>');
      lines.push(`    <loc>${loc}</loc>`);
      if (url.lastmod) lines.push(`    <lastmod>${url.lastmod}</lastmod>`);
      if (url.changefreq) lines.push(`    <changefreq>${url.changefreq}</changefreq>`);
      if (url.priority !== undefined) lines.push(`    <priority>${url.priority.toFixed(1)}</priority>`);
      lines.push('  </url>');
    }

    lines.push('</urlset>');
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ */
  /*  Utilities                                                          */
  /* ------------------------------------------------------------------ */

  private getBaseUrl(): string {
    const envUrl =
      process.env.SITE_URL ||
      process.env.PUBLIC_SITE_URL ||
      process.env.APP_BASE_URL;
    if (envUrl && typeof envUrl === 'string') {
      return envUrl.replace(/\/+$/, '');
    }
    return DEFAULT_BASE_URL;
  }

  private joinUrl(baseUrl: string, path: string): string {
    if (!path) return baseUrl;
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return path.startsWith('/') ? `${baseUrl}${path}` : `${baseUrl}/${path}`;
  }

  /** W3C date of a real content change: nothing when the change time is unknown, never a date in the future. */
  private formatLastmod(date?: Date | string | null): string | undefined {
    const time = date ? new Date(date).getTime() : NaN;
    if (!Number.isFinite(time)) return undefined;
    return new Date(Math.min(time, Date.now())).toISOString().split('T')[0];
  }

  private formatYmd(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /** Matches Channel.normalizedName: NFD-normalize to strip diacritics */
  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
