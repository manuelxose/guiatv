import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Competition } from '../domain/models';

/** Competition chips plus a "my teams" toggle. Stateless: the page owns the filter (in the URL). */
@Component({
  selector: 'app-sv2-filter-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar" role="group" aria-label="Filtrar partidos">
      <button type="button" [attr.aria-pressed]="!competition() && !followedOnly()" (click)="reset()">Todos</button>
      <button type="button" [attr.aria-pressed]="followedOnly()" [disabled]="!canFollow()" [attr.title]="canFollow() ? null : 'Sigue algún equipo para usar este filtro'" (click)="followedChange.emit(!followedOnly())">Mis equipos</button>
      @for (c of competitions(); track c.slug) {
        <button type="button" [attr.aria-pressed]="competition() === c.slug" (click)="competitionChange.emit(competition() === c.slug ? null : c.slug)">{{ c.name }}</button>
      }
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .bar { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; }
    .bar::-webkit-scrollbar { display: none; }
    button { flex: none; min-height: 36px; padding: 0 14px; border: 1px solid var(--sv2-border); border-radius: 999px; background: var(--sv2-surface-2); color: var(--sv2-text); font: inherit; font-size: var(--sv2-fs-sm); font-weight: 600; white-space: nowrap; cursor: pointer; }
    button:hover:not(:disabled) { background: var(--sv2-surface-3); }
    button[aria-pressed='true'] { background: var(--sv2-text); border-color: var(--sv2-text); color: var(--sv2-bg); }
    button:disabled { color: var(--sv2-text-faint); cursor: not-allowed; }
    button:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
  `,
})
export class Sv2FilterBarComponent {
  readonly competitions = input.required<readonly Competition[]>();
  readonly competition = input<string | null>(null);
  readonly followedOnly = input(false);
  readonly canFollow = input(false);
  readonly competitionChange = output<string | null>();
  readonly followedChange = output<boolean>();
  /** One event, because two back-to-back URL updates would overwrite each other. */
  readonly filtersReset = output<void>();

  protected reset(): void {
    this.filtersReset.emit();
  }
}
