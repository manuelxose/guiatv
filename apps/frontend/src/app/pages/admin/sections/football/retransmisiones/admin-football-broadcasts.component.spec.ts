import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminFootballBroadcastsComponent } from './admin-football-broadcasts.component';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';

describe('AdminFootballBroadcastsComponent', () => {
  let service: { getBroadcasts: jasmine.Spy };

  const broadcast = (overrides: Record<string, unknown> = {}) => ({
    matchId: 'm1',
    matchSlug: 'real-madrid-barcelona',
    channelId: 'c1',
    channelName: 'Canal TV',
    availability: 'tv',
    provenance: 'airing',
    confidence: 'high',
    ...overrides,
  });

  beforeEach(() => {
    service = { getBroadcasts: jasmine.createSpy().and.returnValue(of({ page: 1, limit: 25, total: 0, items: [] })) };
    TestBed.configureTestingModule({
      imports: [AdminFootballBroadcastsComponent],
      providers: [{ provide: FootballAdminDataService, useValue: service }],
    });
  });

  it('renders distinct TV, Streaming and TV y streaming availability states', () => {
    service.getBroadcasts.and.returnValue(
      of({
        page: 1,
        limit: 25,
        total: 3,
        items: [
          broadcast(),
          broadcast({ channelId: 'b', channelName: 'Plataforma', availability: 'streaming' }),
          broadcast({ channelId: 'c', channelName: 'Ambos', availability: 'both' }),
        ],
      })
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

  it('shows an honest empty state when there are no broadcast mappings', () => {
    const fixture = TestBed.createComponent(AdminFootballBroadcastsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No hay retransmisiones que coincidan con la consulta.');
    fixture.destroy();
  });
});
