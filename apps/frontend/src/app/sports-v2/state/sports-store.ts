import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, Injector, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FootballData, SPORTS_NOW } from '../data/football-data';
import { FollowState, FollowStorage } from '../data/follow-storage';
import { mergeSnapshots } from '../data/football-mapper';
import { dayKey, displayZone, setDisplayZone, shortDay } from '../domain/calendar';
import { Competition, Match, NewsItem, SportsSnapshot, StandingRow, Standings, Team } from '../domain/models';
import { sv2Link } from '../sports-v2.paths';
import { LivePoller, nextPollDelay } from './live-poller';
import { Sv2Viewport } from './viewport';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface SearchHit {
  readonly kind: 'team' | 'competition' | 'match' | 'news' | 'site';
  readonly label: string;
  readonly detail: string;
  readonly link: readonly string[];
  /** Absolute in-app path for results that live outside Sports (site-wide search). */
  readonly path?: string;
}

export interface SearchGroups {
  readonly teams: readonly SearchHit[];
  readonly competitions: readonly SearchHit[];
  readonly matches: readonly SearchHit[];
  readonly news: readonly SearchHit[];
  /** Programmes, films and series from the site-wide search. */
  readonly site: readonly SearchHit[];
  readonly total: number;
}

export interface NewsFilter {
  readonly team?: string;
  readonly competition?: string;
  readonly match?: string;
}

const EMPTY: SportsSnapshot = { teams: [], competitions: [], matches: [], standings: [], news: [] };
const NO_SEARCH: SearchGroups = { teams: [], competitions: [], matches: [], news: [], site: [], total: 0 };
const MAX_TRACKED = 3;
const byKickoff = (a: Match, b: Match) => Date.parse(a.kickoff) - Date.parse(b.kickoff);
const byNewest = (a: NewsItem, b: NewsItem) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
const toggle = (list: readonly string[], slug: string): readonly string[] => (list.includes(slug) ? list.filter((s) => s !== slug) : [...list, slug]);

export const KIND_LABEL: Record<SearchHit['kind'], string> = { team: 'Equipo', competition: 'Competición', match: 'Partido', news: 'Noticia', site: 'Guía TV' };

/** Single source of UI state for the sports shell. Provided at the shell route, so it dies with it. */
@Injectable()
export class SportsStore {
  private readonly data = inject(FootballData);
  private readonly storage = inject(FollowStorage);
  private readonly router = inject(Router);
  private readonly viewport = inject(Sv2Viewport);
  private readonly now = inject(SPORTS_NOW);
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private poller?: LivePoller;
  private readonly requested = new Set<string>();

  readonly isDemo = this.data.source === 'demo';
  /** When live data last arrived from the provider via our API (epoch ms). Null until the first successful load. */
  readonly lastUpdated = signal<number | null>(null);
  /** The last refresh failed or the tab was away: scores on screen may be old. */
  readonly stale = signal(false);
  /** Lazy fetches in flight; pages hold their "not found" state until this is 0. */
  readonly resolving = signal(0);
  /** Polling gave up after repeated failures; the user can retry. */
  readonly liveStopped = signal(false);
  readonly zone = signal(displayZone());
  private readonly dismissedAuto = signal<readonly string[]>([]);
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
  /** Slugs of articles whose body has been fetched. */
  private readonly fullArticles = new Set<string>();
  readonly standings = computed(() => this.snapshot().standings);

  private readonly teamIndex = computed(() => new Map(this.teams().map((t) => [t.slug, t])));
  private readonly competitionIndex = computed(() => new Map(this.competitions().map((c) => [c.slug, c])));
  private readonly matchIndex = computed(() => new Map(this.matches().map((m) => [m.slug, m])));

