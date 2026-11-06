import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { stamp } from '../domain/calendar';
import { NewsItem } from '../domain/models';
import { Sv2EmptyStateComponent } from '../ui/states';

/** News rows. Items are not links in M01: article routes arrive with the real news adapter (M03). */
@Component({
  selector: 'app-sv2-news-list',
  standalone: true,
  imports: [Sv2EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length) {
      <ul>
        @for (n of items(); track n.slug) {
          <li>
            <article>
              <p class="kicker">{{ n.kicker }} · <time [attr.datetime]="n.publishedAt">{{ stamp(n.publishedAt) }}</time></p>
              <h3>{{ n.title }}</h3>
            </article>
          </li>
        }
      </ul>
    } @else {
      <app-sv2-empty-state title="No hay noticias" hint="Vuelve más tarde." />
    }
  `,
  styles: `
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    article { padding: 14px 16px; border-radius: var(--sv2-r-md); background: var(--sv2-surface-2); border: 1px solid var(--sv2-border); }
    .kicker { margin: 0 0 4px; font-size: var(--sv2-fs-xs); color: var(--sv2-text-muted); }
    h3 { margin: 0; font-size: var(--sv2-fs-md); font-weight: 600; line-height: 1.35; }
  `,
})
export class Sv2NewsListComponent {
  protected readonly stamp = stamp;
  readonly items = input.required<readonly NewsItem[]>();
}
