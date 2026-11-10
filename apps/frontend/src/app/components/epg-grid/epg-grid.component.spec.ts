import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TvReadItemDTO } from '../../api/models';
import { EpgGridComponent } from './epg-grid.component';

const HOUR_MS = 3_600_000;
// Floored to the current minute (within a second of real "now", so live/"next" checks against the
// component's own Date.now() still land correctly) so every `at(h)` is exactly whole-minute-aligned —
// raw Date.now() carries seconds/ms that would otherwise make an "N minutes from the window start"
// assertion miss by a fraction depending on when the test happens to run.
const NOW_MINUTE_MS = Math.floor(Date.now() / 60_000) * 60_000;
/** An ISO instant `h` hours from "now" (negative for the past) — every test schedules itself relative to
 * whenever it actually runs, instead of a fixed calendar date that ages out of the grid's lookback/lookahead. */
const at = (h: number): string => new Date(NOW_MINUTE_MS + h * HOUR_MS).toISOString();

describe('EpgGridComponent', () => {
  function render(items: TvReadItemDTO[], category = 'all') {
    TestBed.configureTestingModule({ imports: [EpgGridComponent], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(EpgGridComponent);
    fixture.componentRef.setInput('items', items);
    fixture.componentRef.setInput('category', category);
    fixture.detectChanges();
    return fixture;
  }

  it('puts channels in sort order and programmes at their minute offset from the first full hour', () => {
    const bStart = at(0.5);
    const bEnd = at(1.25);
    const aStart = at(1 / 6);
    const aEnd = at(1);
    const fixture = render([
      item('b', 'Antena 3', 3, bStart, bEnd, 'Cine'),
      item('a', 'La 1', 1, aStart, aEnd, 'Noticias'),
    ]);

    const rows = fixture.componentInstance.rows();

    expect(rows.map((r) => r.channelName)).toEqual(['La 1', 'Antena 3']);
    const winStart = fixture.componentInstance['window']().start.getTime();
    const minutesFromWindowStart = (iso: string) => Math.round((Date.parse(iso) - winStart) / 60_000);
    expect(rows[0].cells[0].start).toBe(minutesFromWindowStart(aStart));
    expect(rows[0].cells[0].span).toBe(50);
    expect(rows[1].cells[0].start).toBe(minutesFromWindowStart(bStart));
  });

  it('keeps every in-sync channel visible when one channel\'s data is days out of sync with the rest', () => {
    // Reproduces a real bug: one stale channel used to anchor the window around its own old data,
    // clamping every other (in-sync) channel's cells out of it (see computeWindow/WINDOW_LOOKBACK_MS).
    // 43 normal "Autonómicos" channels went missing in production behind exactly one such channel.
    const fixture = render([
      item('stale', 'Canal Desfasado', 1, at(-80), at(-79), 'Cine'),
      item('a', 'La 1', 2, at(0), at(1), 'Noticias'),
      item('b', 'Antena 3', 3, at(0), at(1), 'Noticias'),
    ]);

    const rows = fixture.componentInstance.rows();

    // The stale channel's own programme sits entirely outside the (now-anchored) window and is correctly
    // dropped — that's expected, not a regression. What matters is that it no longer takes the other two with it.
    expect(rows.map((r) => r.channelName).sort()).toEqual(['Antena 3', 'La 1']);
    expect(rows.find((r) => r.channelName === 'La 1')?.cells.length).toBe(1);
    expect(rows.find((r) => r.channelName === 'Antena 3')?.cells.length).toBe(1);
  });

  it('selects a programme on a plain click and leaves modified clicks to the browser', () => {
    const fixture = render([item('a', 'La 1', 1, at(0), at(1), 'Cine')]);
    const selected: string[] = [];
    fixture.componentInstance.select.subscribe((i) => selected.push(i.id));
    const cell: HTMLAnchorElement = fixture.nativeElement.querySelector('.epg__prog');

    const plain = new MouseEvent('click', { button: 0, cancelable: true });
    const withCtrl = new MouseEvent('click', { button: 0, ctrlKey: true, cancelable: true });
    cell.dispatchEvent(plain);
    cell.dispatchEvent(withCtrl);

    expect(selected).toEqual(['a']);
    expect(plain.defaultPrevented).toBeTrue();
    expect(withCtrl.defaultPrevented).toBeFalse();
  });

  it('marks the programme after the one on air in the "next" view', () => {
    const fixture = render([
      item('live', 'La 1', 1, at(-0.5), at(0.5), 'Noticias'),
      item('after', 'La 1', 1, at(0.5), at(1.5), 'Cine'),
      item('later', 'La 1', 1, at(1.5), at(2.5), 'Cine'),
    ]);

    fixture.componentRef.setInput('view', 'next');
    fixture.detectChanges();
    const marked = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.epg__prog.next')).map((c) => c.getAttribute('data-cell'));

    expect(marked).toEqual(['0-1']);
  });

  it('dims programmes of other categories instead of hiding them', () => {
    const fixture = render(
      [
        item('a', 'La 1', 1, at(0), at(1), 'Cine'),
        item('b', 'La 1', 1, at(1), at(2), 'Noticias'),
      ],
      'Cine'
    );

    const cells: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.epg__prog'));

    expect(cells.map((c) => c.classList.contains('dim'))).toEqual([false, true]);
  });
});

function item(id: string, channel: string, sortOrder: number, start: string, end: string, category: string): TvReadItemDTO {
  return {
    id,
    channel: { id: channel, name: channel, icon: '', sortOrder, type: 'TDT', group: 'tdt' },
    program: {
      brandKey: id,
      title: `Programa ${id}`,
      normalizedTitle: `programa ${id}`,
      titleAliases: [],
      editorialCategory: category,
      genre: category,
      description: '',
      isResolvedTitle: true,
    },
    airing: { id, date: '20261109', start, end, durationMinutes: 60, liveNow: false, partOfDay: 'noche', timeSlotKey: 'night' },
    assets: { fallbackChain: [] },
    availability: { live: true, catchup: false, streaming: false },
    sourceProvenance: { schedule: [], metadata: [], assets: [] },
    timingContext: { liveNow: false },
    relevance: { score: 1, reason: 'test' },
  } as TvReadItemDTO;
}
