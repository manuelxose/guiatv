import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminFootballBroadcastsComponent } from './admin-football-broadcasts.component';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';

describe('AdminFootballBroadcastsComponent', () => {
  let service: { getMatches: jasmine.Spy };

  const match = (id: string, broadcasts: unknown[]) => ({
    id,
    slug: id,
    providerIds: {},
    competition: { id: 'c1', slug: 'laliga', name: 'LaLiga' },
    kickoffAt: '2026-11-06T20:00:00.000Z',
    status: 'scheduled',
    homeTeam: { id: 'h', slug: 'h', name: 'Real Madrid', aliases: [], providerIds: {}, lastUpdatedAt: '' },
    awayTeam: { id: 'a', slug: 'a', name: 'Barcelona', aliases: [], providerIds: {}, lastUpdatedAt: '' },
    score: { home: null, away: null },
    broadcasts,
    sourceProvenance: { source: 'openligadb', confidence: 'high' },
    lastUpdatedAt: '2026-11-06T10:00:00.000Z',
  });

  beforeEach(() => {
    service = { getMatches: jasmine.createSpy().and.returnValue(of([])) };
    TestBed.configureTestingModule({
      imports: [AdminFootballBroadcastsComponent],
      providers: [{ provide: FootballAdminDataService, useValue: service }],
    });
  });

  it('renders distinct TV, Streaming and TV y streaming availability states', () => {
    service.getMatches.and.returnValue(
      of([
        match('m1', [
          { channelId: 'a', channelName: 'Canal TV', availability: 'tv', provenance: 'airing', confidence: 'high' },
          { channelId: 'b', channelName: 'Plataforma', availability: 'streaming', provenance: 'reconciliation', confidence: 'medium' },
          { channelId: 'c', channelName: 'Ambos', availability: 'both', provenance: 'override', confidence: 'high' },
        ]),
      ])
    );
    const fixture = TestBed.createComponent(AdminFootballBroadcastsComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('TV');
    expect(text).toContain('Streaming');
    expect(text).toContain('TV y streaming');
    expect(text).toContain('Canal TV');
    fixture.destroy();
  });

  it('renders "Sin retransmisión" for a match with no broadcasts', () => {
    service.getMatches.and.returnValue(of([match('m1', [])]));
    const fixture = TestBed.createComponent(AdminFootballBroadcastsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sin retransmisión');
    fixture.destroy();
  });

  it('renders a distinct empty state when there are no matches at all', () => {
    const fixture = TestBed.createComponent(AdminFootballBroadcastsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No hay retransmisiones');
    fixture.destroy();
  });
});
