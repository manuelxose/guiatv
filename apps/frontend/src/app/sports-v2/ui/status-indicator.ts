import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { STATUS_PRESENTATION } from '../domain/match-status';
import { MatchStatus } from '../domain/models';

@Component({
  selector: 'app-sv2-status-indicator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="dot" aria-hidden="true">{{ view().glyph }}</span><span>{{ view().label }}</span>`,
  styles: `
    :host { display: inline-flex; align-items: center; gap: 6px; font-size: var(--sv2-fs-xs); font-weight: 600; letter-spacing: .02em; color: var(--c); }
    :host(.live) { --c: var(--sv2-live); }
    :host(.finished) { --c: var(--sv2-finished); }
    :host(.scheduled) { --c: var(--sv2-scheduled); }
    :host(.postponed) { --c: var(--sv2-postponed); }
    .dot { font-size: .7em; line-height: 1; }
    :host(.live) .dot { animation: sv2-pulse 1.6s ease-in-out infinite; }
    @keyframes sv2-pulse { 50% { opacity: .35; } }
    @media (prefers-reduced-motion: reduce) { :host(.live) .dot { animation: none; } }
  `,
  host: { '[class]': 'status()' },
})
export class Sv2StatusIndicatorComponent {
  readonly status = input.required<MatchStatus>();
  protected readonly view = computed(() => STATUS_PRESENTATION[this.status()]);
}
