import { ChangeDetectionStrategy, Component, ElementRef, afterEveryRender, computed, inject, input, output } from '@angular/core';
import { addDays, dayLabel, isDayKey, longDay } from '../domain/calendar';
import { Sv2IconComponent } from '../ui/icon';

/** Day navigation: previous/next, a seven-day strip around the selection, "Hoy" and a date jump. */
@Component({
  selector: 'app-sv2-date-strip',
  standalone: true,
  imports: [Sv2IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="strip" role="group" aria-label="Elegir día">
      <button type="button" class="step" (click)="daySelect.emit(prev())" aria-label="Día anterior"><app-sv2-icon name="left" /></button>
      <ul>
        @for (d of days(); track d.key) {
          <li>
            <button type="button" [class.today]="d.key === today()" [attr.aria-pressed]="d.key === selected()" [attr.aria-label]="d.aria" (click)="daySelect.emit(d.key)">
              <span class="l">{{ d.label }}</span>
              <span class="dot" [class.on]="d.marked" aria-hidden="true"></span>
            </button>
          </li>
        }
      </ul>
      <button type="button" class="step" (click)="daySelect.emit(next())" aria-label="Día siguiente"><app-sv2-icon name="right" /></button>
    </div>
    <div class="tools">
      @if (selected() !== today()) {
        <button type="button" class="today-btn" (click)="daySelect.emit(today())">Volver a hoy</button>
      }
      <label>
        <span class="sr">Ir a una fecha</span>
        <input type="date" [value]="selected()" (change)="jump($event)" />
      </label>
    </div>
  `,
  styles: `
    :host { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-width: 0; }
    .strip { display: flex; align-items: center; gap: 4px; flex: 1 1 auto; min-width: 0; }
    ul { display: flex; flex: 1; gap: 4px; margin: 0; padding: 0; list-style: none; overflow-x: auto; scrollbar-width: none; }
    ul::-webkit-scrollbar { display: none; }
    li { flex: 1 0 auto; }
    ul button { display: grid; justify-items: center; align-content: center; gap: 4px; width: 100%; min-width: 64px; min-height: 52px; padding: 0 8px; border: 1px solid transparent; border-radius: var(--sv2-r-md); background: var(--sv2-surface-2); color: var(--sv2-text-muted); font: inherit; font-size: var(--sv2-fs-sm); font-weight: 600; cursor: pointer; text-transform: capitalize; white-space: nowrap; }
    ul button:hover { color: var(--sv2-text); background: var(--sv2-surface-3); }
    ul button[aria-pressed='true'] { background: var(--sv2-text); color: var(--sv2-bg); }
    ul button.today:not([aria-pressed='true']) { border-color: var(--sv2-accent); color: var(--sv2-text); }
    .dot { width: 5px; height: 5px; border-radius: 50%; background: transparent; }
    .dot.on { background: var(--sv2-accent); }
    .step { display: grid; place-items: center; flex: none; width: 40px; height: 52px; border: 0; border-radius: var(--sv2-r-md); background: var(--sv2-surface-2); color: var(--sv2-text); cursor: pointer; }
    .step:hover { background: var(--sv2-surface-3); }
    .tools { display: flex; align-items: center; gap: 8px; }
    .today-btn { min-height: 36px; padding: 0 14px; border: 1px solid var(--sv2-border-strong); border-radius: 999px; background: transparent; color: var(--sv2-text); font: inherit; font-size: var(--sv2-fs-sm); font-weight: 600; cursor: pointer; }
    input { min-height: 36px; padding: 0 10px; border: 1px solid var(--sv2-border); border-radius: var(--sv2-r-sm); background: var(--sv2-surface-2); color: var(--sv2-text); font: inherit; font-size: var(--sv2-fs-sm); color-scheme: dark; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
  `,
})
export class Sv2DateStripComponent {
  readonly selected = input.required<string>();
  readonly today = input.required<string>();
  /** Days that have at least one match (shown with a dot). */
  readonly markedDays = input<readonly string[]>([]);
  readonly daySelect = output<string>();

  protected readonly prev = computed(() => addDays(this.selected(), -1));
  protected readonly next = computed(() => addDays(this.selected(), 1));
  protected readonly days = computed(() => {
    const marked = new Set(this.markedDays());
    return Array.from({ length: 7 }, (_, i) => addDays(this.selected(), i - 3)).map((key) => ({
      key,
      label: dayLabel(key, this.today()),
      marked: marked.has(key),
      aria: `${longDay(key)}${marked.has(key) ? ', con partidos' : ', sin partidos'}`,
    }));
  });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // The selected chip must be visible on narrow screens.
    afterEveryRender(() => this.host.nativeElement.querySelector<HTMLElement>('ul button[aria-pressed="true"]')?.scrollIntoView?.({ inline: 'center', block: 'nearest' }));
  }

  protected jump(ev: Event): void {
    const value = (ev.target as HTMLInputElement).value;
    if (isDayKey(value)) this.daySelect.emit(value);
  }
}
