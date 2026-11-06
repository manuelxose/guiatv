import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminFootballMatchesComponent } from './admin-football-matches.component';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';

describe('AdminFootballMatchesComponent', () => {
  let service: { getOverview: jasmine.Spy; getMatches: jasmine.Spy };

  const overview = (provider: Record<string, unknown> = { configured: true, state: 'healthy', eligibility: 'approved-limited' }) => ({
    provider,
    upcomingFixtures: 0,
  });

  const match = (overrides: Record<string, unknown> = {}) => ({
    id: 'm1',
    slug: 'm1',
    providerIds: {},
    competition: { id: 'c1', slug: 'laliga', name: 'LaLiga' },
    kickoffAt: '2026-11-06T20:00:00.000Z',
    status: 'scheduled',
    homeTeam: { id: 'h', slug: 'h', name: 'Real Madrid', aliases: [], providerIds: {}, lastUpdatedAt: '' },
    awayTeam: { id: 'a', slug: 'a', name: 'Barcelona', aliases: [], providerIds: {}, lastUpdatedAt: '' },
    score: { home: null, away: null },
    broadcasts: [],
    sourceProvenance: { source: 'openligadb', confidence: 'high' },
    lastUpdatedAt: '2026-11-06T10:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    service = {
      getOverview: jasmine.createSpy().and.returnValue(of(overview())),
      getMatches: jasmine.createSpy().and.returnValue(of([])),
    };
    TestBed.configureTestingModule({
      imports: [AdminFootballMatchesComponent],
      providers: [{ provide: FootballAdminDataService, useValue: service }],
    });
  });

  it('renders "no hay partidos hoy" when the provider is approved but there are no matches', () => {
    const fixture = TestBed.createComponent(AdminFootballMatchesComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('no hay partidos hoy');
    expect(text).not.toContain('Proveedor no disponible');
    fixture.destroy();
  });

  it('renders "Proveedor no disponible" — not "no hay partidos hoy" — when no provider is approved', () => {
    service.getOverview.and.returnValue(of(overview({ configured: false, state: 'unconfigured' })));
    const fixture = TestBed.createComponent(AdminFootballMatchesComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Proveedor no disponible');
    expect(text).not.toContain('no hay partidos hoy');
    fixture.destroy();
  });

  it('opens the match inspector with teams, score, provenance and broadcast state', () => {
    service.getMatches.and.returnValue(
      of([
        match({
          score: { home: 2, away: 1 },
          broadcasts: [
            { channelId: 'b1', channelName: 'DAZN', availability: 'streaming', provenance: 'reconciliation', confidence: 'high' },
          ],
        }),
      ])
    );
    const fixture = TestBed.createComponent(AdminFootballMatchesComponent);
    fixture.detectChanges();
    const button = Array.from(
      fixture.nativeElement.querySelectorAll('button')
    ).find((b) => (b as HTMLElement).textContent?.includes('Real Madrid')) as HTMLElement;
    button.click();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Inspector de partido');
    expect(text).toContain('Real Madrid — Barcelona');
    expect(text).toContain('DAZN');
    expect(text).toContain('Streaming');
    expect(text).toContain('openligadb');
    fixture.destroy();
  });

  it('shows "Sin retransmisión" in the inspector for a match with no broadcasts', () => {
    service.getMatches.and.returnValue(of([match()]));
    const fixture = TestBed.createComponent(AdminFootballMatchesComponent);
    fixture.detectChanges();
    const button = Array.from(
      fixture.nativeElement.querySelectorAll('button')
    ).find((b) => (b as HTMLElement).textContent?.includes('Real Madrid')) as HTMLElement;
    button.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sin retransmisión');
    fixture.destroy();
  });
});
