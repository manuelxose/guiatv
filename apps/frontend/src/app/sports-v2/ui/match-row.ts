import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { matchClockLabel, scoreAriaLabel, STATUS_PRESENTATION } from '../domain/match-status';
import { Match, Team } from '../domain/models';
import { Sv2IconComponent } from './icon';
import { Sv2TeamIdentityComponent } from './team-identity';

/**
 * Compact scoreboard row: clock | two team lines | two score cells | save.
 * The body and the save toggle are sibling buttons (no nested interactives).
 * Score and clock cells have fixed widths, so a changing value never moves the layout.
 */
@Component({
  selector: 'app-sv2-match-row',
  standalone: true,
  imports: [Sv2TeamIdentityComponent, Sv2IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="body" [attr.aria-current]="selected() ? 'true' : null" [attr.aria-label]="aria()" (click)="matchSelect.emit(match().slug)">
      <span class="clock" [class]="match().status">
        <span class="glyph" aria-hidden="true">{{ glyph() }}</span>{{ clock() }}
      </span>
      <span class="teams">
        <app-sv2-team-identity [team]="home()" class="t" />
        <app-sv2-team-identity [team]="away()" class="t" />
      </span>
      <span class="scores" [class.live]="match().status === 'live'">
        <b>{{ showScore() ? match().homeScore : '' }}</b>
        <b>{{ showScore() ? match().awayScore : '' }}</b>
      </span>
      @if (showCompetition()) {
        <span class="comp">{{ competitionName() }}</span>
      }
    </button>
    <button type="button" class="save" [class.on]="saved()" [attr.aria-pressed]="saved()" [attr.aria-label]="(saved() ? 'Quitar de guardados ' : 'Guardar ') + home().name + ' contra ' + away().name" (click)="saveToggle.emit(match().slug)">
      <app-sv2-icon name="bookmark" />
    </button>
  `,
  styles: `
    :host { position: relative; display: block; --sv2-badge: 22px; container-type: inline-size; }
    .body { all: unset; box-sizing: border-box; display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; align-items: center; column-gap: 12px; width: 100%; min-height: 64px; padding: 8px 52px 8px 12px; border-radius: var(--sv2-r-sm); cursor: pointer; transition: background var(--sv2-dur) var(--sv2-ease); }
    .body:hover { background: var(--sv2-surface-2); }
    .body:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: -2px; }
    .body[aria-current='true'] { background: var(--sv2-surface-2); box-shadow: inset 3px 0 0 var(--sv2-accent); }
    .clock { display: inline-flex; align-items: center; justify-content: flex-start; gap: 4px; width: 64px; font-size: var(--sv2-fs-xs); font-weight: 700; font-variant-numeric: tabular-nums; color: var(--sv2-text-muted); white-space: nowrap; }
    .clock.live { color: var(--sv2-live); }
    .clock.scheduled { color: var(--sv2-scheduled); }
    .clock.postponed { color: var(--sv2-postponed); }
    .glyph { font-size: .7em; }
    .clock.live .glyph { animation: sv2-pulse 1.6s ease-in-out infinite; }
    @keyframes sv2-pulse { 50% { opacity: .35; } }
    .teams { display: grid; gap: 6px; min-width: 0; }
    .t { max-width: 100%; }
    .scores { display: grid; gap: 6px; justify-items: end; min-width: 28px; font-size: var(--sv2-fs-md); font-variant-numeric: tabular-nums; }
    .scores b { display: block; min-width: 2ch; height: 22px; line-height: 22px; text-align: right; font-weight: 700; }
    .scores.live b { color: var(--sv2-text); }
    .comp { display: none; grid-column: 4; font-size: var(--sv2-fs-xs); color: var(--sv2-text-faint); white-space: nowrap; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
    @container (min-width: 640px) {
      .body { grid-template-columns: 64px minmax(0, 1fr) auto minmax(0, 200px); }
      .comp { display: block; }
    }
    .save { position: absolute; top: 50%; right: 8px; transform: translateY(-50%); display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; color: var(--sv2-text-faint); cursor: pointer; --sv2-icon: 18px; }
    .save:hover { color: var(--sv2-text); background: var(--sv2-surface-3); }
    .save.on { color: var(--sv2-accent); }
    .save:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .body { transition: none; } .clock.live .glyph { animation: none; } }
  `,
})
export class Sv2MatchRowComponent {
  readonly match = input.required<Match>();
  readonly home = input.required<Team>();
  readonly away = input.required<Team>();
  readonly competitionName = input('');
  readonly showCompetition = input(false);
  readonly selected = input(false);
  readonly saved = input(false);
  readonly matchSelect = output<string>();
  readonly saveToggle = output<string>();

  protected readonly clock = computed(() => matchClockLabel(this.match().status, this.match().minute, this.match().kickoff));
  protected readonly glyph = computed(() => STATUS_PRESENTATION[this.match().status].glyph);
  protected readonly showScore = computed(() => (this.match().status === 'live' || this.match().status === 'finished') && this.match().homeScore != null);
  protected readonly aria = computed(() => {
    const m = this.match();
    const comp = this.competitionName() ? `${this.competitionName()}. ` : '';
    const time = m.status === 'scheduled' ? ` a las ${this.clock()}` : m.status === 'live' && m.minute != null ? `, minuto ${m.minute}` : '';
    return `${comp}${scoreAriaLabel(this.home().name, this.away().name, m.status, m.homeScore, m.awayScore)}${time}. Ver detalle del partido`;
  });
}
