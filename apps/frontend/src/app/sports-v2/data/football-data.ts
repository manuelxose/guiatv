import { Injectable, InjectionToken, inject } from '@angular/core';
import { dayKey } from '../domain/calendar';
import { SportsSnapshot } from '../domain/models';
import { buildDemoSnapshot } from './demo-fixtures';

/** Injectable clock so day navigation and tests are deterministic. */
export const SPORTS_NOW = new InjectionToken<() => Date>('SPORTS_NOW', { providedIn: 'root', factory: () => () => new Date() });

/**
 * Data port. UI and state depend only on this contract.
 * M03 swaps the provider for an HTTP adapter against the real API; nothing above this file changes.
 */
export abstract class FootballData {
  /** `demo` adapters serve fictional data and make the shell say so. */
  abstract readonly source: 'demo' | 'live';
  abstract load(): Promise<SportsSnapshot>;
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
