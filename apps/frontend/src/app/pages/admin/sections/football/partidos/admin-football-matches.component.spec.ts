import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminFootballMatchesComponent } from './admin-football-matches.component';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';

describe('AdminFootballMatchesComponent', () => {
  let service: { getMatches: jasmine.Spy; getMatch: jasmine.Spy };

  const match = (overrides: Record<string, unknown> = {}) => ({
    matchId: 'm1',
    canonicalKey: 'bl1:m1',
    competitionSlug: 'laliga',
    kickoffAt: '2026-11-06T20:00:00.000Z',
    kickoffState: 'observed',
    status: 'scheduled',
    statusState: 'observed',
    homeTeam: 'Real Madrid',
    homeTeamState: 'observed',
    awayTeam: 'Barcelona',
    awayTeamState: 'observed',
    score: { home: null, away: null },
    scoreState: 'missing',
    ingestedAt: '2026-11-06T10:00:00.000Z',
    contentHash: 'abc',
    ...overrides,
  });

  beforeEach(() => {
    service = {
      getMatches: jasmine.createSpy().and.returnValue(of({ page: 1, limit: 25, total: 0, items: [] })),
      getMatch: jasmine.createSpy().and.returnValue(of(match())),
    };
    TestBed.configureTestingModule({
      imports: [AdminFootballMatchesComponent],
      providers: [{ provide: FootballAdminDataService, useValue: service }],
    });
  });

  it('shows an honest empty state when the query returned no rows', () => {
    const fixture = TestBed.createComponent(AdminFootballMatchesComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No hay partidos que coincidan con la consulta.');
    fixture.destroy();
  });

  it('opens the match inspector with teams, score and canonical key', () => {
    service.getMatches.and.returnValue(
      of({ page: 1, limit: 25, total: 1, items: [match({ score: { home: 2, away: 1 }, scoreState: 'observed' })] })
    );
    const fixture = TestBed.createComponent(AdminFootballMatchesComponent);
    fixture.detectChanges();
    const button = Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes('Real Madrid')
    ) as HTMLElement;
    button.click();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Inspector de partido');
    expect(text).toContain('Real Madrid — Barcelona');
    expect(text).toContain('2 : 1');
    expect(text).toContain('bl1:m1');
    fixture.destroy();
  });

  it('shows "Sin marcador" when the snapshot carries no score', () => {
    service.getMatches.and.returnValue(of({ page: 1, limit: 25, total: 1, items: [match()] }));
    const fixture = TestBed.createComponent(AdminFootballMatchesComponent);
    fixture.detectChanges();
    const button = Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes('Real Madrid')
    ) as HTMLElement;
    button.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sin marcador');
    fixture.destroy();
  });
});
