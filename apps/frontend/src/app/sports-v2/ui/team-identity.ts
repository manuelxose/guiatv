import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Team } from '../domain/models';

/** Monogram badge: genuine crests are only used once licensed (tracked for M02+). */
@Component({
  selector: 'app-sv2-team-identity',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="badge" aria-hidden="true" [style.background]="bg()">{{ team().shortName }}</span>
    @if (!hideName()) {
      <span class="name">{{ team().name }}</span>
    }
  `,
  styles: `
    :host { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
    :host(.stack) { flex-direction: column; gap: 6px; text-align: center; }
    .badge { display: inline-grid; place-items: center; width: var(--sv2-badge, 32px); height: var(--sv2-badge, 32px); border-radius: 50%; flex: none;
      font-size: calc(var(--sv2-badge, 32px) * .3); font-weight: 700; color: #fff; letter-spacing: .02em; border: 1px solid rgba(255,255,255,.18); }
    .name { display: var(--sv2-name-display, block); font-size: var(--sv2-fs-sm); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    :host(.stack) .name { white-space: normal; }
  `,
  host: { '[class.stack]': 'layout() === "stack"' },
})
export class Sv2TeamIdentityComponent {
  readonly team = input.required<Team>();
  readonly layout = input<'row' | 'stack'>('row');
  readonly hideName = input(false);
  protected readonly bg = computed(() => `hsl(${this.team().hue} 45% 32%)`);
}
