import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Params, RouterLink, RouterLinkActive } from '@angular/router';
import { resolvePlatformLogoUrl } from '../../utils/platform-logos';

export interface PanelNavLink {
  label: string;
  path: string;
  queryParams?: Params;
  /** SVG path (24×24) drawn with the menu's stroke style. */
  iconPath?: string;
  /** Brand mark (channel logo, platform icon) shown instead of the initial. */
  logoUrl?: string;
  /** Highlight only on an exact URL match (e.g. the section home). */
  exact?: boolean;
  /** Filter option (group links): drawn as a radio, selected when true, instead of following the URL. */
  active?: boolean;
}

export interface PanelNavGroup {
  title: string;
  links: PanelNavLink[];
  /** Shown when the group has no links. */
  empty?: string;
}

/** Section menu for the left panel of app-panel-shell; same look as the football sidebar. */
@Component({
  selector: 'app-panel-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav [attr.aria-label]="title()">
      <h2 class="title">{{ title() }}</h2>
      <ul>
        @for (link of links(); track link.label) {
          <li>
            <a [routerLink]="link.path" [queryParams]="link.queryParams" routerLinkActive="active" ariaCurrentWhenActive="page" [routerLinkActiveOptions]="{ exact: !!link.exact }" [attr.title]="link.label" [attr.aria-label]="link.label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path [attr.d]="link.iconPath || dot" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
              <span class="label">{{ link.label }}</span>
            </a>
          </li>
        }
      </ul>
      @for (group of groups(); track group.title) {
        <h3 class="group">{{ group.title }}</h3>
        <ul>
          @for (link of group.links; track link.label) {
            <li>
              @if (link.active === undefined) {
              <a [routerLink]="link.path" [queryParams]="link.queryParams" routerLinkActive="active" ariaCurrentWhenActive="page" [attr.title]="link.label" [attr.aria-label]="link.label">
                @if (logo(link); as mark) {
                <img class="logo" [src]="mark" [alt]="''" width="24" height="24" loading="lazy" aria-hidden="true" (error)="onLogoError(link)" />
                } @else {
                <span class="initial" aria-hidden="true">{{ link.label.charAt(0) }}</span>
                }
                <span class="label">{{ link.label }}</span>
              </a>
              } @else {
              <a class="facet" [class.on]="link.active" [routerLink]="link.path" [queryParams]="link.queryParams" [attr.aria-current]="link.active ? 'true' : null">
                <span class="radio" aria-hidden="true"></span>
                @if (logo(link); as mark) {
                <img class="logo logo--facet" [src]="mark" [alt]="''" width="18" height="18" loading="lazy" aria-hidden="true" (error)="onLogoError(link)" />
                }
                <span class="label">{{ link.label }}</span>
              </a>
              }
            </li>
          } @empty {
            <li class="empty label">{{ group.empty }}</li>
          }
        </ul>
      }
    </nav>
  `,
  styles: `
    :host { display: block; height: 100%; overflow-y: auto; overflow-x: hidden; padding: 16px 8px; }
    ul { list-style: none; margin: 0 0 8px; padding: 0; display: grid; gap: 2px; }
    .title { margin: 0 8px 12px; font-size: var(--sv2-fs-md); font-weight: 700; }
    .group { margin: 16px 12px 8px; font-size: var(--sv2-fs-xs); font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--sv2-text-faint); }
    a { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 12px; border-radius: var(--sv2-r-sm); color: var(--sv2-text-muted); text-decoration: none; font-size: var(--sv2-fs-sm); font-weight: 600; }
    a:hover { background: var(--sv2-surface-2); color: var(--sv2-text); }
    a.active { background: var(--sv2-surface-3); color: var(--sv2-text); box-shadow: inset 3px 0 0 var(--section-accent); }
    a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: -2px; }
    svg { width: 20px; height: 20px; flex: none; }
    .initial { display: grid; place-items: center; width: 24px; height: 24px; flex: none; border-radius: 6px; background: var(--sv2-surface-2); font-size: var(--sv2-fs-xs); font-weight: 800; color: var(--sv2-text); }
    .logo { width: 24px; height: 24px; flex: none; object-fit: contain; border-radius: 6px; }
    .logo--facet { width: 18px; height: 18px; border-radius: 4px; }
    .empty { padding: 0 12px; font-size: var(--sv2-fs-sm); color: var(--sv2-text-faint); }
    a.facet { min-height: 34px; gap: 10px; font-weight: 500; }
    a.facet.on { color: var(--sv2-text); }
    .radio { width: 14px; height: 14px; flex: none; border-radius: 50%; border: 1.5px solid var(--sv2-text-faint); }
    a.facet.on .radio { border: 4px solid var(--section-accent-text); }
    :host-context(.collapsed) .label, :host-context(.collapsed) .title, :host-context(.collapsed) .group, :host-context(.collapsed) .empty, :host-context(.collapsed) .facet { display: none; }
    :host-context(.collapsed) a { justify-content: center; padding: 0; }
    /* Icon rail: filter options have no icon, so they are shown in the page instead. */
    @media (min-width: 768px) and (max-width: 1199px) { .label, .title, .group, .empty, .facet { display: none; } a { justify-content: center; padding: 0; } }
  `,
})
export class PanelNavComponent {
  readonly title = input.required<string>();
  readonly links = input.required<PanelNavLink[]>();
  readonly groups = input<PanelNavGroup[]>([]);
  protected readonly dot = 'M12 12h.01';

  private readonly failedLogos = new Set<string>();

  /** Explicit mark (channel logos come from the EPG), else the platform brand
   * mark when the label names one; empty means the initial is shown. */
  logo(link: PanelNavLink): string {
    if (this.failedLogos.has(link.label)) return '';
    return link.logoUrl?.trim() || resolvePlatformLogoUrl(link.label);
  }

  onLogoError(link: PanelNavLink): void {
    this.failedLogos.add(link.label);
  }
}
