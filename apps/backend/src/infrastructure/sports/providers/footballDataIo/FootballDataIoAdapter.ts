/**
 * footballdata.io adapter (M07).
 *
 * One ingestion "competition" is the rolling WINDOW: a single `/matches?from&to`
 * request returns every licensed league at once (La Liga, Premier League, UCL,
 * UEL, World Cup on the free key), so a tick costs exactly one request from the
 * monthly quota whatever the number of leagues.
 *
 * Mapping rules (probe 2026-11-09, field names as returned):
 *  - `date_unix` (UTC seconds) -> kickoffAt; `match_date` is the same instant in UTC.
 *  - `status: "complete"` -> finished with the provider's score. Nothing else is
 *    ever reported as finished.
 *  - `minute` ("72", "45+", "HT") -> live / halftime with that minute. Without a
 *    minute, an open match is live only inside LIVE_WINDOW_MS after kickoff; past
 *    it, it stays `scheduled` (the UI shows "sin resultado"), never invented.
 *  - corners / cards / xG -> statistics, only when the provider sent them.
 *  - team_logo, league image -> crests (owner-authorised 2026-11-09).
 */

import { FootballMatch, FootballMatchStatus, FootballStandingRow, FootballTeam } from '@/domain/sports/football/types';
import { buildMatchSlug, slugify } from '@/application/sports/services/FootballNormalizer';
import { getCompetitionCatalogBySlug } from '@/application/sports/services/FootballCompetitionCatalog';
import { FootballDataIoClient, FootballDataIoError } from './FootballDataIoClient';

export const FOOTBALLDATA_IO_PROVIDER_ID = 'footballdata-io';
export const FOOTBALLDATA_IO_WINDOW = 'window';

/** Free-key league ids -> catalogue slugs. Unknown ids are dropped, never guessed. */
export const FOOTBALLDATA_IO_LEAGUES: Readonly<Record<string, string>> = {
  '10': 'laliga',
  '15': 'premier-league',
  '45': 'champions-league',
  '46': 'europa-league',
  '50': 'mundial',
};

/**
 * League logos as published by GET /leagues (`league_image`, probe 2026-11-09).
 * /matches omits them, so they are pinned here instead of costing a request.
 */
export const FOOTBALLDATA_IO_LEAGUE_LOGOS: Readonly<Record<string, string>> = {
  '10': 'https://footballdata.io/img/league/spain-la-liga.png',
  '15': 'https://footballdata.io/img/league/england-premier-league.png',
  '45': 'https://footballdata.io/img/league/europe-uefa-champions-league.png',
  '46': 'https://footballdata.io/img/league/europe-uefa-europa-league.png',
  '50': 'https://footballdata.io/img/league/international-world-cup.png',
};

/** Leagues whose table is worth a daily request (league format, not knockout). */
export const FOOTBALLDATA_IO_TABLE_LEAGUES = [10, 15] as const;

export const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
/** Window is [today-2, today+5]: recent results plus the coming week, < 100 matches on 5 leagues. */
const WINDOW_BACK_DAYS = 2;
const WINDOW_AHEAD_DAYS = 5;

function rec(v: unknown): Record<string, any> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, any>) : null;
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
/** The provider HTML-escapes names ("Brighton &amp; Hove Albion"). */
const unescape = (s: string): string => s.replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"');
const https = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\//i.test(v) ? v : null);

/**
 * /matches prefixes crest paths with the league country ("/img/team/england-arsenal-fc.png"),
 * which 404s; the real asset has no prefix ("/img/team/arsenal-fc.png"). Measured 2026-11-09:
 * stripping the league-country prefix fixed 36/36 broken crests and broke none.
 */
export function fixCrestUrl(url: string | null, leagueCountry: unknown): string | null {
  const country = String(leagueCountry ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!url || !country) return url;
  return url.replace(new RegExp(`/img/team/${country}-(?!national-team)`), '/img/team/');
}

