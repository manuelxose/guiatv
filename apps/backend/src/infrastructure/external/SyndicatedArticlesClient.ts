import axios, { AxiosInstance } from 'axios';

/**
 * A site that publishes articles into its own API so consumers can pull them (BabyLoveGrowth, and Auctorio's
 * `/api/integrations` feed). It is rate limited, so the sync reads each page once and stores the result: no page
 * view ever calls it. The key comes from the environment (server-only, never in the frontend build).
 */
export const BABYLOVEGROWTH_BASE_URL = 'https://api.babylovegrowth.ai/api/integrations';
export const AUCTORIO_BASE_URL = 'https://auctorio.com/api/integrations';
/** Both feeds refuse anything larger. */
export const SYNDICATED_MAX_PAGE = 50;

export type ArticleFeedProvider = 'babylovegrowth' | 'auctorio';

export interface SyndicatedArticleSummary {
  id: string;
  slug?: string;
  title?: string;
  publishedAt?: string;
  languageCode?: string;
  meta_description?: string;
  hero_image_url?: string;
  published_url?: string;
}

export interface SyndicatedArticle extends SyndicatedArticleSummary {
  content_html?: string;
  content_markdown?: string;
  jsonLd?: unknown;
  faqJsonLd?: unknown;
}

export class SyndicatedFeedRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'SyndicatedFeedRequestError';
  }
}

export interface SyndicatedArticlesClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  attempts?: number;
  /** Extra query parameters on every request (Auctorio scopes its feed with `site`). */
  defaults?: Record<string, string>;
  sleep?: (ms: number) => Promise<void>;
}

type Row = Record<string, unknown>;

const isObject = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** The envelope is not part of the contract; accept an array or the usual wrapper keys (`data`/`items`/`articles`…). */
const rowsOf = (payload: unknown): Row[] => {
  if (Array.isArray(payload)) return payload.filter(isObject);
  if (!isObject(payload)) return [];
  for (const key of ['items', 'articles', 'data', 'results', 'posts']) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isObject);
    if (isObject(value)) {
      const nested = rowsOf(value);
      if (nested.length) return nested;
    }
  }
  return [];
};

const objectOf = (payload: unknown): Row | null => {
  if (!isObject(payload)) return null;
  for (const key of ['article', 'item', 'data', 'result']) {
    const value = payload[key];
    if (isObject(value)) return objectOf(value) ?? value;
  }
  return payload;
};

export class SyndicatedArticlesClient {
  private readonly http: AxiosInstance;
  private readonly attempts: number;
  private readonly defaults: Record<string, string>;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: SyndicatedArticlesClientOptions) {
    const apiKey = String(options.apiKey || '').trim();
    if (!apiKey) throw new SyndicatedFeedRequestError('A feed API key is required');
    this.http = axios.create({
      baseURL: String(options.baseUrl || BABYLOVEGROWTH_BASE_URL).replace(/\/+$/, ''),
      timeout: options.timeoutMs ?? 20_000,
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    });
    this.attempts = Math.max(1, options.attempts ?? 3);
    this.defaults = { ...(options.defaults ?? {}) };
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Newest first. A page shorter than `limit` is the last one. */
  async listArticles(limit = SYNDICATED_MAX_PAGE, offset = 0): Promise<SyndicatedArticleSummary[]> {
    const payload = await this.get('/v1/articles', { limit, offset });
    return rowsOf(payload)
      .map((row) => ({ ...row, id: String(row.id ?? '').trim() }) as unknown as SyndicatedArticleSummary)
      .filter((row) => row.id);
  }

  async getArticle(id: string): Promise<SyndicatedArticle> {
    const payload = await this.get(`/v1/articles/${encodeURIComponent(id)}`, {});
    const article = objectOf(payload);
    if (!article) throw new SyndicatedFeedRequestError(`Article ${id} returned no object`);
    return { ...article, id: String(article.id ?? id) } as unknown as SyndicatedArticle;
  }

  private async get(path: string, params: Record<string, number>): Promise<unknown> {
    let lastError: unknown;
    let lastStatus: number | undefined;
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        const response = await this.http.get(path, { params: { ...this.defaults, ...params } });
        return response.data;
      } catch (error) {
        lastError = error;
        lastStatus = axios.isAxiosError(error) ? error.response?.status : undefined;
        const retryable = lastStatus === undefined || lastStatus === 429 || lastStatus >= 500;
        if (!retryable || attempt === this.attempts) break;
        const retryAfter = Number(axios.isAxiosError(error) ? error.response?.headers?.['retry-after'] : NaN);
        await this.sleep(
          Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : 1000 * 2 ** (attempt - 1)
        );
      }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new SyndicatedFeedRequestError(`GET ${path} failed (${lastStatus ?? 'no response'}): ${message}`, lastStatus);
  }
}
