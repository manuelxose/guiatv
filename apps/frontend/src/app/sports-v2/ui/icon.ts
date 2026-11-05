import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Original 24px stroke icon set (hand-drawn paths, no icon-font dependency). */
const PATHS = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  live: 'M12 12h.01M8.5 8.5a5 5 0 000 7M15.5 8.5a5 5 0 010 7M5.6 5.6a9 9 0 000 12.8M18.4 5.6a9 9 0 010 12.8',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  results: 'M12 21a9 9 0 100-18 9 9 0 000 18zM8 12l3 3 5-6',
  trophy: 'M8 4h8v5a4 4 0 01-8 0zM8 6H4v2a3 3 0 003 3M16 6h4v2a3 3 0 01-3 3M12 13v4M8 21h8M10 17h4',
  news: 'M5 4h11v16H5zM16 8h3v10a2 2 0 01-2 2M8 8h5M8 12h5M8 16h3',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  bell: 'M6 16v-5a6 6 0 1112 0v5l2 2H4zM10 21h4',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12M18 6L6 18',
  track: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8z',
  tv: 'M3 6h18v12H3zM8 21h8M12 18v3',
  panel: 'M4 4h16v16H4zM15 4v16',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 13l4 4 10-10',
  expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
} as const;

export type IconName = keyof typeof PATHS;

@Component({
  selector: 'app-sv2-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path [attr.d]="path()" /></svg>`,
  styles: `
    :host { display: inline-flex; width: var(--sv2-icon, 20px); height: var(--sv2-icon, 20px); flex: none; }
    svg { width: 100%; height: 100%; }
  `,
})
export class Sv2IconComponent {
  readonly name = input.required<IconName>();
  protected readonly path = computed(() => PATHS[this.name()]);
}
