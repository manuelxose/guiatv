import { ChangeDetectionStrategy, Component, booleanAttribute, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-sv2-empty-state',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (page()) {
      <h1 class="t">{{ title() }}</h1>
    } @else {
      <p class="t">{{ title() }}</p>
    }
    @if (hint()) {
      <p class="h">{{ hint() }}</p>
    }
    @if (actionLabel() && actionLink()) {
      <a class="act" [routerLink]="actionLink()">{{ actionLabel() }}</a>
    }
  `,
  styles: `
    :host { display: block; padding: 24px 16px; text-align: center; border: 1px dashed var(--sv2-border-strong); border-radius: var(--sv2-r-md); }
    p, h1 { margin: 0; } .t { font-weight: 600; font-size: 1em; } .h { margin-top: 4px; font-size: var(--sv2-fs-sm); color: var(--sv2-text-muted); }
    .act { display: inline-flex; align-items: center; min-height: 40px; margin-top: 12px; padding: 0 16px; border-radius: 999px; background: var(--sv2-accent); color: var(--sv2-accent-ink); font-weight: 700; font-size: var(--sv2-fs-sm); text-decoration: none; }
    .act:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
  `,
})
export class Sv2EmptyStateComponent {
  readonly title = input.required<string>();
  /** The state is the whole page (not found): its title is the page's only h1. */
  readonly page = input(false, { transform: booleanAttribute });
  readonly hint = input<string>();
  readonly actionLabel = input<string>();
  readonly actionLink = input<readonly string[]>();
}

@Component({
  selector: 'app-sv2-error-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="t">{{ title() }}</p>
    <p class="h">{{ hint() }}</p>
    <button type="button" (click)="retry.emit()">Reintentar</button>
  `,
  styles: `
    :host { display: block; padding: 24px 16px; text-align: center; border: 1px solid color-mix(in srgb, var(--sv2-live) 40%, transparent); border-radius: var(--sv2-r-md); background: var(--sv2-surface-1); }
    p { margin: 0; } .t { font-weight: 600; } .h { margin: 4px 0 12px; font-size: var(--sv2-fs-sm); color: var(--sv2-text-muted); }
    button { min-height: 40px; padding: 0 16px; border: 0; border-radius: 999px; background: var(--sv2-accent); color: var(--sv2-accent-ink); font: inherit; font-weight: 700; cursor: pointer; }
    button:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
  `,
  host: { role: 'alert' },
})
export class Sv2ErrorStateComponent {
  readonly title = input('No hemos podido cargar los datos');
  readonly hint = input('Comprueba tu conexión e inténtalo de nuevo.');
  readonly retry = output<void>();
}

@Component({
  selector: 'app-sv2-loading-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (i of rows(); track i) {
      <span class="row"></span>
    }
  `,
  styles: `
    :host { display: grid; gap: 12px; }
    .row { height: var(--sv2-skeleton-h, 72px); border-radius: var(--sv2-r-md); background: linear-gradient(90deg, var(--sv2-surface-1), var(--sv2-surface-2), var(--sv2-surface-1)); background-size: 200% 100%; animation: sv2-shimmer 1.4s linear infinite; }
    @keyframes sv2-shimmer { to { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .row { animation: none; } }
  `,
  host: { role: 'status', 'aria-label': 'Cargando', 'aria-busy': 'true' },
})
export class Sv2LoadingSkeletonComponent {
  readonly count = input(3);
  protected rows(): number[] {
    return Array.from({ length: this.count() }, (_, i) => i);
  }
}
