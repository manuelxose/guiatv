import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FootballData, SPORTS_NOW } from '../data/football-data';
import { FollowState, FollowStorage } from '../data/follow-storage';
import { dayKey, shortDay } from '../domain/calendar';
import { Competition, Match, NewsItem, SportsSnapshot, StandingRow, Standings, Team } from '../domain/models';
import { sv2Link } from '../sports-v2.paths';
import { Sv2Viewport } from './viewport';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface SearchHit {
  readonly kind: 'team' | 'competition' | 'match' | 'news';
  readonly label: string;
  readonly detail: string;
  readonly link: readonly string[];
}

export interface SearchGroups {
  readonly teams: readonly SearchHit[];
  readonly competitions: readonly SearchHit[];
  readonly matches: readonly SearchHit[];
  readonly news: readonly SearchHit[];
  readonly total: number;
}

export interface NewsFilter {
  readonly team?: string;
  readonly competition?: string;
  readonly match?: string;
}

const EMPTY: SportsSnapshot = { teams: [], competitions: [], matches: [], standings: [], news: [] };
const NO_SEARCH: SearchGroups = { teams: [], competitions: [], matches: [], news: [], total: 0 };
const MAX_TRACKED = 3;
const byKickoff = (a: Match, b: Match) => Date.parse(a.kickoff) - Date.parse(b.kickoff);
const byNewest = (a: NewsItem, b: NewsItem) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
const toggle = (list: readonly string[], slug: string): readonly string[] => (list.includes(slug) ? list.filter((s) => s !== slug) : [...list, slug]);

export const KIND_LABEL: Record<SearchHit['kind'], string> = { team: 'Equipo', competition: 'Competición', match: 'Partido', news: 'Noticia' };

/** Single source of UI state for the sports shell. Provided at the shell route, so it dies with it. */
@Injectable()
export class SportsStore {
  private readonly data = inject(FootballData);
  private readonly storage = inject(FollowStorage);
  private readonly router = inject(Router);
  private readonly viewport = inject(Sv2Viewport);
  private readonly now = inject(SPORTS_NOW);

  readonly isDemo = this.data.source === 'demo';
  readonly loadState = signal<LoadState>('idle');
  private readonly snapshot = signal<SportsSnapshot>(EMPTY);

  readonly selectedMatchSlug = signal<string | null>(null);
  readonly sidebarCollapsed = signal(false);
  readonly contextOpen = signal(false); // tablet drawer for the Match Center
  /** True while the full-page Match Center is on screen (the contextual sidebar steps aside). */
  readonly matchPageOpen = signal(false);
  readonly trackedSlugs = signal<readonly string[]>([]);
  readonly trackerMinimized = signal(false);
  readonly query = signal('');
  readonly followedTeamSlugs = signal<readonly string[]>([]);
  readonly favoriteCompetitionSlugs = signal<readonly string[]>([]);
  readonly savedMatchSlugs = signal<readonly string[]>([]);
  /** Router navigations since the shell opened; >0 means "Back" can stay inside the app. */
  readonly navigations = signal(0);

  readonly today = signal(dayKey(this.now()));
  readonly teams = computed(() => this.snapshot().teams);
  readonly competitions = computed(() => this.snapshot().competitions);
  readonly matches = computed(() => this.snapshot().matches);
  readonly news = computed(() => [...this.snapshot().news].sort(byNewest));
  readonly standings = computed(() => this.snapshot().standings);

  private readonly teamIndex = computed(() => new Map(this.teams().map((t) => [t.slug, t])));
  private readonly competitionIndex = computed(() => new Map(this.competitions().map((c) => [c.slug, c])));
  private readonly matchIndex = computed(() => new Map(this.matches().map((m) => [m.slug, m])));

  readonly liveMatches = computed(() => this.matches().filter((m) => m.status === 'live'));
  readonly upcomingMatches = computed(() => this.matches().filter((m) => m.status === 'scheduled' || m.status === 'postponed').sort(byKickoff));
  readonly finishedMatches = computed(() => this.matches().filter((m) => m.status === 'finished').sort((a, b) => byKickoff(b, a)));
  readonly selectedMatch = computed<Match | null>(() => this.matchIndex().get(this.selectedMatchSlug() ?? '') ?? null);
  readonly trackedMatches = computed(() => this.trackedSlugs().flatMap((s) => this.matchIndex().get(s) ?? []));
  readonly followedTeams = computed(() => this.followedTeamSlugs().flatMap((s) => this.teamIndex().get(s) ?? []));
  readonly favoriteCompetitions = computed(() => this.favoriteCompetitionSlugs().flatMap((s) => this.competitionIndex().get(s) ?? []));
  readonly savedMatches = computed(() => this.savedMatchSlugs().flatMap((s) => this.matchIndex().get(s) ?? []).sort(byKickoff));

