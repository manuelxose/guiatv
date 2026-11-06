import {
  Broadcast,
  Competition,
  Lineup,
  LineupPlayer,
  Match,
  MatchEvent,
  MatchEventType,
  MatchLineups,
  MatchPhase,
  MatchStat,
  MatchStatus,
  NewsItem,
  ScoreLine,
  SportsSnapshot,
  StandingRow,
  Standings,
  Team,
} from '../domain/models';

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
  venue?: string | null;
  referee?: string | null;
  phase?: string | null;
  injuryTime?: number | null;
  /** Backend `FootballMatch.events` (unknown[]): tolerated synonyms, unknown types ignored. */
  events?: unknown[] | null;
  /** Backend `FootballMatch.statistics` (Record<string, unknown>); `stats` accepted as an alias. */
  statistics?: unknown | null;
  stats?: unknown | null;
  lineups?: unknown | null;
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

const PHASES: Record<string, MatchPhase> = {
  scheduled: 'scheduled',
  first_half: 'first_half',
  halftime: 'halftime',
  half_time: 'halftime',
  second_half: 'second_half',
  extra_time: 'extra_time',
  penalties: 'penalties',
  penalty_shootout: 'penalties',
  finished: 'finished',
  full_time: 'finished',
};

/** Phase from the provider, falling back to the unambiguous scheduled/finished statuses. Live without a phase stays unresolved. */
export function mapPhase(raw: unknown, status: MatchStatus): MatchPhase | undefined {
  const key = normalizeKey(raw);
  if (key) {
    const phase = PHASES[key];
    if (phase) return phase;
  }
  if (status === 'finished') return 'finished';
  if (status === 'scheduled') return 'scheduled';
  return undefined;
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

/** Lowercase, trimmed, spaces/hyphens → underscores. */
function normalizeKey(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return s || undefined;
}

/** Read a human string out of `string | { name | fullName | value | slug }`. */
function asString(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const s = v.trim();
    return s || undefined;
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return asString(o.name) ?? asString(o.fullName) ?? asString(o.value) ?? asString(o.slug);
  }
  return undefined;
}

/** Read a finite number out of `number | numeric string`. */
function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

const EVENT_TYPES: Record<string, MatchEventType> = {
  goal: 'goal',
  regular_goal: 'goal',
  normal_goal: 'goal',
  own_goal: 'own_goal',
  penalty: 'penalty',
  penalty_goal: 'penalty',
  penalty_missed: 'penalty_missed',
  penalty_miss: 'penalty_missed',
  missed_penalty: 'penalty_missed',
  goal_disallowed: 'goal_disallowed',
  disallowed_goal: 'goal_disallowed',
  var: 'var',
  var_decision: 'var',
  yellow: 'yellow',
  yellow_card: 'yellow',
  second_yellow: 'second_yellow',
  yellow_second: 'second_yellow',
  red: 'red',
  red_card: 'red',
  substitution: 'substitution',
  sub: 'substitution',
  assist: 'assist',
};

/** Map a provider event type (string or nested `{ name | value | code }`) to a known type; unknown types become undefined. */
export function mapEventType(raw: unknown): MatchEventType | undefined {
  let value = raw;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    value = o.name ?? o.value ?? o.shortName ?? o.code ?? o.type ?? o.eventType;
  }
  const key = normalizeKey(value);
  return key ? EVENT_TYPES[key] : undefined;
}

interface EventTeamRefs {
  readonly homeSlug: string;
  readonly awaySlug: string;
  readonly homeName: string;
  readonly awayName: string;
}

function mapSide(raw: unknown, teamSlug: string | undefined, refs: EventTeamRefs): 'home' | 'away' | undefined {
  if (typeof raw === 'string') {
    const k = normalizeKey(raw);
    if (k === 'home' || k === 'local' || k === '1') return 'home';
    if (k === 'away' || k === 'visitante' || k === 'visitor' || k === 'guest' || k === '2') return 'away';
  }
  if (teamSlug) {
    const k = normalizeKey(teamSlug);
    if (k === normalizeKey(refs.homeSlug) || k === normalizeKey(refs.homeName)) return 'home';
    if (k === normalizeKey(refs.awaySlug) || k === normalizeKey(refs.awayName)) return 'away';
  }
  return undefined;
}

function mapScore(raw: unknown): ScoreLine | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const home = asNumber(r.home);
  const away = asNumber(r.away);
  if (home == null || away == null) return undefined;
  return { home, away };
}

function mapEvent(item: unknown, refs: EventTeamRefs): MatchEvent | undefined {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  const r = item as Record<string, unknown>;
  const type = mapEventType(r.type ?? r.eventType ?? r.kind);
  if (!type) return undefined; // unknown event types are ignored, never guessed
  const minute = asNumber(r.minute ?? r.eventMinute ?? r.time);
  if (minute == null) return undefined; // a timeline entry without a minute cannot be placed honestly
  const teamSlug = asString(r.teamSlug) ?? asString(r.team);
  // An event we cannot attribute to a side is still real data: the model and the
  // timeline both handle a side-less event, and dropping it would hide a VAR or
  // disallowed goal the provider did report.
  const side = mapSide(r.side, teamSlug, refs);
  const player = asString(r.playerName) ?? asString(r.player);
  return {
    minute,
    addedMinute: asNumber(r.addedMinute ?? r.injuryTime ?? r.stoppageTime),
    type,
    side,
    teamSlug,
    player,
    playerName: player,
    assistName: asString(r.assistName) ?? asString(r.assist),
    scoreAfter: mapScore(r.scoreAfter ?? r.score),
    detail: asString(r.detail) ?? asString(r.description),
  };
}

