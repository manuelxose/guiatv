import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatchStatus } from '../domain/models';

@Component({
  selector: 'app-sv2-score-display',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hasScore()) {
      <span class="n">{{ home() }}</span><span class="sep" aria-hidden="true">-</span><span class="n">{{ away() }}</span>
    } @else {
      <span class="vs">vs</span>
    }
  `,
  styles: `
    :host { display: inline-flex; align-items: baseline; gap: .35em; font-weight: 700; font-variant-numeric: tabular-nums; font-size: var(--sv2-score-size, var(--sv2-fs-lg)); line-height: 1; }
    :host(.dim) .n { color: var(--sv2-text-muted); }
    .n { display: inline-block; min-width: 1.2ch; text-align: center; }
    .sep { color: var(--sv2-text-faint); }
    .vs { font-size: var(--sv2-fs-sm); font-weight: 600; color: var(--sv2-text-faint); }
  `,
  host: { '[class.dim]': 'status() !== "live"' },
})
export class Sv2ScoreDisplayComponent {
  readonly home = input<number | undefined>();
  readonly away = input<number | undefined>();
  readonly status = input.required<MatchStatus>();
  protected hasScore(): boolean {
    return this.home() != null && this.away() != null && (this.status() === 'live' || this.status() === 'finished');
  }
}
