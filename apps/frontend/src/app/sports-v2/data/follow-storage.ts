import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { UserService } from '../../services/user.service';

export interface FollowState {
  readonly teams: readonly string[];
  readonly competitions: readonly string[];
  readonly matches: readonly string[];
}

export const EMPTY_FOLLOWS: FollowState = { teams: [], competitions: [], matches: [] };

/** Persistence port for follows. M03 can add an account-backed adapter without touching the store. */
export abstract class FollowStorage {
  abstract read(): FollowState;
  abstract write(state: FollowState): void;
}

const KEY = 'guiatv.sports-v2.follows';
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 200) : []);

/** localStorage adapter. Anonymous by design: nothing leaves the device. SSR-safe (no-op on the server). */
@Injectable()
export class BrowserFollowStorage extends FollowStorage {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  read(): FollowState {
    if (!this.browser) return EMPTY_FOLLOWS;
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, unknown> | null;
      return raw ? { teams: strings(raw['teams']), competitions: strings(raw['competitions']), matches: strings(raw['matches']) } : EMPTY_FOLLOWS;
    } catch {
      return EMPTY_FOLLOWS; // corrupt or blocked storage must never break the page
    }
  }

  write(state: FollowState): void {
    if (!this.browser) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* quota or privacy mode: follows simply stay in memory */
    }
  }
}

@Injectable()
export class MemoryFollowStorage extends FollowStorage {
  state: FollowState = EMPTY_FOLLOWS;
  read(): FollowState {
    return this.state;
  }
  write(state: FollowState): void {
    this.state = state;
  }
}

const ACCOUNT_LIMIT = 50; // the API keeps at most 50 ids per list

/**
 * Follows stay in localStorage (works signed out) and, when signed in, teams and competitions are also stored in the
 * account (`tvPreferences`) so they follow the user across devices. Saved matches stay on the device (no account field).
 * shortcut: union merge, so a team unfollowed on another device comes back until it is unfollowed here too.
 */
@Injectable()
export class AccountFollowStorage extends BrowserFollowStorage {
  private readonly user = inject(UserService);

  override read(): FollowState {
    const local = super.read();
    const tv = this.signedIn() ? this.user.getProfileSnapshot()?.tvPreferences : undefined;
    if (!tv) return local;
    const union = (a: readonly string[], b: readonly string[] | undefined) => [...new Set([...a, ...(b ?? [])])];
    return {
      teams: union(local.teams, tv.favoriteFootballTeamIds),
      competitions: union(local.competitions, tv.favoriteFootballCompetitionIds),
      matches: local.matches,
    };
  }

  override write(state: FollowState): void {
    super.write(state);
    const tv = this.signedIn() ? this.user.getProfileSnapshot()?.tvPreferences : undefined;
    if (!tv) return;
    const teams = state.teams.slice(0, ACCOUNT_LIMIT);
    const competitions = state.competitions.slice(0, ACCOUNT_LIMIT);
    if (sameList(teams, tv.favoriteFootballTeamIds) && sameList(competitions, tv.favoriteFootballCompetitionIds)) return;
    this.user.updateTvPreferences({ ...tv, favoriteFootballTeamIds: teams, favoriteFootballCompetitionIds: competitions }).subscribe();
  }

  private signedIn(): boolean {
    return this.user.isAuthenticatedSync();
  }
}

const sameList = (a: readonly string[], b: readonly string[] | undefined): boolean => !!b && a.length === b.length && a.every((x, i) => x === b[i]);
