import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

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
