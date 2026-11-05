import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { matchClockLabel, scoreAriaLabel } from '../domain/match-status';
import { Match, Team } from '../domain/models';
import { Sv2IconComponent } from './icon';
import { Sv2ScoreDisplayComponent } from './score-display';
import { Sv2StatusIndicatorComponent } from './status-indicator';
import { Sv2TeamIdentityComponent } from './team-identity';

/** Selectable fixture card. The card body and the track toggle are sibling buttons (no nested interactives). */
@Component({
  selector: 'app-sv2-match-card',
  standalone: true,
  imports: [Sv2TeamIdentityComponent, Sv2ScoreDisplayComponent, Sv2StatusIndicatorComponent, Sv2IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="body" [attr.aria-current]="selected() ? 'true' : null" [attr.aria-label]="aria()" (click)="matchSelect.emit(match().slug)">
      <span class="meta">
        <span class="comp">{{ competitionName() }}</span>
        <app-sv2-status-indicator [status]="match().status" />
      </span>
      <span class="teams">
        <app-sv2-team-identity [team]="home()" layout="stack" />
        <span class="mid">
          <app-sv2-score-display [home]="match().homeScore" [away]="match().awayScore" [status]="match().status" />
          <span class="clock">{{ clock() }}</span>
        </span>
        <app-sv2-team-identity [team]="away()" layout="stack" />
      </span>
    </button>
    <button
      type="button"
      class="track"
      [class.on]="tracked()"
      [attr.aria-pressed]="tracked()"
      [attr.aria-label]="(tracked() ? 'Dejar de seguir ' : 'Seguir ') + home().name + ' contra ' + away().name"
      (click)="trackToggle.emit(match().slug)"
    >
      <app-sv2-icon name="track" />
    </button>
  `,
  styles: `
    :host { position: relative; display: block; --sv2-badge: 36px; }
    .body { all: unset; box-sizing: border-box; display: grid; gap: 12px; width: 100%; padding: 12px 14px; border-radius: var(--sv2-r-md); background: var(--sv2-surface-2); border: 1px solid var(--sv2-border); cursor: pointer; transition: background var(--sv2-dur) var(--sv2-ease), border-color var(--sv2-dur) var(--sv2-ease); }
    .body:hover { background: var(--sv2-surface-3); }
    .body:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    .body[aria-current='true'] { border-color: var(--sv2-accent); }
    .meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-right: 36px; }
    .comp { font-size: var(--sv2-fs-xs); color: var(--sv2-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .teams { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
    .mid { display: grid; justify-items: center; gap: 6px; min-width: 64px; --sv2-score-size: var(--sv2-fs-xl); }
    .clock { font-size: var(--sv2-fs-xs); font-weight: 600; color: var(--sv2-text-muted); font-variant-numeric: tabular-nums; }
    .track { position: absolute; top: 6px; right: 6px; display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 50%; background: transparent; color: var(--sv2-text-faint); cursor: pointer; }
    .track:hover { color: var(--sv2-text); background: var(--sv2-surface-3); }
    .track.on { color: var(--sv2-accent-ink); background: var(--sv2-accent); }
    .track:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    .track app-sv2-icon { --sv2-icon: 18px; }
    @media (prefers-reduced-motion: reduce) { .body { transition: none; } }
  `,
})
export class Sv2MatchCardComponent {
  readonly match = input.required<Match>();
  readonly home = input.required<Team>();
  readonly away = input.required<Team>();
  readonly competitionName = input('');
  readonly selected = input(false);
  readonly tracked = input(false);
  readonly matchSelect = output<string>();
  readonly trackToggle = output<string>();

  protected readonly clock = computed(() => matchClockLabel(this.match().status, this.match().minute, this.match().kickoff));
  protected readonly aria = computed(() => {
    const m = this.match();
    return `${scoreAriaLabel(this.home().name, this.away().name, m.status, m.homeScore, m.awayScore)}. Ver detalle del partido`;
  });
}
