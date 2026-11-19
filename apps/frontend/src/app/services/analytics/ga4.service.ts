import { Injectable, NgZone, PLATFORM_ID, inject } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { environment } from '../../../environments/environment';
import { deleteGaCookies } from './analytics-identifiers';

const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,16}$/;

type Gtag = (...args: unknown[]) => void;
type GtagWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag } & Record<string, unknown>;

/**
 * Google Analytics 4 with Consent Mode v2 *basic*: no Google script, request or cookie exists before the visitor
 * grants the analytics purpose. On grant, the consent defaults (everything denied) and the update (analytics only;
 * advertising purposes stay denied because the site asks for no advertising consent) are queued before `config`, and
 * the Google script is injected on an idle callback after the load event.
 *
 * The GTM container sends its own initial page view. The collector sends later views, with history-based
 * page views turned off in the GA4 property. With direct GA4, the collector sends every view.
 */
@Injectable({ providedIn: 'root' })
export class Ga4Service {
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly containerId = environment.analytics.gtmContainerId;
  private measurementId: string | null = null;
  private configured = false;
  private scriptRequested = false;
  private scriptInjected = false;
  private lastPagePath: string | null = null;

  get active(): boolean {
    return this.configured;
  }

  /**
   * Idempotent. Only call after consent was granted and the server config enabled GA4. `path` is the current
   * sanitised path and `referrerHost` the external referrer host: they replace GA4's defaults (`document.location`
   * and `document.referrer`, which carry query strings and full referrer URLs) on every hit, automatic ones included.
   */
  enable(measurementId: string, path = '/', referrerHost?: string): void {
    if (!this.isBrowser || !MEASUREMENT_ID_PATTERN.test(measurementId)) return;
    const win = this.document.defaultView as unknown as GtagWindow | null;
    if (!win) return;
    if (this.configured && this.measurementId === measurementId) {
      win[`ga-disable-${measurementId}`] = false;
      this.gtag('consent', 'update', { analytics_storage: 'granted' });
      return;
    }
    this.measurementId = measurementId;
    win[`ga-disable-${measurementId}`] = false;
    win.dataLayer = win.dataLayer || [];
    if (typeof win.gtag !== 'function') {
      // The official stub: gtag.js replays `arguments` objects pushed to dataLayer.
      win.gtag = function gtag() {
        // eslint-disable-next-line prefer-rest-params
        (win.dataLayer as unknown[]).push(arguments);
      } as Gtag;
    }
    this.gtag('consent', 'default', {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'denied',
    });
    this.gtag('consent', 'update', { analytics_storage: 'granted' });
    this.gtag('js', new Date());
    this.gtag('set', { page_location: this.location(path), page_referrer: referrerHost ? `https://${referrerHost}/` : '' });
    if (!this.containerId) {
      this.gtag('config', measurementId, { send_page_view: false, page_location: this.location(path), page_referrer: referrerHost ? `https://${referrerHost}/` : '' });
    }
    this.configured = true;
    this.injectScriptWhenIdle(measurementId);
  }

  /** One page_view per page (consecutive repeats ignored); also updates the location used by automatic hits. */
  pageView(path: string, title?: string): void {
    if (!this.configured || path === this.lastPagePath) return;
    this.lastPagePath = path;
    if (this.containerId && !this.scriptInjected) return;
    this.gtag('set', { page_location: this.location(path), page_referrer: '', page_title: title });
    this.gtag('event', 'page_view', { page_location: this.location(path), page_path: path, page_title: title });
  }

  private location(path: string): string {
    return `${this.document.location?.origin || ''}${path}`;
  }

  event(name: string, params?: Record<string, unknown>): void {
    if (!this.configured) return;
    this.gtag('event', name, params || {});
  }

  /** Consent revoked: deny storage, stop collection and delete the GA cookies this site set. */
  disable(): void {
    if (!this.isBrowser) return;
    const win = this.document.defaultView as unknown as GtagWindow | null;
    if (this.measurementId && win) win[`ga-disable-${this.measurementId}`] = true;
    if (this.configured) this.gtag('consent', 'update', { analytics_storage: 'denied' });
    this.configured = false;
    this.lastPagePath = null;
    deleteGaCookies(this.document);
  }

  private gtag(...args: unknown[]): void {
    const win = this.document.defaultView as (Window & { gtag?: Gtag }) | null;
    win?.gtag?.(...args);
  }

  private injectScriptWhenIdle(measurementId: string): void {
    if (this.scriptRequested) return;
    this.scriptRequested = true;
    const win = this.document.defaultView;
    if (!win) return;
    const inject = () => {
      if (!this.configured) {
        this.scriptRequested = false;
        return;
      }
      const script = this.document.createElement('script');
      script.async = true;
      script.src = this.containerId
        ? `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(this.containerId)}`
        : `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
      this.scriptInjected = true;
      this.document.head.appendChild(script);
    };
    this.zone.runOutsideAngular(() => {
      const whenIdle = () => {
        const ric = (win as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
        if (typeof ric === 'function') ric(inject, { timeout: 4000 });
        else win.setTimeout(inject, 1500);
      };
      if (this.document.readyState === 'complete') whenIdle();
      else win.addEventListener('load', whenIdle, { once: true });
    });
  }
}
