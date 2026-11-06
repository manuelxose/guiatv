import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminFootballSectionComponent } from './admin-football-section.component';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';

describe('AdminFootballSectionComponent (navigation)', () => {
  const overview = {
    generatedAt: null,
    provider: { configured: true, state: 'healthy', eligibility: 'approved-limited' },
    activeCompetitions: 0,
    totalTeams: 0,
    upcomingFixtures: 0,
    fixturesMissingBroadcast: 0,
    broadcastMappings: 0,
    staleCompetitions: 0,
    staleTeams: 0,
    unmappedCompetitions: 0,
    unmappedTeams: 0,
    lastSuccessfulSync: null,
    lastFailedSync: null,
  };

  let service: Record<string, jasmine.Spy>;

  beforeEach(() => {
    service = {
      getOverview: jasmine.createSpy().and.returnValue(of(overview)),
      getCoverage: jasmine.createSpy().and.returnValue(of({ provider: overview.provider, competitions: [], matrix: [] })),
      getMatches: jasmine.createSpy().and.returnValue(of([])),
      getEntities: jasmine.createSpy().and.returnValue(of([])),
      getSyncState: jasmine
        .createSpy()
        .and.returnValue(of({ provider: overview.provider, lastSuccessfulSync: null, lastFailedSync: null, jobs: [] })),
      getQuality: jasmine
        .createSpy()
        .and.returnValue(of({ overview, staleEntities: [], unmappedEntities: [] })),
      refreshFootball: jasmine.createSpy().and.returnValue(of({ id: 'job-1' })),
    };
    TestBed.configureTestingModule({
      imports: [AdminFootballSectionComponent],
      providers: [{ provide: FootballAdminDataService, useValue: service }],
    });
  });

  it('renders each of the eight sections for its activeItem', () => {
    const fixture = TestBed.createComponent(AdminFootballSectionComponent);
    const cases: Array<[string, string]> = [
      ['centro-de-control', 'Próximos partidos'],
      ['proveedores', 'Proveedor de datos de fútbol'],
      ['cobertura', 'No hay competiciones registradas'],
      ['partidos', 'no hay partidos hoy'],
      ['entidades', 'No hay entidades registradas'],
      ['retransmisiones', 'No hay retransmisiones'],
      ['sincronizacion', 'Sincronizar ahora'],
      ['calidad', 'Sin incidencias de calidad'],
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
