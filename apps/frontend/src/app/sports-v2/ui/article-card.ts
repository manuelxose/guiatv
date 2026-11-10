import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { stamp } from '../domain/calendar';
import { NewsItem } from '../domain/models';
import { sv2Link } from '../sports-v2.paths';

/**
 * Editorial card. `hero` is the big lead, `card` the standard tile, `row` a compact line.
 * Without a licensed image the art is a neutral gradient from the article hue, at a fixed
 * aspect ratio so lists never jump when images arrive.
 */
@Component({
  selector: 'app-sv2-article-card',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a [routerLink]="link()" [class]="'c ' + variant()" [style.--hue]="item().hue ?? 210">
      <span class="art" aria-hidden="true">
        @if (item().image; as img) {
          <img [src]="img.url" [alt]="''" loading="lazy" />
        }
        <span class="kick-badge">{{ item().kicker }}</span>
      </span>
      <span class="txt">
        <strong>{{ item().title }}</strong>
        @if (variant() !== 'row') {
          <span class="sum">{{ item().summary }}</span>
        }
        <span class="meta">{{ item().author }} · <time [attr.datetime]="item().publishedAt">{{ when() }}</time></span>
      </span>
    </a>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .c { display: grid; gap: 12px; height: 100%; color: var(--sv2-text); text-decoration: none; border-radius: var(--sv2-r-md); }
    .c:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 4px; }
    .art { position: relative; display: block; aspect-ratio: 16 / 9; overflow: hidden; border-radius: var(--sv2-r-md); border: 1px solid var(--sv2-border);
      background: radial-gradient(120% 140% at 0% 0%, hsl(var(--hue) 55% 34%), hsl(calc(var(--hue) + 40) 40% 14%) 70%), var(--sv2-surface-2); }
    .art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .kick-badge { position: absolute; left: 10px; bottom: 10px; padding: 3px 10px; border-radius: 999px; background: rgba(0,0,0,.55); font-size: var(--sv2-fs-xs); font-weight: 700; letter-spacing: .02em; }
    .txt { display: grid; gap: 6px; align-content: start; min-width: 0; }
    strong { font-size: var(--sv2-fs-md); line-height: 1.3; }
    .c:hover strong { text-decoration: underline; text-underline-offset: 3px; }
    .sum { font-size: var(--sv2-fs-sm); line-height: 1.45; color: var(--sv2-text-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .meta { font-size: var(--sv2-fs-xs); color: var(--sv2-text-faint); }
    .hero { gap: 16px; }
    .hero strong { font-size: var(--sv2-fs-xl); letter-spacing: -.02em; line-height: 1.2; }
    .hero .sum { font-size: var(--sv2-fs-md); -webkit-line-clamp: 3; }
    .row { grid-template-columns: 112px minmax(0, 1fr); align-items: center; gap: 12px; }
    .row .art { border-radius: var(--sv2-r-sm); }
    .row .kick-badge { display: none; }
    @media (min-width: 900px) { .hero { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: center; } }
  `,
})
export class Sv2ArticleCardComponent {
  readonly item = input.required<NewsItem>();
  readonly variant = input<'hero' | 'card' | 'row'>('card');
  protected when(): string {
    return stamp(this.item().publishedAt);
  }
  /** Blog guides open in Guías (their canonical page); other news keep the football article page. */
  protected link(): string[] {
    const canonical = this.item().canonicalPath;
    return canonical ? [canonical] : sv2Link('noticias', this.item().slug);
  }
}
