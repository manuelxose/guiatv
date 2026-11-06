import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminFootballCoverageComponent } from './admin-football-coverage.component';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';

describe('AdminFootballCoverageComponent', () => {
  let service: { getCoverage: jasmine.Spy };

  const row = (overrides: Record<string, unknown> = {}) => ({
    competitionSlug: 'laliga',
    name: 'LaLiga',
    type: 'league',
    coverageState: 'competition_not_covered',
    snapshotCount: null,
    snapshotCountState: 'not_covered',
    ...overrides,
  });

  beforeEach(() => {
    service = { getCoverage: jasmine.createSpy().and.returnValue(of({ generatedAt: '2026-11-06T10:00:00.000Z', rows: [] })) };
    TestBed.configureTestingModule({
      imports: [AdminFootballCoverageComponent],
      providers: [{ provide: FootballAdminDataService, useValue: service }],
    });
  });

  it('renders "Competición sin cobertura" for a competition without an eligible provider', () => {
    service.getCoverage.and.returnValue(of({ generatedAt: 'x', rows: [row()] }));
    const fixture = TestBed.createComponent(AdminFootballCoverageComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Competición sin cobertura');
    expect(text).toContain('Sin cobertura'); // snapshot label for not_covered
    fixture.destroy();
  });

  it('renders "Cubierta" and the observed snapshot count', () => {
    service.getCoverage.and.returnValue(
      of({ generatedAt: 'x', rows: [row({ coverageState: 'provider_supported', snapshotCount: 12, snapshotCountState: 'observed' })] })
    );
    const fixture = TestBed.createComponent(AdminFootballCoverageComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Cubierta');
    expect(text).toContain('12');
    fixture.destroy();
  });

  it('renders "Cubierta sin partidos" for a supported competition with no fixtures', () => {
    service.getCoverage.and.returnValue(
      of({ generatedAt: 'x', rows: [row({ coverageState: 'provider_supported_no_fixtures', snapshotCount: 0, snapshotCountState: 'empty' })] })
    );
    const fixture = TestBed.createComponent(AdminFootballCoverageComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Cubierta sin partidos');
    fixture.destroy();
  });

  it('renders "Proveedor no disponible" and never a snapshot number for an unavailable provider', () => {
    service.getCoverage.and.returnValue(
      of({ generatedAt: 'x', rows: [row({ coverageState: 'provider_unavailable', snapshotCount: null, snapshotCountState: 'unavailable' })] })
    );
    const fixture = TestBed.createComponent(AdminFootballCoverageComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Proveedor no disponible');
    expect(text).not.toContain('Sin partidos');
    fixture.destroy();
  });

  it('shows a distinct empty state when there are no competitions at all', () => {
    const fixture = TestBed.createComponent(AdminFootballCoverageComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No hay competiciones registradas.');
    fixture.destroy();
  });
});
