import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Match } from '../domain/models';
import { SportsStore } from '../state/sports-store';
import { Sv2MatchCardComponent } from '../ui/match-card';
import { Sv2EmptyStateComponent } from '../ui/states';

/** Responsive grid (or horizontal snap row) of match cards wired to the store. */
@Component({
  selector: 'app-sv2-match-grid',
  standalone: true,
  imports: [Sv2MatchCardComponent, Sv2EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (matches().length) {
      <ul [class.row]="layout() === 'row'">
        @for (m of matches(); track m.slug) {
          @if (store.team(m.homeSlug); as home) {
            @if (store.team(m.awaySlug); as away) {
              <li>
                <app-sv2-match-card
                  [match]="m"
                  [home]="home"
                  [away]="away"
                  [competitionName]="store.competition(m.competitionSlug)?.name ?? ''"
                  [selected]="store.selectedMatchSlug() === m.slug"
                  [tracked]="store.isTracked(m.slug)"
                  (matchSelect)="store.selectMatch($event, true)"
                  (trackToggle)="store.toggleTracked($event)"
                />
              </li>
            }
          }
        }
      </ul>
    } @else {
      <app-sv2-empty-state [title]="emptyTitle()" [hint]="emptyHint()" />
    }
  `,
  styles: `
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
    ul.row { display: flex; overflow-x: auto; scroll-snap-type: x proximity; padding-bottom: 8px; }
    ul.row li { flex: 0 0 min(300px, 82%); scroll-snap-align: start; }
  `,
})
export class Sv2MatchGridComponent {
  protected readonly store = inject(SportsStore);
  readonly matches = input.required<readonly Match[]>();
  readonly layout = input<'grid' | 'row'>('grid');
  readonly emptyTitle = input('No hay partidos');
  readonly emptyHint = input('');
}
