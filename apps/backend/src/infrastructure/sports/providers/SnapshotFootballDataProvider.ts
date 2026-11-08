/**
 * Snapshot-backed public football provider (M06).
 *
 * WHY THIS EXISTS: before M06 the public football API was served either by the
 * EPG read model or by football-data.org. Neither reads `football_snapshots`, so
 * the data M05/M06 actually ingest was stored and displayed in the admin console
 * but never reached a public page. Verified 2026-11-06: the collection held 1,444
 * real matches while GET /v2/sports/football/matches returned 0.
 *
 * This provider closes that gap: it serves the public API from the SAME stored
 * snapshots the ingestion pipeline writes, so what the admin sees is what visitors
 * see. It is a read model only - it never calls a provider and never fabricates.
 *
 * DESIGN RULES
 *  - Never invent a field. A snapshot stores `match` exactly as the adapter mapped
 *    it; an absent field stays absent (no 0, no "unknown", no derived minute).
 *  - Only `finished`, `live` and `scheduled` matches are returned; anything else is
 *    excluded rather than relabelled.
 *  - Bounded queries only: every method applies an explicit limit so a public
 *    request can never scan the whole collection.
 */

import { FootballSnapshotModel } from '../../../infrastructure/sports/persistence/models';

/** Madrid is UTC+1 in winter and UTC+2 in summer; the day window uses the current offset. */
const MADRID_OFFSET_MS = (() => {
  const now = new Date();
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const madrid = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  return madrid.getTime() - utc.getTime();
})();

/** YYYY-MM-DD for a Madrid calendar day. */
function madridDayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
import {
  FootballCompetition,
  FootballDataProvider,
  FootballMatch,
  FootballMatchQuery,
  FootballStandingRow,
  FootballTeam,
} from '../../../domain/sports/football/types';

/** Hard caps so a public read stays cheap regardless of what the query asks for. */
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;
const TOURNAMENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function boundedLimit(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested) || requested <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(requested), MAX_LIMIT);
}

export class SnapshotFootballDataProvider implements FootballDataProvider {
  readonly key = 'snapshot';
  readonly name = 'Guía TV (datos ingeridos verificados)';

  /**
   * Live scores are supported only in the sense that an ingested match may carry
   * status `live`. OpenLigaDB publishes no live minute, so no minute is claimed.
   */
  supportsLiveScores(): boolean {
    return true;
  }

  async getMatches(query: FootballMatchQuery = {}): Promise<FootballMatch[]> {
    const filter = this.buildFilter(query);
    const limit = boundedLimit(query.limit);
    const docs = await FootballSnapshotModel.find(filter)
      .sort({ 'match.kickoffAt': 1 })
      .limit(limit)
      .lean()
      .exec();
    return docs.map((doc: any) => doc.match as FootballMatch).filter(Boolean);
  }

  async getLiveMatches(): Promise<FootballMatch[]> {
    const since = new Date(Date.now() - LIVE_WINDOW_MS).toISOString();
    const docs = await FootballSnapshotModel.find({
      'match.status': 'live',
      'match.kickoffAt': { $gte: since },
    })
      .sort({ 'match.kickoffAt': -1 })
      .limit(MAX_LIMIT)
      .lean()
      .exec();
    return docs.map((doc: any) => doc.match as FootballMatch).filter(Boolean);
  }

  async getMatch(idOrSlug: string): Promise<FootballMatch | null> {
    const key = String(idOrSlug ?? '').trim();
    if (!key) return null;
    // Resolve by stable identity first (provider match id, then the internal
    // canonical key), and by the display slug LAST. This keeps public semantic
    // routes unchanged (the display slug still resolves, including for legacy
    // slug-keyed records) while guaranteeing a duplicate-slug situation never
    // returns the wrong match when a stable id is available. The internal
    // canonical identity must never leak into a user-visible URL.
    let doc = await FootballSnapshotModel.findOne({ matchId: key }).lean().exec();
    if (!doc) doc = await FootballSnapshotModel.findOne({ canonicalKey: key }).lean().exec();
    if (!doc) doc = await FootballSnapshotModel.findOne({ 'match.slug': key }).lean().exec();
    if (!doc) return null;
    return (doc as any).match as FootballMatch;
  }

