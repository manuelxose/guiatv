/**
 * OpenLigaDB HTTP client.
 *
 * Plain injected fetch (never a hard dependency), an AbortSignal timeout, a
 * caller-supplied User-Agent, and failure classification into a typed
 * `OpenLigaDbError` — never a raw network/parse error propagated upward.
 *
 * Reference facts (captain probe, 2026-11-06): `GET /getmatchdata/bl1/2026`
 * returns HTTP 200, no auth, no documented rate limit.
 */

import { assertEligible } from '../eligibility/providerEligibilityRegistry';

export type OpenLigaDbFailureKind = 'timeout' | 'rate_limited' | 'auth' | 'http' | 'malformed';

export interface OpenLigaDbFailure {
  kind: OpenLigaDbFailureKind;
  status?: number;
  message: string;
}

export class OpenLigaDbError extends Error {
  readonly kind: OpenLigaDbFailureKind;
  readonly status?: number;

  constructor(failure: OpenLigaDbFailure) {
    super(failure.message);
    this.name = 'OpenLigaDbError';
    this.kind = failure.kind;
    this.status = failure.status;
  }
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<FetchResponse>;

export interface OpenLigaDbClientOptions {
  baseUrl?: string;
  userAgent?: string;
  timeoutMs?: number;
  clock?: () => number;
}

const DEFAULT_BASE_URL = 'https://api.openligadb.de';
const DEFAULT_TIMEOUT_MS = 10_000;

export class OpenLigaDbClient {
  private readonly fetchImpl: FetchLike;
  private readonly options: OpenLigaDbClientOptions;

  constructor(fetchImpl: FetchLike, options: OpenLigaDbClientOptions = {}) {
    // F05: the single enforced admission boundary. A provider client can only be
    // constructed AFTER the eligibility registry admits the provider, so a
    // blocked/prototype provider can never be constructed, issue a request, or
    // write. This runs before `fetchImpl` is retained and before any external
    // call, and it is the ONLY gate the ingestion paths pass through (scheduled
    // loop, manual sync, CLI, startup/recovery all build this client via the
    // factory — there is no separate fallback adapter).
    assertEligible('openligadb');
    this.fetchImpl = fetchImpl;
    this.options = options;
  }

  /** Fetches all match data for a league season (`/getmatchdata/{league}/{season}`). */
  async getMatchdata(leagueShortcut: string, season: string | number): Promise<unknown> {
    const url = `${this.baseUrl()}/getmatchdata/${encodeURIComponent(String(leagueShortcut))}/${encodeURIComponent(String(season))}`;
    return this.fetchJson(url);
  }

  private baseUrl(): string {
    return this.options.baseUrl ?? DEFAULT_BASE_URL;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: FetchResponse;
    try {
      response = await this.fetchImpl(url, {
        headers: { 'User-Agent': this.options.userAgent ?? 'guiatv-m05-ingestion/1.0' },
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new OpenLigaDbError({ kind: 'timeout', message: 'OpenLigaDB request timed out' });
      }
      throw new OpenLigaDbError({ kind: 'http', message: 'OpenLigaDB network failure' });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const status = response.status;
      const kind = status === 429 ? 'rate_limited' : status === 401 || status === 403 ? 'auth' : 'http';
      throw new OpenLigaDbError({ kind, status, message: `OpenLigaDB HTTP ${status}` });
    }

    try {
      return await response.json();
    } catch {
      throw new OpenLigaDbError({ kind: 'malformed', status: response.status, message: 'OpenLigaDB response is not valid JSON' });
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}
