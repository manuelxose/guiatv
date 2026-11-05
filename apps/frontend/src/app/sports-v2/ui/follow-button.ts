import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Sv2IconComponent } from './icon';

/** Toggle button for follow / unfollow. The accessible name always says who it acts on. */
@Component({
  selector: 'app-sv2-follow-button',
  standalone: true,
  imports: [Sv2IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" [class.on]="following()" [attr.aria-pressed]="following()" [attr.aria-label]="(following() ? 'Dejar de seguir ' : 'Seguir ') + subject()" (click)="followToggle.emit()">
      <app-sv2-icon [name]="following() ? 'check' : 'plus'" />
      <span>{{ following() ? 'Siguiendo' : 'Seguir' }}</span>
    </button>
  `,
  styles: `
    :host { display: inline-block; }
    button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 112px; min-height: 40px; padding: 0 16px; border: 1px solid var(--sv2-border-strong); border-radius: 999px; background: transparent; color: var(--sv2-text); font: inherit; font-size: var(--sv2-fs-sm); font-weight: 700; cursor: pointer; --sv2-icon: 16px; transition: background var(--sv2-dur) var(--sv2-ease); }
    button:hover { background: var(--sv2-surface-3); }
    button.on { background: var(--sv2-accent); border-color: var(--sv2-accent); color: var(--sv2-accent-ink); }
    button:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { button { transition: none; } }
  `,
})
export class Sv2FollowButtonComponent {
  readonly following = input(false);
  /** Name of the team or competition, used in the accessible label. */
  readonly subject = input.required<string>();
  readonly followToggle = output<void>();
}