  async getCompetitions(): Promise<FootballCompetition[]> {
    const slugs: string[] = await FootballSnapshotModel.distinct('competitionSlug').exec();
    const bySlug = new Map<string, FootballCompetition>();
    for (const slug of slugs) {
      const doc = await FootballSnapshotModel.findOne({ competitionSlug: slug }).lean().exec();
      const competition = (doc as any)?.match?.competition as FootballCompetition | undefined;
      if (competition?.slug) bySlug.set(competition.slug, competition);
    }
    return [...bySlug.values()];
  }

  async getCompetition(slug: string): Promise<FootballCompetition | null> {
    const doc = await FootballSnapshotModel.findOne({ competitionSlug: String(slug ?? '') }).lean().exec();
    return ((doc as any)?.match?.competition as FootballCompetition | undefined) ?? null;
  }

  /**
   * Standings computed FROM the real finished results we have ingested.
   *
   * OpenLigaDB publishes no standings table, so returning an empty array made
   * /clasificaciones useless even though every result is stored. A league table
   * is a deterministic function of finished matches with a real score, so it is
   * DERIVED here rather than invented: a match whose score is absent is skipped,
   * and a competition with no finished matches still returns an empty array
   * (callers render "not available", never a fake table).
   */
  async getStandings(competitionSlug: string): Promise<FootballStandingRow[]> {
    const slug = String(competitionSlug ?? '').trim();
    if (!slug) return [];
    const docs = await FootballSnapshotModel.find({
      competitionSlug: slug,
      'match.status': 'finished',
      'match.score.home': { $ne: null },
      'match.score.away': { $ne: null },
    })
      .lean()
      .exec();

    interface Tally { team: FootballStandingRow['team']; played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; }
    const tally = new Map<string, Tally>();
    const row = (team: FootballStandingRow['team']): Tally => {
      const key = team.slug || team.id || team.name;
      let t = tally.get(key);
      if (!t) {
        t = { team, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 };
        tally.set(key, t);
      }
      return t;
    };

    for (const doc of docs as any[]) {
      const match = doc?.match;
      const home = match?.homeTeam;
      const away = match?.awayTeam;
      const hs = match?.score?.home;
      const as = match?.score?.away;
      if (!home || !away || typeof hs !== 'number' || typeof as !== 'number') continue;
      const h = row(home);
      const a = row(away);
      h.played += 1;
      a.played += 1;
      h.goalsFor += hs;
      h.goalsAgainst += as;
      a.goalsFor += as;
      a.goalsAgainst += hs;
      if (hs > as) { h.won += 1; a.lost += 1; }
      else if (hs < as) { a.won += 1; h.lost += 1; }
      else { h.drawn += 1; a.drawn += 1; }
    }

    const rows = [...tally.values()].map((t) => ({
      position: 0,
      team: t.team,
      played: t.played,
      won: t.won,
      drawn: t.drawn,
      lost: t.lost,
      goalsFor: t.goalsFor,
      goalsAgainst: t.goalsAgainst,
      goalDifference: t.goalsFor - t.goalsAgainst,
      points: t.won * 3 + t.drawn,
    }));

    // Standard football ordering: points, goal difference, goals scored, name.
    rows.sort(
      (x, y) =>
        y.points - x.points ||
        y.goalDifference - x.goalDifference ||
        y.goalsFor - x.goalsFor ||
        String(x.team?.name ?? '').localeCompare(String(y.team?.name ?? ''), 'es')
    );
    rows.forEach((r, i) => { r.position = i + 1; });
    return rows as FootballStandingRow[];
  }

  async getTeams(): Promise<FootballTeam[]> {
    const since = new Date(Date.now() - TOURNAMENT_WINDOW_MS).toISOString();
    const sincePast = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const docs = await FootballSnapshotModel.find({
      'match.kickoffAt': { $gte: sincePast },
    })
      .sort({ 'match.kickoffAt': 1 })
      .limit(MAX_LIMIT)
      .lean()
      .exec();
    void since;
    const bySlug = new Map<string, FootballTeam>();
    for (const doc of docs as any[]) {
      for (const team of [doc.match?.homeTeam, doc.match?.awayTeam]) {
        if (team?.slug && !bySlug.has(team.slug)) bySlug.set(team.slug, team);
      }
    }
    return [...bySlug.values()];
  }

