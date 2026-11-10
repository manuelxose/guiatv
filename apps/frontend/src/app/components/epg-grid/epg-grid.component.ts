import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  PLATFORM_ID,
  afterEveryRender,
  computed,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { interval } from 'rxjs';
import { TvReadItemDTO } from '../../api/models';
import { normalizeToCard, UnifiedCardData } from '../../utils/tv-normalizers';
import { formatMadridHM, madridMinutesSinceMidnight, minutesBetween } from '../../utils/madrid-time';

/** Safety cap on the rendered window so a bad data point can't blow up the grid width. */
const MAX_WINDOW_MINUTES = 30 * 60;
/** How far from "now" an item may sit and still help anchor the window (see computeWindow). */
const WINDOW_LOOKBACK_MS = 24 * 3_600_000;
const WINDOW_LOOKAHEAD_MS = 96 * 3_600_000;

interface EpgGridCell {
  item: TvReadItemDTO;
  card: UnifiedCardData;
  /** Minutes from the window start, and length in minutes: CSS turns them into px (--ppm). */
  start: number;
  span: number;
  startMs: number;
  endMs: number;
  timeLabel: string;
  ariaLabel: string;
}

interface EpgGridRow {
  channelId: string;
  channelName: string;
  channelIcon: string;
  channelPath: string;
  cells: EpgGridCell[];
}

interface EpgGridTick {
  at: number;
  label: string;
}

/**
 * Channel × time grid (docs/design/unified-shell.html "Parrilla EPG").
 *
 * Built to stay cheap with a full day of every channel:
 * - one scroll box; the time header and the channel column are CSS sticky (no scroll syncing);
 * - positions are minutes in CSS custom properties, so density (--ppm) is a media query, not JS;
 * - rows use content-visibility, so off-screen rows cost no layout or paint, yet every
 *   programme stays in the server HTML as a real link (virtual scrolling would drop them);
 * - programme cells are plain anchors (no RouterLink per cell): a click selects the programme
 *   (`select`), a modified/middle click opens its page natively.
 */
@Component({
  selector: 'app-epg-grid',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './epg-grid.component.html',
  styleUrl: './epg-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Any read gesture inside the grid (drag, wheel, arrows) is the reader taking over from the opening anchor.
  host: {
    '(pointerdown)': 'onReaderInput()',
    '(wheel)': 'onReaderInput()',
    '(keydown)': 'onReaderInput()',
  },
})
export class EpgGridComponent {
  readonly items = input.required<TvReadItemDTO[]>();

  /** What the page is about: 'now' opens on the current time, 'next' marks what follows, 'night' opens on prime time. */
  readonly view = input<'now' | 'next' | 'night'>('now');
  /** Programmes of other categories are dimmed, not hidden, so the grid keeps its shape. */
  readonly category = input('all');
  readonly selectedId = input<string | null>(null);
  readonly select = output<TvReadItemDTO>();

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  /** Anchor key (`view|window start`) whose position has already been applied to the scroll box. */
  private anchored = '';
  private readerMovedGrid = false;

  readonly now = signal(Date.now());
  /** Roving tabindex: only one cell is in the tab order, arrows move between cells. */
  readonly focused = signal<[number, number]>([0, 0]);

  private readonly window = computed(() => computeWindow(this.items()));
  readonly rows = computed(() => buildRows(this.items(), this.window()));
  readonly ticks = computed(() => buildTicks(this.window()));
  readonly span = computed(() => minutesBetween(this.window().start, this.window().end));
  readonly nowAt = computed<number | null>(() => {
    const { start, end } = this.window();
    const now = this.now();
    return now < start.getTime() || now > end.getTime() ? null : (now - start.getTime()) / 60_000;
  });
  readonly nowLabel = computed(() => formatMadridHM(new Date(this.now())));
  /** In the 'next' view, the programme after the one on air in each channel. */
  readonly nextIds = computed(() => {
    if (this.view() !== 'next') return new Set<string>();
    const now = this.now();
    return new Set(this.rows().flatMap((row) => row.cells.find((cell) => cell.startMs > now)?.item.id ?? []));
  });

  constructor() {
    if (this.isBrowser) {
      interval(30_000)
        .pipe(takeUntilDestroyed())
        .subscribe(() => this.now.set(Date.now()));
    }
    // Not an effect on `view`: the first render of a hydrated page runs before the browser has laid the scroll
    // box out, and the render that follows it rebuilds the cells; either can drop the anchor back to 0 after it
    // was applied. So it is re-applied after every render, and only dropped once the reader moves the grid
    // themselves — a new view (or another day's window) restores it.
    afterEveryRender(() => untracked(() => this.anchorGrid()));
  }

  /** Opens the grid where the view is about, unless the reader has moved it since the view last changed. */
  private anchorGrid(): void {
    const view = this.view();
    const anchor = `${view}|${this.window().start.getTime()}`;
    if (anchor !== this.anchored) {
      this.anchored = anchor;
      this.readerMovedGrid = false;
    }
    if (!this.readerMovedGrid) this.scrollToView(view);
  }

  /** The reader's own pan/keys win over the anchor until the view or the day changes. */
  onReaderInput(): void {
    this.readerMovedGrid = true;
  }

  /** Opens where the view is about: prime time for 'night' (or another day), otherwise the current time. */
  scrollToView(view: string): void {
    const el = this.scroller()?.nativeElement;
    if (!el) return;
    const ppm = parseFloat(getComputedStyle(el).getPropertyValue('--ppm')) || 4;
    // The last 21:00: a broadcast day's window can start on the previous evening.
    const primeTime = this.ticks().filter((tick) => tick.label === '21:00').pop()?.at;
    const at = (view === 'night' ? primeTime : this.nowAt()) ?? primeTime ?? 0;
    el.scrollLeft = Math.max(0, at - 30) * ppm;
  }

