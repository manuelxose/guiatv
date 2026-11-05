import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { map } from 'rxjs';
import { sv2Link } from '../sports-v2.paths';
import { SportsStore } from '../state/sports-store';
import { Sv2EmptyStateComponent, Sv2ErrorStateComponent, Sv2LoadingSkeletonComponent } from '../ui/states';
import { usePageTitle } from './page-title';
import { Sv2StandingsTableComponent } from './standings-table';

/** Standings for one competition; `/clasificaciones` redirects to the first competition that has a table. */
@Component({
  selector: 'app-sv2-standings-page',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, Sv2StandingsTableComponent, Sv2EmptyStateComponent, Sv2ErrorStateComponent, Sv2LoadingSkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Clasificaciones</h1>
    @switch (store.loadState()) {
      @case ('error') { <app-sv2-error-state (retry)="store.retry()" /> }
      @case ('ready') {
        @if (withTables().length) {
          <nav aria-label="Competición">
            @for (c of withTables(); track c.slug) {
              <a [routerLink]="link(c.slug)" routerLinkActive="on" ariaCurrentWhenActive="page">{{ c.name }}</a>
            }
          </nav>
          @if (competition(); as c) {
            @if (standings(); as s) {
              <section>
                <h2>{{ c.name }}@if (c.season) { <small> · {{ c.season }}</small> }</h2>
                <app-sv2-standings-table [standings]="s" [competition]="c" />
                <a class="more" [routerLink]="compLink()">Ver la competición</a>
              </section>
            } @else {
              <app-sv2-empty-state [title]="c.name + ' no tiene clasificación'" hint="Elige otra competición o consulta sus partidos." actionLabel="Ver la competición" [actionLink]="compLink()" />
            }
          } @else {
            <app-sv2-empty-state title="No encontramos esta competición" actionLabel="Ver clasificaciones" [actionLink]="base" />
          }
        } @else {
          <app-sv2-empty-state title="Aún no hay clasificaciones" hint="Se mostrarán cuando las competiciones publiquen su tabla." />
        }
      }
      @default { <app-sv2-loading-skeleton [count]="3" /> }
    }
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-content: start; }
    h1 { margin: 0; font-size: var(--sv2-fs-xl); letter-spacing: -.02em; }
    h2 { margin: 0 0 12px; font-size: var(--sv2-fs-lg); }
    h2 small { font-size: var(--sv2-fs-sm); color: var(--sv2-text-muted); font-weight: 500; }
    nav { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; }
    nav a { flex: none; display: inline-flex; align-items: center; min-height: 36px; padding: 0 16px; border-radius: 999px; background: var(--sv2-surface-2); color: var(--sv2-text); font-size: var(--sv2-fs-sm); font-weight: 600; text-decoration: none; }
    nav a:hover { background: var(--sv2-surface-3); } nav a.on { background: var(--sv2-text); color: var(--sv2-bg); }
    .more { display: inline-block; margin-top: 12px; color: var(--sv2-text); font-size: var(--sv2-fs-sm); font-weight: 600; }
    a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
  `,
})
export class Sv2StandingsPageComponent {
  protected readonly store = inject(SportsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly base = sv2Link('clasificaciones');
  private readonly slug = toSignal(this.route.paramMap.pipe(map((p) => p.get('slug'))), { initialValue: this.route.snapshot.paramMap.get('slug') });

  protected readonly withTables = computed(() => this.store.competitions().filter((c) => this.store.standingsOf(c.slug)));
  protected readonly competition = computed(() => (this.slug() ? this.store.competition(this.slug() as string) : undefined));
  protected readonly standings = computed(() => (this.slug() ? this.store.standingsOf(this.slug() as string) : undefined));

  constructor() {
    usePageTitle(() => (this.competition() ? `Clasificación ${this.competition()?.name}` : 'Clasificaciones'));
    effect(() => {
      const first = this.withTables()[0];
      if (!this.slug() && first) void this.router.navigate(sv2Link('clasificaciones', first.slug), { replaceUrl: true });
    });
  }

  protected link(slug: string): string[] {
    return sv2Link('clasificaciones', slug);
  }
  protected compLink(): string[] {
    return sv2Link('competiciones', this.slug() ?? '');
  }
}
