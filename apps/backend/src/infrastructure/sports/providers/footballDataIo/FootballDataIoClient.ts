/**
 * footballdata.io HTTP client (M07).
 *
 * Bearer-key auth (`FOOTBALLDATA_IO_API_KEY`), injected fetch, AbortSignal
 * timeout and typed failures. The free plan is a MONTHLY quota (1000 requests,
 * 5 leagues, probe 2026-11-09), so every call here must be paid for by a
 * durable budget before it is made; this client never retries.
 */

import { assertEligible } from '../eligibility/providerEligibilityRegistry';
import type { FetchLike, FetchResponse } from '../openLigaDb/OpenLigaDbClient';

export type FootballDataIoFailureKind = 'timeout' | 'rate_limited' | 'auth' | 'http' | 'malformed';

export class FootballDataIoError extends Error {
  constructor(readonly kind: FootballDataIoFailureKind, message: string, readonly status?: number) {
    super(message);
    this.name = 'FootballDataIoError';
  }
}

export interface FootballDataIoClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://footballdata.io/api/v1';

export class FootballDataIoClient {
  constructor(private readonly fetchImpl: FetchLike, private readonly options: FootballDataIoClientOptions) {
    assertEligible('footballdata-io');
    if (!options.apiKey) throw new FootballDataIoError('auth', 'footballdata.io API key is not configured');
  }

  /** Matches of every licensed league between two YYYY-MM-DD days (one request). */
  getMatches(from: string, to: string, limit = 100): Promise<unknown> {
    return this.get(`/matches?from=${from}&to=${to}&limit=${limit}`);
  }

  /** Finished matches WITH statistics between two days, one page per request. */
  getResults(from: string, to: string, page = 1, limit = 100): Promise<unknown> {
    return this.get(`/fixtures/results?from=${from}&to=${to}&page=${page}&limit=${limit}`);
  }

  /** The provider's own current table for a league (one request). */
  getStandings(leagueId: number): Promise<unknown> {
    return this.get(`/leagues/${leagueId}/standings`);
  }

  private async get(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    let response: FetchResponse;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl ?? DEFAULT_BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${this.options.apiKey}`, Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
      throw new FootballDataIoError(aborted ? 'timeout' : 'http', aborted ? 'footballdata.io request timed out' : 'footballdata.io network failure');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const s = response.status;
      throw new FootballDataIoError(s === 429 ? 'rate_limited' : s === 401 || s === 403 ? 'auth' : 'http', `footballdata.io HTTP ${s}`, s);
    }
    try {
      return await response.json();
    } catch {
      throw new FootballDataIoError('malformed', 'footballdata.io response is not valid JSON', response.status);
    }
  }
}