/** Sort by minute (+stoppage), dedupe identical (type, minute, player), ignore unknown types. */
export function mapEvents(raw: unknown, homeSlug: string, awaySlug: string, homeName: string, awayName: string): readonly MatchEvent[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const refs: EventTeamRefs = { homeSlug, awaySlug, homeName, awayName };
  const out: MatchEvent[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const ev = mapEvent(item, refs);
    if (!ev) continue;
    const key = `${ev.type}|${ev.minute}|${ev.player ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  out.sort((a, b) => a.minute - b.minute || (a.addedMinute ?? 0) - (b.addedMinute ?? 0));
  return out.length ? out : undefined;
}

/** Read a statistic value out of `number | numeric string | { value | total | stat }`. A real 0 stays 0. */
function statValue(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return statValue(o.value ?? o.total ?? o.stat);
  }
  return undefined;
}

export function mapStat(raw: unknown): MatchStat | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const label = asString(r.label) ?? asString(r.name) ?? asString(r.key) ?? asString(r.stat) ?? asString(r.type);
  if (!label) return undefined;
  const home = statValue(r.home);
  const away = statValue(r.away);
  if (home == null && away == null) return undefined; // a label with no value is absent, never 0-0
  const unitKey = normalizeKey(r.unit);
  const unit = unitKey === '%' || unitKey === 'percent' ? '%' : undefined;
  return { label, home, away, ...(unit ? { unit } : {}) };
}

function statFromValue(label: string, raw: unknown): MatchStat | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return mapStat({ ...(raw as object), label });
}

/** Map `statistics` (array of rows or a keyed object) into rows, absent stays undefined. */
export function mapStats(raw: unknown): readonly MatchStat[] | undefined {
  if (Array.isArray(raw)) {
    const out: MatchStat[] = [];
    for (const item of raw) {
      const s = mapStat(item);
      if (s) out.push(s);
    }
    return out.length ? out : undefined;
  }
  if (raw && typeof raw === 'object') {
    const out: MatchStat[] = [];
    for (const [label, value] of Object.entries(raw as Record<string, unknown>)) {
      const s = statFromValue(label, value);
      if (s) out.push(s);
    }
    return out.length ? out : undefined;
  }
  return undefined;
}

export function mapPlayers(raw: unknown): readonly LineupPlayer[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: LineupPlayer[] = [];
  for (const p of raw) {
    if (typeof p === 'string') {
      const name = p.trim();
      if (name) out.push({ name });
      continue;
    }
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
    const r = p as Record<string, unknown>;
    const name = asString(r.name) ?? asString(r.player) ?? asString(r.fullName);
    if (!name) continue;
    const substitutedOut = typeof r.substitutedOut === 'boolean' ? r.substitutedOut : typeof r.substituted === 'boolean' ? r.substituted : typeof r.off === 'boolean' ? r.off : undefined;
    const number = asNumber(r.number ?? r.shirtNumber ?? r.shirt);
    const position = asString(r.position) ?? asString(r.pos);
    // Absent stays absent: never write a key whose value is undefined, so a player the
    // provider gave no number/position for is distinguishable from one that has them.
    out.push({
      name,
      ...(number === undefined ? {} : { number }),
      ...(position === undefined ? {} : { position }),
      ...(substitutedOut === undefined ? {} : { substitutedOut }),
    });
  }
  return out.length ? out : undefined;
}

export function mapLineup(raw: unknown): Lineup | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const formation = asString(r.formation);
  const coach = asString(r.coach);
  const starters = mapPlayers(r.starters ?? r.startingXI ?? r.starting_xi ?? r.lineup ?? r.starting ?? r.players ?? r.squad);
  const bench = mapPlayers(r.bench ?? r.substitutes ?? r.subs ?? r.reserves);
  if (!formation && !coach && !starters && !bench) return undefined;
  return { formation, coach, starters, bench };
}

export function mapLineups(raw: unknown): MatchLineups | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const home = mapLineup(r.home ?? r.homeTeam ?? r.home_team);
  const away = mapLineup(r.away ?? r.awayTeam ?? r.away_team);
  if (home || away) return { home, away };
  return undefined;
}

export function mapMatch(m: ApiMatch): Match {
  const status = mapStatus(m.status);
  const hasScore = (status === 'live' || status === 'finished') && m.score?.home != null && m.score?.away != null;
  const venue = m.venue?.trim();
  const referee = m.referee?.trim();
  return {
    slug: m.slug,
    competitionSlug: m.competition.slug,
    homeSlug: m.homeTeam.slug,
    awaySlug: m.awayTeam.slug,
    status,
    phase: mapPhase(m.phase, status),
    kickoff: m.kickoffAt,
    round: m.round,
    minute: status === 'live' && typeof m.minute === 'number' ? m.minute : undefined,
    injuryTime: typeof m.injuryTime === 'number' ? m.injuryTime : undefined,
    venue: venue || undefined,
    referee: referee || undefined,
    homeScore: hasScore ? m.score!.home! : undefined,
    awayScore: hasScore ? m.score!.away! : undefined,
    events: mapEvents(m.events, m.homeTeam.slug, m.awayTeam.slug, m.homeTeam.name, m.awayTeam.name),
    stats: mapStats(m.statistics ?? m.stats),
    lineups: mapLineups(m.lineups),
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
