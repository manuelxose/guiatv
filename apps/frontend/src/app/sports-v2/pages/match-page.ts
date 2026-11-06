import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { dayKey, kickoffTime, longDay } from '../domain/calendar';
import { sv2Link } from '../sports-v2.paths';
import { SportsStore } from '../state/sports-store';
import { Sv2IconComponent } from '../ui/icon';
import { Sv2EmptyStateComponent, Sv2ErrorStateComponent, Sv2LoadingSkeletonComponent } from '../ui/states';
import { MATCH_TABS, MatchTab, Sv2MatchDetailsComponent } from './match-details';
import { Sv2MatchHeroComponent } from './match-hero';
import { breadcrumbs, sportsEvent, SPORTS_SITE_URL, sv2Path, useNotFound, useSeo, Sv2Seo } from './seo';

/** Full-page Match Center: the desktop "expand" target and the dedicated full-screen mobile view. */
@Component({
  selector: 'app-sv2-match-page',
  standalone: true,
  imports: [RouterLink, Sv2IconComponent, Sv2MatchHeroComponent, Sv2MatchDetailsComponent, Sv2EmptyStateComponent, Sv2ErrorStateComponent, Sv2LoadingSkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="bar">
      <button type="button" class="back" (click)="back()" aria-label="Volver"><app-sv2-icon name="left" /></button>
      <nav aria-label="Ruta de navegación">
        <ol>
          <li><a [routerLink]="home">Fútbol</a></li>
          @if (match(); as m) {
            <li><a [routerLink]="compLink()">{{ store.competition(m.competitionSlug)?.name }}</a></li>
            <li aria-current="page">{{ title() }}</li>
          }
        </ol>
      </nav>
    </header>

    @switch (store.loadState()) {
      @case ('error') { <app-sv2-error-state (retry)="store.retry()" /> }
      @case ('ready') {
        @if (match(); as m) {
          <h1 class="sr">{{ title() }}</h1>
          <app-sv2-match-hero [match]="m" size="lg" />
          <app-sv2-match-details [match]="m" prefix="sv2pg" [tab]="tab()" (tabChange)="setTab($event)" [relatedLimit]="4" />
        } @else if (store.resolving()) {
          <app-sv2-loading-skeleton [count]="3" />
        } @else {
          <app-sv2-empty-state page title="No encontramos este partido" hint="Puede que el enlace sea antiguo o que el partido ya no esté disponible." actionLabel="Ver el calendario" [actionLink]="fixtures" />
        }
      }
      @default { <app-sv2-loading-skeleton [count]="3" /> }
    }
  `,
  styles: `
    :host { display: grid; gap: 20px; align-content: start; max-width: 880px; width: 100%; margin: 0 auto; min-width: 0; }
    .bar { display: flex; align-items: center; gap: 12px; position: sticky; top: -16px; z-index: 5; margin: -16px -16px 0; padding: 12px 16px; background: var(--sv2-surface-1); border-bottom: 1px solid var(--sv2-border); }
    .back { display: inline-grid; place-items: center; flex: none; width: 40px; height: 40px; border: 0; border-radius: 50%; background: var(--sv2-surface-2); color: var(--sv2-text); cursor: pointer; }
    .back:hover { background: var(--sv2-surface-3); }
    ol { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 0; padding: 0; list-style: none; font-size: var(--sv2-fs-sm); color: var(--sv2-text-muted); min-width: 0; }
    ol a { display: inline-flex; align-items: center; min-block-size: 24px; }
    li + li::before { content: '›'; margin-right: 8px; color: var(--sv2-text-faint); }
    li a { color: var(--sv2-text-muted); text-decoration: none; border-radius: 4px; } li a:hover { color: var(--sv2-text); text-decoration: underline; }
    li[aria-current] { color: var(--sv2-text); font-weight: 600; }
    a:focus-visible, button:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    @media (max-width: 767px) { li:nth-child(2) { display: none; } li:nth-child(3)::before { content: none; } }
  `,
})
export class Sv2MatchPageComponent {
  protected readonly store = inject(SportsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  protected readonly home = sv2Link();
  protected readonly fixtures = sv2Link('partidos');

  private readonly slug = toSignal(this.route.paramMap.pipe(map((p) => p.get('slug') ?? '')), { initialValue: this.route.snapshot.paramMap.get('slug') ?? '' });
  protected readonly tab = toSignal(this.route.queryParamMap.pipe(map((q) => asTab(q.get('tab')))), { initialValue: asTab(this.route.snapshot.queryParamMap.get('tab')) });
  protected readonly match = computed(() => this.store.match(this.slug()) ?? null);
  protected readonly compLink = computed(() => sv2Link('competiciones', this.match()?.competitionSlug ?? ''));
  protected readonly title = computed(() => {
    const m = this.match();
    return m ? `${this.store.team(m.homeSlug)?.name ?? ''} - ${this.store.team(m.awaySlug)?.name ?? ''}` : 'Partido';
  });

  private readonly site = inject(SPORTS_SITE_URL);
  private readonly seo = computed<Sv2Seo | null>(() => {
    const m = this.match();
    if (!m) return { title: 'Partido' };
    const home = this.store.team(m.homeSlug)?.name ?? '';
    const away = this.store.team(m.awaySlug)?.name ?? '';
    const comp = this.store.competition(m.competitionSlug)?.name ?? '';
    const where = m.broadcasts.length ? `Dónde verlo: ${m.broadcasts.map((b) => b.channel).join(', ')}.` : 'Emisión aún no confirmada.';
    const segments = ['partido', m.slug];
    const path = sv2Path(segments);
    return {
      title: `${home} - ${away}`,
      description: `${home} contra ${away} (${comp}), ${longDay(dayKey(m.kickoff))} a las ${kickoffTime(m.kickoff)}. ${where}`,
      segments,
      jsonLd: [
        sportsEvent(this.site, { name: `${home} - ${away}`, kickoff: m.kickoff, status: m.status, home, away, competition: comp, path }),
        breadcrumbs(this.site, [['Fútbol', sv2Path()], [comp, sv2Path(['competiciones', m.competitionSlug])], [`${home} - ${away}`, path]]),
      ],
    };
  });

  constructor() {
    this.store.matchPageOpen.set(true);
    this.store.contextOpen.set(false);
    inject(DestroyRef).onDestroy(() => this.store.matchPageOpen.set(false));
    effect(() => {
      if (this.store.loadState() === 'ready') untracked(() => void this.store.ensureMatch(this.slug()));
    });
    useNotFound(() => this.store.loadState() === 'ready' && !this.store.resolving() && !this.match(), false);
    useSeo(() => this.seo());
    // Keep the sidebar's selection in step so leaving the page lands on the same match.
    effect(() => {
      const m = this.match();
      if (m) untracked(() => this.store.selectMatch(m.slug));
    });
  }

  protected setTab(tab: MatchTab): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { tab: tab === 'resumen' ? null : tab }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  /** Stay in the app: browser-back when we arrived from another sports page, the calendar otherwise. */
  protected back(): void {
    if (this.store.navigations() > 1) this.location.back();
    else void this.router.navigate(this.fixtures);
  }
}

const asTab = (value: string | null): MatchTab => (MATCH_TABS.some((t) => t.id === value) ? (value as MatchTab) : 'resumen');
