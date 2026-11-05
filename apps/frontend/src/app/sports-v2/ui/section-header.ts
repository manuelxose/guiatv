import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-sv2-section-header',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>{{ title() }}</h2>
    @if (linkLabel() && link()) {
      <a [routerLink]="link()">{{ linkLabel() }}</a>
    }
  `,
  styles: `
    :host { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 0 12px; }
    h2 { margin: 0; font-size: var(--sv2-fs-lg); font-weight: 700; letter-spacing: -.01em; }
    a { font-size: var(--sv2-fs-sm); font-weight: 600; color: var(--sv2-text-muted); text-decoration: none; border-radius: 6px; }
    a:hover { color: var(--sv2-text); text-decoration: underline; }
    a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
  `,
})
export class Sv2SectionHeaderComponent {
  readonly title = input.required<string>();
  readonly linkLabel = input<string>();
  readonly link = input<readonly string[] | string>();
}
