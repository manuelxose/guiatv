import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { Match } from '../domain/models';
import { sv2Link } from '../sports-v2.paths';
import { SportsStore } from '../state/sports-store';
import { Sv2CompetitionCardComponent } from '../ui/competition-card';
import { Sv2SectionHeaderComponent } from '../ui/section-header';
import { Sv2ErrorStateComponent, Sv2LoadingSkeletonComponent } from '../ui/states';
import { Sv2TeamIdentityComponent } from '../ui/team-identity';
import { Sv2MatchGridComponent } from './match-grid';
import { Sv2NewsListComponent } from './news-list';

export type SectionView = 'live' | 'fixtures' | 'results' | 'competitions' | 'news' | 'following' | 'competition' | 'team' | 'match';

/** One data-driven page for every listing route; the route's `data.view` picks the content. */
@Component({
  selector: 'app-sv2-section-page',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, Sv2SectionHeaderComponent, Sv2MatchGridComponent, Sv2CompetitionCardComponent, Sv2NewsListComponent, Sv2LoadingSkeletonComponent, Sv2ErrorStateComponent, Sv2TeamIdentityComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isMatchList()) {
      <nav class="tabs" aria-label="Vista de partidos">
        <a [routerLink]="link('en-directo')" routerLinkActive="on" ariaCurrentWhenActive="page">En vivo</a>
        <a [routerLink]="link('partidos')" routerLinkActive="on" ariaCurrentWhenActive="page">Próximos</a>
        <a [routerLink]="link('resultados')" routerLinkActive="on" ariaCurrentWhenActive="page">Resultados</a>
      </nav>
    }

    @switch (store.loadState()) {
      @case ('error') { <app-sv2-error-state (retry)="store.retry()" /> }
      @case ('ready') {
        <h1>{{ title() }}</h1>
        @switch (view) {
          @case ('live') { <app-sv2-match-grid [matches]="store.liveMatches()" emptyTitle="No hay partidos en directo" emptyHint="Vuelve cuando empiece la próxima jornada." /> }
          @case ('fixtures') { <app-sv2-match-grid [matches]="store.upcomingMatches()" emptyTitle="Sin partidos programados" /> }
          @case ('results') { <app-sv2-match-grid [matches]="store.finishedMatches()" emptyTitle="Aún no hay resultados" /> }
          @case ('competitions') {
            <div class="comps">@for (c of store.competitions(); track c.slug) { <app-sv2-competition-card [competition]="c" /> }</div>
          }
          @case ('news') { <app-sv2-news-list [items]="store.news()" /> }
          @case ('following') {
            <app-sv2-section-header title="Equipos que sigues" />
            <ul class="teams">
              @for (t of store.followedTeams(); track t.slug) {
                <li><a [routerLink]="link('equipos', t.slug)"><app-sv2-team-identity [team]="t" /></a></li>
              }
            </ul>
            <app-sv2-section-header title="Competiciones favoritas" />
            <div class="comps">@for (c of store.favoriteCompetitions(); track c.slug) { <app-sv2-competition-card [competition]="c" /> }</div>
          }
          @case ('competition') { <app-sv2-match-grid [matches]="entityMatches()" emptyTitle="Esta competición no tiene partidos" /> }
          @case ('team') { <app-sv2-match-grid [matches]="entityMatches()" emptyTitle="Este equipo no tiene partidos" /> }
          @case ('match') { <app-sv2-match-grid [matches]="entityMatches()" emptyTitle="Partido no encontrado" emptyHint="Revisa el enlace o vuelve al calendario." /> }
        }
      }
      @default { <app-sv2-loading-skeleton [count]="4" /> }
    }
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; align-content: start; }
    h1 { margin: 0; font-size: var(--sv2-fs-xl); letter-spacing: -.02em; }
    .tabs { display: flex; gap: 8px; }
    .tabs a { display: inline-flex; align-items: center; min-height: 36px; padding: 0 16px; border-radius: 999px; background: var(--sv2-surface-2); color: var(--sv2-text); font-size: var(--sv2-fs-sm); font-weight: 600; text-decoration: none; }
    .tabs a.on { background: var(--sv2-text); color: var(--sv2-bg); }
    .tabs a:focus-visible, .teams a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    .comps { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
    .teams { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
    .teams a { display: flex; align-items: center; min-height: 48px; padding: 0 16px 0 8px; border-radius: 999px; background: var(--sv2-surface-2); color: var(--sv2-text); text-decoration: none; }
  `,
})
export class Sv2SectionPageComponent {
  protected readonly store = inject(SportsStore);
  private readonly route = inject(ActivatedRoute);
  protected readonly view = this.route.snapshot.data['view'] as SectionView;
  // Signal, not snapshot: /equipos/a -> /equipos/b reuses this component instance.
  private readonly slug = toSignal(this.route.paramMap.pipe(map((p) => p.get('slug') ?? '')), { initialValue: this.route.snapshot.paramMap.get('slug') ?? '' });

  constructor() {
    effect(() => {
      const slug = this.slug();
      if (this.view === 'match' && this.store.matches().some((m) => m.slug === slug)) {
        untracked(() => this.store.selectMatch(slug, true));
      }
    });
  }

  protected isMatchList(): boolean {
    return this.view === 'live' || this.view === 'fixtures' || this.view === 'results';
  }

  protected readonly entityMatches = computed<readonly Match[]>(() => {
    const all = this.store.matches();
    const slug = this.slug();
    if (this.view === 'competition') return all.filter((m) => m.competitionSlug === slug);
    if (this.view === 'team') return all.filter((m) => m.homeSlug === slug || m.awaySlug === slug);
    if (this.view === 'match') return all.filter((m) => m.slug === slug);
    return [];
  });

  protected readonly title = computed(() => {
    switch (this.view) {
      case 'live': return 'En directo';
      case 'fixtures': return 'Próximos partidos';
      case 'results': return 'Resultados';
      case 'competitions': return 'Competiciones';
      case 'news': return 'Noticias de fútbol';
      case 'following': return 'Siguiendo';
      case 'competition': return this.store.competition(this.slug())?.name ?? 'Competición';
      case 'team': return this.store.team(this.slug())?.name ?? 'Equipo';
      default: return 'Partido';
    }
  });

  protected link(...segments: string[]): string[] {
    return sv2Link(...segments);
  }
}
