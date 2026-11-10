import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER } from 'rxjs';
import { TvReadItemDTO } from '../../api/models';
import { AffiliateService } from '../../services/affiliate.service';
import { PanelTileComponent } from './panel-tile.component';

const POSTER = 'https://epg.test/poster.jpg';
const BACKDROP = 'https://image.tmdb.org/t/p/w1280/backdrop.jpg';

function airing(assets: Record<string, unknown>): TvReadItemDTO {
  return {
    id: 'a1',
    assets,
    airing: { start: '2026-11-10T20:00:00.000Z', end: '2026-11-10T21:00:00.000Z', liveNow: false },
    program: { title: 'Mañaneros 360', editorialCategory: 'Otros', genre: 'Magazine' },
    channel: { id: 'la_1', name: 'La 1', path: '/canales/la-1' },
    availability: { streaming: false },
  } as unknown as TvReadItemDTO;
}

describe(PanelTileComponent.name, () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PanelTileComponent],
      providers: [provideRouter([]), { provide: AffiliateService, useValue: { resolve: () => NEVER } }],
    }).compileComponents();
  });

  const render = (item: TvReadItemDTO, variant: 'tv' | 'poster' = 'tv'): HTMLImageElement => {
    const fixture = TestBed.createComponent(PanelTileComponent);
    fixture.componentRef.setInput('item', item);
    fixture.componentRef.setInput('variant', variant);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector('.tile__img') as HTMLImageElement;
  };

  it('should render the API rectangular backdrop when the card is the 16:9 one', () => {
    const img = render(airing({ poster: { kind: 'poster', role: 'primary', source: 'epg_program_image', url: POSTER }, backdrop: { kind: 'backdrop', role: 'fallback', source: 'tmdb_backdrop', url: BACKDROP } }));

    expect(img.getAttribute('src')).toBe(BACKDROP);
  });

  it('should keep the poster when the API has no rectangular backdrop', () => {
    const img = render(airing({ poster: { kind: 'poster', role: 'primary', source: 'epg_program_image', url: POSTER } }));

    expect(img.getAttribute('src')).toBe(POSTER);
  });

  it('should keep the poster on catalogue cards even when a backdrop exists', () => {
    const img = render(airing({ poster: { kind: 'poster', role: 'primary', source: 'epg_program_image', url: POSTER }, backdrop: { kind: 'backdrop', role: 'fallback', source: 'tmdb_backdrop', url: BACKDROP } }), 'poster');

    expect(img.getAttribute('src')).toBe(POSTER);
  });
});
