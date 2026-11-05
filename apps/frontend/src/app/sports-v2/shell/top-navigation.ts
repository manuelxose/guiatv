import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SportsStore } from '../state/sports-store';
import { sv2Link } from '../sports-v2.paths';
import { Sv2IconComponent } from '../ui/icon';

@Component({
  selector: 'app-sv2-top-navigation',
  standalone: true,
  imports: [RouterLink, Sv2IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="ib sidebar-toggle" (click)="store.toggleSidebar()" [attr.aria-pressed]="store.sidebarCollapsed()" aria-label="Contraer o expandir Mi fútbol">
      <app-sv2-icon name="panel" />
    </button>
    <a class="brand" [routerLink]="home" aria-label="GuíaTV Sports, inicio">
      <span class="mark" aria-hidden="true"><app-sv2-icon name="trophy" /></span>
      <span class="word">GuíaTV <b>Sports</b></span>
    </a>

    <form class="search" role="search" (submit)="$event.preventDefault(); go()">
      <app-sv2-icon name="search" />
      <input
        #q
        type="search"
        name="q"
        autocomplete="off"
        placeholder="Buscar equipos, competiciones, partidos"
        aria-label="Buscar fútbol"
        aria-controls="sv2-search-results"
        [attr.aria-expanded]="store.searchHits().length > 0"
        [value]="store.query()"
        (input)="store.query.set(q.value)"
        (keydown.escape)="store.query.set('')"
      />
      @if (store.searchHits().length) {
        <ul id="sv2-search-results" class="hits" aria-label="Resultados de búsqueda">
          @for (hit of store.searchHits(); track hit.label + hit.kind) {
            <li>
              <a [routerLink]="link(hit.link)" (click)="store.query.set('')">
                <span class="kind">{{ kindLabel(hit.kind) }}</span>{{ hit.label }}
              </a>
            </li>
          }
        </ul>
      }
    </form>

    <nav class="actions" aria-label="Acciones">
      <a class="ib" [routerLink]="following" aria-label="Siguiendo: equipos y competiciones favoritas"><app-sv2-icon name="star" /></a>
      <button type="button" class="ib ctx-toggle" (click)="store.contextOpen.set(!store.contextOpen())" [attr.aria-expanded]="store.contextOpen()" aria-label="Abrir Match Center">
        <app-sv2-icon name="tv" />
      </button>
      <a class="ib" href="/perfil" aria-label="Mi cuenta"><app-sv2-icon name="user" /></a>
    </nav>
  `,
  styles: `
    :host { display: flex; align-items: center; gap: 12px; height: 100%; padding: 0 8px; }
    .brand { display: flex; align-items: center; gap: 10px; color: var(--sv2-text); text-decoration: none; border-radius: 10px; }
    .mark { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: var(--sv2-accent); color: var(--sv2-accent-ink); }
    .word { font-size: var(--sv2-fs-md); font-weight: 700; white-space: nowrap; } .word b { color: var(--sv2-accent); }
    .search { position: relative; flex: 1; max-width: 520px; margin: 0 auto; display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 16px; border-radius: 999px; background: var(--sv2-surface-2); color: var(--sv2-text-muted); border: 1px solid transparent; }
    .search:focus-within { border-color: var(--sv2-border-strong); background: var(--sv2-surface-3); }
    input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--sv2-text); font: inherit; font-size: var(--sv2-fs-md); outline: none; }
    input::placeholder { color: var(--sv2-text-faint); }
    .search:has(input:focus-visible) { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    .hits { position: absolute; z-index: 30; top: 52px; left: 0; right: 0; margin: 0; padding: 6px; list-style: none; border-radius: var(--sv2-r-md); background: var(--sv2-surface-3); border: 1px solid var(--sv2-border-strong); box-shadow: var(--sv2-shadow); }
    .hits a { display: flex; gap: 10px; align-items: center; min-height: 40px; padding: 0 10px; border-radius: var(--sv2-r-sm); color: var(--sv2-text); text-decoration: none; font-size: var(--sv2-fs-sm); }
    .hits a:hover, .hits a:focus-visible { background: var(--sv2-surface-1); outline: none; }
    .kind { font-size: var(--sv2-fs-xs); color: var(--sv2-text-muted); min-width: 84px; }
    .actions { display: flex; gap: 8px; }
    .ib { display: inline-grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 999px; background: var(--sv2-surface-2); color: var(--sv2-text-muted); cursor: pointer; text-decoration: none; flex: none; }
    .ib:hover { background: var(--sv2-surface-3); color: var(--sv2-text); }
    .ib:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    .sidebar-toggle { display: none; }
    @media (min-width: 1200px) { .sidebar-toggle { display: inline-grid; } .ctx-toggle { display: none; } }
    @media (max-width: 767px) {
      .word { display: none; }
      .search { margin: 0; }
      .kind { min-width: 0; }
    }
  `,
})
export class Sv2TopNavigationComponent {
  protected readonly store = inject(SportsStore);
  private readonly router = inject(Router);
  protected readonly home = sv2Link();
  protected readonly following = sv2Link('siguiendo');

  protected link(segments: readonly string[]): string[] {
    return sv2Link(...segments);
  }
  protected kindLabel(kind: 'team' | 'competition' | 'match'): string {
    return { team: 'Equipo', competition: 'Competición', match: 'Partido' }[kind];
  }
  protected go(): void {
    const first = this.store.searchHits()[0];
    if (!first) return;
    this.store.query.set('');
    void this.router.navigate(sv2Link(...first.link));
  }
}
