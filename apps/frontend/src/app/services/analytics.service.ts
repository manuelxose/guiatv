import { Injectable, Injector, NgZone, PLATFORM_ID, inject } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ConsentService } from './analytics/consent.service';
import { removeAnalyticsIdentifiers } from './analytics/analytics-identifiers';
import type { AnalyticsCollector } from './analytics/analytics-collector';

type Call = ({ kind: 'page'; url: string } | { kind: 'event'; type: string; data?: Record<string, unknown>; name?: string }) & { at: number };

const MAX_BUFFERED_CALLS = 20;
const MAX_BUFFERED_AGE_MS = 10 * 60_000;
const DEBUG_KEY = 'gtv_analytics_debug';

/**
 * Eager analytics facade (the API every component uses). It is deliberately tiny: the collector, the GA4 bridge and
 * the payload sanitisers live in a lazy chunk that is imported only after the visitor grants the analytics purpose,
 * on an idle callback. Until then calls are kept in a bounded in-memory buffer (never stored, never sent) and are
 * replayed in order once the collector loads; a "denied" choice drops them and removes any analytics identifier.
 * Nothing runs during SSR.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly zone = inject(NgZone);
  private readonly consent = inject(ConsentService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private initialized = false;
  private disabled = false;
  private collector: AnalyticsCollector | null = null;
  private loading: Promise<void> | null = null;
  private buffer: Call[] = [];

  init(): void {
    if (!this.isBrowser || this.initialized) return;
    this.initialized = true;
    const host = this.document.location?.hostname || '';
    if (['localhost', '127.0.0.1', '[::1]'].includes(host) && !this.debugEnabled()) {
      this.disabled = true;
      return;
    }
    this.consent.onChange((state) => {
      if (state === 'granted') this.scheduleLoad();
      else if (!this.collector) this.dropAll(); // a loaded collector handles revocation itself
    });
    if (this.consent.state === 'granted') this.scheduleLoad();
    else removeAnalyticsIdentifiers(this.document); // includes identifiers an older, pre-consent collector created
  }

  trackPageView(url: string): void {
    this.dispatch({ kind: 'page', url, at: Date.now() });
  }

  trackEvent(type: string, data?: Record<string, unknown>, name?: string): void {
    this.dispatch({ kind: 'event', type, data, name, at: Date.now() });
  }

  /** Resolves once the lazy collector is loaded (tests and diagnostics). */
  whenLoaded(): Promise<void> {
    return this.loading || Promise.resolve();
  }

  private dispatch(call: Call): void {
    if (!this.isBrowser) return;
    this.init();
    if (this.disabled || this.consent.state === 'denied') return;
    if (this.collector) {
      this.apply(this.collector, call);
      return;
    }
    this.buffer.push(call);
    if (this.buffer.length > MAX_BUFFERED_CALLS) this.buffer.shift();
  }

  private apply(collector: AnalyticsCollector, call: Call): void {
    if (call.kind === 'page') collector.trackPageView(call.url);
    else collector.trackEvent(call.type, call.data, call.name);
  }

  private scheduleLoad(): void {
    if (this.loading || this.collector) return;
    this.loading = new Promise<void>((resolve) => {
      const win = this.document.defaultView as (Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }) | null;
      const run = () => {
        import('./analytics/analytics-collector')
          .then(({ AnalyticsCollector }) => {
            if (this.consent.state !== 'granted') {
              this.loading = null; // revoked while loading: a later grant loads again
              return;
            }
            const collector = this.injector.get(AnalyticsCollector);
            collector.init();
            const cutoff = Date.now() - MAX_BUFFERED_AGE_MS;
            const pending = this.buffer.filter((call) => call.at >= cutoff);
            this.buffer = [];
            for (const call of pending) this.apply(collector, call);
            this.collector = collector;
          })
          .catch(() => {
            // Chunk failed to load (offline, deploy in progress): analytics stays off for this page view.
            this.buffer = [];
          })
          .finally(resolve);
      };
      this.zone.runOutsideAngular(() => {
        if (typeof win?.requestIdleCallback === 'function') win.requestIdleCallback(run, { timeout: 3000 });
        else setTimeout(run, 1);
      });
    });
  }

  private dropAll(): void {
    this.buffer = [];
    removeAnalyticsIdentifiers(this.document);
  }

  private debugEnabled(): boolean {
    try {
      return localStorage.getItem(DEBUG_KEY) === '1';
    } catch {
      return false;
    }
  }
}
