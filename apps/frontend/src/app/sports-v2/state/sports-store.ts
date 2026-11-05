import { Injectable, computed, inject, signal } from '@angular/core';
import { FootballData } from '../data/football-data';
import { Competition, Match, NewsItem, SportsSnapshot, Team } from '../domain/models';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface SearchHit {
  readonly kind: 'team' | 'competition' | 'match';
  readonly label: string;
  readonly link: readonly string[];
}

const EMPTY: SportsSnapshot = { teams: [], competitions: [], matches: [], news: [] };
const MAX_TRACKED = 3;

/** Single source of UI state for the sports shell. Provided at the shell route, so it dies with it. */
@Injectable()
export class SportsStore {
  private readonly data = inject(FootballData);

  readonly loadState = signal<LoadState>('idle');
  private readonly snapshot = signal<SportsSnapshot>(EMPTY);

  readonly selectedMatchSlug = signal<string | null>(null);
  readonly sidebarCollapsed = signal(false);
  readonly contextOpen = signal(false); // mobile drawer for the Match Center
  readonly trackedSlugs = signal<readonly string[]>([]);
  readonly trackerMinimized = signal(false);
  readonly followedTeamSlugs = signal<readonly string[]>(['real-costa', 'atletico-norte']);
  readonly favoriteCompetitionSlugs = signal<readonly string[]>(['liga-demo-a']);
  readonly query = signal('');

  readonly teams = computed(() => this.snapshot().teams);
  readonly competitions = computed(() => this.snapshot().competitions);
  readonly matches = computed(() => this.snapshot().matches);
  readonly news = computed(() => this.snapshot().news);

  private readonly teamIndex = computed(() => new Map(this.teams().map((t) => [t.slug, t])));
  private readonly competitionIndex = computed(() => new Map(this.competitions().map((c) => [c.slug, c])));

  readonly liveMatches = computed(() => this.matches().filter((m) => m.status === 'live'));
  readonly upcomingMatches = computed(() => this.matches().filter((m) => m.status === 'scheduled' || m.status === 'postponed'));
  readonly finishedMatches = computed(() => this.matches().filter((m) => m.status === 'finished'));
  readonly selectedMatch = computed<Match | null>(() => {
    const slug = this.selectedMatchSlug();
    return this.matches().find((m) => m.slug === slug) ?? null;
  });
  readonly trackedMatches = computed(() => {
    const index = new Map(this.matches().map((m) => [m.slug, m]));
    return this.trackedSlugs().flatMap((s) => (index.has(s) ? [index.get(s) as Match] : []));
  });
  readonly followedTeams = computed(() =>
    this.followedTeamSlugs().flatMap((s) => (this.teamIndex().has(s) ? [this.teamIndex().get(s) as Team] : [])),
  );
  readonly favoriteCompetitions = computed(() =>
    this.favoriteCompetitionSlugs().flatMap((s) =>
      this.competitionIndex().has(s) ? [this.competitionIndex().get(s) as Competition] : [],
    ),
  );

  readonly searchHits = computed<readonly SearchHit[]>(() => {
    const q = normalize(this.query());
    if (q.length < 2) return [];
    const hits: SearchHit[] = [];
    for (const t of this.teams()) if (normalize(t.name).includes(q)) hits.push({ kind: 'team', label: t.name, link: ['equipos', t.slug] });
    for (const c of this.competitions())
      if (normalize(c.name).includes(q)) hits.push({ kind: 'competition', label: c.name, link: ['competiciones', c.slug] });
    for (const m of this.matches()) {
      const label = `${this.team(m.homeSlug)?.name ?? ''} - ${this.team(m.awaySlug)?.name ?? ''}`;
      if (normalize(label).includes(q)) hits.push({ kind: 'match', label, link: ['partido', m.slug] });
    }
    return hits.slice(0, 8);
  });

  team(slug: string): Team | undefined {
    return this.teamIndex().get(slug);
  }
  competition(slug: string): Competition | undefined {
    return this.competitionIndex().get(slug);
  }
  matchesOf(competitionSlug: string): readonly Match[] {
    return this.matches().filter((m) => m.competitionSlug === competitionSlug);
  }
  newsItems(): readonly NewsItem[] {
    return this.news();
  }

  async load(): Promise<void> {
    if (this.loadState() === 'loading' || this.loadState() === 'ready') return;
    this.loadState.set('loading');
    try {
      this.snapshot.set(await this.data.load());
      this.loadState.set('ready');
      // Pre-select the most relevant match so the Match Center is never empty on desktop.
      if (!this.selectedMatchSlug()) this.selectedMatchSlug.set(this.liveMatches()[0]?.slug ?? this.matches()[0]?.slug ?? null);
    } catch {
      this.loadState.set('error');
    }
  }

  retry(): Promise<void> {
    this.loadState.set('idle');
    return this.load();
  }

  selectMatch(slug: string, openPanel = false): void {
    this.selectedMatchSlug.set(slug);
    if (openPanel) this.contextOpen.set(true);
  }

  toggleSidebar(): void {
    this.sidebarCollapsed.update((v) => !v);
  }

  isTracked(slug: string): boolean {
    return this.trackedSlugs().includes(slug);
  }

  /** Toggle tracking; keeps at most MAX_TRACKED, dropping the oldest. */
  toggleTracked(slug: string): void {
    this.trackedSlugs.update((list) => {
      if (list.includes(slug)) return list.filter((s) => s !== slug);
      return [...list, slug].slice(-MAX_TRACKED);
    });
    this.trackerMinimized.set(false);
  }
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
