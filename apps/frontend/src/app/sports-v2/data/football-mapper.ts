import { Broadcast, Competition, Match, MatchStatus, NewsItem, SportsSnapshot, StandingRow, Standings, Team } from '../domain/models';

/**
 * Pure mapping from the existing `/v2/sports/football/*` response shapes to the Sports v2 domain.
 * Rule: a field the provider does not supply stays absent. Nothing is guessed, defaulted to a score or invented.
 */

export interface ApiTeam { id: string; slug: string; name: string; shortName?: string; aliases?: string[]; country?: string; crest?: string | null }
export interface ApiCompetition { id: string; slug: string; name: string; shortName?: string; country?: string; type?: string; currentSeason?: string; logo?: string | null }
export interface ApiBroadcast { channelId?: string; channelName: string; availability?: string; provenance?: string; confidence?: string; channelPath?: string }
export interface ApiMatch {
  id: string; slug: string; kickoffAt: string; status: string; round?: string; minute?: number | null; lastUpdatedAt?: string;
  competition: Pick<ApiCompetition, 'id' | 'slug' | 'name' | 'shortName'>;
  homeTeam: ApiTeam; awayTeam: ApiTeam;
  score?: { home: number | null; away: number | null };
  broadcasts?: ApiBroadcast[];
}
export interface ApiStandingRow { position: number; team: ApiTeam; played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; points: number }
export interface ApiNews {
  id: string; slug: string; title: string; excerpt?: string; contentType?: string; author?: { name?: string }; publishedAt: string; content?: string;
  sportsRelations?: { teamIds?: string[]; competitionIds?: string[]; matchIds?: string[] };
}