  readonly liveMatches = computed(() => this.matches().filter((m) => m.status === 'live'));
  readonly upcomingMatches = computed(() => this.matches().filter((m) => m.status === 'scheduled' || m.status === 'postponed').sort(byKickoff));
  readonly finishedMatches = computed(() => this.matches().filter((m) => m.status === 'finished').sort((a, b) => byKickoff(b, a)));
  readonly selectedMatch = computed<Match | null>(() => this.matchIndex().get(this.selectedMatchSlug() ?? '') ?? null);
  /** Matches the user pinned, plus live matches of followed teams (unless dismissed). Capped. */
  readonly trackedMatches = computed(() => {
    const manual = this.trackedSlugs().flatMap((s) => this.matchIndex().get(s) ?? []);
    const teams = this.followedTeamSlugs();
    const auto = this.liveMatches().filter((m) => (teams.includes(m.homeSlug) || teams.includes(m.awaySlug)) && !this.trackedSlugs().includes(m.slug) && !this.dismissedAuto().includes(m.slug));
    return [...manual, ...auto].slice(0, MAX_TRACKED);
  });
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
  /** Dropdown list: football first, with room kept for up to three site-wide results. */
  readonly searchHits = computed<readonly SearchHit[]>(() => {
    const g = this.searchGroups();
    const site = g.site.slice(0, 3);
    return [...g.teams, ...g.competitions, ...g.matches, ...g.news].slice(0, 8 - site.length).concat(site);
  });
  private readonly siteHits = signal<{ q: string; hits: readonly SearchHit[] }>({ q: '', hits: [] });
  private remoteSeq = 0;
  private remoteTimer: ReturnType<typeof setTimeout> | null = null;

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
    const ranked = <T>(items: readonly T[], text: (i: T) => string): T[] =>
      items
        .map((item, i) => ({ item, i, score: rank(normalize(text(item)), q) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .map((r) => r.item);
    const teams = ranked(this.teams(), (t) => `${t.name} ${t.shortName}`).map<SearchHit>((t) => ({ kind: 'team', label: t.name, detail: t.city ?? '', link: ['equipos', t.slug] }));
    const competitions = ranked(this.competitions(), (c) => `${c.name} ${c.country}`).map<SearchHit>((c) => ({ kind: 'competition', label: c.name, detail: c.country, link: ['competiciones', c.slug] }));
    const matches = ranked([...this.matches()].sort(byKickoff), (m) => `${this.team(m.homeSlug)?.name} ${this.team(m.awaySlug)?.name} ${this.competition(m.competitionSlug)?.name}`)
      .map<SearchHit>((m) => ({ kind: 'match', label: `${this.team(m.homeSlug)?.name ?? ''} - ${this.team(m.awaySlug)?.name ?? ''}`, detail: `${this.competition(m.competitionSlug)?.name ?? ''} · ${shortDay(dayKey(m.kickoff))}`, link: ['partido', m.slug] }));
    const news = ranked(this.news(), (n) => `${n.title} ${n.summary}`).map<SearchHit>((n) => ({ kind: 'news', label: n.title, detail: n.kicker, link: ['noticias', n.slug] }));
    const site = this.siteHits().q === rawQuery.trim() ? this.siteHits().hits : [];
    return { teams, competitions, matches, news, site, total: teams.length + competitions.length + matches.length + news.length + site.length };
  }

  async load(): Promise<void> {
    if (this.loadState() === 'loading' || this.loadState() === 'ready') return;
    this.loadState.set('loading');
    try {
      this.snapshot.set(await this.data.load());
      this.lastUpdated.set(this.now().getTime());
      this.today.set(dayKey(this.now()));
      this.poller?.reschedule(); // the poller may have started before the first data arrived
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

  private merge(part: Partial<SportsSnapshot>): void {
    this.snapshot.update((s) => mergeSnapshots(s, part));
    this.poller?.reschedule();
  }

  /** Fetch each lazy resource at most once; a failure allows a later retry and never breaks the page. */
  private once(key: string, job: () => Promise<void>): Promise<void> {
    if (this.requested.has(key)) return Promise.resolve();
    this.requested.add(key);
    this.resolving.update((n) => n + 1);
    return job()
      .catch(() => void this.requested.delete(key))
      .finally(() => this.resolving.update((n) => n - 1));
  }

  /** Table, fixtures and news of one competition (not in the preloaded window). */
  ensureCompetition(slug: string): Promise<void> {
    return this.once(`c:${slug}`, async () => this.merge(await this.data.competition(slug)));
  }

  /** A match opened by direct link that is not in the preloaded window. */
  ensureMatch(slug: string): Promise<void> {
    if (this.matchIndex().has(slug)) return Promise.resolve();
    return this.once(`m:${slug}`, async () => this.merge(await this.data.match(slug)));
  }

  /** A team opened by direct link that has no fixtures in the preloaded window. */
  ensureTeam(slug: string): Promise<void> {
    if (this.teamIndex().has(slug)) return Promise.resolve();
    return this.once(`t:${slug}`, async () => this.merge(await this.data.team(slug)));
  }

  /** Fixtures for a day outside the preloaded window. */
  ensureDay(key: string): Promise<void> {
    if (this.matchDays().includes(key)) return Promise.resolve();
    return this.once(`d:${key}`, async () => this.merge(await this.data.day(key)));
  }

  /** Full article body, fetched on demand. */
  ensureArticle(slug: string): Promise<void> {
    if (this.fullArticles.has(slug)) return Promise.resolve();
    return this.once(`a:${slug}`, async () => {
      const a = await this.data.article(slug);
      if (a) {
        this.fullArticles.add(slug);
        this.snapshot.update((s) => ({ ...s, news: [...s.news.filter((n) => n.slug !== slug), a] }));
      }
    });
  }

  /** Browser only. Starts adaptive live updates and adopts the visitor's time zone. */
  startLive(): void {
    if (this.poller || this.isDemo) return; // demo data is Madrid-timed and static
    if (setDisplayZone(Intl.DateTimeFormat().resolvedOptions().timeZone) && displayZone() !== this.zone()) {
      this.zone.set(displayZone());
      this.today.set(dayKey(this.now()));
    }
    effect(() => this.searchRemote(this.query()), { injector: this.injector });
    this.destroyRef.onDestroy(() => this.remoteTimer && clearTimeout(this.remoteTimer));
    if (!this.data.polls) return;
    this.poller = new LivePoller(
      {
        delay: (failures) => nextPollDelay(this.matches(), this.now().getTime(), failures),
        poll: () => this.pollLive(),
        onFailure: (n) => {
          this.stale.set(true);
          this.liveStopped.set(n >= 5);
        },
        onResume: () => {
          this.today.set(dayKey(this.now()));
          this.stale.set(true); // until the catch-up poll lands
        },
      },
      this.doc,
      () => this.now().getTime(),
    );
    this.poller.start();
    this.destroyRef.onDestroy(() => this.poller?.stop());
  }

  /**
   * Debounced (300 ms, latest wins) lookups beyond the loaded data: published football news and the site-wide
   * search (programmes, films, series), so one box searches the whole app. Browser only; failures are silent.
   */
  searchRemote(raw: string): void {
    if (this.remoteTimer) clearTimeout(this.remoteTimer);
    const q = raw.trim();
    if (this.isDemo || q.length < 2) return;
    this.remoteTimer = setTimeout(() => {
      const id = ++this.remoteSeq; // an older response must never overwrite a newer query's results
      if (q.length >= 3) this.data.searchNews(q).then((items) => items.length && this.merge({ news: items })).catch(() => undefined);
      this.data
        .searchSite(q)
        .then((items) => id === this.remoteSeq && this.siteHits.set({ q, hits: items.map<SearchHit>((i) => ({ kind: 'site', label: i.title, detail: i.meta, link: [], path: i.path })) }))
        .catch(() => undefined);
    }, 300);
  }

  /** Manual retry after polling stopped. */
  refreshLive(): void {
    this.liveStopped.set(false);
    this.poller?.poke();
  }

  /** One poll: live list from the provider, then settle matches that were live here but are no longer listed. */
  async pollLive(): Promise<void> {
    const live = await this.data.liveUpdates();
    const liveSlugs = new Set(live.map((m) => m.slug));
    const dropped = this.matches().filter((m) => m.status === 'live' && !liveSlugs.has(m.slug)).slice(0, 3);
    const settled = (await Promise.all(dropped.map((m) => this.data.match(m.slug).catch(() => ({}) as Partial<SportsSnapshot>)))).flatMap((p) => p.matches ?? []);
    const byslug = new Map([...live, ...settled].map((m) => [m.slug, m]));
    this.snapshot.update((s) => ({
      ...s,
      matches: s.matches.map((old) => {
        const n = byslug.get(old.slug);
        return n ? { ...n, broadcasts: n.broadcasts.length ? n.broadcasts : old.broadcasts } : old;
      }),
    }));
    this.lastUpdated.set(this.now().getTime());
    this.stale.set(false);
    this.liveStopped.set(false);
    this.poller?.reschedule();
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
    return this.trackedMatches().some((m) => m.slug === slug);
  }

  /** Toggle tracking; keeps at most MAX_TRACKED, dropping the oldest. */
  toggleTracked(slug: string): void {
    if (this.isTracked(slug)) {
      this.trackedSlugs.update((list) => list.filter((s) => s !== slug));
      this.dismissedAuto.update((list) => [...list, slug]);
    } else {
      this.trackedSlugs.update((list) => [...list, slug].slice(-MAX_TRACKED));
      this.dismissedAuto.update((list) => list.filter((s) => s !== slug));
    }
    this.trackerMinimized.set(false);
  }
}

/** 4 exact, 3 prefix, 2 word prefix, 1 contains, 0 no match. `hay` and `q` are already normalized. */
export function rank(hay: string, q: string): number {
  if (hay === q) return 4;
  if (hay.startsWith(q)) return 3;
  if (hay.includes(` ${q}`)) return 2;
  return hay.includes(q) ? 1 : 0;
}

export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