  async getTeam(slug: string): Promise<FootballTeam | null> {
    const key = String(slug ?? '').trim();
    if (!key) return null;
    const doc = await FootballSnapshotModel.findOne({
      $or: [{ 'match.homeTeam.slug': key }, { 'match.awayTeam.slug': key }],
    })
      .lean()
      .exec();
    if (!doc) return null;
    const match = (doc as any).match as FootballMatch | undefined;
    if (!match) return null;
    if (match.homeTeam?.slug === key) return match.homeTeam;
    if (match.awayTeam?.slug === key) return match.awayTeam;
    return null;
  }

  /** Builds a bounded Mongo filter. Absent query fields simply do not constrain. */
  private buildFilter(query: FootballMatchQuery): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    const kickoff: Record<string, string> = {};

    if (query.dateFrom) kickoff.$gte = new Date(query.dateFrom).toISOString();
    if (query.dateTo) kickoff.$lte = new Date(query.dateTo).toISOString();

    if (query.date) {
      // A single calendar day: the caller's local day is approximated as a 24h
      // window around the given date, never a fabricated kickoff.
      //
      // The public API accepts BOTH `YYYY-MM-DD` and the compact `YYYYMMDD` that
      // the Sports v2 client sends. `new Date('20261126')` is an Invalid Date in
      // JavaScript, so without normalising it the day filter was silently
      // dropped and the endpoint answered with matches from ANY date - which is
      // why a fixture outside the first page (e.g. the Europa League round)
      // appeared to be missing.
      // Accept every form the public API receives. `date=today` was silently
      // unparseable, so the day filter was DROPPED and the endpoint answered with
      // hundreds of matches from ANY date - which is why "today" showed August
      // results and a match being played right now was never marked live.
      const raw = String(query.date).trim().toLowerCase();
      const todayKey = madridDayKey(new Date());
      const relative: Record<string, string> = {
        today: todayKey,
        yesterday: madridDayKey(new Date(Date.now() - 86_400_000)),
        tomorrow: madridDayKey(new Date(Date.now() + 86_400_000)),
      };
      const expanded = relative[raw] ?? raw;
      const normalised = /^\d{8}$/.test(expanded)
        ? `${expanded.slice(0, 4)}-${expanded.slice(4, 6)}-${expanded.slice(6, 8)}`
        : expanded;
      const start = new Date(normalised);
      if (!Number.isNaN(start.getTime())) {
        // One Madrid calendar day, not a rolling 24h window from midnight UTC.
        const dayStart = new Date(`${normalised}T00:00:00.000Z`);
        kickoff.$gte = new Date(dayStart.getTime() - MADRID_OFFSET_MS).toISOString();
        kickoff.$lte = new Date(dayStart.getTime() - MADRID_OFFSET_MS + 86_400_000 - 1).toISOString();
      }
    }
    if (Object.keys(kickoff).length > 0) filter['match.kickoffAt'] = kickoff;

    if (query.competitionSlug) filter.competitionSlug = query.competitionSlug;
    if (query.status) filter['match.status'] = query.status;
    if (query.teamSlug) {
      filter.$or = [
        { 'match.homeTeam.slug': query.teamSlug },
        { 'match.awayTeam.slug': query.teamSlug },
      ];
    }
    if (query.q) {
      const escaped = String(query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = { $regex: escaped, $options: 'i' };
      const textClauses = [
        { 'match.homeTeam.name': rx },
        { 'match.awayTeam.name': rx },
        { 'match.competition.name': rx },
      ];
      // Preserve a team constraint when both are present.
      filter.$and = filter.$or
        ? [{ $or: filter.$or as unknown[] }, { $or: textClauses }]
        : [{ $or: textClauses }];
      delete filter.$or;
    }
    return filter;
  }
}
