import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { sv2Link } from '../sports-v2.paths';
import { SportsStore } from '../state/sports-store';
import { Sv2ArticleCardComponent } from '../ui/article-card';
import { Sv2FollowButtonComponent } from '../ui/follow-button';
import { Sv2CompetitionLogoComponent } from '../ui/competition-logo';
import { Sv2EmptyStateComponent, Sv2ErrorStateComponent, Sv2LoadingSkeletonComponent } from '../ui/states';
import { Sv2TeamIdentityComponent } from '../ui/team-identity';
import { Sv2TabsComponent, TabItem } from '../ui/tabs';
import { Sv2MatchListComponent } from './match-list';
import { breadcrumbs, SPORTS_SITE_URL, sv2Path, useNotFound, useSeo } from './seo';
import { Sv2StandingsTableComponent } from './standings-table';

const TABS: readonly TabItem[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'partidos', label: 'Partidos' },
  { id: 'resultados', label: 'Resultados' },
  { id: 'clasificacion', label: 'Clasificación' },
  { id: 'equipos', label: 'Equipos' },
  { id: 'noticias', label: 'Noticias' },
];
const KIND = { league: 'Liga', cup: 'Copa', international: 'Internacional' } as const;

@Component({
  selector: 'app-sv2-competition-page',
  standalone: true,
  imports: [RouterLink, Sv2CompetitionLogoComponent, Sv2FollowButtonComponent, Sv2TabsComponent, Sv2MatchListComponent, Sv2StandingsTableComponent, Sv2ArticleCardComponent, Sv2TeamIdentityComponent, Sv2EmptyStateComponent, Sv2ErrorStateComponent, Sv2LoadingSkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (store.loadState()) {
      @case ('error') { <app-sv2-error-state (retry)="store.retry()" /> }
      @case ('ready') {
        @if (competition(); as c) {
          <header class="hero" [style.--hue]="c.hue">
            <span class="ico" aria-hidden="true"><app-sv2-competition-logo [url]="c.logoUrl" /></span>
            <div class="txt">
              <h1>{{ c.name }}</h1>
              <p>{{ c.country }} · {{ kind(c.kind) }}@if (c.season) { · Temporada {{ c.season }} }</p>
              @if (c.description) { <p class="desc">{{ c.description }}</p> }
            </div>
            <app-sv2-follow-button [following]="store.isCompetitionFollowed(c.slug)" [subject]="c.name" (followToggle)="store.toggleCompetition(c.slug)" />
          </header>

          <app-sv2-tabs [tabs]="tabs" [selected]="tab()" [label]="'Secciones de ' + c.name" prefix="sv2cmp" (tabSelect)="setTab($event)" />

          <div id="sv2cmp-panel" role="tabpanel" tabindex="0" [attr.aria-labelledby]="'sv2cmp-tab-' + tab()">
            @switch (tab()) {
              @case ('resumen') {
                <section>
                  <h2>Próximos partidos</h2>
                  <app-sv2-match-list [matches]="upcoming().slice(0, 3)" grouping="none" emptyTitle="Sin partidos programados" />
                </section>
                <section>
                  <h2>Últimos resultados</h2>
                  <app-sv2-match-list [matches]="results().slice(0, 3)" grouping="none" emptyTitle="Aún no hay resultados" />
                </section>
                @if (standings(); as s) {
                  <section>
                    <h2>Clasificación</h2>
                    <app-sv2-standings-table [standings]="s" [competition]="c" [limit]="5" />
                    <a class="more" [routerLink]="tableLink()">Ver clasificación completa</a>
                  </section>
                }
                @if (articles().length) {
                  <section>
                    <h2>Noticias</h2>
                    <div class="news">@for (n of articles().slice(0, 2); track n.slug) { <app-sv2-article-card [item]="n" /> }</div>
                  </section>
                }
              }
              @case ('partidos') { <app-sv2-match-list [matches]="upcoming()" grouping="day" emptyTitle="Sin partidos programados" emptyHint="Cuando se publique el calendario aparecerá aquí." /> }
              @case ('resultados') { <app-sv2-match-list [matches]="results()" grouping="day" emptyTitle="Aún no hay resultados" /> }
              @case ('clasificacion') {
                @if (standings(); as s) {
                  <app-sv2-standings-table [standings]="s" [competition]="c" />
                } @else {
                  <app-sv2-empty-state [title]="c.kind === 'cup' ? 'Las copas no tienen clasificación' : 'Clasificación no disponible'" hint="Consulta los partidos y resultados de la competición." />
                }
              }
              @case ('equipos') {
                <ul class="teams">
                  @for (t of teams(); track t.slug) {
                    <li>
                      <a [routerLink]="teamLink(t.slug)"><app-sv2-team-identity [team]="t" /></a>
                      <app-sv2-follow-button [following]="store.isTeamFollowed(t.slug)" [subject]="t.name" (followToggle)="store.toggleTeam(t.slug)" />
                    </li>
                  }
                </ul>
              }
              @case ('noticias') {
                @if (articles().length) {
                  <div class="news">@for (n of articles(); track n.slug) { <app-sv2-article-card [item]="n" /> }</div>
                } @else {
                  <app-sv2-empty-state title="Sin noticias de esta competición" hint="Consulta las noticias generales de fútbol." actionLabel="Ir a noticias" [actionLink]="newsLink" />
                }
              }
            }
          </div>
        } @else {
          <app-sv2-empty-state page title="No encontramos esta competición" hint="Puede que el enlace sea antiguo." actionLabel="Ver competiciones" [actionLink]="listLink" />
        }
      }
      @default { <app-sv2-loading-skeleton [count]="3" /> }
    }
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; align-content: start; }
    .hero { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; padding: 20px; border-radius: var(--sv2-r-lg); border: 1px solid var(--sv2-border); background: linear-gradient(135deg, hsl(var(--hue) 40% 22%), var(--sv2-surface-2) 75%); }
    .ico { display: grid; place-items: center; width: 56px; height: 56px; border-radius: var(--sv2-r-md); background: rgba(255,255,255,.1); --sv2-icon: 28px; }
    .txt { flex: 1 1 240px; min-width: 0; }
    h1 { margin: 0; font-size: var(--sv2-fs-xl); letter-spacing: -.02em; }
    .txt p { margin: 4px 0 0; font-size: var(--sv2-fs-sm); color: var(--sv2-text-muted); }
    .desc { max-width: 60ch; }
    [role='tabpanel'] { display: grid; gap: 24px; min-width: 0; outline: none; }
    [role='tabpanel']:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 4px; border-radius: var(--sv2-r-sm); }
    h2 { margin: 0 0 12px; font-size: var(--sv2-fs-lg); letter-spacing: -.01em; }
    section { min-width: 0; }
    .more { display: inline-flex; align-items: center; min-block-size: 24px; margin-top: 12px; color: var(--sv2-text); font-size: var(--sv2-fs-sm); font-weight: 600; }
    .news { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
    .teams { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
    .teams li { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 64px; padding: 8px 12px; border-radius: var(--sv2-r-md); background: var(--sv2-surface-2); border: 1px solid var(--sv2-border); }
    .teams a { display: flex; align-items: center; min-width: 0; color: var(--sv2-text); text-decoration: none; border-radius: var(--sv2-r-sm); }
    .teams a:hover { text-decoration: underline; text-underline-offset: 3px; }
    a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
  `,
})
export class Sv2CompetitionPageComponent {
  protected readonly store = inject(SportsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly site = inject(SPORTS_SITE_URL);
  private readonly router = inject(Router);
  protected readonly tabs = TABS;
  protected readonly listLink = sv2Link('competiciones');
  protected readonly newsLink = sv2Link('noticias');
  protected readonly kind = (k: keyof typeof KIND) => KIND[k];

  // Signals, not snapshots: /competiciones/a → /competiciones/b reuses this component instance.
  private readonly slug = toSignal(this.route.paramMap.pipe(map((p) => p.get('slug') ?? '')), { initialValue: this.route.snapshot.paramMap.get('slug') ?? '' });
  protected readonly tab = toSignal(this.route.queryParamMap.pipe(map((q) => asTab(q.get('tab')))), { initialValue: asTab(this.route.snapshot.queryParamMap.get('tab')) });

  protected readonly competition = computed(() => this.store.competition(this.slug()));
  protected readonly standings = computed(() => this.store.standingsOf(this.slug()));
  protected readonly matches = computed(() => this.store.matchesOf(this.slug()));
  protected readonly upcoming = computed(() => this.matches().filter((m) => m.status === 'scheduled' || m.status === 'postponed' || m.status === 'live'));
  protected readonly results = computed(() => this.matches().filter((m) => m.status === 'finished').reverse());
  protected readonly articles = computed(() => this.store.newsFor({ competition: this.slug() }));
  protected readonly teams = computed(() => (this.competition()?.teamSlugs ?? []).flatMap((s) => this.store.team(s) ?? []));
  protected readonly tableLink = computed(() => sv2Link('clasificaciones', this.slug()));

  constructor() {
    effect(() => {
      if (this.store.loadState() === 'ready' && this.slug()) untracked(() => void this.store.ensureCompetition(this.slug()));
    });
    useNotFound(() => this.store.loadState() === 'ready' && !this.store.resolving() && !this.competition());
    useSeo(() => {
      const c = this.competition();
      if (!c) return { title: 'Competición' };
      const segments = ['competiciones', c.slug];
      return {
        title: c.name,
        description: `Partidos, resultados, clasificación y noticias de ${c.name}${c.country ? ' (' + c.country + ')' : ''}.`,
        segments,
        jsonLd: [breadcrumbs(this.site, [['Fútbol', sv2Path()], ['Competiciones', sv2Path(['competiciones'])], [c.name, sv2Path(segments)]])],
      };
    });
  }

  protected teamLink(slug: string): string[] {
    return sv2Link('equipos', slug);
  }
  protected setTab(tab: string): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { tab: tab === 'resumen' ? null : tab }, queryParamsHandling: 'merge', replaceUrl: true });
  }
}

const asTab = (value: string | null): string => (TABS.some((t) => t.id === value) ? (value as string) : 'resumen');
