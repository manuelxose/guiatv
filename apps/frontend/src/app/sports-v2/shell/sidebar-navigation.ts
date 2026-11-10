import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SportsStore } from '../state/sports-store';
import { sv2Link } from '../sports-v2.paths';
import { Sv2IconComponent } from '../ui/icon';
import { Sv2TeamIdentityComponent } from '../ui/team-identity';
import { NAV_ITEMS } from './nav-items';

@Component({
  selector: 'app-sv2-sidebar-navigation',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, Sv2IconComponent, Sv2TeamIdentityComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav aria-label="Mi fútbol">
      <h2 class="title">Mi fútbol</h2>
      <ul>
        @for (item of items; track item.label) {
          <li>
            <a
              [routerLink]="item.path || link(item.segments)"
              routerLinkActive="active"
              ariaCurrentWhenActive="page"
              [routerLinkActiveOptions]="{ exact: item.segments.length === 0 }"
              [attr.title]="item.label"
              [attr.aria-label]="item.label"
            >
              <app-sv2-icon [name]="item.icon" /><span class="label">{{ item.label }}</span>
            </a>
          </li>
        }
      </ul>

      <h3 class="group">Siguiendo</h3>
      <ul>
        @for (team of store.followedTeams(); track team.slug) {
          <li>
            <a [routerLink]="link(['equipos', team.slug])" routerLinkActive="active" ariaCurrentWhenActive="page" [attr.title]="team.name" [attr.aria-label]="team.name">
              <app-sv2-team-identity [team]="team" [hideName]="store.sidebarCollapsed()" />
            </a>
          </li>
        } @empty {
          <li class="empty label">Aún no sigues equipos.</li>
        }
      </ul>

      <h3 class="group">Competiciones favoritas</h3>
      <ul>
        @for (comp of store.favoriteCompetitions(); track comp.slug) {
          <li>
            <a [routerLink]="link(['competiciones', comp.slug])" routerLinkActive="active" ariaCurrentWhenActive="page" [attr.title]="comp.name" [attr.aria-label]="comp.name">
              <app-sv2-icon name="star" /><span class="label">{{ comp.name }}</span>
            </a>
          </li>
        } @empty {
          <li class="empty label">Márcalas desde su página.</li>
        }
      </ul>
    </nav>
  `,
  styles: `
    :host { display: block; height: 100%; overflow-y: auto; overflow-x: hidden; padding: 16px 8px; }
    ul { list-style: none; margin: 0 0 8px; padding: 0; display: grid; gap: 2px; }
    .title { margin: 0 8px 12px; font-size: var(--sv2-fs-md); font-weight: 700; }
    .group { margin: 16px 12px 8px; font-size: var(--sv2-fs-xs); font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--sv2-text-faint); }
    a { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 12px; border-radius: var(--sv2-r-sm); color: var(--sv2-text-muted); text-decoration: none; font-size: var(--sv2-fs-sm); font-weight: 600; }
    a:hover { background: var(--sv2-surface-2); color: var(--sv2-text); }
    a.active { background: var(--sv2-surface-3); color: var(--sv2-text); box-shadow: inset 3px 0 0 var(--sv2-accent); }
    a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: -2px; }
    .empty { padding: 0 12px; font-size: var(--sv2-fs-sm); color: var(--sv2-text-faint); }
    :host-context(.collapsed) .label, :host-context(.collapsed) .title, :host-context(.collapsed) .group, :host-context(.collapsed) .empty { display: none; }
    :host-context(.collapsed) a { justify-content: center; padding: 0; }
    :host-context(.collapsed) app-sv2-team-identity { --sv2-name-display: none; }
    @media (min-width: 768px) and (max-width: 1199px) { .label, .title, .group, .empty { display: none; } a { justify-content: center; padding: 0; } app-sv2-team-identity { --sv2-name-display: none; } }
  `,
})
export class Sv2SidebarNavigationComponent {
  protected readonly store = inject(SportsStore);
  protected readonly items = NAV_ITEMS;
  protected link(segments: readonly string[]): string[] {
    return sv2Link(...segments);
  }
}
