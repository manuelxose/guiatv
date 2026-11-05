import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { sv2Link } from '../sports-v2.paths';
import { SportsStore } from '../state/sports-store';
import { Sv2ArticleCardComponent } from '../ui/article-card';
import { Sv2CompetitionCardComponent } from '../ui/competition-card';
import { Sv2FollowButtonComponent } from '../ui/follow-button';
import { Sv2SectionHeaderComponent } from '../ui/section-header';
import { Sv2EmptyStateComponent, Sv2ErrorStateComponent, Sv2LoadingSkeletonComponent } from '../ui/states';
import { Sv2TeamIdentityComponent } from '../ui/team-identity';
import { Sv2MatchGridComponent } from './match-grid';
import { Sv2MatchListComponent } from './match-list';
import { usePageTitle } from './page-title';

/** Football home: live now, today, my teams, favourites, what is coming, recent results, news. */
@Component({
  selector: 'app-sv2-home-page',
  standalone: true,
  imports: [RouterLink, Sv2SectionHeaderComponent, Sv2MatchGridComponent, Sv2MatchListComponent, Sv2CompetitionCardComponent, Sv2ArticleCardComponent, Sv2FollowButtonComponent, Sv2TeamIdentityComponent, Sv2EmptyStateComponent, Sv2LoadingSkeletonComponent, Sv2ErrorStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="sr">Fútbol</h1>
    @switch (store.loadState()) {
      @case ('error') { <app-sv2-error-state (retry)="store.retry()" /> }
      @case ('ready') {
        <section>
          <app-sv2-section-header title="En vivo ahora" linkLabel="Ver todos" [link]="live" />
          <app-sv2-match-grid [matches]="store.featuredLive()" layout="row" emptyTitle="Ahora mismo no hay partidos en juego" emptyHint="Mira los partidos de hoy y los próximos encuentros más abajo." />
        </section>

        <section>
          <app-sv2-section-header title="Partidos de hoy" linkLabel="Calendario" [link]="fixtures" />
          <app-sv2-match-list [matches]="store.todayMatches()" [headingLevel]="3" emptyTitle="Hoy no hay partidos" emptyHint="Consulta el calendario para ver los próximos días." />
        </section>

        <section>
          <app-sv2-section-header title="Mis equipos" linkLabel="Mi fútbol" [link]="following" />
          @if (store.followedTeams().length) {
            <ul class="chips">
              @for (t of store.followedTeams(); track t.slug) {
                <li><a [routerLink]="team(t.slug)"><app-sv2-team-identity [team]="t" /></a></li>
              }
            </ul>
            <app-sv2-match-list [matches]="myNext()" grouping="day" [headingLevel]="3" emptyTitle="Tus equipos no tienen partidos próximos" />
          } @else {
            <app-sv2-empty-state title="Sigue a tus equipos" hint="Verás aquí sus partidos, resultados y noticias. Se guardan en este dispositivo, sin crear cuenta." />
            @if (store.suggestedTeams().length) {
              <ul class="suggest" aria-label="Equipos sugeridos">
                @for (t of store.suggestedTeams(); track t.slug) {
                  <li>
                    <a [routerLink]="team(t.slug)"><app-sv2-team-identity [team]="t" /></a>
                    <app-sv2-follow-button [following]="false" [subject]="t.name" (followToggle)="store.toggleTeam(t.slug)" />
                  </li>
                }
              </ul>
            }
          }
        </section>

        <section>
          <app-sv2-section-header [title]="store.favoriteCompetitions().length ? 'Competiciones favoritas' : 'Competiciones'" linkLabel="Ver todas" [link]="competitions" />
          @if (store.favoriteCompetitions().length) {
            <div class="comps">@for (c of store.favoriteCompetitions(); track c.slug) { <app-sv2-competition-card [competition]="c" /> }</div>
          } @else {
            <app-sv2-empty-state title="Aún no tienes competiciones favoritas" hint="Márcalas desde su página y las tendrás siempre a mano." actionLabel="Explorar competiciones" [actionLink]="competitions" />
          }
        </section>

        <section>
          <app-sv2-section-header title="Próximos partidos importantes" linkLabel="Calendario" [link]="fixtures" />
          <app-sv2-match-list [matches]="store.importantUpcoming().slice(0, 5)" grouping="day" [headingLevel]="3" emptyTitle="Sin partidos programados" />
        </section>

        <section>
          <app-sv2-section-header title="Resultados recientes" linkLabel="Todos los resultados" [link]="results" />
          <app-sv2-match-list [matches]="store.recentResults().slice(0, 5)" grouping="day" [headingLevel]="3" emptyTitle="Aún no hay resultados" />
        </section>

        <section>
          <app-sv2-section-header [title]="store.personalizedNews().length ? 'Noticias para ti' : 'Noticias destacadas'" linkLabel="Más noticias" [link]="news" />
          @if (articles().length) {
            <div class="news">@for (n of articles(); track n.slug) { <app-sv2-article-card [item]="n" /> }</div>
          } @else {
            <app-sv2-empty-state title="Todavía no hay noticias" />
          }
        </section>
      }
      @default { <app-sv2-loading-skeleton [count]="4" /> }
    }
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(0, 1fr); gap: 28px; align-content: start; }
    section { min-width: 0; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    .comps { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
    .news { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
    ul { list-style: none; margin: 0; padding: 0; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .chips a { display: flex; align-items: center; min-height: 48px; padding: 0 16px 0 8px; border-radius: 999px; background: var(--sv2-surface-2); color: var(--sv2-text); text-decoration: none; }
    .chips a:hover { background: var(--sv2-surface-3); }
    .chips a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    .suggest { display: grid; gap: 8px; margin-top: 12px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
    .suggest li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border-radius: var(--sv2-r-md); background: var(--sv2-surface-2); border: 1px solid var(--sv2-border); }
    .suggest a { display: flex; min-width: 0; color: var(--sv2-text); text-decoration: none; }
    .suggest a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; border-radius: 6px; }
  `,
})
export class Sv2HomePageComponent {
  protected readonly store = inject(SportsStore);
  protected readonly live = sv2Link('en-directo');
  protected readonly fixtures = sv2Link('partidos');
  protected readonly results = sv2Link('resultados');
  protected readonly competitions = sv2Link('competiciones');
  protected readonly news = sv2Link('noticias');
  protected readonly following = sv2Link('siguiendo');

  protected readonly myNext = computed(() => this.store.myMatches().filter((m) => m.status !== 'finished').slice(0, 4));
  protected readonly articles = computed(() => (this.store.personalizedNews().length ? this.store.personalizedNews() : this.store.news()).slice(0, 3));

  constructor() {
    usePageTitle(() => 'Inicio');
  }

  protected team(slug: string): string[] {
    return sv2Link('equipos', slug);
  }
}
