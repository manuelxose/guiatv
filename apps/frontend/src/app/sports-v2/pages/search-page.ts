import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { sv2Link } from '../sports-v2.paths';
import { SearchHit, SportsStore } from '../state/sports-store';
import { Sv2IconComponent } from '../ui/icon';
import { Sv2EmptyStateComponent } from '../ui/states';
import { usePageTitle } from './page-title';

/** Unified search over teams, competitions, fixtures and news. The query lives in `?q=`. */
@Component({
  selector: 'app-sv2-search-page',
  standalone: true,
  imports: [RouterLink, Sv2IconComponent, Sv2EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Buscar</h1>
    <form role="search" (submit)="$event.preventDefault()">
      <app-sv2-icon name="search" />
      <input #box type="search" name="q" autocomplete="off" enterkeyhint="search" placeholder="Equipos, competiciones, partidos y noticias" aria-label="Buscar en fútbol" [value]="q()" (input)="setQuery(box.value)" />
    </form>

    @if (store.loadState() !== 'ready') {
      <p class="hint" role="status">Cargando datos…</p>
    } @else if (q().trim().length < 2) {
      <app-sv2-empty-state title="Escribe al menos dos letras" hint="Busca por nombre de equipo, competición, partido o noticia." />
    } @else if (!groups().total) {
      <app-sv2-empty-state [title]="'Sin resultados para «' + q().trim() + '»'" hint="Revisa la ortografía o prueba con otro nombre." actionLabel="Ver competiciones" [actionLink]="competitions" />
    } @else {
      <p class="count" role="status">{{ groups().total === 1 ? '1 resultado' : groups().total + ' resultados' }}</p>
      @for (s of sections(); track s.title) {
        @if (s.hits.length) {
          <section [attr.aria-label]="s.title">
            <h2>{{ s.title }} <span>{{ s.hits.length }}</span></h2>
            <ul>
              @for (h of s.hits; track h.path ?? h.link.join('/')) {
                <li><a [routerLink]="link(h)"><span class="l">{{ h.label }}</span><span class="d">{{ h.detail }}</span></a></li>
              }
            </ul>
          </section>
        }
      }
    }
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-content: start; max-width: 760px; width: 100%; margin: 0 auto; }
    h1 { margin: 0; font-size: var(--sv2-fs-xl); letter-spacing: -.02em; }
    form { display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 18px; border-radius: 999px; background: var(--sv2-surface-2); border: 1px solid var(--sv2-border); color: var(--sv2-text-muted); }
    form:focus-within { border-color: var(--sv2-border-strong); background: var(--sv2-surface-3); }
    input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--sv2-text); font: inherit; font-size: 1rem; outline: none; }
    form:has(input:focus-visible) { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    .hint, .count { margin: 0; font-size: var(--sv2-fs-sm); color: var(--sv2-text-muted); }
    h2 { display: flex; align-items: center; gap: 8px; margin: 8px 0; font-size: var(--sv2-fs-md); }
    h2 span { padding: 1px 8px; border-radius: 999px; background: var(--sv2-surface-3); color: var(--sv2-text-muted); font-size: var(--sv2-fs-xs); }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; border-radius: var(--sv2-r-md); overflow: hidden; background: var(--sv2-surface-2); border: 1px solid var(--sv2-border); }
    li a { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 52px; padding: 0 16px; color: var(--sv2-text); text-decoration: none; }
    li a:hover { background: var(--sv2-surface-3); }
    li a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: -2px; }
    .l { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .d { flex: none; font-size: var(--sv2-fs-xs); color: var(--sv2-text-muted); }
  `,
})
export class Sv2SearchPageComponent {
  protected readonly store = inject(SportsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly competitions = sv2Link('competiciones');
  protected readonly q = toSignal(this.route.queryParamMap.pipe(map((p) => p.get('q') ?? '')), { initialValue: this.route.snapshot.queryParamMap.get('q') ?? '' });
  protected readonly groups = computed(() => this.store.search(this.q()));
  protected readonly sections = computed(() => [
    { title: 'Equipos', hits: this.groups().teams },
    { title: 'Competiciones', hits: this.groups().competitions },
    { title: 'Partidos', hits: this.groups().matches },
    { title: 'Noticias', hits: this.groups().news },
    { title: 'Programas, películas y series', hits: this.groups().site },
  ]);

  constructor() {
    usePageTitle(() => (this.q().trim() ? `Buscar «${this.q().trim()}»` : 'Buscar'));
    effect(() => this.store.searchRemote(this.q()));
  }

  protected setQuery(value: string): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { q: value || null }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  protected link(hit: SearchHit): string | string[] {
    return hit.path ?? sv2Link(...hit.link);
  }
}
