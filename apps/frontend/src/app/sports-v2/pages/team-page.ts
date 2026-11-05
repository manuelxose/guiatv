import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { goalDifference, signed } from '../domain/standings';
import { sv2Link } from '../sports-v2.paths';
import { SportsStore } from '../state/sports-store';
import { Sv2ArticleCardComponent } from '../ui/article-card';
import { Sv2FollowButtonComponent } from '../ui/follow-button';
import { Sv2MatchCardComponent } from '../ui/match-card';
import { Sv2EmptyStateComponent, Sv2ErrorStateComponent, Sv2LoadingSkeletonComponent } from '../ui/states';
import { Sv2TeamIdentityComponent } from '../ui/team-identity';
import { Sv2MatchListComponent } from './match-list';
import { usePageTitle } from './page-title';
import { Sv2StandingsTableComponent } from './standings-table';

@Component({
  selector: 'app-sv2-team-page',
  standalone: true,
  imports: [RouterLink, Sv2FollowButtonComponent, Sv2TeamIdentityComponent, Sv2MatchCardComponent, Sv2MatchListComponent, Sv2StandingsTableComponent, Sv2ArticleCardComponent, Sv2EmptyStateComponent, Sv2ErrorStateComponent, Sv2LoadingSkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (store.loadState()) {
      @case ('error') { <app-sv2-error-state (retry)="store.retry()" /> }
      @case ('ready') {
        @if (team(); as t) {
          <header class="hero" [style.--hue]="t.hue">
            <app-sv2-team-identity [team]="t" class="big" [hideName]="true" />
            <div class="txt">
              <h1>{{ t.name }}</h1>
              <p>{{ t.city }}@if (t.founded) { · Fundado en {{ t.founded }} }</p>
              <ul class="comps">@for (c of competitions(); track c.slug) { <li><a [routerLink]="compLink(c.slug)">{{ c.name }}</a></li> }</ul>
            </div>
            <app-sv2-follow-button [following]="store.isTeamFollowed(t.slug)" [subject]="t.name" (followToggle)="store.toggleTeam(t.slug)" />
          </header>

          @if (position(); as p) {
            <section aria-labelledby="pos-h">
              <h2 id="pos-h">Posición en {{ p.competition.name }}</h2>
              <dl class="kpi">
                <div><dt>Posición</dt><dd>{{ p.position }}.º</dd></div>
                <div><dt>Puntos</dt><dd>{{ p.row.points }}</dd></div>
                <div><dt>Jugados</dt><dd>{{ p.row.played }}</dd></div>
                <div><dt>Dif. goles</dt><dd>{{ gd(p.row) }}</dd></div>
              </dl>
            </section>
          }

          <section aria-labelledby="next-h">
            <h2 id="next-h">Próximo partido</h2>
            @if (next(); as m) {
              @if (store.team(m.homeSlug); as h) {
                @if (store.team(m.awaySlug); as a) {
                  <div class="next">
                    <app-sv2-match-card [match]="m" [home]="h" [away]="a" [competitionName]="store.competition(m.competitionSlug)?.name ?? ''" [selected]="store.selectedMatchSlug() === m.slug" [tracked]="store.isTracked(m.slug)" (matchSelect)="store.openMatch($event)" (trackToggle)="store.toggleTracked($event)" />
                  </div>
                }
              }
            } @else {
              <app-sv2-empty-state title="Sin próximo partido programado" hint="Cuando se publique el calendario aparecerá aquí." />
            }
          </section>

          <section aria-labelledby="res-h">
            <h2 id="res-h">Últimos resultados</h2>
            <app-sv2-match-list [matches]="results()" grouping="none" emptyTitle="Aún no hay resultados" />
          </section>

          <section aria-labelledby="fx-h">
            <h2 id="fx-h">Próximos partidos</h2>
            <app-sv2-match-list [matches]="fixtures()" grouping="none" emptyTitle="Sin más partidos programados" />
          </section>

          @if (table(); as tb) {
            @if (position(); as p) {
              <section aria-labelledby="tb-h">
                <h2 id="tb-h">Clasificación</h2>
                <app-sv2-standings-table [standings]="tb" [competition]="p.competition" [highlight]="t.slug" />
              </section>
            }
          }

          @if (articles().length) {
            <section aria-labelledby="nw-h">
              <h2 id="nw-h">Noticias de {{ t.name }}</h2>
              <div class="news">@for (n of articles(); track n.slug) { <app-sv2-article-card [item]="n" /> }</div>
            </section>
          }
        } @else {
          <app-sv2-empty-state title="No encontramos este equipo" hint="Puede que el enlace sea antiguo." actionLabel="Ver competiciones" [actionLink]="listLink" />
        }
      }
      @default { <app-sv2-loading-skeleton [count]="3" /> }
    }
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; align-content: start; }
    .hero { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; padding: 20px; border-radius: var(--sv2-r-lg); border: 1px solid var(--sv2-border); background: linear-gradient(135deg, hsl(var(--hue) 45% 22%), var(--sv2-surface-2) 75%); }
    .big { --sv2-badge: 72px; }
    .txt { flex: 1 1 220px; min-width: 0; }
    h1 { margin: 0; font-size: var(--sv2-fs-xl); letter-spacing: -.02em; }
    .txt p { margin: 4px 0 0; font-size: var(--sv2-fs-sm); color: var(--sv2-text-muted); }
    .comps { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; padding: 0; list-style: none; }
    .comps a { display: inline-flex; align-items: center; min-height: 28px; padding: 0 12px; border-radius: 999px; background: rgba(255,255,255,.1); color: var(--sv2-text); font-size: var(--sv2-fs-xs); font-weight: 600; text-decoration: none; }
    .comps a:hover { background: rgba(255,255,255,.18); }
    h2 { margin: 0 0 12px; font-size: var(--sv2-fs-lg); letter-spacing: -.01em; }
    section { min-width: 0; }
    .kpi { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0; }
    .kpi div { padding: 12px; border-radius: var(--sv2-r-md); background: var(--sv2-surface-2); border: 1px solid var(--sv2-border); text-align: center; }
    .kpi dt { font-size: var(--sv2-fs-xs); color: var(--sv2-text-muted); } .kpi dd { margin: 4px 0 0; font-size: var(--sv2-fs-xl); font-weight: 800; font-variant-numeric: tabular-nums; }
    .next { max-width: 420px; }
    .news { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
    a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
  `,
})
export class Sv2TeamPageComponent {
  protected readonly store = inject(SportsStore);
  private readonly route = inject(ActivatedRoute);
  protected readonly listLink = sv2Link('competiciones');
  // Signal, not snapshot: /equipos/a → /equipos/b reuses this component instance.
  private readonly slug = toSignal(this.route.paramMap.pipe(map((p) => p.get('slug') ?? '')), { initialValue: this.route.snapshot.paramMap.get('slug') ?? '' });

  protected readonly team = computed(() => this.store.team(this.slug()));
  protected readonly competitions = computed(() => this.store.teamCompetitions(this.slug()));
  protected readonly position = computed(() => this.store.positionOf(this.slug()));
  protected readonly table = computed(() => {
    const p = this.position();
    return p ? this.store.standingsOf(p.competition.slug) : undefined;
  });
  private readonly all = computed(() => this.store.matchesOfTeam(this.slug()));
  protected readonly next = computed(() => this.all().find((m) => m.status === 'live') ?? this.all().find((m) => m.status === 'scheduled'));
  protected readonly results = computed(() => this.all().filter((m) => m.status === 'finished').reverse().slice(0, 5));
  protected readonly fixtures = computed(() => this.all().filter((m) => (m.status === 'scheduled' || m.status === 'postponed') && m.slug !== this.next()?.slug));
  protected readonly articles = computed(() => this.store.newsFor({ team: this.slug() }));

  constructor() {
    usePageTitle(() => this.team()?.name ?? 'Equipo');
  }

  protected compLink(slug: string): string[] {
    return sv2Link('competiciones', slug);
  }
  protected gd(row: Parameters<typeof goalDifference>[0]): string {
    return signed(goalDifference(row));
  }
}
