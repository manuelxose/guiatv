import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { environment } from '../../../environments/environment';
import { Ga4Service } from './ga4.service';

describe('Ga4Service (Consent Mode v2 basic)', () => {
  let win: any;
  const defaultContainerId = environment.analytics.gtmContainerId;
  beforeEach(() => {
    win = window as any;
    win.dataLayer = [];
    delete win.gtag;
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'browser' }] });
  });
  afterEach(() => {
    delete win.gtag;
    win.dataLayer = [];
    environment.analytics.gtmContainerId = defaultContainerId;
  });

  const entries = () => (win.dataLayer as IArguments[]).map((a) => Array.from(a));

  it('queues consent defaults before config, overrides location/referrer with sanitised values, dedups page views', () => {
    const ga4 = TestBed.inject(Ga4Service);
    ga4.enable('G-TEST1234', '/cookies', 'www.google.com');
    const list = entries();
    const iDefault = list.findIndex((a) => a[0] === 'consent' && a[1] === 'default');
    const iUpdate = list.findIndex((a) => a[0] === 'consent' && a[1] === 'update');
    const iConfig = list.findIndex((a) => a[0] === 'config');
    expect(iDefault).toBeLessThan(iUpdate);
    expect(iUpdate).toBeLessThan(iConfig);
    expect(list[iDefault][2]).toEqual(jasmine.objectContaining({ analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }));
    const config = list[iConfig][2] as any;
    expect(config.send_page_view).toBeFalse();
    expect(config.page_location).toBe(`${location.origin}/cookies`);
    expect(config.page_referrer).toBe('https://www.google.com/');
    ga4.pageView('/cookies');
    ga4.pageView('/cookies');
    ga4.pageView('/canales');
    expect(entries().filter((a) => a[0] === 'event' && a[1] === 'page_view').length).toBe(2);
    expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull(); // injected later, on idle after load
    ga4.disable();
    expect(win['ga-disable-G-TEST1234']).toBeTrue();
    expect(entries().some((a) => a[0] === 'consent' && a[1] === 'update' && (a[2] as any).analytics_storage === 'denied')).toBeTrue();
  });

  it('rejects malformed measurement ids', () => {
    TestBed.inject(Ga4Service).enable('UA-123');
    expect(win.dataLayer.length).toBe(0);
  });

  it('loads only the configured container at idle after load, once even if consent changes', () => {
    environment.analytics.gtmContainerId = 'GTM-KBRSTHLS';
    const ready = spyOnProperty(document, 'readyState').and.returnValue('loading');
    const idle = spyOn(window, 'requestIdleCallback').and.returnValue(1);
    const append = spyOn(document.head, 'appendChild').and.callFake(node => node);
    const ga4 = TestBed.inject(Ga4Service);

    ga4.enable('G-2QLQW39ZGV');
    expect(idle).not.toHaveBeenCalled();
    ready.and.returnValue('complete');
    window.dispatchEvent(new Event('load'));
    expect(append).not.toHaveBeenCalled();
    ga4.disable();
    ga4.enable('G-2QLQW39ZGV');
    ga4.pageView('/');
    expect(entries().some(entry => entry[0] === 'config' || entry[1] === 'page_view')).toBeFalse();

    expect(idle).toHaveBeenCalledTimes(1);
    idle.calls.mostRecent().args[0]({ didTimeout: false, timeRemaining: () => 10 });
    expect(append).toHaveBeenCalledTimes(1);
    const script = append.calls.mostRecent().args[0] as HTMLScriptElement;
    expect(script.async).toBeTrue();
    expect(script.src).toBe('https://www.googletagmanager.com/gtm.js?id=GTM-KBRSTHLS');
    ga4.pageView('/canales');
    ga4.pageView('/canales');
    expect(entries().filter(entry => entry[0] === 'event' && entry[1] === 'page_view').length).toBe(1);
  });
});