  onCellClick(event: MouseEvent, item: TvReadItemDTO): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    this.select.emit(item);
  }

  onCellKeydown(event: KeyboardEvent, rowIndex: number, colIndex: number): void {
    const rows = this.rows();
    let target: [number, number] | null = null;
    switch (event.key) {
      case 'ArrowRight':
        if (colIndex + 1 < rows[rowIndex].cells.length) target = [rowIndex, colIndex + 1];
        break;
      case 'ArrowLeft':
        if (colIndex > 0) target = [rowIndex, colIndex - 1];
        break;
      case 'ArrowDown':
      case 'ArrowUp': {
        const next = rowIndex + (event.key === 'ArrowDown' ? 1 : -1);
        if (rows[next]?.cells.length) target = [next, closestCell(rows[next].cells, rows[rowIndex].cells[colIndex].start)];
        break;
      }
      case ' ':
        // Anchors activate on Enter only; Space selects too, like a grid cell.
        event.preventDefault();
        (event.currentTarget as HTMLElement).click();
        return;
      default:
        return;
    }
    event.preventDefault();
    if (!target) return;
    this.focused.set(target);
    this.scroller()?.nativeElement.querySelector<HTMLElement>(`[data-cell="${target[0]}-${target[1]}"]`)?.focus();
  }
}

function closestCell(cells: EpgGridCell[], at: number): number {
  let best = 0;
  cells.forEach((cell, index) => {
    if (Math.abs(cell.start - at) < Math.abs(cells[best].start - at)) best = index;
  });
  return best;
}

interface TimeWindow {
  start: Date;
  end: Date;
}

/** Floors an instant to the start of its Europe/Madrid hour (e.g. 22:47 → 22:00). */
function floorToMadridHour(date: Date): Date {
  const minutes = madridMinutesSinceMidnight(date);
  const floored = new Date(date.getTime() - (minutes % 60) * 60_000);
  // madridMinutesSinceMidnight resolves whole seconds only; zero the milliseconds too.
  floored.setMilliseconds(0);
  return floored;
}

function computeWindow(items: TvReadItemDTO[]): TimeWindow {
  // One channel out of sync with the rest (stale or far-future airings) must not drag the whole grid's
  // window away from where everyone else's programmes actually are — only items plausibly near "now"
  // (covers every view: now/next/night for today, tomorrow and the day after) anchor the window; every
  // item still renders, since cells outside the resulting window are clamped at render time as before.
  const now = Date.now();
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const item of items) {
    const start = Date.parse(item.airing.start);
    const end = Date.parse(item.airing.end);
    if (Number.isFinite(start) && start >= now - WINDOW_LOOKBACK_MS && start <= now + WINDOW_LOOKAHEAD_MS) {
      minStart = Math.min(minStart, start);
    }
    if (Number.isFinite(end) && end >= now - WINDOW_LOOKBACK_MS && end <= now + WINDOW_LOOKAHEAD_MS) {
      maxEnd = Math.max(maxEnd, end);
    }
  }
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd) || maxEnd <= minStart) {
    const start = floorToMadridHour(new Date());
    return { start, end: new Date(start.getTime() + 6 * 3_600_000) };
  }
  const start = floorToMadridHour(new Date(minStart));
  const ceil = floorToMadridHour(new Date(maxEnd));
  const end = ceil.getTime() === maxEnd ? ceil : new Date(ceil.getTime() + 3_600_000);
  return { start, end: new Date(Math.min(end.getTime(), start.getTime() + MAX_WINDOW_MINUTES * 60_000)) };
}

function buildTicks({ start, end }: TimeWindow): EpgGridTick[] {
  const ticks: EpgGridTick[] = [];
  for (let at = 0; at < minutesBetween(start, end); at += 30) {
    ticks.push({ at, label: formatMadridHM(new Date(start.getTime() + at * 60_000)) });
  }
  return ticks;
}

function buildRows(allItems: TvReadItemDTO[], window: TimeWindow): EpgGridRow[] {
  const winStart = window.start.getTime();
  const winEnd = window.end.getTime();
  const rows = new Map<string, EpgGridRow & { order: number }>();

  for (const item of allItems) {
    const startMs = Date.parse(item.airing.start);
    const endMs = Date.parse(item.airing.end);
    const from = Math.max(startMs, winStart);
    const to = Math.min(endMs, winEnd);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || to <= from) continue;

    const card = normalizeToCard(item);
    let row = rows.get(item.channel.id);
    if (!row) {
      row = {
        channelId: item.channel.id,
        channelName: item.channel.name,
        channelIcon: item.assets.channelLogo?.url || item.channel.icon || '',
        channelPath: card.channelPath,
        order: Number(item.channel.sortOrder ?? 999),
        cells: [],
      };
      rows.set(item.channel.id, row);
    }
    const startLabel = formatMadridHM(new Date(startMs));
    row.cells.push({
      item,
      card,
      start: (from - winStart) / 60_000,
      span: (to - from) / 60_000,
      startMs,
      endMs,
      timeLabel: startLabel,
      ariaLabel: `${item.channel.name}: ${item.program.title}, ${startLabel} a ${formatMadridHM(new Date(endMs))}`,
    });
  }

  const sorted = [...rows.values()].sort((a, b) => a.order - b.order || a.channelName.localeCompare(b.channelName, 'es'));
  sorted.forEach((row) => row.cells.sort((a, b) => a.start - b.start));
  return sorted;
}
