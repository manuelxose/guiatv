import { ApplicationRef, PLATFORM_ID, TransferState, makeStateKey } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DeviceDetectorService, DeviceInfo } from './device-detector.service';

describe('DeviceDetectorService (SSR → browser)', () => {
  it('replaces a cached desktop TransferState with the real viewport after the first render', () => {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'browser' }] });
    const desktop: DeviceInfo = { type: 'desktop', isMobile: false, isTablet: false, isDesktop: true, width: 1920, height: 1080, orientation: 'landscape', isTouchDevice: false };
    TestBed.inject(TransferState).set(makeStateKey<DeviceInfo>('deviceInfo'), desktop);
    spyOnProperty(window, 'innerWidth', 'get').and.returnValue(406);
    spyOnProperty(window, 'innerHeight', 'get').and.returnValue(724);
    const service = TestBed.inject(DeviceDetectorService);
    // Hydrating render: must match the server HTML.
    expect(service.deviceType()).toBe('desktop');
    TestBed.inject(ApplicationRef).tick();
    expect(service.deviceType()).toBe('mobile');
    expect(service.orientation()).toBe('portrait');
  });
});
