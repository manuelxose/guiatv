import { CommonModule } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { map, switchMap } from 'rxjs';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FootballFacade } from '@app/features/football/football.facade';
import { FootballCompetitionDetailDTO, FootballMatchDTO } from '@app/features/football/football.models';
import { FootballNewsCardComponent } from '@app/features/football/components/football-news-card/football-news-card.component';
import { FootballStandingsTableComponent } from '@app/features/football/components/football-standings-table/football-standings-table.component';
import { FootballSectionHeaderComponent } from '@app/features/football/components/football-section-header/football-section-header.component';
import { FootballMatchRowComponent } from '@app/features/football/components/football-match-row/football-match-row.component';
import { FootballBroadcastListComponent } from '@app/features/football/components/football-broadcast-list/football-broadcast-list.component';
import {
  applyFootballMatchFilter,
  FootballFilterBarComponent,
  FootballMatchFilter,
} from '@app/features/football/components/football-filter-bar/football-filter-bar.component';
import { MetaService } from '@app/services/meta.service';
import { FilterChipBarComponent, FilterChipItem } from '@app/components/filter-chip-bar/filter-chip-bar.component';

type CompetitionTab = 'resumen' | 'calendario' | 'clasificacion';

type CompetitionState =
  | { status: 'loading' }
  | { status: 'found'; detail: FootballCompetitionDetailDTO }
  | { status: 'not-found' };

interface RoundGroup {
  round: string;
  matches: FootballMatchDTO[];
}

export function groupByRound(matches: FootballMatchDTO[]): RoundGroup[] {
  const groups = new Map<string, FootballMatchDTO[]>();
  for (const match of matches) {
    const key = match.round || 'Partidos';
    const list = groups.get(key) || [];
    list.push(match);
    groups.set(key, list);
  }
  return Array.from(groups.entries()).map(([round, matches]) => ({ round, matches }));
}

@Component({
  selector: 'app-football-competition-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FootballNewsCardComponent,
    FootballStandingsTableComponent,
    FootballSectionHeaderComponent,
    FootballMatchRowComponent,
    FootballBroadcastListComponent,
    FootballFilterBarComponent,
    FilterChipBarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './football-competition-detail.component.html',
  styleUrl: './football-competition-detail.component.scss',
})
export class FootballCompetitionDetailComponent {
  private readonly facade = inject(FootballFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly meta = inject(MetaService);
  private readonly destroyRef = inject(DestroyRef);

  readonly tabs: readonly FilterChipItem[] = [
    { id: 'resumen', label: 'Resumen' },
    { id: 'calendario', label: 'Calendario' },
    { id: 'clasificacion', label: 'Clasificación' },
  ];
  readonly activeTab = signal<CompetitionTab>('resumen');
  readonly filter = signal<FootballMatchFilter>('all');

  // Same discriminated state as football-match-detail — and for the same
  // reason: a naive "set noindex, then clear it once data arrives" ordering
  // is exactly what shipped every match page as noindex to crawlers before
  // that fix. This never sets meta at all until the real outcome is known.
  readonly state = toSignal(
    this.route.paramMap.pipe(
      map((params) => params.get('slug') || ''),
      switchMap((slug) =>
        this.facade.getCompetition(slug).pipe(
          map((detail): CompetitionState => (detail ? { status: 'found', detail } : { status: 'not-found' }))
        )
      )
    ),
    { initialValue: { status: 'loading' } as CompetitionState }
  );

  readonly loading = computed(() => this.state().status === 'loading');
  readonly detail = computed(() => {
    const state = this.state();
    return state.status === 'found' ? state.detail : null;
  });

  private readonly matches = computed(() => this.detail()?.matches ?? []);
  readonly filteredMatches = computed(() => applyFootballMatchFilter(this.matches(), this.filter()));
  readonly roundGroups = computed(() => groupByRound(this.filteredMatches()));
  readonly liveMatches = computed(() => applyFootballMatchFilter(this.matches(), 'live'));

  readonly upcomingPreview = computed(() =>
    this.matches()
      .filter((m) => m.status === 'scheduled')
      .slice(0, 5)
  );
  /** The single next scheduled match — the "where to watch" CTA is always scoped to it, never to the whole competition. */
  readonly nextMatch = computed(() => this.upcomingPreview()[0] ?? null);
  readonly resultsPreview = computed(() =>
    this.matches()
      .filter((m) => m.status === 'finished')
      .slice(-5)
      .reverse()
  );
  readonly standingsPreview = computed(() => (this.detail()?.standings ?? []).slice(0, 5));

  constructor() {
    // URL fragments are browser-only; hydrate the server's summary before switching panels.
    afterNextRender(() => this.route.fragment.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((fragment) => this.selectTab(fragment || 'resumen')));
    effect(() => {
      const state = this.state();
      if (state.status === 'found') {
        this.applyDetailMeta(state.detail);
      } else if (state.status === 'not-found') {
        this.applyNotFoundMeta();
      }
    });
  }

  selectTab(tab: string): void {
    this.activeTab.set(tab === 'calendario' || tab === 'clasificacion' ? tab : 'resumen');
  }

  onFilterChange(filter: FootballMatchFilter): void {
    this.filter.set(filter);
  }

  trackByRound(_index: number, group: RoundGroup): string {
    return group.round;
  }

  trackByMatch(_index: number, match: FootballMatchDTO): string {
    return match.id;
  }

  trackByNewsSlug(_index: number, article: { slug: string }): string {
    return article.slug;
  }

  private applyDetailMeta(detail: FootballCompetitionDetailDTO): void {
    this.meta.setMetaTags({
      title: `${detail.competition.name} - partidos, clasificación y dónde verlos - Guía TV`,
      description: `${detail.competition.name}: partidos, resultados, clasificación y noticias.`,
      canonicalUrl: `/deportes/futbol/competiciones/${detail.competition.slug}`,
    });
  }

  private applyNotFoundMeta(): void {
    this.meta.setMetaTags({
      title: 'Competición no encontrada - Guía TV',
      description: 'Esta competición no está disponible.',
      canonicalUrl: null,
      robots: 'noindex, follow',
    });
  }
}
