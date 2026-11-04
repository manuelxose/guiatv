import { Injectable, NgZone, OnDestroy, PLATFORM_ID, inject } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { environment } from '../../../environments/environment';
import { DeviceDetectorService } from '../device-detector.service';
import { ConsentService } from './consent.service';
import { Ga4Service } from './ga4.service';
import { AnalyticsQueue, QueuedEvent } from './analytics-queue';
import { extractUtm, isValidEventType, sanitizeData, sanitizePath, sanitizeReferrer, sanitizeString } from './analytics-sanitize';
import { removeAnalyticsIdentifiers } from './analytics-identifiers';

/** Server answer of `GET /v2/telemetry/config` (the emergency switch and GA4 rollout flag live on the server). */
interface TelemetryConfig {
  enabled: boolean;
  ga4?: { enabled: boolean; measurementId?: string };
}

const COLLECT_PATH = '/telemetry/collect';
const CONFIG_PATH = '/telemetry/config';
const ANON_KEY = 'gtv_anon_id';
const SESSION_KEY = 'gtv_session';
const FLUSH_DELAY_MS = 5_000;
const HEARTBEAT_MS = 30_000;
const SESSION_IDLE_MS = 30 * 60_000;
const HEARTBEAT_IDLE_STOP_MS = 30 * 60_000;
const PRECONSENT_MAX = 20;
const PRECONSENT_MAX_AGE_MS = 10 * 60_000;
const MAX_BACKOFF_MS = 60_000;
const SCROLL_THROTTLE_MS = 500;
const SCROLL_THRESHOLDS = [25, 50, 75, 100];
/** Custom product events forwarded to GA4 (engagement noise such as scroll/click/heartbeat stays first-party). */
const GA4_FORWARDED_PREFIXES = ['assistant_', 'comparator_', 'compare_', 'affiliate_', 'search', 'share', 'login', 'sign_up'];

