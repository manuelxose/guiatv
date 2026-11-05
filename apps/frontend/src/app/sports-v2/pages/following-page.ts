import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { sv2Link } from '../sports-v2.paths';
import { SportsStore } from '../state/sports-store';
import { Sv2CompetitionCardComponent } from '../ui/competition-card';
import { Sv2FollowButtonComponent } from '../ui/follow-button';
import { Sv2EmptyStateComponent } from '../ui/states';
import { Sv2TeamIdentityComponent } from '../ui/team-identity';
import { Sv2MatchListComponent } from './match-list';
import { usePageTitle } from './page-title';

/** My Football: followed teams, favourite competitions and saved fixtures. Stored on this device. */
@Component({
  selector: 'app-sv2-following-page',
  standalone: true,
  imports: [RouterLink, Sv2TeamIdentityComponent, Sv2CompetitionCardComponent, Sv2FollowButtonComponent, Sv2MatchListComponent, Sv2EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Mi fútbol</h1>
    <p class="sub">Tus equipos, competiciones y partidos se guardan en este dispositivo. No necesitas cuenta.</p>

    <section aria-labelledby="t-h">
      <h2 id="t-h">Equipos que sigues</h2>
      @if (store.followedTeams().length) {
        <ul class="teams">
          @for (t of store.followedTeams(); track t.slug) {
            <li>
              <a [routerLink]="link('equipos', t.slug)"><app-sv2-team-identity [team]="t" /></a>
              <app-sv2-follow-button [following]="true" [subject]="t.name" (followToggle)="store.toggleTeam(t.slug)" />
            </li>
          }
        </ul>
      } @else {
        <app-sv2-empty-state title="Aún no sigues ningún equipo" hint="Sigue equipos para ver sus partidos y noticias en tu inicio." />
      }
      @if (store.suggestedTeams().length) {
        <h3>Sugerencias</h3>
        <ul class="teams">
          @for (t of store.suggestedTeams(); track t.slug) {
            <li>
              <a [routerLink]="link('equipos', t.slug)"><app-sv2-team-identity [team]="t" /></a>
              <app-sv2-follow-button [following]="false" [subject]="t.name" (followToggle)="store.toggleTeam(t.slug)" />
            </li>
          }
        </ul>
      }
    </section>

    <section aria-labelledby="c-h">
      <h2 id="c-h">Competiciones favoritas</h2>
      @if (store.favoriteCompetitions().length) {
        <ul class="comps">
          @for (c of store.favoriteCompetitions(); track c.slug) {
            <li>
              <app-sv2-competition-card [competition]="c" />
              <app-sv2-follow-button [following]="true" [subject]="c.name" (followToggle)="store.toggleCompetition(c.slug)" />
            </li>
          }
        </ul>
      } @else {
        <app-sv2-empty-state title="Aún no tienes competiciones favoritas" hint="Márcalas desde su página para fijarlas aquí." actionLabel="Explorar competiciones" [actionLink]="competitions" />
      }
    </section>

    <section aria-labelledby="s-h">
      <h2 id="s-h">Partidos guardados</h2>
      <app-sv2-match-list [matches]="store.savedMatches()" grouping="day" [headingLevel]="3" emptyTitle="No has guardado ningún partido" emptyHint="Pulsa el marcador de un partido para guardarlo aquí." emptyActionLabel="Ver el calendario" [emptyActionLink]="fixtures" />
    </section>
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; align-content: start; }
    h1 { margin: 0; font-size: var(--sv2-fs-xl); letter-spacing: -.02em; }
    .sub { margin: -16px 0 0; font-size: var(--sv2-fs-sm); color: var(--sv2-text-muted); }
    h2 { margin: 0 0 12px; font-size: var(--sv2-fs-lg); }
    h3 { margin: 20px 0 8px; font-size: var(--sv2-fs-sm); color: var(--sv2-text-muted); }
    section { min-width: 0; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
    .teams li { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 64px; padding: 8px 12px; border-radius: var(--sv2-r-md); background: var(--sv2-surface-2); border: 1px solid var(--sv2-border); }
    .teams a { display: flex; align-items: center; min-width: 0; color: var(--sv2-text); text-decoration: none; border-radius: var(--sv2-r-sm); }
    .teams a:hover { text-decoration: underline; text-underline-offset: 3px; }
    .comps li { display: grid; gap: 8px; justify-items: start; }
    .comps li app-sv2-competition-card { width: 100%; }
    a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
  `,
})
export class Sv2FollowingPageComponent {
  protected readonly store = inject(SportsStore);
  protected readonly competitions = sv2Link('competiciones');
  protected readonly fixtures = sv2Link('partidos');
  constructor() {
    usePageTitle(() => 'Mi fútbol');
  }
  protected link(...segments: string[]): string[] {
    return sv2Link(...segments);
  }
}
