import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { CatalogService } from '../../services/catalog.service';
import { ChatService } from '../../services/chat.service';
import { MetaService } from '../../services/meta.service';
import { TvDataFacade } from '../../state/tv-data.facade';
import { StatsComponent } from './stats.component';

// Phase 1 TS-05: /tendencias server-rendered "Cargando…" (OnPush view never re-rendered) while its meta said index.
describe('StatsComponent (/tendencias)', () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ title: `Título ${i + 1}`, detailPath: `/series/titulo-${i + 1}`, genres: ['Drama'] }));
  let setMetaTags: jasmine.Spy;

  function render(result: ReturnType<CatalogService['queryState']>): HTMLElement {
    setMetaTags = jasmine.createSpy('setMetaTags');
    TestBed.configureTestingModule({
      imports: [StatsComponent],
      providers: [
        provideRouter([]),
        { provide: MetaService, useValue: { setMetaTags } },
        { provide: CatalogService, useValue: { queryState: () => result } },
        { provide: TvDataFacade, useValue: { discoverContent: () => of({ items: [] }), getTonightPrograms: () => of([]) } },
        { provide: ChatService, useValue: { requestToggleAssistant: () => undefined } },
      ],
    });
    const fixture = TestBed.createComponent(StatsComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const lastRobots = () => setMetaTags.calls.mostRecent().args[0].robots;

  it('renders the list, not the loading state, once the data arrives, and only then becomes indexable', () => {
    const el = render(of({ data: { items } } as any));
    expect(el.querySelectorAll('.popular-page__list li').length).toBe(6);
    expect(el.textContent).toContain('Título 1');
    expect(el.textContent).not.toContain('Cargando');
    expect(lastRobots()).toBe('index, follow');
  });

  it('stays noindex with a visible error and no list when the request fails', () => {
    const el = render(throwError(() => new Error('down')));
    expect(el.querySelector('.popular-page__list')).toBeNull();
    expect(el.textContent).toContain('No hemos podido cargar');
    expect(lastRobots()).toBe('noindex, follow');
  });

  it('stays noindex when there are too few items to be a useful list', () => {
    render(of({ data: { items: items.slice(0, 3) } } as any));
    expect(lastRobots()).toBe('noindex, follow');
  });
});
