import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { AdminAnalyticsSectionComponent } from './admin-analytics-section.component';
import { AdminAnalyticsService } from '../../../../services/admin-analytics.service';
import { AdminUsersService } from '../../../../services/admin-users.service';

describe('Analytics geography', () => {
  const overview = {
    activeNow: 0, totalSessions: 6, uniqueVisitors: 4, totalPageViews: 0,
    avgSessionDurationSec: 0, topPages: [], topReferrers: [], sessionsByDay: [],
    geographyConfigured: true,
    geography: [
      { country: 'ES', region: 'MD', count: 2 },
      { country: 'ES', region: 'CT', count: 3 },
      { country: 'Desconocido', region: 'Desconocido', count: 1 },
    ],
  };
  let service: any;

  beforeEach(() => {
    service = {
      getOverview: jasmine.createSpy().and.returnValue(of(overview)),
      getRealtimePages: jasmine.createSpy().and.returnValue(of({ from: '2026-11-04T10:00:00Z', to: '2026-11-04T10:30:00Z', activeUsers: 3, pageViews: 10, minutes: [{ from: '2026-11-04T10:00:00Z', users: 2 }], pages: [{ path: '/zeta', users: 2, views: 2 }, { path: '/alfa', users: 3, views: 8 }] })),
      getLive: () => of({ activeCount: 0, sessions: [] }),
      getRecentEvents: () => of([]), getView: jasmine.createSpy().and.returnValue(of({ tab: 'live', rangeHours: 168 })),
    };
    TestBed.configureTestingModule({
      imports: [AdminAnalyticsSectionComponent],
      providers: [
        { provide: AdminAnalyticsService, useValue: service },
        { provide: AdminUsersService, useValue: {} },
      ],
    });
  });

  it('hides inactive sessions and filters the displayed sample', () => {
    service.getLive = () => of({ activeCount: 2, sessions: [
      { sessionId: 'active', lastPath: '/active', metadata: { activity: { idleSec: 20 } } },
      { sessionId: 'idle', lastPath: '/idle', metadata: { activity: { idleSec: 300 } } },
    ] });
    const fixture = TestBed.createComponent(AdminAnalyticsSectionComponent);
    fixture.componentInstance.activeItem = 'live';
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(component.activeNow).toBe(1);
    expect(component.liveSessions.map((session) => session.sessionId)).toEqual(['active']);
    const table: HTMLElement = fixture.nativeElement.querySelector('.session-table');
    expect(table.querySelectorAll('thead th').length).toBe(6);
    expect(table.textContent).toContain('/active');
    const details = table.querySelector('button')!;
    details.click();
    fixture.detectChanges();
    expect(details.getAttribute('aria-expanded')).toBe('true');
    expect(table.querySelector('#session-detail-active')).not.toBeNull();
    component.filterLiveSessions('/missing', 'all');
    expect(component.filteredLiveSessions.length).toBe(0);
    fixture.destroy();
  });

  it('maps country totals and exposes all region values in a sortable table', () => {
    const fixture = TestBed.createComponent(AdminAnalyticsSectionComponent);
    fixture.componentInstance.activeItem = 'geography';
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(fixture.componentInstance.geographyCounts['ES']).toBe(5);
    expect(element.querySelectorAll('svg path.geo-map__country--active').length).toBeGreaterThan(0);
    expect(element.querySelectorAll('tbody tr').length).toBe(3);
    expect(element.textContent).toContain('Desconocido');
    fixture.componentInstance.sortGeography('region');
    fixture.detectChanges();
    expect(element.querySelector('tbody tr')?.textContent).toContain('CT');
    fixture.destroy();
  });

  it('does not show stale geography while a new period loads or fails', () => {
    const fixture = TestBed.createComponent(AdminAnalyticsSectionComponent);
    fixture.componentInstance.activeItem = 'geography';
    fixture.detectChanges();
    const pending = new Subject<any>();
    service.getOverview.and.returnValue(pending);
    fixture.componentInstance.selectRange(168);
    fixture.detectChanges();
    expect(service.getOverview).toHaveBeenCalledWith(168);
    expect(fixture.nativeElement.textContent).toContain('Cargando datos geográficos');
    expect(fixture.nativeElement.querySelector('svg')).toBeNull();
    pending.error(new Error('offline'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No se han podido cargar los datos geográficos');
    expect(fixture.nativeElement.querySelector('svg')).toBeNull();
    fixture.destroy();
  });

  it('distinguishes an unsupported store and an empty result', () => {
    const fixture = TestBed.createComponent(AdminAnalyticsSectionComponent);
    fixture.componentInstance.activeItem = 'geography';
    service.getOverview.and.returnValue(of({ ...overview, geography: undefined }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('no proporciona datos geográficos');
    service.getOverview.and.returnValue(of({ ...overview, geography: [] }));
    fixture.componentInstance.selectRange(168);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No hay datos para este periodo');
    service.getOverview.and.returnValue(of({ ...overview, geographyConfigured: false }));
    fixture.componentInstance.selectRange(24);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('La fuente geográfica no está configurada');
    fixture.destroy();
  });

  it('shows overview values and opens the corresponding report', () => {
    service.getOverview.and.returnValue(of({ ...overview, topPages: [{ path: '/guia', count: 12 }], topReferrers: [{ referrer: 'example.test', count: 5 }], sessionsByDay: [{ date: '2026-11-01', count: 0 }] }));
    const fixture = TestBed.createComponent(AdminAnalyticsSectionComponent);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('Visitantes únicos');
    expect(element.textContent).not.toContain('Guardar vista');
    expect(element.querySelector('nav[aria-label="Analytics views"]')).toBeNull();
    expect(service.getView).not.toHaveBeenCalled();
    expect(element.textContent).toContain('/guia');
    expect(element.textContent).toContain('example.test');
    expect(fixture.componentInstance.getDayBarWidth(0)).toBe('0%');
    const navigate = spyOn(fixture.componentInstance.activeItemChange, 'emit');
    const link = Array.from(element.querySelectorAll('button')).find((button) => button.textContent?.includes('Ver páginas'))!;
    link.click();
    expect(navigate).toHaveBeenCalledWith('pages');
    fixture.destroy();
  });

  it('labels Valkey aggregate limitations and event breakdowns', () => {
    service.getOverview.and.returnValue(of({ ...overview, aggregateLimitations: true }));
    const fixture = TestBed.createComponent(AdminAnalyticsSectionComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('exclusiones históricas no se pueden verificar');
    expect(fixture.nativeElement.textContent).toContain('Rutas con más eventos');
    fixture.destroy();
  });

  it('shows page data with search, sorting and accurate empty states', () => {
    const fixture = TestBed.createComponent(AdminAnalyticsSectionComponent);
    fixture.componentInstance.activeItem = 'pages';
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('Usuarios activos por minuto');
    expect(element.textContent).toContain('Últimos 30 minutos');
    expect(element.querySelector('tbody tr')?.textContent).toContain('/alfa');
    fixture.componentInstance.sortPages('users');
    fixture.detectChanges();
    expect(element.querySelector('tbody tr')?.textContent).toContain('/zeta');
    fixture.componentInstance.searchPages('no-existe');
    fixture.detectChanges();
    expect(element.textContent).toContain('No hay páginas que coincidan con la búsqueda');
    fixture.destroy();
  });

  it('does not show stale page totals when the store cannot provide the report', () => {
    service.getRealtimePages.and.returnValue(throwError(() => ({ status: 503 })));
    const fixture = TestBed.createComponent(AdminAnalyticsSectionComponent);
    fixture.componentInstance.activeItem = 'pages';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('El almacenamiento activo no está disponible');
    expect(fixture.nativeElement.querySelector('.page-report__summary')).toBeNull();
    fixture.destroy();
  });

  it('keeps a limited event sample visible without flashing while the endpoint is unavailable', fakeAsync(() => {
    service.getRealtimePages.and.returnValue(throwError(() => ({ status: 404 })));
    service.getRecentEvents = jasmine.createSpy().and.returnValue(of([{ eventId: 'one', type: 'page_view', sessionId: 's', anonId: 'a', path: '/guia', occurredAt: new Date().toISOString() }]));
    const fixture = TestBed.createComponent(AdminAnalyticsSectionComponent);
    fixture.componentInstance.activeItem = 'pages';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Actualiza o reinicia el backend');
    expect(fixture.nativeElement.textContent).toContain('muestra limitada');
    expect(fixture.nativeElement.textContent).toContain('/guia');
    expect(service.getRecentEvents).toHaveBeenCalledWith(40, undefined, undefined, 0.5);
    tick(10000);
    fixture.detectChanges();
    expect(service.getRealtimePages).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Muestra de eventos recientes');
    fixture.destroy();
  }));

  it('does not cancel a slow realtime report during polling', fakeAsync(() => {
    const pending = new Subject<any>();
    service.getRealtimePages.and.returnValue(pending);
    const fixture = TestBed.createComponent(AdminAnalyticsSectionComponent);
    fixture.componentInstance.activeItem = 'pages';
    fixture.detectChanges();
    tick(20000);
    expect(service.getRealtimePages).toHaveBeenCalledTimes(1);
    pending.next({ from: '2026-11-04T10:00:00Z', to: '2026-11-04T10:30:00Z', activeUsers: 2, pageViews: 3, minutes: [], pages: [] });
    pending.complete();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Usuarios activos');
    expect(fixture.componentInstance.realtimePages?.activeUsers).toBe(2);
    fixture.destroy();
  }));

  it('keeps the last report and warns when a background refresh fails', () => {
    const fixture = TestBed.createComponent(AdminAnalyticsSectionComponent);
    fixture.componentInstance.activeItem = 'pages';
    fixture.detectChanges();
    service.getRealtimePages.and.returnValue(throwError(() => ({ status: 500 })));
    (fixture.componentInstance as any).loadRealtimePages();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Los datos pueden estar desactualizados');
    expect(fixture.nativeElement.textContent).toContain('/alfa');
    expect((fixture.nativeElement.querySelector('button[disabled]') as HTMLButtonElement)).toBeTruthy();
    fixture.destroy();
  });

  it('identifies incomplete realtime coverage', () => {
    service.getRealtimePages.and.returnValue(of({ from: '2026-11-04T10:00:00Z', to: '2026-11-04T10:30:00Z', activeUsers: 0, pageViews: 0, minutes: [], pages: [], partial: true, coverageStartedAt: '2026-11-04T10:20:00Z' }));
    const fixture = TestBed.createComponent(AdminAnalyticsSectionComponent);
    fixture.componentInstance.activeItem = 'pages';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Datos parciales');
    expect(fixture.nativeElement.textContent).toContain('no se incluyen');
    fixture.destroy();
  });

  it('renders the realtime map from the returned sessions and labels the sample', () => {
    service.getLive = () => of({ activeCount: 8, sessions: [
      { sessionId: 'one', anonId: 'a', startedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), country: 'ES', lastPath: '/guia' },
      { sessionId: 'two', anonId: 'b', startedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), lastPath: '/guia' },
    ] });
    const fixture = TestBed.createComponent(AdminAnalyticsSectionComponent);
    fixture.componentInstance.activeItem = 'live';
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.live-map__metric strong')?.textContent).toContain('8');
    expect(fixture.componentInstance.liveMarkers.length).toBe(1);
    expect(element.textContent).toContain('2 sesiones mostradas');
    expect(element.textContent).toContain('Sin punto en el mapa: 1');
    expect(element.textContent).toContain('/guia');
    (element.querySelector('app-live-map button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(element.textContent).toContain('Actividad simulada');
    expect(element.querySelector('app-live-map button')?.getAttribute('aria-pressed')).toBe('true');
    fixture.destroy();
  });

  it('maps trusted IP locations separately and falls back to country only when needed', () => {
    const base = { startedAt: '2026-11-04T10:00:00Z', lastSeenAt: '2026-11-04T10:05:00Z' };
    service.getLive = () => of({ activeCount: 4, sessions: [
      { ...base, sessionId: 'a', anonId: 'a', country: 'ES', region: 'MD', city: 'Madrid', latitude: 40.4, longitude: -3.7 },
      { ...base, sessionId: 'b', anonId: 'b', country: 'ES', region: 'VC', city: 'Valencia', latitude: 39.5, longitude: -0.4 },
      { ...base, sessionId: 'c', anonId: 'c', country: 'ES' },
      { ...base, sessionId: 'd', anonId: 'd', language: 'es', timezone: 'Europe/Madrid' },
    ] });
    const fixture = TestBed.createComponent(AdminAnalyticsSectionComponent);
    fixture.componentInstance.activeItem = 'live';
    fixture.detectChanges();
    const markers = fixture.componentInstance.liveMarkers;
    expect(markers.length).toBe(3);
    expect(markers.find((marker) => marker.label === 'Madrid, MD, ES')).toEqual(jasmine.objectContaining({ lat: 40.4, lng: -3.7, precision: 'ip' }));
    expect(markers.find((marker) => marker.label === 'ES')?.precision).toBe('country');
    expect(fixture.componentInstance.liveUnmapped).toBe(1);
    fixture.destroy();
  });

  it('identifies crawlers, calculates elapsed duration and opens session events', () => {
    service.getRecentEvents = jasmine.createSpy().and.returnValue(of([]));
    service.getLive = () => of({ activeCount: 1, sessions: [{ sessionId: 'apple-session', anonId: 'a', startedAt: '2026-11-04T10:00:00Z', lastSeenAt: '2026-11-04T10:05:00Z', durationSec: 0, lastPath: '/peliculas/ejemplo', userAgent: 'Mozilla/5.0 Safari/605.1.15 Applebot/0.1', metadata: { device: { type: 'desktop', orientation: 'landscape' }, activity: { isIdle: true, idleSec: 180 } } }] });
    const fixture = TestBed.createComponent(AdminAnalyticsSectionComponent);
    fixture.componentInstance.activeItem = 'live';
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('Rastreador identificado: Applebot');
    expect(element.querySelector('.session-table__row td:nth-child(4)')?.textContent).toContain('5m 0s');
    expect(element.textContent).toContain('Sin interacción desde hace 3m 0s');
    const navigate = spyOn(fixture.componentInstance.activeItemChange, 'emit');
    Array.from(element.querySelectorAll('button')).find((button) => button.textContent?.includes('Ver eventos de esta sesión'))!.click();
    expect(service.getRecentEvents).toHaveBeenCalledWith(40, undefined, 'apple-session', 24);
    expect(navigate).toHaveBeenCalledWith('events');
    fixture.destroy();
  });
});
