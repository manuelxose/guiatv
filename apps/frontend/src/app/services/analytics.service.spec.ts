import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { AnalyticsService } from './analytics.service';
import { CONSENT_COOKIE, ConsentService } from './analytics/consent.service';
import { AnalyticsCollector } from './analytics/analytics-collector';

describe('AnalyticsService (eager facade)', () => {
  const clearCookie = () => { document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`; };

  beforeEach(() => {
    clearCookie();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('gtv_analytics_debug', '1');
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(new Response('{"success":true,"data":{"enabled":true}}', { status: 200 })));
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'browser' }] });
  });

  afterEach(() => {
    clearCookie();
    localStorage.clear();
  });

  it('measures every visit: loads the collector without consent and stores nothing', async () => {
    const service = TestBed.inject(AnalyticsService);
    localStorage.setItem('gtv_anon_id', 'legacy');
    service.init();
    service.trackPageView('/');
    await service.whenLoaded();
    expect((service as any).collector).not.toBeNull();
    expect(localStorage.getItem('gtv_anon_id')).toBeNull();
  });

  it('loads the collector and replays buffered calls in order', async () => {
    const service = TestBed.inject(AnalyticsService);
    const collector = TestBed.inject(AnalyticsCollector);
    const calls: string[] = [];
    spyOn(collector, 'init');
    spyOn(collector, 'trackPageView').and.callFake((url: string) => { calls.push(`page:${url}`); });
    spyOn(collector, 'trackEvent').and.callFake((type: string) => { calls.push(`event:${type}`); });
    service.init();
    service.trackPageView('/a');
    service.trackEvent('assistant_opened', { surface: 'x' });
    await service.whenLoaded();
    expect(collector.init).toHaveBeenCalled();
    expect(calls).toEqual(['page:/a', 'event:assistant_opened']);
    service.trackPageView('/b');
    expect(calls[2]).toBe('page:/b');
  });

  it('keeps measuring after consent is denied', () => {
    const service = TestBed.inject(AnalyticsService);
    service.init();
    TestBed.inject(ConsentService).deny();
    service.trackPageView('/b');
    expect((service as any).buffer.length).toBe(1);
  });

  it('bounds the pre-consent buffer', () => {
    const service = TestBed.inject(AnalyticsService);
    service.init();
    for (let i = 0; i < 100; i++) service.trackEvent('click');
    expect((service as any).buffer.length).toBe(20);
  });

  it('does nothing on the server', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'server' }] });
    const service = TestBed.inject(AnalyticsService);
    service.init();
    service.trackPageView('/');
    expect((service as any).buffer.length).toBe(0);
  });
});
