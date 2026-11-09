/**
 * football-data.org ingestion (M07): fixtures, results and OFFICIAL tables for the
 * leagues no other free source covers (Serie A, Ligue 1, Eredivisie, Primeira Liga,
 * Championship, Brasileirão), plus a second opinion on LaLiga/Premier/Bundesliga/UCL.
 *
 * Probe 2026-11-09 with the owner's free key: 13 competitions, 10 requests/minute
 * (X-Requests-Available-Minute), `/matches?dateFrom&dateTo` returns every licensed
 * competition in ONE request (range ≤ 10 days). Mapping reuses the existing v4
 * mappers; only the competition is resolved against our catalogue by provider code.
 */

import { FootballMatch, FootballStandingRow } from '@/domain/sports/football/types';
import { getCompetitionCatalogBySlug } from '@/application/sports/services/FootballCompetitionCatalog';
import { assertEligible } from '../eligibility/providerEligibilityRegistry';
import type { FetchLike, FetchResponse } from '../openLigaDb/OpenLigaDbClient';
import { mapFootballDataOrgMatch, mapFootballDataOrgStandingRow } from '../FootballDataOrgAdapter';

export const FOOTBALL_DATA_ORG_PROVIDER_ID = 'football-data-org';
export const FOOTBALL_DATA_ORG_WINDOW = 'window';

/** Provider competition code -> catalogue slug. Unknown codes are dropped, never guessed. */
export const FOOTBALL_DATA_ORG_COMPETITIONS: Readonly<Record<string, string>> = {
  SA: 'serie-a',
  FL1: 'ligue-1',
  DED: 'eredivisie',
  PPL: 'primeira-liga',
  ELC: 'championship',
  BSA: 'brasileirao',
  PD: 'laliga',
  PL: 'premier-league',
  BL1: 'bundesliga',
  CL: 'champions-league',
};

/** Competitions whose official table is refreshed (league format; UCL league phase included). */
export const FOOTBALL_DATA_ORG_TABLES = ['SA', 'FL1', 'DED', 'PPL', 'ELC', 'BSA', 'PD', 'PL', 'BL1', 'CL'] as const;

/** 10 requests/minute on the free plan: one request every 6.5 s keeps a safety margin. */
const MIN_SPACING_MS = 6_500;
const DAY_MS = 86_400_000;

export class FootballDataOrgError extends Error {
  constructor(readonly kind: 'timeout' | 'rate_limited' | 'auth' | 'http' | 'malformed', message: string, readonly status?: number) {
    super(message);
    this.name = 'FootballDataOrgError';
  }
}

/**
 * One-off jobs (season backfill, tables) can share the 10/minute window with another
 * process (the API refreshing tables right after a restart) — measured 2026-11-09: three
 * competitions lost to 429 in production. On a rate limit, wait for the window to reset
 * and retry once; any other failure, or a second 429, is thrown to the caller.
 */
export async function retryOnRateLimit<T>(
  run: () => Promise<T>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof FootballDataOrgError && error.kind === 'rate_limited')) throw error;
    await wait(61_000);
    return run();
  }
}

let nextSlot = 0;

export class FootballDataOrgClient {
  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly options: { apiKey: string; baseUrl?: string; timeoutMs?: number; spacingMs?: number }
  ) {
    assertEligible(FOOTBALL_DATA_ORG_PROVIDER_ID);
    if (!options.apiKey) throw new FootballDataOrgError('auth', 'football-data.org API key is not configured');
  }

  getMatches(dateFrom: string, dateTo: string): Promise<unknown> {
    return this.get(`/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`);
  }

  getSeasonMatches(code: string): Promise<unknown> {
    return this.get(`/competitions/${encodeURIComponent(code)}/matches`);
  }

  getStandings(code: string): Promise<unknown> {
    return this.get(`/competitions/${encodeURIComponent(code)}/standings`);
  }

  private async get(path: string): Promise<unknown> {
    // Process-wide spacing: every caller (tick, tables, backfill) shares the per-minute limit.
    const spacing = this.options.spacingMs ?? MIN_SPACING_MS;
    const start = Math.max(Date.now(), nextSlot);
    nextSlot = start + spacing;
    if (start > Date.now()) await new Promise((r) => setTimeout(r, start - Date.now()));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    let response: FetchResponse;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl ?? 'https://api.football-data.org/v4'}${path}`, {
        headers: { 'X-Auth-Token': this.options.apiKey },
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
      throw new FootballDataOrgError(aborted ? 'timeout' : 'http', aborted ? 'football-data.org request timed out' : 'football-data.org network failure');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const s = response.status;
      throw new FootballDataOrgError(s === 429 ? 'rate_limited' : s === 401 || s === 403 ? 'auth' : 'http', `football-data.org HTTP ${s}`, s);
    }
    try {
      return await response.json();
    } catch {
      throw new FootballDataOrgError('malformed', 'football-data.org response is not valid JSON', response.status);
    }
  }
}

/** One v4 match -> domain match with the catalogue competition; null when not ours. */
export function mapFootballDataOrgIngestedMatch(raw: any): FootballMatch | null {
  const slug = FOOTBALL_DATA_ORG_COMPETITIONS[String(raw?.competition?.code ?? '')];
  const entry = slug ? getCompetitionCatalogBySlug(slug) : undefined;
  const match = entry ? mapFootballDataOrgMatch(raw) : null;
  if (!entry || !match) return null;
  const emblem = typeof raw.competition?.emblem === 'string' && /^https:\/\//.test(raw.competition.emblem) ? raw.competition.emblem : null;
  return {
    ...match,
    competition: { id: `catalog:${entry.slug}`, slug: entry.slug, name: entry.name, shortName: entry.shortName, country: entry.country, type: entry.type, logo: emblem },
    // The free plan sends no live minute; an absent minute stays absent, never 0.
    ...(typeof raw.minute === 'number' ? { minute: raw.minute } : { minute: undefined }),
  };
}

export function parseFootballDataOrgMatches(payload: unknown): FootballMatch[] {
  const list = (payload as { matches?: unknown })?.matches;
  if (!Array.isArray(list)) throw new FootballDataOrgError('malformed', 'football-data.org payload has no match list');
  return list.map(mapFootballDataOrgIngestedMatch).filter((m): m is FootballMatch => m !== null);
}

/** The provider's TOTAL table; empty when it sends none (never a derived table). */
export function parseFootballDataOrgStandings(payload: unknown): FootballStandingRow[] {
  const tables = (payload as { standings?: Array<{ type?: string; table?: unknown[] }> })?.standings;
  const total = Array.isArray(tables) ? tables.find((t) => t?.type === 'TOTAL') : undefined;
  return Array.isArray(total?.table) ? total!.table.map(mapFootballDataOrgStandingRow).filter((r) => r.team.slug !== 'unknown') : [];
}

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class FootballDataOrgIngestionAdapter {
  readonly key = FOOTBALL_DATA_ORG_PROVIDER_ID;
  readonly name = 'football-data.org';

  constructor(private readonly client: FootballDataOrgClient) {}

  /** One request: [today-2, today+5] for every licensed competition (provider max range: 10 days). */
  async fetchMatches(shortcut: string, _season: string | number, now: Date = new Date()): Promise<FootballMatch[]> {
    if (shortcut !== FOOTBALL_DATA_ORG_WINDOW) return [];
    const t = now.getTime();
    return parseFootballDataOrgMatches(await this.client.getMatches(dayKey(t - 2 * DAY_MS), dayKey(t + 5 * DAY_MS)));
  }
}
