import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output } from '@angular/core';

export interface TabItem {
  readonly id: string;
  readonly label: string;
}

/**
 * WAI-ARIA tablist (roving tabindex, arrows, Home/End). The parent renders the panel:
 * `<div role="tabpanel" [id]="prefix + '-panel'" [attr.aria-labelledby]="prefix + '-tab-' + selected">`.
 */
@Component({
  selector: 'app-sv2-tabs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="list" role="tablist" [attr.aria-label]="label()">
      @for (t of tabs(); track t.id) {
        <button
          type="button"
          role="tab"
          [id]="prefix() + '-tab-' + t.id"
          [attr.aria-selected]="selected() === t.id"
          [attr.aria-controls]="prefix() + '-panel'"
          [attr.tabindex]="selected() === t.id ? 0 : -1"
          (click)="tabSelect.emit(t.id)"
          (keydown)="onKey($event)"
        >{{ t.label }}</button>
      }
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .list { display: flex; gap: 4px; overflow-x: auto; padding: 4px; border-radius: 999px; background: var(--sv2-surface-2); scrollbar-width: none; }
    .list::-webkit-scrollbar { display: none; }
    :host(.fill) .list { flex-wrap: wrap; border-radius: var(--sv2-r-lg); }
    :host(.fill) .list button { flex: 1 1 auto; }
    button { flex: none; min-height: 36px; padding: 0 14px; border: 0; border-radius: 999px; background: transparent; color: var(--sv2-text-muted); font: inherit; font-size: var(--sv2-fs-sm); font-weight: 600; white-space: nowrap; cursor: pointer; transition: background var(--sv2-dur) var(--sv2-ease); }
    button:hover { color: var(--sv2-text); }
    button[aria-selected='true'] { background: var(--sv2-text); color: var(--sv2-bg); }
    button:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { button { transition: none; } }
  `,
  host: { '[class.fill]': 'fill()' },
})
export class Sv2TabsComponent {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly tabs = input.required<readonly TabItem[]>();
  readonly selected = input.required<string>();
  readonly label = input.required<string>();
  readonly prefix = input('sv2');
  readonly fill = input(false);
  readonly tabSelect = output<string>();

  protected onKey(ev: KeyboardEvent): void {
    const tabs = this.tabs();
    const i = tabs.findIndex((t) => t.id === this.selected());
    const next = ev.key === 'ArrowRight' ? i + 1 : ev.key === 'ArrowLeft' ? i - 1 : ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 : null;
    if (next == null) return;
    ev.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length];
    this.tabSelect.emit(target.id);
    queueMicrotask(() => this.el.nativeElement.querySelector<HTMLElement>(`#${this.prefix()}-tab-${target.id}`)?.focus());
  }
}
