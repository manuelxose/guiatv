import {
  FootballCompetition,
  FootballDataProvider,
  FootballMatch,
  FootballMatchQuery,
  FootballStandingRow,
  FootballTeam,
} from '../../../domain/sports/football/types';

/**
 * Keeps the football surface available when the live provider is throttled or
 * unavailable. The secondary provider is the local EPG read model, so the
 * fallback never causes another external request and never invents scores.
 */
export class FallbackFootballDataProvider implements FootballDataProvider {
  readonly key: string;
  readonly name: string;

  constructor(
    private readonly primary: FootballDataProvider,
    private readonly secondary: FootballDataProvider
  ) {
    this.key = `${primary.key}+${secondary.key}`;
    this.name = `${primary.name} with ${secondary.name} fallback`;
  }

  getMatches(query: FootballMatchQuery): Promise<FootballMatch[]> {
    return this.fillGaps(() => this.primary.getMatches(query), () => this.secondary.getMatches(query), query.limit);
  }

  getLiveMatches(): Promise<FootballMatch[]> {
    return this.fillGaps(() => this.primary.getLiveMatches(), () => this.secondary.getLiveMatches());
  }

  /**
   * Competitions the primary provider does not return at all (e.g. Europa League on a free
   * football-data.org plan) are completed from the EPG. A competition the primary does return
   * is never touched, so the EPG cannot contradict or duplicate the primary's fixtures.
   */
  private async fillGaps(
    primary: () => Promise<FootballMatch[]>,
    secondary: () => Promise<FootballMatch[]>,
    limit?: number
  ): Promise<FootballMatch[]> {
    let main: FootballMatch[];
    try {
      main = await primary();
    } catch {
      return secondary();
    }
    let extra: FootballMatch[] = [];
    try {
      const covered = new Set(main.map((m) => m.competition.slug));
      extra = (await secondary()).filter((m) => !covered.has(m.competition.slug));
    } catch {
      // shortcut: EPG failure only loses the extra fixtures; the primary result still stands
    }
    if (!extra.length) return main;
    const merged = [...main, ...extra].sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));
    return limit ? merged.slice(0, limit) : merged;
  }

  getMatch(idOrSlug: string): Promise<FootballMatch | null> {
    return this.withNullableFallback(() => this.primary.getMatch(idOrSlug), () => this.secondary.getMatch(idOrSlug));
  }

  /** Primary entries win; catalog competitions the primary lacks (e.g. Europa League) are appended. */
  async getCompetitions(): Promise<FootballCompetition[]> {
    let main: FootballCompetition[];
    try {
      main = await this.primary.getCompetitions();
    } catch {
      return this.secondary.getCompetitions();
    }
    try {
      const have = new Set(main.map((c) => c.slug));
      return [...main, ...(await this.secondary.getCompetitions()).filter((c) => !have.has(c.slug))];
    } catch {
      return main;
    }
  }

  getCompetition(slug: string): Promise<FootballCompetition | null> {
    return this.withNullableFallback(() => this.primary.getCompetition(slug), () => this.secondary.getCompetition(slug));
  }

  getStandings(competitionSlug: string): Promise<FootballStandingRow[]> {
    return this.withFallback(() => this.primary.getStandings(competitionSlug), () => this.secondary.getStandings(competitionSlug));
  }

  getTeams(): Promise<FootballTeam[]> {
    return this.withFallback(() => this.primary.getTeams(), () => this.secondary.getTeams());
  }

  getTeam(slug: string): Promise<FootballTeam | null> {
    return this.withNullableFallback(() => this.primary.getTeam(slug), () => this.secondary.getTeam(slug));
  }

  supportsLiveScores(): boolean {
    return this.primary.supportsLiveScores();
  }

  private async withFallback<T>(primary: () => Promise<T>, secondary: () => Promise<T>): Promise<T> {
    try {
      return await primary();
    } catch {
      return secondary();
    }
  }

  private async withNullableFallback<T>(primary: () => Promise<T | null>, secondary: () => Promise<T | null>): Promise<T | null> {
    try {
      return (await primary()) ?? secondary();
    } catch {
      return secondary();
    }
  }
}
