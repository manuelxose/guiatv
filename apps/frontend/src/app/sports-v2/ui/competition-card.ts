import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Competition } from '../domain/models';
import { sv2Link } from '../sports-v2.paths';
import { Sv2CompetitionLogoComponent } from './competition-logo';

@Component({
  selector: 'app-sv2-competition-card',
  standalone: true,
  imports: [RouterLink, Sv2CompetitionLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a [routerLink]="link()" [style.--hue]="competition().hue" [class.nodata]="competition().hasData === false">
      <span class="ico"><app-sv2-competition-logo [url]="competition().logoUrl" /></span>
      <span class="txt">
        <strong>{{ competition().name }}</strong>
        <small>{{ competition().country }} · {{ kindLabel() }}@if (competition().hasData === false) { · <em>Sin datos todavía</em> }</small>
      </span>
    </a>
  `,
  styles: `
    :host { display: block; }
    a { display: flex; align-items: center; gap: 12px; min-height: 72px; padding: 14px; border-radius: var(--sv2-r-md); color: var(--sv2-text); text-decoration: none;
      background: linear-gradient(135deg, hsl(var(--hue) 40% 22%), var(--sv2-surface-2) 80%); border: 1px solid var(--sv2-border); transition: border-color var(--sv2-dur) var(--sv2-ease); }
    a:hover { border-color: var(--sv2-border-strong); }
    a.nodata { background: var(--sv2-surface-2); }
    em { font-style: normal; color: var(--sv2-text-muted); }
    a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    .ico { display: grid; place-items: center; width: 40px; height: 40px; border-radius: var(--sv2-r-sm); background: rgba(255,255,255,.1); flex: none; }
    .txt { display: grid; gap: 2px; min-width: 0; }
    strong { font-size: var(--sv2-fs-md); }
    small { font-size: var(--sv2-fs-xs); color: var(--sv2-text-muted); }
    @media (prefers-reduced-motion: reduce) { a { transition: none; } }
  `,
})
export class Sv2CompetitionCardComponent {
  readonly competition = input.required<Competition>();
  protected readonly link = computed(() => sv2Link('competiciones', this.competition().slug));
  protected readonly kindLabel = computed(
    () => ({ league: 'Liga', cup: 'Copa', international: 'Internacional' })[this.competition().kind],
  );
}