  /** Is this match about something the user follows? */
  isRelevant(m: Match): boolean {
    return (
      this.followedTeamSlugs().includes(m.homeSlug) ||
      this.followedTeamSlugs().includes(m.awaySlug) ||
      this.favoriteCompetitionSlugs().includes(m.competitionSlug) ||
      this.savedMatchSlugs().includes(m.slug)
    );
  }

  /** Live matches, the user's own first. */
  readonly featuredLive = computed(() => {
    const live = this.liveMatches();
    return [...live.filter((m) => this.isRelevant(m)), ...live.filter((m) => !this.isRelevant(m))];
  });
  readonly todayMatches = computed(() => this.matchesOnDay(this.today()));
  /** Scheduled matches still to come, followed/favourite first, then by kickoff. */
  readonly importantUpcoming = computed(() => {
    const up = this.upcomingMatches().filter((m) => m.status === 'scheduled');
    return [...up.filter((m) => this.isRelevant(m)), ...up.filter((m) => !this.isRelevant(m))].slice(0, 8);
  });
  readonly recentResults = computed(() => this.finishedMatches().slice(0, 8));
  readonly myMatches = computed(() => this.matches().filter((m) => this.followedTeamSlugs().includes(m.homeSlug) || this.followedTeamSlugs().includes(m.awaySlug)).sort(byKickoff));
  /** Teams offered to anonymous users: the first team of each competition, deduplicated. */
  readonly suggestedTeams = computed(() => {
    const seen = new Set<string>(this.followedTeamSlugs());
    const out: Team[] = [];
    for (const c of this.competitions())
      for (const slug of c.teamSlugs) {
        const t = this.teamIndex().get(slug);
        if (t && !seen.has(slug)) {
          seen.add(slug);
          out.push(t);
          break;
        }
      }
    return out;
  });
  readonly personalizedNews = computed(() => {
    const teams = new Set(this.followedTeamSlugs());
    const comps = new Set(this.favoriteCompetitionSlugs());
    return this.news().filter((n) => n.teamSlugs?.some((t) => teams.has(t)) || (n.competitionSlug && comps.has(n.competitionSlug)));
  });

  readonly searchGroups = computed(() => this.search(this.query()));
  readonly searchHits = computed<readonly SearchHit[]>(() => {
    const g = this.searchGroups();
    return [...g.teams, ...g.competitions, ...g.matches, ...g.news].slice(0, 8);
  });

  team(slug: string): Team | undefined {
    return this.teamIndex().get(slug);
  }
  competition(slug: string): Competition | undefined {
    return this.competitionIndex().get(slug);
  }
  match(slug: string): Match | undefined {
    return this.matchIndex().get(slug);
  }
  article(slug: string): NewsItem | undefined {
    return this.news().find((n) => n.slug === slug);
  }
  matchesOf(competitionSlug: string): readonly Match[] {
    return this.matches().filter((m) => m.competitionSlug === competitionSlug).sort(byKickoff);
  }
  matchesOfTeam(teamSlug: string): readonly Match[] {
    return this.matches().filter((m) => m.homeSlug === teamSlug || m.awaySlug === teamSlug).sort(byKickoff);
  }
  matchesOnDay(key: string): readonly Match[] {
    return this.matches().filter((m) => dayKey(m.kickoff) === key).sort(byKickoff);
  }
  /** Distinct match days, ascending. */
  matchDays(): readonly string[] {
    return [...new Set(this.matches().map((m) => dayKey(m.kickoff)))].sort();
  }
  standingsOf(competitionSlug: string): Standings | undefined {
    return this.standings().find((s) => s.competitionSlug === competitionSlug);
  }
  /** 1-based league position of a team, when its competition publishes a table. */
  positionOf(teamSlug: string): { position: number; row: StandingRow; competition: Competition } | undefined {
    for (const s of this.standings()) {
      const i = s.rows.findIndex((r) => r.teamSlug === teamSlug);
      const competition = this.competitionIndex().get(s.competitionSlug);
      if (i >= 0 && competition?.kind === 'league') return { position: i + 1, row: s.rows[i], competition };
    }
    return undefined;
  }
  teamCompetitions(teamSlug: string): readonly Competition[] {
    return this.competitions().filter((c) => c.teamSlugs.includes(teamSlug));
  }
  newsFor(filter: NewsFilter): readonly NewsItem[] {
    return this.news().filter(
      (n) => (!filter.team || n.teamSlugs?.includes(filter.team)) && (!filter.competition || n.competitionSlug === filter.competition) && (!filter.match || n.matchSlug === filter.match),
    );
  }

