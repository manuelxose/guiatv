import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { shortDay, zoneDescription } from '../domain/calendar';
import { SportsStore } from '../state/sports-store';
import { Sv2ErrorStateComponent, Sv2LoadingSkeletonComponent } from '../ui/states';
import { Sv2DateStripComponent } from './date-strip';
import { Sv2FilterBarComponent } from './filter-bar';
import { useMatchFilters } from './match-filters';
import { Sv2MatchListComponent } from './match-list';
import { Sv2MatchesNavComponent } from './matches-nav';
import { usePageTitle } from './page-title';

/** Fixtures (day navigation) and Results (finished matches by day), both filterable via the URL. */
@Component({
  selector: 'app-sv2-fixtures-page',
  standalone: true,
  imports: [Sv2MatchesNavComponent, Sv2FilterBarComponent, Sv2DateStripComponent, Sv2MatchListComponent, Sv2LoadingSkeletonComponent, Sv2ErrorStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-sv2-matches-nav />
    <header>
      <h1>{{ results ? 'Resultados' : 'Partidos' }}</h1>
      <p class="sub">Horarios en {{ tz }}.</p>
    </header>
    @switch (store.loadState()) {
      @case ('error') { <app-sv2-error-state (retry)="store.retry()" /> }
      @case ('ready') {
        @if (!results) {
          <app-sv2-date-strip [selected]="day()" [today]="store.today()" [markedDays]="store.matchDays()" (daySelect)="f.setDay($event === store.today() ? null : $event)" />
        }
        <app-sv2-filter-bar [competitions]="store.competitions()" [competition]="f.competition()" [followedOnly]="f.followedOnly()" [canFollow]="store.followedTeams().length > 0" (competitionChange)="f.setCompetition($event)" (followedChange)="f.setFollowedOnly($event)" (filtersReset)="f.reset()" />
        <app-sv2-match-list
          [matches]="shown()"
          [grouping]="results ? 'day' : 'competition'"
          [emptyTitle]="emptyTitle()"
          [emptyHint]="f.active() ? 'Quita algún filtro para ver más partidos.' : results ? '' : 'Prueba con otro día.'"
        />
        @if (!results && !shown().length && nextDay(); as next) {
          <button type="button" class="jump" (click)="f.setDay(next)">Ir al siguiente día con partidos ({{ label(next) }})</button>
        }
      }
      @default { <app-sv2-loading-skeleton [count]="4" /> }
    }
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-content: start; }
    h1 { margin: 0; font-size: var(--sv2-fs-xl); letter-spacing: -.02em; }
    .sub { margin: 4px 0 0; font-size: var(--sv2-fs-sm); color: var(--sv2-text-muted); }
    .jump { justify-self: center; min-height: 40px; padding: 0 20px; border: 1px solid var(--sv2-border-strong); border-radius: 999px; background: transparent; color: var(--sv2-text); font: inherit; font-size: var(--sv2-fs-sm); font-weight: 600; cursor: pointer; }
    .jump:hover { background: var(--sv2-surface-3); }
    .jump:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
  `,
})
export class Sv2FixturesPageComponent {
  protected readonly store = inject(SportsStore);
  protected readonly f = useMatchFilters();
  protected readonly results = inject(ActivatedRoute).snapshot.data['mode'] === 'results';
  protected readonly tz = zoneDescription();
  protected readonly day = computed(() => this.f.day() ?? this.store.today());
  protected readonly shown = computed(() => this.f.apply(this.results ? this.store.finishedMatches() : this.store.matchesOnDay(this.day())));
  protected readonly nextDay = computed(() => this.store.matchDays().find((d) => d > this.day()) ?? null);
  protected readonly emptyTitle = computed(() => (this.results ? 'Aún no hay resultados' : this.f.active() ? 'Sin partidos con estos filtros este día' : 'No hay partidos este día'));
  protected readonly label = shortDay;

  constructor() {
    usePageTitle(() => (this.results ? 'Resultados' : 'Partidos'), this.results ? 'Resultados de los últimos partidos de fútbol por día y competición.' : 'Calendario de partidos de fútbol por día, con horarios y dónde verlos cuando hay emisión confirmada.');
    effect(() => {
      const d = this.day();
      if (!this.results && this.store.loadState() === 'ready') untracked(() => void this.store.ensureDay(d));
    });
  }
}