/**
 * Consent-aware, non-blocking first-party collector (and GA4 bridge). Lives in a lazy chunk: `AnalyticsService` (the
 * eager facade) imports it only after the visitor grants the analytics purpose, so visitors who do not consent never
 * download it.
 *
 * * Nothing runs during SSR. In the browser nothing is stored or sent until the analytics purpose is granted; events
 *   produced before the choice are kept only in memory (bounded, 10 min) and are discarded if consent is denied.
 * * Events are batched (25 per request, 5 s delay, one timer at a time) and sent with `fetch` outside Angular's zone,
 *   so no analytics request is a pending task for hydration/stability and no change detection follows one.
 *   Hidden/pagehide flushes use `sendBeacon` (falling back to `fetch keepalive`).
 * * Page views are deduplicated on the sanitised path (SSR + hydration + router + redirects produce one view).
 * * Paths carry no query string or fragment; referrers are reduced to an external host; event data is bounded.
 * * Revoking consent stops timers and listeners, clears the queue and deletes the analytics identifiers.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsCollector implements OnDestroy {
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private readonly consent = inject(ConsentService);
  private readonly ga4 = inject(Ga4Service);
  private readonly deviceDetector = inject(DeviceDetectorService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly baseUrl = environment.API_BASE_URL;

  private initialized = false;
  private disabled = false;
  private started = false;
  private configState: 'pending' | 'ready' = 'pending';
  private readonly queue = new AnalyticsQueue();
  private preConsent: Array<QueuedEvent & { at: number }> = [];

  private anonId: string | null = null;
  private sessionId: string | null = null;
  private pendingSession: Record<string, unknown> | null = null;
  private pendingEnd: { reason: string } | null = null;
  private pendingResume = false;
  private pendingHeartbeat: Record<string, unknown> | null = null;

  private lastPageViewPath: string | null = null;
  /** On an unmeasured route (/admin, /embed): nothing is enqueued, clicks and scroll included. */
  private unmeasured = false;
  /** Incremented on revocation: results of requests started before it are discarded. */
  private generation = 0;
  private landingReferrer: string | undefined;
  private landingUtm: Record<string, string> | undefined;
  private pageStartedAt = 0;
  private lastActivityAt = Date.now();
  private firedScroll = new Set<number>();
  private lastScrollCheck = 0;

  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private backoffMs = 0;
  private listeners: AbortController | null = null;
  private unsubscribeConsent: (() => void) | null = null;

  /** Delivery counters, readable in tests and from the console for diagnostics. */
  readonly stats = { sent: 0, failed: 0, beacons: 0, droppedPreConsent: 0 };

  /** Called by the facade (which already applied the browser/localhost checks). */
  init(): void {
    if (!this.isBrowser || this.initialized) return;
    this.initialized = true;
    this.landingReferrer = sanitizeReferrer(this.document.referrer, this.document.location?.host || '');
    this.landingUtm = extractUtm(this.document.location?.search);
    this.unsubscribeConsent = this.consent.onChange((state) => (state === 'granted' ? this.start() : this.revoke()));
    if (this.consent.state === 'granted') this.start();
    else this.removeIdentifiers(); // also clears identifiers the pre-consent collector used to create
  }

  trackPageView(url: string): void {
    if (!this.isBrowser) return;
    this.init();
    if (this.disabled) return;
    const path = sanitizePath(url);
    if (path === null) {
      // Leaving the measured site: close the current page, then measure nothing until a public route again.
      if (this.lastPageViewPath && this.pageStartedAt) this.enqueue({ type: 'page_exit', name: 'page_exit', path: this.lastPageViewPath, data: { durationSec: Math.max(0, Math.floor((Date.now() - this.pageStartedAt) / 1000)) } });
      this.unmeasured = true;
      this.lastPageViewPath = null;
      this.pageStartedAt = 0;
      return;
    }
    this.unmeasured = false;
    if (path === this.lastPageViewPath) return;
    const now = Date.now();
    if (this.lastPageViewPath && this.pageStartedAt) {
      this.enqueue({ type: 'page_exit', name: 'page_exit', path: this.lastPageViewPath, data: { to: path, durationSec: Math.max(0, Math.floor((now - this.pageStartedAt) / 1000)) } });
    }
    const first = this.lastPageViewPath === null;
    this.lastPageViewPath = path;
    this.pageStartedAt = now;
    this.firedScroll = new Set();
    this.enqueue({ type: 'page_view', name: 'page_view', path, referrer: first ? this.landingReferrer : undefined });
    // Before the config answer GA4 is not decided yet; `loadConfig` then sends the current page view once.
    if (this.started && this.configState === 'ready') this.ga4.pageView(path, this.currentTitle());
  }

  trackEvent(type: string, data?: Record<string, unknown>, name?: string): void {
    if (!this.isBrowser) return;
    this.init();
    if (this.disabled || this.unmeasured || !isValidEventType(type)) return;
    const cleanName = name ? sanitizeString(name)?.slice(0, 60) : undefined;
    const cleanData = sanitizeData(data);
    this.enqueue({ type, name: cleanName, path: this.lastPageViewPath || sanitizePath(this.document.location?.pathname) || undefined, data: cleanData });
    if (this.started && this.configState === 'ready' && GA4_FORWARDED_PREFIXES.some((prefix) => type.startsWith(prefix))) this.ga4.event(type, this.ga4Params(cleanData));
  }

  ngOnDestroy(): void {
    this.stopRuntime();
    this.unsubscribeConsent?.();
  }

  // ---- lifecycle -------------------------------------------------------------------------------------------------

  private start(): void {
    if (this.started || this.disabled) return;
    this.started = true;
    this.anonId = this.getOrCreateAnonId();
    this.ensureSession();
    const cutoff = Date.now() - PRECONSENT_MAX_AGE_MS;
    for (const { at, ...event } of this.preConsent) if (at >= cutoff) this.queue.push(event);
    this.preConsent = [];
    this.zone.runOutsideAngular(() => {
      this.bindListeners();
      this.startHeartbeat();
    });
    void this.loadConfig();
  }

  private revoke(): void {
    this.generation++;
    this.started = false;
    this.stopRuntime();
    this.queue.clear();
    this.preConsent = [];
    this.pendingSession = this.pendingEnd = this.pendingHeartbeat = null;
    this.pendingResume = false;
    this.removeIdentifiers();
    this.anonId = this.sessionId = null;
    this.configState = 'pending';
    this.ga4.disable();
  }

  private stopRuntime(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.flushTimer = this.heartbeatTimer = null;
    this.listeners?.abort();
    this.listeners = null;
  }

  private async loadConfig(): Promise<void> {
    let config: TelemetryConfig = { enabled: true };
    try {
      // No cookies: the answer is global, and without them nginx and the API can cache it (60 s).
      const response = await fetch(`${this.baseUrl}${CONFIG_PATH}`, { credentials: 'omit' });
      if (response.ok) {
        const body = await response.json();
        if (body?.data && typeof body.data.enabled === 'boolean') config = body.data;
      }
    } catch {
      // Unknown config: first-party stays on (the server still enforces its switch); GA4 stays off (fail closed).
    }
    if (!this.started) return;
    this.configState = 'ready';
    if (!config.enabled) {
      this.disabled = true;
      this.revoke();
      return;
    }
    const measurementId = config.ga4?.measurementId || environment.analytics?.ga4MeasurementId;
    if (config.ga4?.enabled && measurementId) {
      this.ga4.enable(measurementId, this.lastPageViewPath || '/', this.landingReferrer);
      if (this.lastPageViewPath) this.ga4.pageView(this.lastPageViewPath, this.currentTitle());
    }
    this.scheduleFlush(0);
  }

  // ---- queueing --------------------------------------------------------------------------------------------------

  private enqueue(partial: Omit<QueuedEvent, 'eventId' | 'occurredAt'>): void {
    const state = this.consent.state;
    if (state === 'denied' || (this.unmeasured && partial.type !== 'page_exit')) return;
    const event: QueuedEvent = { ...partial, eventId: this.uuid(), occurredAt: new Date().toISOString() };
    if (state === 'unset' || !this.started) {
      this.preConsent.push({ ...event, at: Date.now() });
      if (this.preConsent.length > PRECONSENT_MAX) {
        this.preConsent.shift();
        this.stats.droppedPreConsent++;
      }
      return;
    }
    this.touchSession();
    this.queue.push(event);
    this.scheduleFlush(FLUSH_DELAY_MS);
  }

  private scheduleFlush(delay: number): void {
    if (!this.started || this.flushTimer) return;
    this.zone.runOutsideAngular(() => {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush(false);
      }, Math.max(delay, this.backoffMs));
    });
  }

  private hasPayload(): boolean {
    return this.queue.size > 0 || !!this.pendingSession || !!this.pendingEnd || this.pendingResume || !!this.pendingHeartbeat;
  }

  private buildBody(events: QueuedEvent[]): string {
    const title = this.currentTitle();
    return JSON.stringify({
      v: 1,
      sessionId: this.sessionId,
      anonId: this.anonId,
      session: this.pendingSession || undefined,
      resume: this.pendingResume || undefined,
      heartbeat: this.pendingHeartbeat || undefined,
      end: this.pendingEnd || undefined,
      events: events.map((queued) => {
        const event: QueuedEvent = { ...queued };
        delete event.attempts; // delivery bookkeeping, not payload
        return event.type === 'page_view' && !event.title && event.path === this.lastPageViewPath && title ? { ...event, title } : event;
      }),
    });
  }

  private clearControlFields(): void {
    this.pendingSession = this.pendingEnd = this.pendingHeartbeat = null;
    this.pendingResume = false;
  }

  /** `final`: the page may be going away; send everything now with beacons, without waiting for answers. */
  private async flush(final: boolean): Promise<void> {
    if (!this.started || !this.sessionId || !this.anonId) return;
    if (!final && (this.configState === 'pending' || this.inFlight)) return;
    if (!this.hasPayload()) return;
    const url = `${this.baseUrl}${COLLECT_PATH}`;

    if (final) {
      for (let i = 0; i < 4 && this.hasPayload(); i++) {
        const body = this.buildBody(this.queue.take());
        this.clearControlFields();
        const queued = this.beacon(url, body);
        if (queued) this.stats.beacons++;
        else fetch(url, { method: 'POST', body, keepalive: body.length < 60_000, headers: { 'Content-Type': 'application/json' }, credentials: 'omit' }).catch(() => undefined);
      }
      return;
    }

    const batch = this.queue.take();
    const generation = this.generation;
    // Snapshot of the control fields this request carries: only these are cleared on success, so a field set while
    // the request is in flight (a new session after idle, a resume, an end) is kept for the next batch.
    const sent = { session: this.pendingSession, end: this.pendingEnd, resume: this.pendingResume, heartbeat: this.pendingHeartbeat };
    const body = this.buildBody(batch);
    this.inFlight = true;
    try {
      const response = await fetch(url, { method: 'POST', body, headers: this.headers(), credentials: 'omit' });
      if (generation !== this.generation) return; // consent revoked meanwhile: forget this batch either way
      if (response.status === 429 || response.status >= 500) throw new Error(String(response.status));
      // 2xx: delivered. 4xx (other than 429): the server rejected the payload; resending it would fail again.
      this.stats.sent += batch.length;
      this.backoffMs = 0;
      if (this.pendingSession === sent.session) this.pendingSession = null;
      if (this.pendingEnd === sent.end) this.pendingEnd = null;
      if (this.pendingHeartbeat === sent.heartbeat) this.pendingHeartbeat = null;
      if (sent.resume) this.pendingResume = false;
      if (response.status === 202 || response.status === 204) {
        const disabled = response.headers.get('X-Telemetry-Disabled') === '1';
        if (disabled) {
          this.disabled = true;
          this.revoke();
          return;
        }
      }
    } catch {
      if (generation !== this.generation) return;
      this.stats.failed += batch.length;
      this.queue.requeue(batch);
      this.backoffMs = Math.min(MAX_BACKOFF_MS, this.backoffMs ? this.backoffMs * 2 : 5_000);
    } finally {
      this.inFlight = false;
    }
    if (this.queue.size) this.scheduleFlush(FLUSH_DELAY_MS);
  }

  /** `sendBeacon` with a JSON body; false when the browser refused or lacks it (the caller falls back to fetch). */
  private beacon(url: string, body: string): boolean {
    try {
      return typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } catch {
      return false;
    }
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      // Lets the server exclude administrators' own browsing from the reports.
      const token = localStorage.getItem('gtv_id_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch {
      // storage blocked
    }
    return headers;
  }

  // ---- session ---------------------------------------------------------------------------------------------------

  private ensureSession(): void {
    const now = Date.now();
    let stored: { id?: string; last?: number } | null = null;
    try {
      stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    } catch {
      stored = null;
    }
    if (stored?.id && typeof stored.last === 'number' && now - stored.last < SESSION_IDLE_MS) {
      this.sessionId = stored.id;
    } else {
      this.sessionId = this.uuid();
      this.pendingSession = this.buildSessionInfo();
    }
    this.persistSession(now);
  }

  private touchSession(): void {
    const now = Date.now();
    if (now - this.lastActivityAt > SESSION_IDLE_MS && this.sessionId) {
      this.sessionId = this.uuid();
      this.pendingSession = this.buildSessionInfo();
    }
    this.lastActivityAt = now;
    this.persistSession(now);
  }

  private persistSession(now: number): void {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: this.sessionId, last: now }));
    } catch {
      // storage blocked: the session lives for this page only
    }
  }

  private buildSessionInfo(): Record<string, unknown> {
    const win = this.document.defaultView;
    const nav = win?.navigator as (Navigator & { userAgentData?: { mobile?: boolean } }) | undefined;
    const device = this.deviceDetector.classifyCurrent();
    let timezone: string | undefined;
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    } catch {
      timezone = undefined;
    }
    return {
      startedAt: new Date().toISOString(),
      initialPath: this.lastPageViewPath || sanitizePath(this.document.location?.pathname) || '/',
      referrer: this.landingReferrer,
      utm: this.landingUtm,
      screen: win ? { width: win.screen?.width, height: win.screen?.height } : undefined,
      viewport: win ? { width: win.innerWidth, height: win.innerHeight } : undefined,
      language: nav?.language?.slice(0, 16),
      timezone,
      device: { type: device.type, orientation: device.orientation, touch: device.isTouchDevice, uaMobile: nav?.userAgentData?.mobile },
      colorScheme: win?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    };
  }

  // ---- browser signals (all outside Angular's zone) ---------------------------------------------------------------

  private bindListeners(): void {
    const win = this.document.defaultView;
    if (!win || this.listeners) return;
    this.listeners = new AbortController();
    const signal = this.listeners.signal;
    const activity = () => {
      this.lastActivityAt = Date.now();
    };
    win.addEventListener('pointerdown', activity, { passive: true, signal });
    win.addEventListener('keydown', activity, { passive: true, signal });
    win.addEventListener('scroll', () => this.onScroll(), { passive: true, signal });
    this.document.addEventListener('click', (event) => this.onClick(event), { capture: true, passive: true, signal });
    this.document.addEventListener('visibilitychange', () => {
      if (this.document.visibilityState === 'hidden') {
        this.stopHeartbeat();
        void this.flush(true);
      } else {
        this.startHeartbeat();
      }
    }, { signal });
    win.addEventListener('pagehide', (event) => {
      this.pendingEnd = { reason: (event as PageTransitionEvent).persisted ? 'bfcache' : 'pagehide' };
      this.stopHeartbeat();
      void this.flush(true);
    }, { signal });
    win.addEventListener('pageshow', (event) => {
      if (!(event as PageTransitionEvent).persisted) return;
      this.pendingResume = true;
      this.touchSession();
      this.startHeartbeat();
      this.scheduleFlush(0);
    }, { signal });
  }

  private onScroll(): void {
    const now = Date.now();
    this.lastActivityAt = now;
    if (now - this.lastScrollCheck < SCROLL_THROTTLE_MS || this.firedScroll.size === SCROLL_THRESHOLDS.length) return;
    this.lastScrollCheck = now;
    const win = this.document.defaultView;
    const doc = this.document.documentElement;
    if (!win || !doc) return;
    const max = Math.max(1, doc.scrollHeight - win.innerHeight);
    const depth = Math.min(100, Math.round((win.scrollY / max) * 100));
    for (const threshold of SCROLL_THRESHOLDS) {
      if (depth >= threshold && !this.firedScroll.has(threshold)) {
        this.firedScroll.add(threshold);
        this.enqueue({ type: 'scroll_depth', name: 'scroll_depth', path: this.lastPageViewPath || undefined, data: { threshold } });
      }
    }
  }

  private onClick(event: Event): void {
    this.lastActivityAt = Date.now();
    const target = event.target as Element | null;
    const element = target?.closest?.('[data-analytics-id],[data-analytics-name]') as HTMLElement | null;
    if (!element) return;
    const analyticsId = element.getAttribute('data-analytics-id') || undefined;
    const analyticsName = element.getAttribute('data-analytics-name') || undefined;
    const href = element instanceof HTMLAnchorElement ? element.getAttribute('href') : null;
    let link: Record<string, string> | undefined;
    if (href) {
      try {
        const url = new URL(href, this.document.location?.origin);
        const internal = url.host === this.document.location?.host;
        link = internal ? { path: sanitizePath(url.pathname) || '/' } : { host: url.host };
      } catch {
        link = undefined;
      }
    }
    this.enqueue({
      type: 'click',
      name: sanitizeString(analyticsName || analyticsId || element.tagName.toLowerCase())?.slice(0, 60),
      path: this.lastPageViewPath || undefined,
      data: sanitizeData({ tag: element.tagName.toLowerCase(), analyticsId, analyticsName, link }),
    });
  }

  private startHeartbeat(): void {
    if (!this.started || this.heartbeatTimer || this.document.visibilityState === 'hidden') return;
    this.zone.runOutsideAngular(() => {
      this.heartbeatTimer = setInterval(() => {
        const idleMs = Date.now() - this.lastActivityAt;
        if (idleMs > HEARTBEAT_IDLE_STOP_MS) {
          this.stopHeartbeat();
          return;
        }
        if (this.queue.size || this.inFlight) return; // the pending batch already refreshes the session
        this.pendingHeartbeat = { idleSec: Math.floor(idleMs / 1000), visible: this.document.visibilityState === 'visible' };
        void this.flush(false);
      }, HEARTBEAT_MS);
    });
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  // ---- identifiers -----------------------------------------------------------------------------------------------

  private getOrCreateAnonId(): string {
    try {
      const stored = localStorage.getItem(ANON_KEY);
      if (stored && /^[A-Za-z0-9-]{8,64}$/.test(stored)) return stored;
      const id = this.uuid();
      localStorage.setItem(ANON_KEY, id);
      return id;
    } catch {
      return this.uuid();
    }
  }

  private removeIdentifiers(): void {
    removeAnalyticsIdentifiers();
  }

  private currentTitle(): string | undefined {
    return sanitizeString(this.document.title || '')?.slice(0, 120);
  }

  private ga4Params(data?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!data) return undefined;
    return Object.fromEntries(Object.entries(data).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)));
  }

  private uuid(): string {
    const cryptoRef = (this.document.defaultView as (Window & { crypto?: Crypto }) | null)?.crypto;
    if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID();
    const bytes = new Uint8Array(16);
    if (cryptoRef?.getRandomValues) cryptoRef.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}
