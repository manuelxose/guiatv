/* eslint-disable @typescript-eslint/no-unused-vars -- the optional port methods default to "nothing more to offer" */
import { Injectable, InjectionToken, inject } from '@angular/core';
import { dayKey } from '../domain/calendar';
import { Match, NewsItem, SiteResult, SportsSnapshot } from '../domain/models';
import { buildDemoSnapshot } from './demo-fixtures';

/** Injectable clock so day navigation and tests are deterministic. */
export const SPORTS_NOW = new InjectionToken<() => Date>('SPORTS_NOW', { providedIn: 'root', factory: () => () => new Date() });

/**
 * Data port. UI and state depend only on this contract.
 * Everything beyond `load()` is optional enrichment: the default is "nothing more to offer", never an error.
 */
export abstract class FootballData {
  /** `demo` adapters serve fictional data and make the shell say so. */
  abstract readonly source: 'demo' | 'live';
  /** True when the store should poll `liveUpdates()`. */
  readonly polls: boolean = false;
  abstract load(): Promise<SportsSnapshot>;
  /** Currently-live matches as reported by the provider. */
  liveUpdates(): Promise<readonly Match[]> {
    return Promise.resolve([]);
  }
  /** Fixtures for one day outside the preloaded window. */
  day(_key: string): Promise<Partial<SportsSnapshot>> {
    return Promise.resolve({});
  }
  /**
   * The next day (from `fromKey`, inclusive) on which `competitionSlug` actually plays.
   *
   * A competition such as the Europa League plays every few weeks, so its next
   * fixture is usually OUTSIDE the preloaded window. Searching only the days that
   * are already in memory makes the competition look empty; this asks the provider
   * for a bounded forward range instead. Null means "no fixture found in range".
   */
  nextCompetitionDay(_competitionSlug: string, _fromKey: string, _searchDays = 60): Promise<string | null> {
    return Promise.resolve(null);
  }
  /** Standings, fixtures and news of one competition. */
  competition(_slug: string): Promise<Partial<SportsSnapshot>> {
    return Promise.resolve({});
  }
  /** One match with the teams and competition it needs, fresh (direct links, and matches that dropped out of the live list). */
  match(_slug: string): Promise<Partial<SportsSnapshot>> {
    return Promise.resolve({});
  }
  /** A team opened by direct link: its fixtures and news. */
  team(_slug: string): Promise<Partial<SportsSnapshot>> {
    return Promise.resolve({});
  }
  searchNews(_query: string): Promise<readonly NewsItem[]> {
    return Promise.resolve([]);
  }
  /** Site-wide search (programmes, films, series), the same source as the main Guía TV search box. */
  searchSite(_query: string): Promise<readonly SiteResult[]> {
    return Promise.resolve([]);
  }
  /** One article with its full body. */
  article(_slug: string): Promise<NewsItem | null> {
    return Promise.resolve(null);
  }
}

/** Demo adapter: fictional fixtures only, for local development and automated tests. */
@Injectable()
export class DemoFootballData extends FootballData {
  readonly source = 'demo' as const;
  private readonly now = inject(SPORTS_NOW);

  load(): Promise<SportsSnapshot> {
    return Promise.resolve(buildDemoSnapshot(dayKey(this.now())));
  }
}
