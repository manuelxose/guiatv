import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { KIND_LABEL, SearchHit, SportsStore } from '../state/sports-store';
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

    <form class="search" role="search" (submit)="$event.preventDefault(); submit()" (focusout)="focusOut($event)">
      <app-sv2-icon name="search" />
      <input
        #q
        type="search"
        name="q"
        role="combobox"
        aria-autocomplete="list"
        enterkeyhint="search"
        autocomplete="off"
        placeholder="Buscar equipos, competiciones, partidos"
        aria-label="Buscar fútbol"
        aria-controls="sv2-search-results"
        [attr.aria-expanded]="open()"
        [attr.aria-activedescendant]="activeId()"
        [value]="store.query()"
        (input)="onInput(q.value)"
        (keydown.arrowdown)="move($event, 1)"
        (keydown.arrowup)="move($event, -1)"
        (keydown.escape)="escape($event)"
      />
      @if (open()) {
        <ul id="sv2-search-results" class="hits" role="listbox" aria-label="Resultados de búsqueda" (mousedown)="$event.preventDefault()">
          @for (hit of hits(); track hit.kind + hit.label + $index; let i = $index) {
            <li role="presentation">
              <a role="option" tabindex="-1" [id]="'sv2-hit-' + i" [attr.aria-selected]="active() === i" [class.on]="active() === i" [routerLink]="link(hit.link)" (click)="close()">
                <span class="kind">{{ kind(hit) }}</span><span class="lbl">{{ hit.label }}</span><span class="det">{{ hit.detail }}</span>
              </a>
            </li>
          } @empty {
            <li role="presentation" class="none"><span role="status">Sin resultados para «{{ store.query().trim() }}»</span></li>
          }
          <li role="presentation">
            <a role="option" tabindex="-1" class="all" id="sv2-hit-all" [attr.aria-selected]="active() === hits().length" [class.on]="active() === hits().length" [routerLink]="searchLink" [queryParams]="{ q: store.query().trim() }" (click)="close()">Ver todos los resultados</a>
          </li>
        </ul>
      }
    </form>

    <nav class="actions" aria-label="Acciones">
      <a class="ib" [routerLink]="following" aria-label="Mi fútbol: equipos, competiciones y partidos guardados"><app-sv2-icon name="star" /></a>
      @if (!store.matchPageOpen()) {
        <button type="button" class="ib ctx-toggle" (click)="store.contextOpen.set(!store.contextOpen())" [attr.aria-expanded]="store.contextOpen()" aria-label="Abrir Match Center">
          <app-sv2-icon name="tv" />
        </button>
      }
      <a class="ib" href="/perfil" aria-label="Mi cuenta"><app-sv2-icon name="user" /></a>
    </nav>
  `,
  styles: `
    :host { display: flex; align-items: center; gap: 12px; height: 100%; padding: 0 8px; }
    .brand { display: flex; align-items: center; gap: 10px; color: var(--sv2-text); text-decoration: none; border-radius: 10px; }
    .brand:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    .mark { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: var(--sv2-accent); color: var(--sv2-accent-ink); }
    .word { font-size: var(--sv2-fs-md); font-weight: 700; white-space: nowrap; } .word b { color: var(--sv2-accent); }
    .search { position: relative; flex: 1; min-width: 0; max-width: 520px; margin: 0 auto; display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 16px; border-radius: 999px; background: var(--sv2-surface-2); color: var(--sv2-text-muted); border: 1px solid transparent; }
    .search:focus-within { border-color: var(--sv2-border-strong); background: var(--sv2-surface-3); }
    input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--sv2-text); font: inherit; font-size: var(--sv2-fs-md); outline: none; }
    input::placeholder { color: var(--sv2-text-faint); }
    .search:has(input:focus-visible) { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    .hits { position: absolute; z-index: 30; top: 52px; left: 0; right: 0; margin: 0; padding: 6px; list-style: none; border-radius: var(--sv2-r-md); background: var(--sv2-surface-3); border: 1px solid var(--sv2-border-strong); box-shadow: var(--sv2-shadow); max-height: 70vh; overflow-y: auto; }
    .hits a { display: flex; gap: 10px; align-items: center; min-height: 44px; padding: 0 10px; border-radius: var(--sv2-r-sm); color: var(--sv2-text); text-decoration: none; font-size: var(--sv2-fs-sm); }
    .hits a:hover, .hits a.on { background: var(--sv2-surface-1); }
    .hits a.on { box-shadow: inset 3px 0 0 var(--sv2-accent); }
    .kind { flex: none; font-size: var(--sv2-fs-xs); color: var(--sv2-text-muted); min-width: 84px; }
    .lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .det { flex: none; font-size: var(--sv2-fs-xs); color: var(--sv2-text-faint); max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .all { justify-content: center; font-weight: 700; color: var(--sv2-accent) !important; }
    .none { padding: 12px 10px; font-size: var(--sv2-fs-sm); color: var(--sv2-text-muted); }
    .actions { display: flex; gap: 8px; }
    .ib { display: inline-grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 999px; background: var(--sv2-surface-2); color: var(--sv2-text-muted); cursor: pointer; text-decoration: none; flex: none; }
    .ib:hover { background: var(--sv2-surface-3); color: var(--sv2-text); }
    .ib:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    .sidebar-toggle { display: none; }
    @media (min-width: 1200px) { .sidebar-toggle { display: inline-grid; } .ctx-toggle { display: none; } }
    @media (max-width: 767px) {
      .word { display: none; }
      .search { margin: 0; }
      .kind, .det { display: none; }
      .ctx-toggle { display: none; }
    }
  `,
})
export class Sv2TopNavigationComponent {
  protected readonly store = inject(SportsStore);
  private readonly router = inject(Router);
  protected readonly home = sv2Link();
  protected readonly following = sv2Link('siguiendo');
  protected readonly searchLink = sv2Link('buscar');

  protected readonly dismissed = signal(false);
  protected readonly active = signal(-1);
  protected readonly hits = computed(() => this.store.searchHits());
  protected readonly open = computed(() => !this.dismissed() && this.store.query().trim().length >= 2);
  protected readonly activeId = computed(() => {
    if (!this.open() || this.active() < 0) return null;
    return this.active() === this.hits().length ? 'sv2-hit-all' : `sv2-hit-${this.active()}`;
  });

  protected link(segments: readonly string[]): string[] {
    return sv2Link(...segments);
  }
  protected kind(hit: SearchHit): string {
    return KIND_LABEL[hit.kind];
  }
  protected onInput(value: string): void {
    this.store.query.set(value);
    this.dismissed.set(false);
    this.active.set(-1);
  }
  protected move(ev: Event, delta: number): void {
    if (!this.open()) return;
    ev.preventDefault();
    const size = this.hits().length + 1; // results + "see all"
    this.active.update((i) => (i < 0 ? (delta > 0 ? 0 : size - 1) : (i + delta + size) % size));
  }
  protected escape(ev: Event): void {
    if (this.open()) {
      ev.stopPropagation(); // do not also close the Match Center
      this.dismissed.set(true);
    } else this.store.query.set('');
  }
  protected focusOut(ev: FocusEvent): void {
    if (!(ev.currentTarget as HTMLElement).contains(ev.relatedTarget as Node | null)) this.dismissed.set(true);
  }
  protected close(): void {
    this.dismissed.set(true);
    this.store.query.set('');
  }
  protected submit(): void {
    const query = this.store.query().trim();
    if (query.length < 2) return;
    const hit = this.active() >= 0 && this.active() < this.hits().length ? this.hits()[this.active()] : null;
    this.close();
    void (hit ? this.router.navigate(sv2Link(...hit.link)) : this.router.navigate(this.searchLink, { queryParams: { q: query } }));
  }
}
