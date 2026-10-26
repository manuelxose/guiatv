import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { RouterModule } from '@angular/router';

/**
 * Compact section header with an optional "see all" link.
 */
@Component({
  selector: 'app-football-section-header',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="header">
      <div class="header__titles">
        <span *ngIf="eyebrow" class="header__eyebrow">{{ eyebrow }}</span>
        <h2 class="header__title">{{ title }}</h2>
      </div>
      <a *ngIf="link" class="header__link" [routerLink]="link">
        {{ linkLabel }}
        <span aria-hidden="true">→</span>
      </a>
    </header>
  `,
  styles: `
    .header {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }
    .header__titles { display: flex; flex-direction: column; gap: 0.125rem; min-width: 0; }
    .header__eyebrow {
      font-size: 0.6875rem;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--portal-text-soft);
    }
    .header__title {
      margin: 0;
      font-size: var(--text-lg);
      font-weight: 850;
      letter-spacing: -0.01em;
      color: var(--portal-text);
    }
    .header__link {
      flex: 0 0 auto;
      display: inline-flex;
      min-height: 44px;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.8125rem;
      font-weight: 700;
      color: var(--portal-text-muted);
      text-decoration: none;
      white-space: nowrap;
    }
    .header__link:hover { color: var(--portal-text); text-decoration: underline; }
    .header__link:focus-visible { outline: 2px solid var(--accent-sports); outline-offset: 2px; border-radius: var(--radius-sm); }
  `,
})
export class FootballSectionHeaderComponent {
  @Input() title = '';
  @Input() eyebrow = '';
  @Input() link = '';
  @Input() linkLabel = 'Ver todo';
}
