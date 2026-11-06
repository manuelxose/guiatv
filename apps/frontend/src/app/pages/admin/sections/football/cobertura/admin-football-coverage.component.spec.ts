import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminFootballCoverageComponent } from './admin-football-coverage.component';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';

describe('AdminFootballCoverageComponent', () => {
  let service: { getCoverage: jasmine.Spy };

  const report = (overrides: Record<string, unknown> = {}) => ({
    provider: { configured: true, state: 'healthy', eligibility: 'approved-limited' },
    competitions: [],
    matrix: [],
    ...overrides,
  });

  const competition = (overrides: Record<string, unknown> = {}) => ({
    id: 'c1',
    name: 'LaLiga',
    country: 'España',
    currentSeason: '2026/27',
    providerIds: {},
    lastUpdatedAt: new Date().toISOString(),
    state: 'not-covered',
    ...overrides,
  });

  beforeEach(() => {
    service = { getCoverage: jasmine.createSpy().and.returnValue(of(report())) };
    TestBed.configureTestingModule({
      imports: [AdminFootballCoverageComponent],
      providers: [{ provide: FootballAdminDataService, useValue: service }],
    });
  });

  it('renders "Competicion sin cobertura" for a competition without an approved provider, and never "no hay partidos hoy"', () => {
    service.getCoverage.and.returnValue(of(report({ competitions: [competition()] })));
    const fixture = TestBed.createComponent(AdminFootballCoverageComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Competicion sin cobertura');
    expect(text).not.toContain('no hay partidos hoy');
    fixture.destroy();
  });

  it('renders "Cobertura parcial" for an approved-limited mapped competition', () => {
    service.getCoverage.and.returnValue(
      of(report({ competitions: [competition({ providerIds: { ol: 'bl1' }, state: 'partial' })] }))
    );
    const fixture = TestBed.createComponent(AdminFootballCoverageComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Cobertura parcial');
    expect(text).not.toContain('Competicion sin cobertura');
    fixture.destroy();
  });

  it('renders "Desactualizado" for a mapped but stale competition', () => {
    service.getCoverage.and.returnValue(
      of(report({ competitions: [competition({ providerIds: { ol: 'bl1' }, state: 'stale' })] }))
    );
    const fixture = TestBed.createComponent(AdminFootballCoverageComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Desactualizado');
    fixture.destroy();
  });

  it('renders "Bloqueado legalmente" for a configured-but-legally-blocked provider, never "Disponible"', () => {
    service.getCoverage.and.returnValue(
      of(
        report({
          provider: { configured: true, state: 'healthy', eligibility: 'blocked' },
          competitions: [competition({ providerIds: { ol: 'bl1' }, state: 'legally-blocked' })],
        })
      )
    );
    const fixture = TestBed.createComponent(AdminFootballCoverageComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Bloqueado legalmente');
    expect(text).not.toContain('Disponible');
    fixture.destroy();
  });

  it('renders "Aún no medido" for an unmeasured state and never "Disponible"', () => {
    service.getCoverage.and.returnValue(
      of(report({ competitions: [competition({ providerIds: { ol: 'bl1' }, state: 'not-yet-measured' })] }))
    );
    const fixture = TestBed.createComponent(AdminFootballCoverageComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Aún no medido');
    expect(text).not.toContain('Disponible');
    fixture.destroy();
  });

  it('renders each coverage-matrix cell with its aspect label and state', () => {
    service.getCoverage.and.returnValue(
      of(
        report({
          matrix: [
            { aspect: 'fixtures', state: 'available' },
            { aspect: 'live-minute', state: 'not-supported' },
          ],
        })
      )
    );
    const fixture = TestBed.createComponent(AdminFootballCoverageComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Matriz de cobertura por dato');
    expect(text).toContain('Partidos');
    expect(text).toContain('Minuto en directo');
    expect(text).toContain('No soportado');
    fixture.destroy();
  });

  it('warns when no provider is approved', () => {
    service.getCoverage.and.returnValue(
      of(report({ provider: { configured: false, state: 'unconfigured', eligibility: 'approved-limited' } }))
    );
    const fixture = TestBed.createComponent(AdminFootballCoverageComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No hay ningún proveedor aprobado');
    fixture.destroy();
  });

  it('shows a distinct empty state when there are no competitions at all', () => {
    service.getCoverage.and.returnValue(of(report({ competitions: [] })));
    const fixture = TestBed.createComponent(AdminFootballCoverageComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('No hay competiciones registradas');
    expect(text).not.toContain('Competicion sin cobertura');
    fixture.destroy();
  });
});
