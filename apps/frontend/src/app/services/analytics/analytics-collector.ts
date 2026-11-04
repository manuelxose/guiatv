import { Injectable, Inject, OnDestroy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { interval, Subscription } from 'rxjs';
import { environment } from '../../environments/environment';
import { DeviceDetectorService } from './device-detector.service';

interface AnalyticsEventPayload {
  eventId?: string;
  sessionId: string;
  anonId: string;
  userId?: string;
  type: string;
  name?: string;
  path?: string;
  title?: string;
  referrer?: string;
  occurredAt?: string;
  data?: Record<string, any>;
  timezone?: string;
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService implements OnDestroy {
  private readonly isBrowser: boolean;
  private readonly baseUrl = environment.API_BASE_URL;
  private readonly anonStorageKey = 'gtv_anon_id';
  private readonly heartbeatMs = 15000;
  private initialized = false;
  private heartbeatSub?: Subscription;

  private sessionId: string | null = null;
  private anonId: string | null = null;
  private startedAt: number | null = null;
  private lastPath: string | null = null;
  private hasTrackedFirstPageView = false;
  private pageStartAt: number | null = null;
  private lastActivityAt: number = Date.now();
  private scrollThresholds = new Set([25, 50, 75, 100]);
  private firedScrollThresholds = new Set<number>();
  private baseMetadata: Record<string, any> = {};
  private visibilityState: string = 'visible';

  constructor(
    private http: HttpClient,
    private deviceDetector: DeviceDetectorService,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  init(): void {
    if (!this.isBrowser || this.initialized) return;
    if (['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return;
    this.initialized = true;

    this.anonId = this.getOrCreateAnonId();
    this.sessionId = this.createSessionId();
    this.startedAt = Date.now();
    this.lastPath = this.getCurrentPath();
    this.pageStartAt = this.startedAt;
    this.visibilityState = document.visibilityState || 'visible';

    this.scheduleIdle(() => {
      this.baseMetadata = this.buildBaseMetadata();
      this.postJson('/telemetry/session/start', {
        sessionId: this.sessionId,
        anonId: this.anonId,
        initialPath: this.lastPath,
        lastPath: this.lastPath,
        referrer: document.referrer || undefined,
        metadata: this.buildHeartbeatMetadata(),
        screen: {
          width: window.screen?.width,
          height: window.screen?.height,
        },
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        language: navigator.language,
        timezone: this.getTimezone(),
        startedAt: new Date(this.startedAt).toISOString(),
      });

      this.startHeartbeat();
      this.bindUnload();
      this.bindEngagementTracking();
    });
  }

  trackPageView(path: string): void {
    const previousPath = this.hasTrackedFirstPageView ? this.lastPath : null;
    this.init();
    if (!this.sessionId || !this.anonId || !this.isBrowser) return;
    const now = Date.now();
    if (previousPath && this.pageStartAt) {
      const durationSec = Math.max(
        0,
        Math.floor((now - this.pageStartAt) / 1000)
      );
      this.trackEvent(
        'page_exit',
        {
          from: previousPath,
          to: path,
          durationSec,
        },
        'page_exit'
      );
    }

    this.lastPath = path;
    this.hasTrackedFirstPageView = true;
    this.pageStartAt = now;
    this.resetScrollTracking();

    const payload: AnalyticsEventPayload = {
      sessionId: this.sessionId,
      anonId: this.anonId,
      type: 'page_view',
      name: 'page_view',
      path,
      title: document.title || undefined,
      referrer: previousPath || document.referrer || undefined,
      occurredAt: new Date().toISOString(),
      timezone: this.getTimezone(),
    };

    this.postJson('/telemetry/event', payload);
  }

  trackEvent(type: string, data?: Record<string, any>, name?: string): void {
    this.init();
    if (!this.sessionId || !this.anonId || !this.isBrowser) return;

    const payload: AnalyticsEventPayload = {
      sessionId: this.sessionId,
      anonId: this.anonId,
      type,
      name,
      path: this.getCurrentPath(),
      title: document.title || undefined,
      referrer: document.referrer || undefined,
      occurredAt: new Date().toISOString(),
      data,
      timezone: this.getTimezone(),
    };

    this.postJson('/telemetry/event', payload);
  }

  private startHeartbeat(): void {
    if (!this.isBrowser || !this.sessionId) return;
    this.heartbeatSub = interval(this.heartbeatMs).subscribe(() => {
      if (!this.sessionId) return;
      this.postJson('/telemetry/session/heartbeat', {
        sessionId: this.sessionId,
        lastPath: this.lastPath || this.getCurrentPath(),
        lastSeenAt: new Date().toISOString(),
        metadata: this.buildHeartbeatMetadata(),
      });
    });
  }

  private bindUnload(): void {
    if (!this.isBrowser) return;
    const handler = () => this.endSession('pagehide');
    window.addEventListener('pagehide', handler);
    window.addEventListener('beforeunload', handler);
  }

  private bindEngagementTracking(): void {
    if (!this.isBrowser) return;

    const activityHandler = () => {
      this.lastActivityAt = Date.now();
    };

    const scrollHandler = () => {
      this.lastActivityAt = Date.now();
      const depth = this.getScrollDepthPercent();
      this.scrollThresholds.forEach((threshold) => {
        if (depth >= threshold && !this.firedScrollThresholds.has(threshold)) {
          this.firedScrollThresholds.add(threshold);
          this.trackEvent(
            'scroll_depth',
            { depth, threshold },
            'scroll_depth'
          );
        }
      });
    };

    const visibilityHandler = () => {
      this.visibilityState = document.visibilityState || 'visible';
      this.trackEvent(
        'visibility',
        { state: this.visibilityState },
        'visibility_change'
      );
    };

    const clickHandler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const element = target.closest(
        '[data-analytics-id],[data-analytics-name]'
      ) as HTMLElement | null;
      if (!element) return;
      const tag = element.tagName.toLowerCase();
      const analyticsId = element.getAttribute('data-analytics-id') || undefined;
      const analyticsName =
        element.getAttribute('data-analytics-name') || undefined;
      const label = analyticsName || analyticsId || tag;

      const link =
        element instanceof HTMLAnchorElement
          ? element.getAttribute('href')
          : undefined;
      const linkInfo = link ? this.normalizeLink(link) : undefined;

      this.trackEvent(
        'click',
        {
          tag,
          analyticsId,
          analyticsName,
          link: linkInfo,
        },
        label
      );
    };

    window.addEventListener('scroll', scrollHandler, { passive: true });
    window.addEventListener('mousemove', activityHandler, { passive: true });
    window.addEventListener('keydown', activityHandler);
    window.addEventListener('touchstart', activityHandler, { passive: true });
    document.addEventListener('visibilitychange', visibilityHandler);
    document.addEventListener('click', clickHandler);
  }

  private endSession(reason: string): void {
    if (!this.sessionId || !this.isBrowser) return;

    const payload = {
      sessionId: this.sessionId,
      lastPath: this.lastPath || this.getCurrentPath(),
      endReason: reason,
      endedAt: new Date().toISOString(),
    };

    const url = this.buildUrl('/telemetry/session/end');

    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], {
        type: 'application/json',
      });
      navigator.sendBeacon(url, blob);
    } else {
      this.postJson('/telemetry/session/end', payload);
    }
  }

  private postJson(path: string, payload: any): void {
    const url = this.buildUrl(path);
    this.http.post(url, payload, { headers: this.buildHeaders() }).subscribe({
      error: () => {
        // Avoid breaking app flow on analytics errors
      },
    });
  }

  private buildHeaders(): HttpHeaders {
    const token = this.isBrowser ? localStorage.getItem('gtv_id_token') : null;
    return new HttpHeaders({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) });
  }

  private buildUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private getCurrentPath(): string {
    if (!this.isBrowser) return '';
    return `${location.pathname}${location.search}${location.hash}`;
  }

  private getTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }

  private getOrCreateAnonId(): string {
    if (!this.isBrowser) return this.createSessionId();
    try {
      const stored = localStorage.getItem(this.anonStorageKey);
      if (stored) return stored;
      const anonId = this.createSessionId();
      localStorage.setItem(this.anonStorageKey, anonId);
      return anonId;
    } catch {
      return this.createSessionId();
    }
  }

  private createSessionId(): string {
    if (this.isBrowser && 'crypto' in window && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `sess-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  ngOnDestroy(): void {
    this.heartbeatSub?.unsubscribe();
  }

  private resetScrollTracking(): void {
    this.firedScrollThresholds = new Set<number>();
  }

  private getScrollDepthPercent(): number {
    const doc = document.documentElement;
    const scrollTop = window.scrollY || doc.scrollTop || 0;
    const scrollHeight = doc.scrollHeight || document.body.scrollHeight || 0;
    const viewportHeight = window.innerHeight || doc.clientHeight || 0;
    const maxScroll = Math.max(1, scrollHeight - viewportHeight);
    return Math.min(100, Math.round((scrollTop / maxScroll) * 100));
  }

  private buildBaseMetadata(): Record<string, any> {
    const deviceInfo = this.deviceDetector.deviceInfo();
    const uaData = (navigator as any).userAgentData;
    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;

    return {
      device: {
        type: deviceInfo.type,
        isMobile: deviceInfo.isMobile,
        isTablet: deviceInfo.isTablet,
        isDesktop: deviceInfo.isDesktop,
        orientation: deviceInfo.orientation,
        isTouchDevice: deviceInfo.isTouchDevice,
      },
      platform: navigator.platform,
      vendor: navigator.vendor,
      languages: navigator.languages || [navigator.language],
      hardware: {
        memoryGB: (navigator as any).deviceMemory,
        cores: navigator.hardwareConcurrency,
      },
      connection: connection
        ? {
            effectiveType: connection.effectiveType,
            downlink: connection.downlink,
            rtt: connection.rtt,
            saveData: connection.saveData,
          }
        : undefined,
      preferences: {
        colorScheme: this.matchMediaPref('(prefers-color-scheme: dark)') ? 'dark' : 'light',
        reducedMotion: this.matchMediaPref('(prefers-reduced-motion: reduce)'),
        contrast: this.matchMediaPref('(prefers-contrast: more)'),
      },
      uaData: uaData
        ? {
            brands: uaData.brands,
            platform: uaData.platform,
            mobile: uaData.mobile,
          }
        : undefined,
      utm: this.getUtmParams(),
    };
  }

  private buildHeartbeatMetadata(): Record<string, any> {
    const idleSec = Math.max(0, Math.floor((Date.now() - this.lastActivityAt) / 1000));
    return {
      ...this.baseMetadata,
      activity: {
        lastActivityAt: new Date(this.lastActivityAt).toISOString(),
        idleSec,
        isIdle: idleSec >= 60,
      },
      visibility: this.visibilityState,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    };
  }

  private matchMediaPref(query: string): boolean {
    if (!this.isBrowser || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  }

  private scheduleIdle(task: () => void): void {
    if (!this.isBrowser) return;
    const anyWindow = window as any;
    if (typeof anyWindow.requestIdleCallback === 'function') {
      anyWindow.requestIdleCallback(() => task(), { timeout: 2000 });
    } else {
      setTimeout(task, 1500);
    }
  }

  private getUtmParams(): Record<string, string> | undefined {
    const params = new URLSearchParams(window.location.search);
    const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    const utm: Record<string, string> = {};
    utmKeys.forEach((key) => {
      const value = params.get(key);
      if (value) utm[key] = value;
    });
    return Object.keys(utm).length ? utm : undefined;
  }

  private normalizeLink(href: string): Record<string, string> {
    try {
      const url = new URL(href, window.location.origin);
      return {
        href: url.href,
        host: url.host,
        path: url.pathname,
      };
    } catch {
      return { href };
    }
  }
}
