import { EnvironmentProviders, Provider } from '@angular/core';
import { provideRouter } from '@angular/router';
import { DemoFootballData, FootballData, SPORTS_NOW } from '../data/football-data';
import { FollowStorage, MemoryFollowStorage } from '../data/follow-storage';
import { SportsStore } from '../state/sports-store';
import { Sv2Viewport } from '../state/viewport';

/** Fixed "now" (13:00 Madrid) so demo fixtures and day navigation are deterministic in tests. */
export const TEST_NOW = new Date('2026-11-05T12:00:00Z');
export const TEST_TODAY = '2026-11-05';

/** Everything the store needs, with demo data, in-memory follows and a fixed clock. */
export const sv2TestProviders = (...extra: Provider[]): (Provider | EnvironmentProviders)[] => [
  provideRouter([]),
  { provide: SPORTS_NOW, useValue: () => TEST_NOW },
  { provide: FootballData, useClass: DemoFootballData },
  { provide: FollowStorage, useClass: MemoryFollowStorage },
  Sv2Viewport,
  SportsStore,
  ...extra,
];
