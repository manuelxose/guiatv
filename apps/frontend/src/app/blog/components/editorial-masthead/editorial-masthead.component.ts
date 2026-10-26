import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { RouterModule } from '@angular/router';
import { APP_PATHS } from '../../../config/route-map';

/**
 * Editorial product identity lockup. Full version on the Editorial home;
 * `compact` on category/rankings/article pages so the section still reads
 * as "Guías" without repeating the full masthead height.
 */
@Component({
  selector: 'app-editorial-masthead',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="editorial-masthead" [class.editorial-masthead--compact]="compact">
      <h1 *ngIf="!compact; else lockupOnly" class="editorial-masthead__heading">
        <ng-container *ngTemplateOutlet="lockup"></ng-container>
      </h1>
      <ng-template #lockupOnly><ng-container *ngTemplateOutlet="lockup"></ng-container></ng-template>
      <ng-template #lockup>
        <a [routerLink]="appPaths.blog" class="editorial-masthead__lockup">
          <!-- &ngsp; keeps a real space for the heading's text ("Guías de…"); inline-flex does not render it. -->
          <span class="editorial-masthead__word">Guías</span>&ngsp;<span *ngIf="!compact" class="editorial-masthead__kicker">de streaming, fútbol y TV</span>
        </a>
      </ng-template>
      <p *ngIf="!compact" class="editorial-masthead__tagline">Dónde ver cada competición, cuánto cuesta cada plataforma y qué merece la pena, con fuentes oficiales y fecha de comprobación.</p>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .editorial-masthead {
        display: grid;
        gap: var(--space-3);
        padding-block: clamp(1.5rem, 4vw, 2.5rem) 0;
        border-bottom: 1px solid var(--portal-border);
      }

      .editorial-masthead--compact {
        padding-block: var(--space-4) 0;
      }

      .editorial-masthead__heading {
        margin: 0;
        font: inherit;
      }

      .editorial-masthead__lockup {
        display: inline-flex;
        align-items: baseline;
        gap: var(--space-2);
        color: var(--portal-text);
        text-decoration: none;
        width: fit-content;
      }

      .editorial-masthead__kicker {
        font-size: var(--text-sm);
        font-weight: 800;
        letter-spacing: -0.01em;
      }

      .editorial-masthead__word {
        font-size: clamp(1.9rem, 3.6vw, 2.9rem);
        font-weight: 800;
        letter-spacing: -0.04em;
        line-height: 1;
        color: var(--accent-editorial);
      }

      .editorial-masthead--compact .editorial-masthead__word {
        font-size: clamp(1.4rem, 2.4vw, 1.9rem);
      }

      .editorial-masthead__tagline {
        margin: 0 0 var(--space-4);
        color: var(--portal-text-soft);
        font-size: var(--text-md);
      }
    `,
  ],
})
export class EditorialMastheadComponent {
  @Input() compact = false;
  public readonly appPaths = APP_PATHS;
}
