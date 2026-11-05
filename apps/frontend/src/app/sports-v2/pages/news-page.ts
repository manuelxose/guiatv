import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SportsStore } from '../state/sports-store';
import { Sv2ArticleCardComponent } from '../ui/article-card';
import { Sv2EmptyStateComponent, Sv2ErrorStateComponent, Sv2LoadingSkeletonComponent } from '../ui/states';
import { Sv2FilterBarComponent } from './filter-bar';
import { useMatchFilters } from './match-filters';
import { usePageTitle } from './page-title';

/** News homepage: one featured lead, then the rest as editorial cards. Filters live in the URL. */
@Component({
  selector: 'app-sv2-news-page',
  standalone: true,
  imports: [Sv2ArticleCardComponent, Sv2FilterBarComponent, Sv2EmptyStateComponent, Sv2ErrorStateComponent, Sv2LoadingSkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Noticias de fútbol</h1>
    @switch (store.loadState()) {
      @case ('error') { <app-sv2-error-state (retry)="store.retry()" /> }
      @case ('ready') {
        <app-sv2-filter-bar [competitions]="store.competitions()" [competition]="f.competition()" [followedOnly]="f.followedOnly()" [canFollow]="store.followedTeams().length > 0" (competitionChange)="f.setCompetition($event)" (followedChange)="f.setFollowedOnly($event)" (filtersReset)="f.reset()" />
        @if (lead(); as l) {
          <app-sv2-article-card [item]="l" variant="hero" />
        }
        @if (rest().length) {
          <div class="grid">@for (n of rest(); track n.slug) { <app-sv2-article-card [item]="n" /> }</div>
        } @else if (!lead()) {
          <app-sv2-empty-state [title]="f.active() ? 'Sin noticias con estos filtros' : 'Todavía no hay noticias'" [hint]="f.active() ? 'Quita algún filtro para ver más.' : 'Vuelve en un rato.'" />
        }
      }
      @default { <app-sv2-loading-skeleton [count]="3" /> }
    }
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; align-content: start; }
    h1 { margin: 0; font-size: var(--sv2-fs-xl); letter-spacing: -.02em; }
    .grid { display: grid; gap: 20px 16px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  `,
})
export class Sv2NewsPageComponent {
  protected readonly store = inject(SportsStore);
  protected readonly f = useMatchFilters();
  private readonly filtered = computed(() => {
    const comp = this.f.competition();
    const mine = this.f.followedOnly();
    const teams = this.store.followedTeamSlugs();
    return this.store.news().filter((n) => (!comp || n.competitionSlug === comp) && (!mine || !!n.teamSlugs?.some((t) => teams.includes(t))));
  });
  protected readonly lead = computed(() => this.filtered().find((n) => n.featured) ?? this.filtered()[0]);
  protected readonly rest = computed(() => this.filtered().filter((n) => n !== this.lead()));

  constructor() {
    usePageTitle(() => 'Noticias');
  }
}