function mapTeam(raw: Record<string, any>, now: Date, leagueCountry?: unknown): FootballTeam | null {
  const name = str(raw.team_name_clean) ?? str(raw.team_name);
  if (raw.team_id == null || !name) return null;
  const clean = unescape(name);
  const providerId = String(raw.team_id);
  return {
    id: `${FOOTBALLDATA_IO_PROVIDER_ID}:${providerId}`,
    slug: slugify(clean),
    name: clean,
    crest: fixCrestUrl(https(raw.team_logo), leagueCountry),
    aliases: [clean],
    providerIds: { [FOOTBALLDATA_IO_PROVIDER_ID]: providerId },
    lastUpdatedAt: now.toISOString(),
  };
}

/** Live clock from the provider's minute string; `undefined` when none was sent. */
function parseMinute(raw: unknown): { minute?: number; halftime: boolean } | undefined {
  if (raw == null || raw === '') return undefined;
  const s = String(raw).trim().toUpperCase();
  if (s === 'HT') return { halftime: true };
  if (s === 'FT') return undefined;
  const m = /^(\d{1,3})/.exec(s);
  return m ? { minute: Number(m[1]), halftime: false } : undefined;
}

export function mapFootballDataIoStatus(raw: Record<string, any>, kickoffMs: number, now: Date): { status: FootballMatchStatus; minute?: number } {
  const status = String(raw.status ?? '').toLowerCase();
  if (status === 'complete' || status === 'finished') return { status: 'finished' };
  if (status === 'postponed') return { status: 'postponed' };
  if (status === 'suspended') return { status: 'suspended' };
  if (status === 'canceled' || status === 'cancelled') return { status: 'cancelled' };
  const clock = parseMinute(raw.minute);
  if (clock?.halftime) return { status: 'halftime' };
  if (clock) return { status: 'live', minute: clock.minute };
  const since = now.getTime() - kickoffMs;
  return { status: since >= 0 && since <= LIVE_WINDOW_MS ? 'live' : 'scheduled' };
}

function side(raw: unknown, key: 'home' | 'away'): number | null {
  return num(rec(raw)?.[key]);
}

function mapStatistics(stats: unknown): Record<string, { home: number; away: number }> | undefined {
  const s = rec(stats);
  if (!s) return undefined;
  const out: Record<string, { home: number; away: number }> = {};
  const put = (label: string, v: unknown) => {
    const home = side(v, 'home');
    const away = side(v, 'away');
    if (home != null && away != null) out[label] = { home, away };
  };
  put('Córners', s.corners);
  put('Tarjetas amarillas', rec(s.cards)?.yellow);
  put('Tarjetas rojas', rec(s.cards)?.red);
  put('Goles esperados (xG)', s.xg);
  return Object.keys(out).length ? out : undefined;
}

