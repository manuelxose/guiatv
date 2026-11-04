import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';

/** State of the optional "analytics" purpose. `unset` = the visitor has not chosen yet (nothing is collected). */
export type AnalyticsConsent = 'unset' | 'granted' | 'denied';

export const CONSENT_COOKIE = 'cookie_consent';
/** Choice validity. The visitor is asked again afterwards (AEPD guidance: renew at most every 24 months). */
const CONSENT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const CONSENT_VERSION = 'v1';

/**
 * Parses `v1.a1.<epoch ms>` (granted) / `v1.a0.<epoch ms>` (denied). Unknown versions, malformed values and choices
 * older than the validity window read as `unset`, so the banner is shown again.
 */
export function parseConsentCookie(raw: string | null | undefined, now = Date.now()): AnalyticsConsent {
  if (!raw) return 'unset';
  const match = /^v1\.a([01])\.(\d{10,14})$/.exec(raw.trim());
  if (!match) return 'unset';
  const at = Number(match[2]);
  if (!Number.isFinite(at) || at > now + 86_400_000 || now - at > CONSENT_MAX_AGE_SECONDS * 1000) return 'unset';
  return match[1] === '1' ? 'granted' : 'denied';
}

export function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * The single source of truth for the analytics consent purpose. Browser only: during SSR the state is always `unset`
 * and nothing reads cookies, so cached SSR HTML never depends on a visitor's choice. The banner is rendered after
 * hydration by `ConsentBannerComponent`.
 */
@Injectable({ providedIn: 'root' })
export class ConsentService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly listeners = new Set<(state: AnalyticsConsent) => void>();

  readonly analytics = signal<AnalyticsConsent>('unset');
  /** True while the preferences dialog is explicitly open (footer/cookies-page link). */
  readonly preferencesOpen = signal(false);

  constructor() {
    if (!this.isBrowser) return;
    try {
      this.analytics.set(parseConsentCookie(readCookie(this.document.cookie || '', CONSENT_COOKIE)));
    } catch {
      this.analytics.set('unset');
    }
  }

  get state(): AnalyticsConsent {
    return this.analytics();
  }

  /** Subscribes to changes (not to the current value). Returns an unsubscribe function. */
  onChange(listener: (state: AnalyticsConsent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  grant(): void {
    this.set('granted');
  }

  deny(): void {
    this.set('denied');
  }

  openPreferences(): void {
    this.preferencesOpen.set(true);
  }

  closePreferences(): void {
    this.preferencesOpen.set(false);
  }

  private set(state: 'granted' | 'denied'): void {
    if (!this.isBrowser) return;
    const value = `${CONSENT_VERSION}.a${state === 'granted' ? 1 : 0}.${Date.now()}`;
    const secure = this.document.location?.protocol === 'https:' ? '; Secure' : '';
    try {
      this.document.cookie = `${CONSENT_COOKIE}=${value}; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
    } catch {
      // A blocked cookie jar still applies the choice for this page view.
    }
    const changed = this.analytics() !== state;
    this.analytics.set(state);
    this.preferencesOpen.set(false);
    if (changed) for (const listener of [...this.listeners]) listener(state);
  }
}
