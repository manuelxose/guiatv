import { GoogleAuth } from 'google-auth-library';
import { existsSync } from 'fs';
import { BlogPostModel } from '../../infrastructure/database/models/BlogPost.model';
import { PUBLIC_EDITORIAL_FILTER } from './EditorialReviewPolicy';

/**
 * Read-only Search Console monitoring of the public guides (/guias/<slug>): URL Inspection and Search Analytics.
 * Stores only what Google returns. Never uses the Indexing API.
 */

const READONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API = 'https://searchconsole.googleapis.com';
const ORIGIN = 'https://guiaprogramaciontv.com';
export const GSC_WINDOW_DAYS = 28;
const DAY = 864e5;
// Inspection quota is 2000/day and 600/min per property; sequential calls stay far below the per-minute cap.
const MAX_INSPECTIONS_PER_RUN = 500;

const db = () => BlogPostModel.db;
const inspections = () => db().collection('editorial_gsc_inspections');
const performance = () => db().collection('editorial_gsc_performance');
const runs = () => db().collection('editorial_gsc_runs');

export type GscRunStatus = 'ok' | 'partial' | 'missing-credentials' | 'auth-error' | 'forbidden' | 'quota-exceeded' | 'error';

export interface GscRun {
  siteUrl: string;
  startedAt: Date;
  finishedAt?: Date;
  status: GscRunStatus;
  message: string | null;
  inspected: number;
  skipped: number;
  inspectionErrors: number;
  pageRows: number;
  queryRows: number;
}

export interface SearchConsoleMonitorOptions {
  siteUrl?: string;
  now?: Date;
  fetch?: typeof fetch;
  /** Injected in tests; otherwise a read-only token for the GOOGLE_APPLICATION_CREDENTIALS service account. */
  getToken?: () => Promise<string>;
}

