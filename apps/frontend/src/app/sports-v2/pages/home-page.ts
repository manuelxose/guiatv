import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { sv2Link } from '../sports-v2.paths';
import { SportsStore } from '../state/sports-store';
import { Sv2CompetitionCardComponent } from '../ui/competition-card';
import { Sv2SectionHeaderComponent } from '../ui/section-header';
import { Sv2ErrorStateComponent, Sv2LoadingSkeletonComponent } from '../ui/states';
import { Sv2MatchGridComponent } from './match-grid';
import { Sv2NewsListComponent } from './news-list';

@Component({
  selector: 'app-sv2-home-page',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, Sv2SectionHeaderComponent, Sv2MatchGridComponent, Sv2CompetitionCardComponent, Sv2NewsListComponent, Sv2LoadingSkeletonComponent, Sv2ErrorStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="chips" aria-label="Filtros de inicio">
      <a [routerLink]="home" routerLinkActive="on" [routerLinkActiveOptions]="{ exact: true }" ariaCurrentWhenActive="page">Para ti</a>
      <a [routerLink]="live" routerLinkActive="on" ariaCurrentWhenActive="page">En vivo</a>
      <a [routerLink]="news" routerLinkActive="on" ariaCurrentWhenActive="page">Noticias</a>
    </nav>

    @switch (store.loadState()) {
      @case ('error') { <app-sv2-error-state (retry)="store.retry()" /> }
      @case ('ready') {
        <section>
          <app-sv2-section-header title="En vivo ahora" linkLabel="Ver todos" [link]="live" />
          <app-sv2-match-grid [matches]="store.liveMatches()" layout="row" emptyTitle="Ahora mismo no hay partidos en juego" emptyHint="Mira los próximos encuentros más abajo." />
        </section>
        <section>
          <app-sv2-section-header title="Próximos partidos" linkLabel="Calendario" [link]="fixtures" />
          <app-sv2-match-grid [matches]="store.upcomingMatches()" layout="row" emptyTitle="Sin partidos programados" />
        </section>
        <section>
          <app-sv2-section-header title="Tus competiciones" linkLabel="Ver todas" [link]="competitions" />
          <div class="comps">
            @for (c of store.competitions(); track c.slug) { <app-sv2-competition-card [competition]="c" /> }
          </div>
        </section>
        <section>
          <app-sv2-section-header title="Resultados recientes" linkLabel="Todos los resultados" [link]="results" />
          <app-sv2-match-grid [matches]="store.finishedMatches()" layout="row" emptyTitle="Aún no hay resultados" />
        </section>
        <section>
          <app-sv2-section-header title="Noticias para ti" linkLabel="Más noticias" [link]="news" />
          <app-sv2-news-list [items]="store.news()" />
        </section>
      }
      @default { <app-sv2-loading-skeleton [count]="4" /> }
    }
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(0, 1fr); gap: 28px; align-content: start; }
    section { min-width: 0; }
    .chips { display: flex; gap: 8px; }
    .chips a { display: inline-flex; align-items: center; min-height: 36px; padding: 0 16px; border-radius: 999px; background: var(--sv2-surface-2); color: var(--sv2-text); font-size: var(--sv2-fs-sm); font-weight: 600; text-decoration: none; }
    .chips a:hover { background: var(--sv2-surface-3); }
    .chips a.on { background: var(--sv2-text); color: var(--sv2-bg); }
    .chips a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    .comps { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  `,
})
export class Sv2HomePageComponent {
  protected readonly store = inject(SportsStore);
  protected readonly home = sv2Link();
  protected readonly live = sv2Link('en-directo');
  protected readonly fixtures = sv2Link('partidos');
  protected readonly results = sv2Link('resultados');
  protected readonly competitions = sv2Link('competiciones');
  protected readonly news = sv2Link('noticias');
}
