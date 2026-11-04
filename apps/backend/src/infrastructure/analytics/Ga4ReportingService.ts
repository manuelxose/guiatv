import { logger } from '../../shared/utils/logger';

/**
 * Aggregate GA4 reporting through the Google Analytics Data API (read-only scope), for the admin panel only.
 *
 * Configuration (outside the repository):
 *   ANALYTICS_GA4_PROPERTY_ID=<numeric GA4 property id>
 *   ANALYTICS_GA4_CREDENTIALS_FILE=/etc/guiatv/ga4-reader.json   (service account with the GA4 "Viewer" role only)
 *
 * Demographics (age, gender, interests) exist in GA4 only when Google signals is enabled for the property and
 * enough users are observed; GA4 applies thresholds and returns "unknown"/no rows otherwise. This service returns
 * exactly what GA4 returns, flags thresholding, and never estimates, fills in or infers values.
 * Results are cached in memory (6 h) so the admin panel never fans out to Google per page view.
 */
export type Ga4Dimension = 'userAgeBracket' | 'userGender' | 'brandingInterest' | 'country' | 'sessionDefaultChannelGroup';

export interface Ga4BreakdownRow {
  value: string;
  activeUsers: number;
}

export interface Ga4Breakdown {
  dimension: Ga4Dimension;
  rows: Ga4BreakdownRow[];
  totalUsers: number;
  /** GA4 withheld or thresholded data (`subjectToThresholding`, `(other)` rows, or only "unknown" values). */
  thresholded: boolean;
}

export type Ga4ReportResult =
  | { available: true; propertyId: string; days: number; generatedAt: string; cached: boolean; breakdowns: Ga4Breakdown[] }
  | { available: false; reason: 'not_configured' | 'credentials_error' | 'api_error' | 'timeout'; message: string };

type TokenProvider = () => Promise<string>;
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

const CACHE_MS = 6 * 60 * 60_000;
const TIMEOUT_MS = 8_000;
const DEMOGRAPHIC_DIMENSIONS: Ga4Dimension[] = ['userAgeBracket', 'userGender', 'brandingInterest'];

export class Ga4ReportingService {
  private cache = new Map<string, { at: number; value: Ga4ReportResult }>();
  private inflight = new Map<string, Promise<Ga4ReportResult>>();

  constructor(
    private readonly propertyId: string | undefined = process.env.ANALYTICS_GA4_PROPERTY_ID,
    private readonly credentialsFile: string | undefined = process.env.ANALYTICS_GA4_CREDENTIALS_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS,
    private readonly tokenProvider?: TokenProvider,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly now: () => number = Date.now
  ) {}

  get configured(): boolean {
    return Boolean(this.propertyId && /^\d{5,15}$/.test(this.propertyId) && (this.credentialsFile || this.tokenProvider));
  }

  async demographics(days = 28): Promise<Ga4ReportResult> {
    return this.report(DEMOGRAPHIC_DIMENSIONS, days);
  }

  async report(dimensions: Ga4Dimension[], days: number): Promise<Ga4ReportResult> {
    if (!this.configured) {
      return { available: false, reason: 'not_configured', message: 'GA4 Data API no configurada (ANALYTICS_GA4_PROPERTY_ID y credenciales de solo lectura).' };
    }
    const span = Math.min(Math.max(Math.floor(days), 1), 90);
    const key = `${dimensions.join(',')}:${span}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_MS) return hit.value.available ? { ...hit.value, cached: true } : hit.value;
    const running = this.inflight.get(key);
    if (running) return running;
    const task = this.fetchReport(dimensions, span).finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    const value = await task;
    // Errors are cached briefly too (5 min) so a broken credential does not hammer Google.
    this.cache.set(key, { at: value.available ? this.now() : this.now() - CACHE_MS + 5 * 60_000, value });
    return value;
  }

  private async token(): Promise<string> {
    if (this.tokenProvider) return this.tokenProvider();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { GoogleAuth } = require('google-auth-library') as typeof import('google-auth-library');
    const auth = new GoogleAuth({ keyFile: this.credentialsFile, scopes: ['https://www.googleapis.com/auth/analytics.readonly'] });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token?.token) throw new Error('no access token');
    return token.token;
  }

  private async fetchReport(dimensions: Ga4Dimension[], days: number): Promise<Ga4ReportResult> {
    let token: string;
    try {
      token = await this.token();
    } catch (error) {
      logger.warn('[Analytics] GA4 credentials unavailable', { error: (error as Error).message });
      return { available: false, reason: 'credentials_error', message: 'No se pudieron obtener credenciales de solo lectura para GA4.' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const breakdowns = await Promise.all(dimensions.map(async (dimension) => {
        const response = await this.fetchImpl(`https://analyticsdata.googleapis.com/v1beta/properties/${this.propertyId}:runReport`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }],
            dimensions: [{ name: dimension }],
            metrics: [{ name: 'activeUsers' }],
            orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
            limit: 25,
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`GA4 Data API ${response.status}`);
        return parseBreakdown(dimension, await response.json());
      }));
      return { available: true, propertyId: this.propertyId!, days, generatedAt: new Date(this.now()).toISOString(), cached: false, breakdowns };
    } catch (error) {
      const aborted = controller.signal.aborted;
      logger.warn('[Analytics] GA4 report failed', { error: (error as Error).message, aborted });
      return aborted
        ? { available: false, reason: 'timeout', message: 'GA4 no respondió a tiempo.' }
        : { available: false, reason: 'api_error', message: 'GA4 rechazó la consulta (revisa el ID de propiedad y los permisos de la cuenta de servicio).' };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function parseBreakdown(dimension: Ga4Dimension, body: any): Ga4Breakdown {
  const rows: Ga4BreakdownRow[] = (Array.isArray(body?.rows) ? body.rows : [])
    .map((row: any) => ({ value: String(row?.dimensionValues?.[0]?.value ?? ''), activeUsers: Number(row?.metricValues?.[0]?.value ?? 0) }))
    .filter((row: Ga4BreakdownRow) => row.value && Number.isFinite(row.activeUsers));
  const known = rows.filter((row) => !['unknown', '(not set)', '(other)'].includes(row.value.toLowerCase()));
  return {
    dimension,
    rows,
    totalUsers: rows.reduce((sum, row) => sum + row.activeUsers, 0),
    thresholded: Boolean(body?.metadata?.subjectToThresholding) || Boolean(body?.metadata?.dataLossFromOtherRow) || (rows.length > 0 && known.length === 0),
  };
}