class MissingCredentials extends Error {}
class GscHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export const gscSiteUrl = () => (process.env.GSC_SITE_URL || ORIGIN).trim().replace(/\/+$/, '');
export const guideUrl = (slug: string) => `${ORIGIN}/guias/${slug}`;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function serviceAccountToken(): Promise<string> {
  const path = (process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (!path) throw new MissingCredentials('GOOGLE_APPLICATION_CREDENTIALS is not set');
  if (!existsSync(path)) throw new MissingCredentials(`Credentials file not found: ${path}`);
  const client = await new GoogleAuth({ scopes: [READONLY_SCOPE] }).getClient();
  const token = await client.getAccessToken();
  const value = typeof token === 'string' ? token : token?.token;
  if (!value) throw new Error('No access token returned for the service account');
  return value;
}

/** Google's own error message only: the request carries the bearer token, the response never does. */
function googleMessage(text: string): string {
  try { return String(JSON.parse(text)?.error?.message ?? text).slice(0, 300); } catch { return text.slice(0, 300); }
}

export async function runSearchConsoleMonitor(options: SearchConsoleMonitorOptions = {}): Promise<GscRun> {
  const now = options.now ?? new Date();
  const siteUrl = options.siteUrl ?? gscSiteUrl();
  const fetchImpl = options.fetch ?? fetch;
  const run: GscRun = { siteUrl, startedAt: now, status: 'ok', message: null, inspected: 0, skipped: 0, inspectionErrors: 0, pageRows: 0, queryRows: 0 };

  try {
    let token: string;
    try {
      token = await (options.getToken ?? serviceAccountToken)();
    } catch (error) {
      if (error instanceof MissingCredentials) throw error;
      throw new GscHttpError(401, `Could not obtain an access token: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown error'}`);
    }
    const post = async (url: string, body: unknown) => {
      const res = await fetchImpl(url, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new GscHttpError(res.status, `HTTP ${res.status}: ${googleMessage(text)}`);
      return text ? JSON.parse(text) : {};
    };

    // Search Analytics first: two calls, and an inspection quota stop must not cost the performance data.
    await performance().createIndex({ date: 1, page: 1, query: 1 }, { unique: true });
    const searchUrl = `${API}/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    for (const dimensions of [['date', 'page'], ['date', 'page', 'query']]) {
      // shortcut: one page of up to 25000 rows, no startRow paging; enough for the guide count, page if it grows.
      const data = await post(searchUrl, {
        startDate: isoDay(now.getTime() - (GSC_WINDOW_DAYS - 1) * DAY), endDate: isoDay(now.getTime()), dimensions,
        dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'contains', expression: '/guias/' }] }],
        dataState: 'all', rowLimit: 25000,
      });
      const firstIncomplete: string | undefined = data.metadata?.firstIncompleteDate;
      const rows: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }> = data.rows ?? [];
      // Only what Google returned: a missing day stays missing, never a zero row.
      if (rows.length) {
        await performance().bulkWrite(rows.map(({ keys: [date, page, query = null], clicks, impressions, ctr, position }) => ({
          updateOne: {
            filter: { date, page, query },
            update: { $set: { clicks, impressions, ctr, position, preliminary: Boolean(firstIncomplete && date >= firstIncomplete), fetchedAt: now } },
            upsert: true,
          },
        })));
      }
      if (dimensions.length === 2) run.pageRows = rows.length; else run.queryRows = rows.length;
    }

    // The URL Inspection API reports Google's indexed copy; it does not live-crawl the page.
    await inspections().createIndex({ url: 1 }, { unique: true });
    const guides = await BlogPostModel.find(PUBLIC_EDITORIAL_FILTER).select({ slug: 1 }).sort({ publishedAt: -1 }).lean().exec();
    const fresh = new Set((await inspections().find({ inspectedAt: { $gt: new Date(now.getTime() - DAY) }, error: null }, { projection: { url: 1 } }).toArray()).map((d) => d.url));
    for (const url of guides.filter((g) => g.slug).map((g) => guideUrl(String(g.slug)))) {
      if (fresh.has(url) || run.inspected + run.inspectionErrors >= MAX_INSPECTIONS_PER_RUN) { run.skipped++; continue; }
      try {
        const r = (await post(`${API}/v1/urlInspection/index:inspect`, { inspectionUrl: url, siteUrl, languageCode: 'es' })).inspectionResult?.indexStatusResult ?? {};
        await inspections().updateOne({ url }, { $set: {
          url, inspectedAt: now, verdict: r.verdict ?? null, coverageState: r.coverageState ?? null, indexingState: r.indexingState ?? null,
          robotsTxtState: r.robotsTxtState ?? null, pageFetchState: r.pageFetchState ?? null, lastCrawlTime: r.lastCrawlTime ?? null,
          googleCanonical: r.googleCanonical ?? null, userCanonical: r.userCanonical ?? null, sitemaps: r.sitemap ?? [], error: null,
        } }, { upsert: true });
        run.inspected++;
      } catch (error) {
        if (error instanceof GscHttpError && (error.status === 403 || error.status === 429 || error.status === 401)) throw error;
        await inspections().updateOne({ url }, { $set: { url, errorAt: now, error: error instanceof Error ? error.message.slice(0, 300) : 'unknown error' } }, { upsert: true });
        run.inspectionErrors++;
      }
    }
    if (run.inspectionErrors) { run.status = 'partial'; run.message = `${run.inspectionErrors} inspection(s) failed`; }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    if (error instanceof MissingCredentials) { run.status = 'missing-credentials'; run.message = message; }
    else if (error instanceof GscHttpError && error.status === 429) { run.status = 'quota-exceeded'; run.message = `Search Console quota exhausted, run stopped: ${message}`; }
    else if (error instanceof GscHttpError && error.status === 403) { run.status = 'forbidden'; run.message = `The service account has no permission on ${siteUrl}: ${message}`; }
    else if (error instanceof GscHttpError && error.status === 401) { run.status = 'auth-error'; run.message = message; }
    else { run.status = 'error'; run.message = message.slice(0, 300); }
  }
  run.finishedAt = new Date();
  await runs().insertOne({ ...run });
  return run;
}

/** Admin view: what we serve (public guide, 200, index,follow, in sitemap) vs what Google reports. */
export async function searchConsoleOverview(now = new Date()) {
  const windowStart = isoDay(now.getTime() - (GSC_WINDOW_DAYS - 1) * DAY);
  const guides = await BlogPostModel.find(PUBLIC_EDITORIAL_FILTER).select({ slug: 1, title: 1 }).sort({ publishedAt: -1 }).limit(100).lean().exec();
  const urls = guides.filter((g) => g.slug).map((g) => guideUrl(String(g.slug)));
  const pageRows = { query: null, date: { $gte: windowStart } };
  const [lastRun, inspected, perf, siteDays] = await Promise.all([
    runs().find({}, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(1).next(),
    inspections().find({ url: { $in: urls } }, { projection: { _id: 0 } }).toArray(),
    performance().aggregate<{ _id: string; clicks: number; impressions: number; weighted: number; days: string[]; preliminary: boolean }>([
      { $match: { ...pageRows, page: { $in: urls } } },
      { $group: { _id: '$page', clicks: { $sum: '$clicks' }, impressions: { $sum: '$impressions' }, weighted: { $sum: { $multiply: ['$position', '$impressions'] } }, days: { $addToSet: '$date' }, preliminary: { $max: '$preliminary' } } },
    ]).toArray(),
    performance().distinct('date', pageRows),
  ]);
  const byUrl = new Map(inspected.map((i) => [i.url, i]));
  const perfByUrl = new Map(perf.map((p) => [p._id, p]));
  return {
    enabled: /^(1|true|yes|on)$/i.test((process.env.GSC_MONITOR_ENABLED || '').trim()),
    windowDays: GSC_WINDOW_DAYS,
    lastRun,
    baseline: { days: siteDays.length, complete: siteDays.length >= GSC_WINDOW_DAYS },
    guides: guides.filter((g) => g.slug).map((g) => {
      const url = guideUrl(String(g.slug));
      const i = byUrl.get(url);
      const p = perfByUrl.get(url);
      return {
        slug: g.slug, title: g.title, url,
        inspection: i ? {
          inspectedAt: i.inspectedAt ?? null, verdict: i.verdict ?? null, coverageState: i.coverageState ?? null,
          indexed: i.verdict === 'PASS', lastCrawlTime: i.lastCrawlTime ?? null, googleCanonical: i.googleCanonical ?? null,
          canonicalMatch: i.googleCanonical ? i.googleCanonical === (i.userCanonical || url) : null, error: i.error ?? null,
        } : null,
        // null, not zeros, when Google returned no rows for the page.
        performance: p ? {
          clicks: p.clicks, impressions: p.impressions,
          ctr: p.impressions ? p.clicks / p.impressions : null, position: p.impressions ? p.weighted / p.impressions : null,
          days: p.days.length, baselineComplete: p.days.length >= GSC_WINDOW_DAYS, preliminary: Boolean(p.preliminary),
        } : null,
      };
    }),
  };
}
