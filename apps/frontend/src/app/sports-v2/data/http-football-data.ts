import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { addDays, dayKey } from '../domain/calendar';
import { Match, NewsItem, SportsSnapshot } from '../domain/models';
import { FootballData, SPORTS_NOW } from './football-data';
import {
  ApiCompetition, ApiMatch, ApiNews, ApiStandingRow, ApiTeam, RelationIndex,
  mapCompetition, mapMatch, mapNews, mapStandings, mapTeam, mergeSnapshots, relationIndex,
} from './football-mapper';

/** Same-origin on both platforms: the server routes it to the internal API (see ApiConfigService). */
export const SPORTS_API_BASE = new InjectionToken<string>('SPORTS_API_BASE', { providedIn: 'root', factory: () => '/v2/sports/football' });

/** football-data.org allows at most a 10-day range; this is 9 days apart. */
export const WINDOW_BACK = 4;
export const WINDOW_AHEAD = 5;

const EMPTY: SportsSnapshot = { teams: [], competitions: [], matches: [], standings: [], news: [] };

interface Envelope<T> { data: T }

/** HTTP adapter over the existing football BFF. The BFF owns caching, provider throttling and broadcast reconciliation. */
@Injectable()
export class HttpFootballData extends FootballData {
  readonly source = 'live' as const;
  override readonly polls = true;
  private readonly http = inject(HttpClient);
  private readonly base = inject(SPORTS_API_BASE);
  private readonly now = inject(SPORTS_NOW);
  private readonly inflight = new Map<string, Promise<unknown>>();
  private relations?: RelationIndex;

  /** Identical concurrent requests share one round trip. */
  private get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const key = `${path}?${new URLSearchParams(params).toString()}`;
    let p = this.inflight.get(key) as Promise<T> | undefined;
    if (!p) {
      p = firstValueFrom(this.http.get<Envelope<T>>(`${this.base}${path}`, { params })).then((r) => r.data).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  async load(): Promise<SportsSnapshot> {
    const today = dayKey(this.now());
    const [matchesR, compsR, newsR] = await Promise.allSettled([
      // If the provider rejects the range, today's fixtures are still better than an error page.
      this.get<{ matches: ApiMatch[] }>('/matches', { dateFrom: addDays(today, -WINDOW_BACK), dateTo: addDays(today, WINDOW_AHEAD) }).catch(() => this.get<{ matches: ApiMatch[] }>('/matches', { date: 'today' })),
      this.get<{ competitions: ApiCompetition[] }>('/competitions'),
      this.get<{ news: ApiNews[] }>('/news', { limit: '30' }),
    ]);
    // Without fixtures there is nothing honest to show; news and the competition list degrade on their own.
    if (matchesR.status === 'rejected') throw matchesR.reason;
    const apiComps = compsR.status === 'fulfilled' ? compsR.value.competitions : [];
    const snap = this.fromMatches(matchesR.value.matches, apiComps);
    const news = newsR.status === 'fulfilled' ? newsR.value.news : [];
    return { ...snap, news: news.map((n) => mapNews(n, this.relations)) };
  }

  override async liveUpdates(): Promise<readonly Match[]> {
    return (await this.get<{ matches: ApiMatch[] }>('/matches/live')).matches.map(mapMatch);
  }

  override async day(key: string): Promise<Partial<SportsSnapshot>> {
    const { matches } = await this.get<{ matches: ApiMatch[] }>('/matches', { date: key.replace(/-/g, '') });
    return this.fromMatches(matches, []);
  }

  override async competition(slug: string): Promise<Partial<SportsSnapshot>> {
    const d = await this.get<{ competition: ApiCompetition; matches: ApiMatch[]; standings: ApiStandingRow[]; news: ApiNews[] }>(`/competitions/${encodeURIComponent(slug)}`);
    const snap = this.fromMatches(d.matches, [d.competition]);
    const teams = [...snap.teams, ...d.standings.map((r) => mapTeam(r.team))];
    return { ...snap, teams, standings: d.standings.length ? [mapStandings(slug, d.standings)] : [], news: d.news.map((n) => mapNews(n, this.relations)) };
  }

  override async match(slug: string): Promise<Partial<SportsSnapshot>> {
    const d = await this.get<{ match: ApiMatch; relatedNews: ApiNews[] }>(`/matches/${encodeURIComponent(slug)}`);
    const snap = this.fromMatches([d.match], []);
    return { ...snap, news: d.relatedNews.map((n) => mapNews(n, this.relations)) };
  }

  override async team(slug: string): Promise<Partial<SportsSnapshot>> {
    const d = await this.get<{ team: ApiTeam; matches: ApiMatch[]; news: ApiNews[] }>(`/teams/${encodeURIComponent(slug)}`);
    const snap = this.fromMatches(d.matches, []);
    return { ...snap, teams: [mapTeam(d.team), ...snap.teams], news: d.news.map((n) => mapNews(n, this.relations)) };
  }

  override async searchNews(query: string): Promise<readonly NewsItem[]> {
    return (await this.get<{ news: ApiNews[] }>('/news', { q: query, limit: '6' })).news.map((n) => mapNews(n, this.relations));
  }

  override async article(slug: string): Promise<NewsItem | null> {
    const { news } = await this.get<{ news: ApiNews[] }>('/news', { slug, limit: '1' });
    return news[0] ? mapNews(news[0], this.relations) : null;
  }

  private fromMatches(apiMatches: readonly ApiMatch[], apiComps: readonly ApiCompetition[]): SportsSnapshot {
    const apiTeams: ApiTeam[] = apiMatches.flatMap((m) => [m.homeTeam, m.awayTeam]);
    const comps = [...apiComps, ...apiMatches.map((m) => m.competition as ApiCompetition)]; // typed list first: mergeSnapshots keeps the first record
    // Accumulate ids: a news item loaded later may reference a team seen only in an earlier response.
    const rel = relationIndex(apiTeams, comps, apiMatches);
    this.relations = this.relations
      ? { teams: new Map([...this.relations.teams, ...rel.teams]), competitions: new Map([...this.relations.competitions, ...rel.competitions]), matches: new Map([...this.relations.matches, ...rel.matches]) }
      : rel;
    return mergeSnapshots(EMPTY, { teams: apiTeams.map(mapTeam), competitions: comps.map(mapCompetition), matches: apiMatches.map(mapMatch) });
  }
}
