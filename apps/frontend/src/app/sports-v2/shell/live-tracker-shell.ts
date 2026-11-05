import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { matchClockLabel } from '../domain/match-status';
import { SportsStore } from '../state/sports-store';
import { Sv2IconComponent } from '../ui/icon';
import { Sv2ScoreDisplayComponent } from '../ui/score-display';
import { Sv2StatusIndicatorComponent } from '../ui/status-indicator';

/** Bottom tracker. Renders nothing until the user tracks a match; collapses to a pill. */
@Component({
  selector: 'app-sv2-live-tracker-shell',
  standalone: true,
  imports: [Sv2IconComponent, Sv2ScoreDisplayComponent, Sv2StatusIndicatorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.trackedMatches().length) {
      <section class="tracker" [class.min]="store.trackerMinimized()" aria-label="Seguimiento en directo">
        <button type="button" class="toggle" (click)="store.trackerMinimized.set(!store.trackerMinimized())" [attr.aria-expanded]="!store.trackerMinimized()">
          <app-sv2-icon name="live" />
          <span>Siguiendo {{ store.trackedMatches().length }} {{ store.trackedMatches().length === 1 ? 'partido' : 'partidos' }}</span>
        </button>
        @if (!store.trackerMinimized()) {
          <ul>
            @for (m of store.trackedMatches(); track m.slug) {
              <li>
                <button type="button" class="item" (click)="store.openMatch(m.slug)" [attr.aria-label]="'Abrir ' + label(m.homeSlug) + ' contra ' + label(m.awaySlug) + ' en Match Center'">
                  <span class="t">{{ short(m.homeSlug) }}</span>
                  <app-sv2-score-display [home]="m.homeScore" [away]="m.awayScore" [status]="m.status" />
                  <span class="t">{{ short(m.awaySlug) }}</span>
                  <app-sv2-status-indicator [status]="m.status" />
                  <span class="min">{{ clock(m.status, m.minute, m.kickoff) }}</span>
                </button>
                <button type="button" class="x" (click)="store.toggleTracked(m.slug)" [attr.aria-label]="'Dejar de seguir ' + label(m.homeSlug) + ' contra ' + label(m.awaySlug)"><app-sv2-icon name="close" /></button>
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
  styles: `
    :host { display: block; }
    .tracker { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 8px 12px; border-radius: var(--sv2-r-lg); background: var(--sv2-surface-2); border: 1px solid var(--sv2-border-strong); box-shadow: var(--sv2-shadow); }
    .tracker.min { width: fit-content; }
    ul { display: flex; gap: 8px; margin: 0; padding: 0; list-style: none; overflow-x: auto; flex: 1; }
    li { display: flex; align-items: center; flex: none; border-radius: 999px; background: var(--sv2-surface-3); }
    .item { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 0 8px 0 14px; border: 0; background: transparent; color: var(--sv2-text); font: inherit; font-size: var(--sv2-fs-sm); cursor: pointer; border-radius: 999px; }
    .t { font-weight: 700; } .min { color: var(--sv2-text-muted); font-size: var(--sv2-fs-xs); font-variant-numeric: tabular-nums; }
    .toggle { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; color: var(--sv2-text); font: inherit; font-size: var(--sv2-fs-sm); font-weight: 600; cursor: pointer; flex: none; }
    .x { display: grid; place-items: center; width: 32px; height: 32px; margin-right: 4px; border: 0; border-radius: 50%; background: transparent; color: var(--sv2-text-muted); cursor: pointer; --sv2-icon: 16px; }
    .x:hover { color: var(--sv2-text); }
    button:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    @media (max-width: 767px) { .toggle span { display: none; } .toggle { padding: 0 8px; } }
  `,
})
export class Sv2LiveTrackerShellComponent {
  protected readonly store = inject(SportsStore);
  protected readonly clock = matchClockLabel;
  protected short(slug: string): string {
    return this.store.team(slug)?.shortName ?? '';
  }
  protected label(slug: string): string {
    return this.store.team(slug)?.name ?? '';
  }
}
