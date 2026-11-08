import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminFootballSectionComponent } from './admin-football-section.component';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';

describe('AdminFootballSectionComponent (navigation)', () => {
  const dashboard = {
    generatedAt: '2026-11-06T10:00:00.000Z',
    competitions: 0,
    teams: 0,
    snapshots: 0,
    providers: 0,
    broadcastMappings: 0,
    staleSnapshots: 0,
    openQualityIssues: 0,
    countsState: 'observed',
    lastSyncState: 'not_measured',
  };

  let service: Record<string, jasmine.Spy>;

  beforeEach(() => {
    service = {
      getDashboard: jasmine.createSpy().and.returnValue(of(dashboard)),
      getProviders: jasmine.createSpy().and.returnValue(of([])),
      getProvider: jasmine.createSpy().and.returnValue(of(null)),
      getCoverage: jasmine.createSpy().and.returnValue(of({ generatedAt: '2026-11-06T10:00:00.000Z', rows: [] })),
      getMatches: jasmine.createSpy().and.returnValue(of({ page: 1, limit: 25, total: 0, items: [] })),
      getMatch: jasmine.createSpy().and.returnValue(of(null)),
      getEntityMappings: jasmine.createSpy().and.returnValue(of({ page: 1, limit: 25, total: 0, items: [] })),
      getBroadcasts: jasmine.createSpy().and.returnValue(of({ page: 1, limit: 25, total: 0, items: [] })),
      getIngestionStatus: jasmine
        .createSpy()
        .and.returnValue(of({ generatedAt: '2026-11-06T10:00:00.000Z', enabled: false, providers: [], quota: { consumed: null, disabled: null, state: 'unavailable' } })),
      getQualityIssues: jasmine.createSpy().and.returnValue(of({ page: 1, limit: 25, total: 0, items: [] })),
      getAudit: jasmine.createSpy().and.returnValue(of({ page: 1, limit: 25, total: 0, items: [] })),
      sync: jasmine.createSpy().and.returnValue(of({ id: 'op-1', status: 'queued', correlationId: 'manual.1' })),
    };
    TestBed.configureTestingModule({
      imports: [AdminFootballSectionComponent],
      providers: [{ provide: FootballAdminDataService, useValue: service }],
    });
  });

  it('renders each of the eight sections for its activeItem', () => {
    const fixture = TestBed.createComponent(AdminFootballSectionComponent);
    const cases: Array<[string, string]> = [
      ['centro-de-control', 'Competiciones / equipos'],
      ['proveedores', 'No hay proveedores registrados.'],
      ['cobertura', 'No hay competiciones registradas.'],
      ['partidos', 'No hay partidos que coincidan con la consulta.'],
      ['entidades', 'No hay entidades que coincidan con la consulta.'],
      ['retransmisiones', 'No hay retransmisiones que coincidan con la consulta.'],
      ['sincronizacion', 'Sincronizar ahora'],
      ['calidad', 'Sin incidencias de calidad.'],
    ];
    for (const [item, expectedText] of cases) {
      fixture.componentInstance.activeItem = item;
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(expectedText);
    }
    fixture.destroy();
  });

  it('defaults to the control center section', () => {
    const fixture = TestBed.createComponent(AdminFootballSectionComponent);
    expect(fixture.componentInstance.activeItem).toBe('centro-de-control');
    fixture.destroy();
  });
});
