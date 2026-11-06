import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { dayKey, kickoffTime, longDay, zoneDescription } from '../domain/calendar';
import { matchClockLabel } from '../domain/match-status';
import { Match } from '../domain/models';
import { sv2Link } from '../sports-v2.paths';
import { SportsStore } from '../state/sports-store';
import { Sv2IconComponent } from '../ui/icon';
import { Sv2ScoreDisplayComponent } from '../ui/score-display';
import { Sv2StatusIndicatorComponent } from '../ui/status-indicator';
import { Sv2TeamIdentityComponent } from '../ui/team-identity';

/** Scoreboard block shared by the contextual sidebar (`sm`) and the full Match Center page (`lg`). */
@Component({
  selector: 'app-sv2-match-hero',
  standalone: true,
  imports: [RouterLink, Sv2IconComponent, Sv2ScoreDisplayComponent, Sv2StatusIndicatorComponent, Sv2TeamIdentityComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="comp">
      <a [routerLink]="compLink()">{{ store.competition(match().competitionSlug)?.name }}</a>
      @if (match().round) { <span> · {{ match().round }}</span> }
    </p>
    <div class="teams">
      @if (store.team(match().homeSlug); as h) { <a class="tm" [routerLink]="teamLink(h.slug)"><app-sv2-team-identity [team]="h" layout="stack" /></a> }
      <div class="mid">
        <app-sv2-score-display [home]="match().homeScore" [away]="match().awayScore" [status]="match().status" />
        <app-sv2-status-indicator [status]="match().status" />
        <span class="clock">{{ clock() }}</span>
      </div>
      @if (store.team(match().awaySlug); as a) { <a class="tm" [routerLink]="teamLink(a.slug)"><app-sv2-team-identity [team]="a" layout="stack" /></a> }
    </div>
    <p class="when"><app-sv2-icon name="clock" /><time [attr.datetime]="match().kickoff">{{ when() }}</time></p>
    <div class="acts">
      <button type="button" [class.on]="store.isTracked(match().slug)" [attr.aria-pressed]="store.isTracked(match().slug)" (click)="store.toggleTracked(match().slug)">
        <app-sv2-icon name="track" />{{ store.isTracked(match().slug) ? 'Siguiendo en directo' : 'Seguir en directo' }}
      </button>
      <button type="button" [class.on]="store.isSaved(match().slug)" [attr.aria-pressed]="store.isSaved(match().slug)" (click)="store.toggleSaved(match().slug)">
        <app-sv2-icon name="bookmark" />{{ store.isSaved(match().slug) ? 'Guardado' : 'Guardar' }}
      </button>
    </div>
  `,
  styles: `
    :host { display: grid; gap: 12px; padding: 16px; border-radius: var(--sv2-r-md); background: var(--sv2-surface-2); border: 1px solid var(--sv2-border); --sv2-badge: 44px; --sv2-score-size: var(--sv2-fs-score); min-width: 0; }
    :host(.lg) { padding: 24px 16px; --sv2-badge: 64px; --sv2-score-size: 3rem; background: linear-gradient(160deg, var(--sv2-surface-3), var(--sv2-surface-2) 60%); }
    .comp { margin: 0; text-align: center; font-size: var(--sv2-fs-xs); color: var(--sv2-text-muted); }
    .comp a { color: inherit; font-weight: 600; text-decoration: none; }
    .comp a:hover { text-decoration: underline; text-underline-offset: 3px; }
    .teams { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 8px; }
    .tm { color: var(--sv2-text); text-decoration: none; border-radius: var(--sv2-r-sm); justify-self: center; }
    .tm:hover { background: var(--sv2-surface-3); }
    .mid { display: grid; justify-items: center; gap: 6px; min-width: 88px; }
    .clock { font-size: var(--sv2-fs-xs); font-weight: 600; color: var(--sv2-text-muted); font-variant-numeric: tabular-nums; }
    .when { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 0; font-size: var(--sv2-fs-xs); color: var(--sv2-text-muted); --sv2-icon: 14px; }
    .acts { display: flex; flex-wrap: wrap; gap: 8px; }
    .acts button { flex: 1 1 140px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; border: 1px solid var(--sv2-border-strong); border-radius: 999px; background: transparent; color: var(--sv2-text); font: inherit; font-size: var(--sv2-fs-sm); font-weight: 600; cursor: pointer; }
    .acts button:hover { background: var(--sv2-surface-3); }
    .acts button.on { background: var(--sv2-accent); border-color: var(--sv2-accent); color: var(--sv2-accent-ink); }
    a:focus-visible, button:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    @media (max-width: 400px) { :host(.lg) { --sv2-badge: 52px; --sv2-score-size: 2.5rem; } }
  `,
  host: { '[class.lg]': 'size() === "lg"' },
})
export class Sv2MatchHeroComponent {
  protected readonly store = inject(SportsStore);
  readonly match = input.required<Match>();
  readonly size = input<'sm' | 'lg'>('sm');

  protected readonly clock = computed(() => matchClockLabel(this.match().status, this.match().minute, this.match().kickoff));
  protected readonly compLink = computed(() => sv2Link('competiciones', this.match().competitionSlug));
  protected readonly when = computed(() => {
    const iso = this.match().kickoff;
    return `${longDay(dayKey(iso))} · ${kickoffTime(iso)} · ${zoneDescription(new Date(iso))}`;
  });

  protected teamLink(slug: string): string[] {
    return sv2Link('equipos', slug);
  }
}
