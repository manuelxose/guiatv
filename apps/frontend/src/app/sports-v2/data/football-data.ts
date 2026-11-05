import { Injectable } from '@angular/core';
import { SportsSnapshot } from '../domain/models';
import { DEMO_COMPETITIONS, DEMO_MATCHES, DEMO_NEWS, DEMO_TEAMS } from './demo-fixtures';

/**
 * Data port. UI and state depend only on this contract.
 * M02 swaps the provider for an HTTP adapter against the existing public API;
 * nothing above this file changes.
 */
export abstract class FootballData {
  abstract load(): Promise<SportsSnapshot>;
}

/** Demo adapter (M01). Clearly isolated: it only serves fictional fixtures. */
@Injectable()
export class DemoFootballData extends FootballData {
  load(): Promise<SportsSnapshot> {
    return Promise.resolve({
      teams: DEMO_TEAMS,
      competitions: DEMO_COMPETITIONS,
      matches: DEMO_MATCHES,
      news: DEMO_NEWS,
    });
  }
}