/** Only absolute https URLs are rendered as images; anything else (data:, javascript:, http:, relative) is dropped. */
export function safeImageUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Deterministic badge colour, used as the fallback when no crest is supplied. */
export function hueOf(slug: string): number {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function mapTeam(t: ApiTeam): Team {
  const tla = t.aliases?.find((a) => /^[A-Z]{3}$/.test(a));
  const letters = t.name.normalize('NFD').replace(/[^A-Za-z]/g, '');
  return { slug: t.slug, name: t.name, shortName: tla ?? letters.slice(0, 3).toUpperCase(), hue: hueOf(t.slug), crestUrl: safeImageUrl(t.crest) };
}

const KINDS: Record<string, Competition['kind']> = { league: 'league', cup: 'cup', international: 'international', national_team: 'international' };

export function mapCompetition(c: ApiCompetition): Competition {
  return { slug: c.slug, name: c.name, country: c.country ?? '', kind: KINDS[c.type ?? ''] ?? 'cup', hue: hueOf(c.slug), logoUrl: safeImageUrl(c.logo), teamSlugs: [], season: c.currentSeason };
}

/** halftime stays "live" (no minute); suspended/cancelled have no v2 state yet and read as "postponed" (documented limit). */
export function mapStatus(raw: string): MatchStatus {
  switch (raw) {
    case 'live':
    case 'halftime':
      return 'live';
    case 'finished':
      return 'finished';
    case 'postponed':
    case 'suspended':
    case 'cancelled':
      return 'postponed';
    default:
      return 'scheduled';
  }
}

/** Surfaced like the legacy section: override/airing, or reconciliation with medium+ confidence (medium is flagged `probable`). Low is dropped. */
export function mapBroadcasts(list: readonly ApiBroadcast[] | undefined): Broadcast[] {
  const out: Broadcast[] = [];
  for (const b of list ?? []) {
    const verified = b.provenance === 'override' || b.provenance === 'airing' || (b.provenance === 'reconciliation' && (b.confidence === 'high' || b.confidence === 'medium'));
    if (!verified || !b.channelName?.trim() || out.some((o) => o.channel === b.channelName)) continue;
    out.push({
      channel: b.channelName,
      kind: b.availability === 'streaming' ? 'streaming' : 'tv',
      channelPath: b.channelPath && b.channelPath.startsWith('/') ? b.channelPath : undefined,
      evidence: b.provenance as Broadcast['evidence'],
      probable: b.provenance === 'reconciliation' && b.confidence !== 'high' ? true : undefined,
    });
  }
  return out;
}

export function mapMatch(m: ApiMatch): Match {
  const status = mapStatus(m.status);
  const hasScore = (status === 'live' || status === 'finished') && m.score?.home != null && m.score?.away != null;
  return {
    slug: m.slug,
    competitionSlug: m.competition.slug,
    homeSlug: m.homeTeam.slug,
    awaySlug: m.awayTeam.slug,
    status,
    kickoff: m.kickoffAt,
    round: m.round,
    minute: status === 'live' && typeof m.minute === 'number' ? m.minute : undefined,
    homeScore: hasScore ? m.score!.home! : undefined,
    awayScore: hasScore ? m.score!.away! : undefined,
    events: [], // football-data.org free tier supplies no event timeline
    stats: [], // nor team statistics
    broadcasts: mapBroadcasts(m.broadcasts),
    updatedAt: m.lastUpdatedAt,
  };
}

export function mapStandings(competitionSlug: string, rows: readonly ApiStandingRow[]): Standings {
  const ordered = [...rows].sort((a, b) => a.position - b.position);
  return {
    competitionSlug,
    rows: ordered.map<StandingRow>((r) => ({ teamSlug: r.team.slug, played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst, points: r.points })),
  };
}

const KICKERS: Record<string, string> = { news: 'Noticia', analysis: 'Análisis', preview: 'Previa', 'match-report': 'Crónica', guide: 'Guía', ranking: 'Ranking', trend: 'Tendencia' };

/** Article HTML → plain paragraphs. No DOM (SSR-safe); links and headings flatten to text (documented limit). */
export function htmlToParagraphs(html: string | undefined): string[] {
  if (!html) return [];
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|h[1-6]|li|blockquote|div|ul|ol)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
  return text.split(/\n+/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export interface RelationIndex {
  readonly teams: ReadonlyMap<string, string>; // api id -> slug
  readonly competitions: ReadonlyMap<string, string>;
  readonly matches: ReadonlyMap<string, string>;
}

export const EMPTY_RELATIONS: RelationIndex = { teams: new Map(), competitions: new Map(), matches: new Map() };

/** Relations come only from structured editorial tagging; ids that resolve to nothing are dropped. */
export function mapNews(n: ApiNews, rel: RelationIndex = EMPTY_RELATIONS): NewsItem {
  const r = n.sportsRelations;
  const teamSlugs = (r?.teamIds ?? []).flatMap((id) => rel.teams.get(id) ?? []);
  const competitionSlug = (r?.competitionIds ?? []).map((id) => rel.competitions.get(id.replace(/^catalog:/, '')) ?? rel.competitions.get(id)).find(Boolean);
  const matchSlug = (r?.matchIds ?? []).map((id) => rel.matches.get(id)).find(Boolean);
  return {
    slug: n.slug,
    title: n.title,
    kicker: KICKERS[n.contentType ?? 'news'] ?? 'Noticia',
    summary: n.excerpt ?? '',
    author: n.author?.name ?? 'Equipo editorial Guía TV',
    publishedAt: n.publishedAt,
    body: htmlToParagraphs(n.content),
    competitionSlug,
    teamSlugs: teamSlugs.length ? teamSlugs : undefined,
    matchSlug,
    hue: hueOf(n.slug),
    canonicalPath: `/guias/${n.slug}`,
  };
}

export function relationIndex(teams: readonly ApiTeam[], competitions: readonly ApiCompetition[], matches: readonly ApiMatch[]): RelationIndex {
  const t = new Map<string, string>(), c = new Map<string, string>(), m = new Map<string, string>();
  for (const x of teams) t.set(x.id, x.slug);
  for (const x of competitions) { c.set(x.id, x.slug); c.set(x.slug, x.slug); }
  for (const x of matches) m.set(x.id, x.slug);
  return { teams: t, competitions: c, matches: m };
}

/** Teams and competitions: first seen wins (a richer record is never replaced by a match-embedded stub). Matches, tables, news: latest wins. Competition teams are recomputed from the matches and tables. */
export function mergeSnapshots(a: SportsSnapshot, b: Partial<SportsSnapshot>): SportsSnapshot {
  const union = <T extends { slug: string }>(x: readonly T[], y: readonly T[] = []): T[] => [...new Map([...x, ...y].map((i) => [i.slug, i])).values()];
  const keepFirst = <T extends { slug: string }>(x: readonly T[], y: readonly T[] = []): T[] => {
    const seen = new Map<string, T>();
    for (const i of [...x, ...y]) if (!seen.has(i.slug)) seen.set(i.slug, i);
    return [...seen.values()];
  };
  const matches = union(a.matches, b.matches);
  const standings = [...new Map([...a.standings, ...(b.standings ?? [])].map((s) => [s.competitionSlug, s])).values()];
  const teamsOf = new Map<string, Set<string>>();
  const add = (comp: string, ...slugs: string[]) => { const s = teamsOf.get(comp) ?? new Set(); slugs.forEach((x) => s.add(x)); teamsOf.set(comp, s); };
  for (const m of matches) add(m.competitionSlug, m.homeSlug, m.awaySlug);
  for (const s of standings) add(s.competitionSlug, ...s.rows.map((r) => r.teamSlug));
  const competitions = keepFirst(a.competitions, b.competitions).map((c) => ({ ...c, teamSlugs: [...new Set([...c.teamSlugs, ...(teamsOf.get(c.slug) ?? [])])] }));
  return { teams: keepFirst(a.teams, b.teams), competitions, matches, standings, news: union(a.news, b.news) };
}
