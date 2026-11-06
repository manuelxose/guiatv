import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
// The one shared contract with the rest of the app: where the top-level sections live. Pure data, no UI.
import { PORTAL_PRIMARY_DESTINATIONS } from '../../config/portal-navigation.config';

/** Links to the other Guía TV sections, so the sports header never strands the visitor. Football is the current one. */
@Component({
  selector: 'app-sv2-site-nav',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="more" [attr.aria-expanded]="open()" aria-controls="sv2-site-links" aria-label="Secciones de Guía TV" (click)="open.set(!open())" (keydown.escape)="open.set(false)">
      <span class="lbl">Secciones</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
    <nav id="sv2-site-links" aria-label="Secciones de Guía TV" [class.open]="open()">
      @for (d of sections; track d.id) {
        <a [routerLink]="d.path" [attr.aria-current]="d.id === 'sports' ? 'page' : null" [class.on]="d.id === 'sports'" (click)="open.set(false)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path [attr.d]="d.iconPath" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
          {{ d.label }}
        </a>
      }
    </nav>
  `,
  styles: `
    :host { position: relative; display: block; flex: none; }
    svg { width: 18px; height: 18px; flex: none; }
    .more, a { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; color: var(--sv2-text-muted); font: inherit; font-size: var(--sv2-fs-sm); font-weight: 600; text-decoration: none; white-space: nowrap; cursor: pointer; }
    .more:hover, a:hover { color: var(--sv2-text); background: var(--sv2-surface-2); }
    a.on { color: var(--sv2-text); background: var(--sv2-surface-3); box-shadow: inset 0 -2px 0 var(--sv2-accent); }
    .more:focus-visible, a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    // Below desktop the links collapse into a menu.
    nav { display: none; position: absolute; z-index: 60; top: 48px; left: 0; min-width: 200px; padding: 6px; border-radius: var(--sv2-r-md); background: var(--sv2-surface-3); border: 1px solid var(--sv2-border-strong); box-shadow: var(--sv2-shadow); }
    nav.open { display: grid; }
    nav a { border-radius: var(--sv2-r-sm); }
    // Narrow screens: icon-only trigger, so the search keeps its room.
    @media (max-width: 767px) { .lbl { display: none; } .more { padding: 0 10px; width: 44px; justify-content: center; background: var(--sv2-surface-2); } }
    @media (min-width: 1200px) {
      .more { display: none; }
      nav, nav.open { display: flex; position: static; min-width: 0; padding: 0; gap: 2px; background: transparent; border: 0; box-shadow: none; }
    }
  `,
})
export class Sv2SiteNavComponent {
  protected readonly sections = PORTAL_PRIMARY_DESTINATIONS;
  protected readonly open = signal(false);
}