  /** Accent-insensitive search over loaded data only; nothing is hardcoded. */
  search(rawQuery: string): SearchGroups {
    const q = normalize(rawQuery);
    if (q.length < 2) return NO_SEARCH;
    const teams = this.teams().filter((t) => normalize(`${t.name} ${t.shortName}`).includes(q)).map<SearchHit>((t) => ({ kind: 'team', label: t.name, detail: t.city ?? '', link: ['equipos', t.slug] }));
    const competitions = this.competitions().filter((c) => normalize(`${c.name} ${c.country}`).includes(q)).map<SearchHit>((c) => ({ kind: 'competition', label: c.name, detail: c.country, link: ['competiciones', c.slug] }));
    const matches = this.matches()
      .filter((m) => normalize(`${this.team(m.homeSlug)?.name} ${this.team(m.awaySlug)?.name} ${this.competition(m.competitionSlug)?.name}`).includes(q))
      .sort(byKickoff)
      .map<SearchHit>((m) => ({ kind: 'match', label: `${this.team(m.homeSlug)?.name ?? ''} - ${this.team(m.awaySlug)?.name ?? ''}`, detail: `${this.competition(m.competitionSlug)?.name ?? ''} · ${shortDay(dayKey(m.kickoff))}`, link: ['partido', m.slug] }));
    const news = this.news().filter((n) => normalize(`${n.title} ${n.summary}`).includes(q)).map<SearchHit>((n) => ({ kind: 'news', label: n.title, detail: n.kicker, link: ['noticias', n.slug] }));
    return { teams, competitions, matches, news, total: teams.length + competitions.length + matches.length + news.length };
  }

  async load(): Promise<void> {
    if (this.loadState() === 'loading' || this.loadState() === 'ready') return;
    this.loadState.set('loading');
    try {
      this.snapshot.set(await this.data.load());
      this.today.set(dayKey(this.now()));
      this.loadState.set('ready');
      // Pre-select the most relevant match so the Match Center is never empty on desktop.
      if (!this.selectedMatchSlug()) this.selectedMatchSlug.set(this.featuredLive()[0]?.slug ?? this.todayMatches()[0]?.slug ?? this.matches()[0]?.slug ?? null);
    } catch {
      this.loadState.set('error');
    }
  }

  retry(): Promise<void> {
    this.loadState.set('idle');
    return this.load();
  }

  /** Called after hydration: reading localStorage during SSR would desynchronise the markup. */
  restoreFollows(): void {
    const s = this.storage.read();
    this.followedTeamSlugs.set(s.teams);
    this.favoriteCompetitionSlugs.set(s.competitions);
    this.savedMatchSlugs.set(s.matches);
  }

  private persist(): void {
    const state: FollowState = { teams: this.followedTeamSlugs(), competitions: this.favoriteCompetitionSlugs(), matches: this.savedMatchSlugs() };
    this.storage.write(state);
  }

  toggleTeam(slug: string): void {
    this.followedTeamSlugs.update((l) => toggle(l, slug));
    this.persist();
  }
  toggleCompetition(slug: string): void {
    this.favoriteCompetitionSlugs.update((l) => toggle(l, slug));
    this.persist();
  }
  toggleSaved(slug: string): void {
    this.savedMatchSlugs.update((l) => toggle(l, slug));
    this.persist();
  }
  isTeamFollowed(slug: string): boolean {
    return this.followedTeamSlugs().includes(slug);
  }
  isCompetitionFollowed(slug: string): boolean {
    return this.favoriteCompetitionSlugs().includes(slug);
  }
  isSaved(slug: string): boolean {
    return this.savedMatchSlugs().includes(slug);
  }

  selectMatch(slug: string, openPanel = false): void {
    this.selectedMatchSlug.set(slug);
    if (openPanel) this.contextOpen.set(true);
  }

  /** Mobile gets the dedicated full-screen page; wider screens keep the context and update the sidebar. */
  openMatch(slug: string): void {
    if (this.viewport.mobile()) void this.router.navigate(sv2Link('partido', slug));
    else this.selectMatch(slug, true);
  }

  toggleSidebar(): void {
    this.sidebarCollapsed.update((v) => !v);
  }

  isTracked(slug: string): boolean {
    return this.trackedSlugs().includes(slug);
  }

  /** Toggle tracking; keeps at most MAX_TRACKED, dropping the oldest. */
  toggleTracked(slug: string): void {
    this.trackedSlugs.update((list) => (list.includes(slug) ? list.filter((s) => s !== slug) : [...list, slug].slice(-MAX_TRACKED)));
    this.trackerMinimized.set(false);
  }
}

export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