export function mapFootballDataIoMatch(raw: unknown, now: Date): FootballMatch | null {
  const r = rec(raw);
  if (!r || r.match_id == null || num(r.date_unix) == null) return null;
  const league = rec(r.league);
  const slug = FOOTBALLDATA_IO_LEAGUES[String(league?.league_id ?? '')];
  const entry = slug ? getCompetitionCatalogBySlug(slug) : undefined;
  if (!entry) return null;
  const home = rec(r.home_team) && mapTeam(r.home_team, now, league?.country);
  const away = rec(r.away_team) && mapTeam(r.away_team, now, league?.country);
  if (!home || !away) return null;

  const kickoffMs = (r.date_unix as number) * 1000;
  const kickoffAt = new Date(kickoffMs).toISOString();
  const { status, minute } = mapFootballDataIoStatus(r, kickoffMs, now);
  // A score is the provider's only once the match is under way; before that it is absent.
  const scored = status === 'finished' || status === 'live' || status === 'halftime';
  const id = String(r.match_id);
  const venue = rec(r.venue);

  return {
    id: `${FOOTBALLDATA_IO_PROVIDER_ID}:${id}`,
    slug: buildMatchSlug(home.name, away.name, kickoffAt),
    providerIds: { [FOOTBALLDATA_IO_PROVIDER_ID]: id },
    competition: {
      id: `catalog:${entry.slug}`,
      slug: entry.slug,
      name: entry.name,
      shortName: entry.shortName,
      country: entry.country,
      type: entry.type,
      logo: https(league?.image) ?? FOOTBALLDATA_IO_LEAGUE_LOGOS[String(league?.league_id)] ?? null,
    },
    season: rec(r.season)?.year != null ? String(rec(r.season)!.year) : undefined,
    round: r.game_week != null ? `Jornada ${r.game_week}` : undefined,
    kickoffAt,
    status,
    ...(minute != null ? { minute } : {}),
    homeTeam: home,
    awayTeam: away,
    score: scored ? { home: side(r.score, 'home'), away: side(r.score, 'away') } : { home: null, away: null },
    venue: str(venue?.stadium_name) ?? str(venue?.stadium_location),
    broadcasts: [],
    statistics: status === 'finished' || status === 'live' || status === 'halftime' ? mapStatistics(r.stats) : undefined,
    sourceProvenance: { source: FOOTBALLDATA_IO_PROVIDER_ID, externalId: id, confidence: 'high' },
    lastUpdatedAt: str(r.last_updated) ? `${String(r.last_updated).replace(' ', 'T')}Z` : now.toISOString(),
  } as FootballMatch;
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function mapFootballDataIoStandings(raw: unknown, now: Date = new Date()): FootballStandingRow[] {
  const rows = rec(rec(raw)?.data)?.standings;
  if (!Array.isArray(rows)) return [];
  const out: FootballStandingRow[] = [];
  for (const item of rows) {
    const r = rec(item);
    const team = r && rec(r.team) && mapTeam(r.team, now, r.team.country);
    const record = rec(r?.record);
    const goals = rec(r?.goals);
    if (!r || !team || !record || num(record.matches_played) == null || num(record.points) == null) continue;
    out.push({
      position: num(r.position) ?? 0,
      team,
      played: record.matches_played,
      won: num(record.wins) ?? 0,
      drawn: num(record.draws) ?? 0,
      lost: num(record.losses) ?? 0,
      goalsFor: num(goals?.for) ?? 0,
      goalsAgainst: num(goals?.against) ?? 0,
      goalDifference: num(goals?.difference) ?? 0,
      points: record.points,
    } as FootballStandingRow);
  }
  return out.sort((a, b) => a.position - b.position);
}

export class FootballDataIoAdapter {
  readonly key = FOOTBALLDATA_IO_PROVIDER_ID;
  readonly name = 'footballdata.io';

  constructor(private readonly client: FootballDataIoClient) {}

  /** `shortcut` must be the window marker; anything else is not a covered plan entry. */
  async fetchMatches(shortcut: string, _season: string | number, now: Date = new Date()): Promise<FootballMatch[]> {
    if (shortcut !== FOOTBALLDATA_IO_WINDOW) return [];
    const t = now.getTime();
    // shortcut: only page 1 (100 matches) is read; the 8-day window on 5 leagues stays below that. Upgrade if pagination.total_pages > 1 shows up in diagnostics.
    return parseMatchPage(await this.client.getMatches(dayKey(t - WINDOW_BACK_DAYS * DAY_MS), dayKey(t + WINDOW_AHEAD_DAYS * DAY_MS)), now).matches;
  }
}

/** One page of /matches or /fixtures/results: mapped matches plus the provider's page count. */
export function parseMatchPage(payload: unknown, now: Date): { matches: FootballMatch[]; totalPages: number } {
  const raw = rec(payload);
  if (!raw || raw.success === false) throw new FootballDataIoError('malformed', 'footballdata.io payload is not a success envelope');
  const list = Array.isArray(raw.data) ? raw.data : rec(raw.data)?.matches;
  if (!Array.isArray(list)) throw new FootballDataIoError('malformed', 'footballdata.io payload has no match list');
  const totalPages = num(rec(rec(raw.meta)?.pagination)?.total_pages) ?? 1;
  return { matches: list.map((m) => mapFootballDataIoMatch(m, now)).filter((m): m is FootballMatch => m !== null), totalPages };
}

export { dayKey as footballDataIoDayKey };
