import { TestBed, fakeAsync, flushMicrotasks, tick, discardPeriodicTasks } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { AnalyticsCollector } from './analytics-collector';
import { CONSENT_COOKIE, ConsentService } from './consent.service';
import { Ga4Service } from './ga4.service';

interface SentBatch { url: string; body: any; via: 'fetch' | 'beacon' }

describe('AnalyticsCollector (lazy, consent-aware collector)', () => {
  let sent: SentBatch[];
  let fetchStatus: number;
  let configBody: any;
  let fetchFails: boolean;

  function clearCookie(): void {
    document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
  }

  function setup(consent: 'unset' | 'granted' | 'denied' = 'unset'): { service: AnalyticsCollector; consent: ConsentService; ga4: jasmine.SpyObj<Ga4Service> } {
    clearCookie();
    if (consent !== 'unset') document.cookie = `${CONSENT_COOKIE}=v1.a${consent === 'granted' ? 1 : 0}.${Date.now()}; Path=/`;
    const ga4 = jasmine.createSpyObj<Ga4Service>('Ga4Service', ['enable', 'disable', 'pageView', 'event'], { active: false });
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'browser' }, { provide: Ga4Service, useValue: ga4 }] });
    const service = TestBed.inject(AnalyticsCollector);
    recordBeacons(service);
    return { service, consent: TestBed.inject(ConsentService), ga4 };
  }

  const collects = () => sent.filter((s) => s.url.endsWith('/telemetry/collect'));
  const allEvents = () => collects().flatMap((s) => s.body.events);

  beforeEach(() => {
    sent = [];
    fetchStatus = 202;
    fetchFails = false;
    configBody = { success: true, data: { enabled: true, ga4: { enabled: false } } };
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('gtv_analytics_debug', '1'); // the collector skips localhost otherwise
    spyOn(window, 'fetch').and.callFake(((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      // Plain objects (not native Response): their promises stay under fakeAsync's control.
      const reply = (status: number, body: unknown) => Promise.resolve({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: () => Promise.resolve(body) } as unknown as Response);
      if (url.endsWith('/telemetry/config')) return reply(200, configBody);
      sent.push({ url, body: JSON.parse(String(init?.body || '{}')), via: 'fetch' });
      if (fetchFails) return Promise.reject(new TypeError('network down'));
      return reply(fetchStatus, {});
    }) as typeof fetch);
  });

  /** Beacons are recorded at the service boundary (the Blob body cannot be read synchronously in fakeAsync). */
  function recordBeacons(service: AnalyticsCollector): void {
    spyOn(service as any, 'beacon').and.callFake((url: string, body: string) => {
      sent.push({ url, body: JSON.parse(body), via: 'beacon' });
      return true;
    });
  }

  afterEach(() => {
    clearCookie();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('sends nothing and stores no identifier before consent', fakeAsync(() => {
    const { service } = setup('unset');
    localStorage.setItem('gtv_anon_id', 'legacy-id-created-without-consent');
    service.init();
    service.trackPageView('/');
    service.trackEvent('assistant_opened', { surface: 'x' });
    tick(60_000);
    flushMicrotasks();
    expect(sent.length).toBe(0);
    expect(window.fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem('gtv_anon_id')).toBeNull();
    expect(sessionStorage.getItem('gtv_session')).toBeNull();
    discardPeriodicTasks();
  }));

  it('keeps pre-consent events in memory only and sends them, session first, once consent is granted', fakeAsync(() => {
    const { service, consent } = setup('unset');
    service.init();
    service.trackPageView('/programacion-tv/series?q=secret#frag');
    expect(sent.length).toBe(0);
    consent.grant();
    flushMicrotasks(); // config
    tick(0);
    flushMicrotasks();
    const batch = collects()[0];
    expect(batch).toBeDefined();
    expect(batch.body.session).toBeDefined();
    expect(batch.body.session.initialPath).toBe('/programacion-tv/series');
    expect(batch.body.events.map((e: any) => e.type)).toEqual(['page_view']);
    expect(batch.body.events[0].path).toBe('/programacion-tv/series');
    expect(JSON.stringify(batch.body)).not.toContain('secret');
    expect(localStorage.getItem('gtv_anon_id')).toBe(batch.body.anonId);
    service.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('discards the in-memory buffer when consent is denied', fakeAsync(() => {
    const { service, consent } = setup('unset');
    service.init();
    service.trackPageView('/');
    consent.deny();
    tick(60_000);
    flushMicrotasks();
    expect(sent.length).toBe(0);
    discardPeriodicTasks();
  }));

  it('deduplicates page views across hydration/router repeats and query-only changes', fakeAsync(() => {
    const { service } = setup('granted');
    service.init();
    service.trackPageView('/canales');
    service.trackPageView('/canales');
    service.trackPageView('/canales?utm_source=x');
    service.trackPageView('/canales#top');
    flushMicrotasks();
    tick(5_000);
    flushMicrotasks();
    expect(allEvents().filter((e: any) => e.type === 'page_view').length).toBe(1);
    service.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('handles rapid route changes with one timer, ordered views and bounded batches', fakeAsync(() => {
    const { service } = setup('granted');
    service.init();
    flushMicrotasks();
    for (let i = 0; i < 40; i++) service.trackPageView(`/canales/canal-${i}`);
    tick(5_000);
    flushMicrotasks();
    tick(5_000);
    flushMicrotasks();
    tick(5_000);
    flushMicrotasks();
    tick(5_000);
    flushMicrotasks();
    const views = allEvents().filter((e: any) => e.type === 'page_view').map((e: any) => e.path);
    expect(views.length).toBe(40);
    expect(views[0]).toBe('/canales/canal-0');
    expect(views[39]).toBe('/canales/canal-39');
    expect(collects().every((b) => b.body.events.length <= 25)).toBeTrue();
    expect(collects().filter((b) => b.body.session).length).toBe(1);
    service.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('flushes with sendBeacon when the tab is hidden and stops the heartbeat', fakeAsync(() => {
    const { service } = setup('granted');
    service.init();
    flushMicrotasks();
    service.trackPageView('/deportes');
    spyOnProperty(document, 'visibilityState', 'get').and.returnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    const beacons = sent.filter((s) => s.via === 'beacon');
    expect(beacons.length).toBe(1);
    expect(beacons[0].body.events[0].path).toBe('/deportes');
    const before = sent.length;
    tick(120_000);
    flushMicrotasks();
    expect(sent.length).toBe(before); // no heartbeat while hidden
    service.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('sends a final beacon with the end reason on pagehide and resumes after a BFCache restore', fakeAsync(() => {
    const { service } = setup('granted');
    service.init();
    flushMicrotasks();
    service.trackPageView('/');
    const hide = new Event('pagehide') as PageTransitionEvent;
    Object.defineProperty(hide, 'persisted', { value: true });
    window.dispatchEvent(hide);
    const beacon = sent.find((s) => s.via === 'beacon');
    expect(beacon?.body.end).toEqual({ reason: 'bfcache' });
    const show = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(show, 'persisted', { value: true });
    window.dispatchEvent(show);
    tick(0);
    flushMicrotasks();
    expect(collects().some((b) => b.via === 'fetch' && b.body.resume === true)).toBeTrue();
    service.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('survives network failures, retries with backoff and never throws', fakeAsync(() => {
    const { service } = setup('granted');
    service.init();
    flushMicrotasks();
    tick(0); // config answer: immediate flush of an empty queue
    flushMicrotasks();
    fetchFails = true;
    expect(() => service.trackPageView('/')).not.toThrow();
    tick(5_000);
    flushMicrotasks();
    expect(service.stats.failed).toBe(1);
    fetchFails = false;
    tick(5_000); // first backoff step
    flushMicrotasks();
    const delivered = collects().filter((b) => b.body.events.some((e: any) => e.type === 'page_view'));
    expect(delivered.length).toBe(2); // first attempt failed, retry delivered
    // The session block went out first (startup flush) and exactly once, before any event of the session.
    const withSession = collects().map((b, i) => (b.body.session ? i : -1)).filter((i) => i >= 0);
    expect(withSession.length).toBe(1);
    expect(withSession[0]).toBeLessThan(collects().indexOf(delivered[0]) + 1);
    service.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('stops everything and deletes identifiers when consent is revoked', fakeAsync(() => {
    const { service, consent, ga4 } = setup('granted');
    service.init();
    flushMicrotasks();
    service.trackPageView('/');
    tick(5_000);
    flushMicrotasks();
    expect(localStorage.getItem('gtv_anon_id')).not.toBeNull();
    consent.deny();
    expect(localStorage.getItem('gtv_anon_id')).toBeNull();
    expect(sessionStorage.getItem('gtv_session')).toBeNull();
    expect(ga4.disable).toHaveBeenCalled();
    const before = sent.length;
    service.trackPageView('/canales');
    tick(120_000);
    flushMicrotasks();
    expect(sent.length).toBe(before);
    discardPeriodicTasks();
  }));

  it('honours the server emergency switch', fakeAsync(() => {
    configBody = { success: true, data: { enabled: false } };
    const { service } = setup('granted');
    service.init();
    flushMicrotasks();
    service.trackPageView('/');
    tick(60_000);
    flushMicrotasks();
    expect(collects().length).toBe(0);
    discardPeriodicTasks();
  }));

  it('loads GA4 only when consent is granted and the server enables it, sending the current page view once', fakeAsync(() => {
    configBody = { success: true, data: { enabled: true, ga4: { enabled: true, measurementId: 'G-TEST1234' } } };
    const { service, ga4 } = setup('granted');
    service.init();
    service.trackPageView('/');
    flushMicrotasks();
    expect(ga4.enable).toHaveBeenCalledWith('G-TEST1234', '/', undefined);
    expect(ga4.pageView).toHaveBeenCalledTimes(1);
    service.trackPageView('/');
    expect(ga4.pageView).toHaveBeenCalledTimes(1);
    service.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('does not measure admin pages', fakeAsync(() => {
    const { service } = setup('granted');
    service.init();
    flushMicrotasks();
    service.trackPageView('/admin');
    service.trackPageView('/admin/analytics');
    tick(5_000);
    flushMicrotasks();
    expect(allEvents().length).toBe(0);
    service.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('review M1: sends nothing while on admin pages (clicks, events) and counts the return to a public page', fakeAsync(() => {
    const { service } = setup('granted');
    service.init();
    flushMicrotasks();
    tick(0);
    flushMicrotasks();
    service.trackPageView('/canales');
    service.trackPageView('/admin/analytics');
    service.trackEvent('assistant_opened');
    const button = document.createElement('button');
    button.setAttribute('data-analytics-id', 'admin-button');
    document.body.appendChild(button);
    button.click();
    button.remove();
    service.trackPageView('/canales');
    tick(5_000);
    flushMicrotasks();
    const events = allEvents();
    expect(events.some((e: any) => e.type === 'click' || e.type === 'assistant_opened')).toBeFalse();
    expect(events.filter((e: any) => e.type === 'page_view').map((e: any) => e.path)).toEqual(['/canales', '/canales']);
    service.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('review m5: a request in flight when consent is revoked is forgotten (not requeued for a later grant)', fakeAsync(() => {
    const { service, consent } = setup('granted');
    service.init();
    flushMicrotasks();
    tick(0);
    flushMicrotasks();
    fetchFails = true;
    service.trackPageView('/deportes');
    tick(5_000); // the request is issued; its rejection is still pending
    consent.deny();
    flushMicrotasks();
    expect((service as any).queue.size).toBe(0);
    discardPeriodicTasks();
  }));

  it('does nothing on the server platform', () => {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'server' }] });
    const service = TestBed.inject(AnalyticsCollector);
    service.init();
    service.trackPageView('/');
    expect(window.fetch).not.toHaveBeenCalled();
  });
});
