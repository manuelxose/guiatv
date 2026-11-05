import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { sv2Link } from '../sports-v2.paths';

/** En vivo / Partidos / Resultados switcher. Query params (competition, my-teams) travel with it. */
@Component({
  selector: 'app-sv2-matches-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav aria-label="Vista de partidos">
      <a [routerLink]="live" [queryParams]="carry" queryParamsHandling="merge" routerLinkActive="on" ariaCurrentWhenActive="page">En vivo</a>
      <a [routerLink]="fixtures" [queryParams]="carry" queryParamsHandling="merge" routerLinkActive="on" ariaCurrentWhenActive="page">Partidos</a>
      <a [routerLink]="results" [queryParams]="carry" queryParamsHandling="merge" routerLinkActive="on" ariaCurrentWhenActive="page">Resultados</a>
    </nav>
  `,
  styles: `
    nav { display: flex; gap: 8px; }
    a { display: inline-flex; align-items: center; min-height: 36px; padding: 0 16px; border-radius: 999px; background: var(--sv2-surface-2); color: var(--sv2-text); font-size: var(--sv2-fs-sm); font-weight: 600; text-decoration: none; }
    a:hover { background: var(--sv2-surface-3); }
    a.on { background: var(--sv2-text); color: var(--sv2-bg); }
    a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
  `,
})
export class Sv2MatchesNavComponent {
  protected readonly live = sv2Link('en-directo');
  protected readonly fixtures = sv2Link('partidos');
  protected readonly results = sv2Link('resultados');
  /** `dia` only means something on the fixtures page, so it is dropped when switching views. */
  protected readonly carry = { dia: null };
}
