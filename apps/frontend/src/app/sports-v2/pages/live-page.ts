import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { sv2Link } from '../sports-v2.paths';
import { SportsStore } from '../state/sports-store';
import { Sv2ErrorStateComponent, Sv2LoadingSkeletonComponent } from '../ui/states';
import { Sv2FilterBarComponent } from './filter-bar';
import { useMatchFilters } from './match-filters';
import { Sv2MatchListComponent } from './match-list';
import { Sv2MatchesNavComponent } from './matches-nav';
import { usePageTitle } from './page-title';

/** Live Scores: every match in play, grouped by competition, filterable, opening the Match Center. */
@Component({
  selector: 'app-sv2-live-page',
  standalone: true,
  imports: [Sv2MatchesNavComponent, Sv2FilterBarComponent, Sv2MatchListComponent, Sv2LoadingSkeletonComponent, Sv2ErrorStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-sv2-matches-nav />
    <header>
      <h1>En directo</h1>
      @if (store.loadState() === 'ready') {
        <p class="sub" aria-live="polite">{{ count() === 1 ? '1 partido en juego' : count() + ' partidos en juego' }}</p>
      }
    </header>
    @switch (store.loadState()) {
      @case ('error') { <app-sv2-error-state (retry)="store.retry()" /> }
      @case ('ready') {
        <app-sv2-filter-bar [competitions]="store.competitions()" [competition]="f.competition()" [followedOnly]="f.followedOnly()" [canFollow]="store.followedTeams().length > 0" (competitionChange)="f.setCompetition($event)" (followedChange)="f.setFollowedOnly($event)" (filtersReset)="f.reset()" />
        <app-sv2-match-list
          [matches]="shown()"
          [emptyTitle]="f.active() ? 'Ningún partido en directo con estos filtros' : 'Ahora mismo no hay partidos en juego'"
          [emptyHint]="f.active() ? 'Quita algún filtro para ver todos los partidos en juego.' : 'Consulta los próximos encuentros en el calendario.'"
          emptyActionLabel="Ver el calendario"
          [emptyActionLink]="fixtures"
        />
      }
      @default { <app-sv2-loading-skeleton [count]="4" /> }
    }
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-content: start; }
    h1 { margin: 0; font-size: var(--sv2-fs-xl); letter-spacing: -.02em; }
    .sub { margin: 4px 0 0; font-size: var(--sv2-fs-sm); color: var(--sv2-text-muted); }
  `,
})
export class Sv2LivePageComponent {
  protected readonly store = inject(SportsStore);
  protected readonly f = useMatchFilters();
  protected readonly fixtures = sv2Link('partidos');
  protected readonly shown = computed(() => this.f.apply(this.store.liveMatches()));
  protected readonly count = computed(() => this.shown().length);

  constructor() {
    usePageTitle(() => 'En directo');
  }
}
