import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';
import { UserService } from '../../../../services/user.service';
import { FootballData } from '../../../../sports-v2/data/football-data';
import { AccountFollowStorage, FollowStorage } from '../../../../sports-v2/data/follow-storage';
import { HttpFootballData } from '../../../../sports-v2/data/http-football-data';
import { Team } from '../../../../sports-v2/domain/models';
import { sv2Link } from '../../../../sports-v2/sports-v2.paths';
import { SportsStore, normalize } from '../../../../sports-v2/state/sports-store';
import { Sv2Viewport } from '../../../../sports-v2/state/viewport';

/**
 * Mi fútbol inside the profile: the football section's store (same data and the same account-synced follows as
 * /deportes/futbol), showing the user's next matches with where to watch them, recent results and what they follow.
 */
@Component({
  selector: 'app-my-football',
  standalone: true,
  imports: [DatePipe, NgTemplateOutlet, RouterLink],
  providers: [{ provide: FootballData, useClass: HttpFootballData }, { provide: FollowStorage, useClass: AccountFollowStorage }, Sv2Viewport, SportsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../perfil-ui.scss', './my-football.component.scss'],
  template: `
    @if (store.loadState() === 'error') {
    <div class="pf-empty" role="alert"><strong>No se pudieron cargar los partidos</strong><button type="button" class="pf-btn pf-btn--pri" (click)="store.retry()">Reintentar</button></div>
    }

    <section class="pf-sec" aria-labelledby="fb-next">
      <div class="pf-head">
        <h2 id="fb-next">Tus próximos partidos</h2>
        <a [routerLink]="link('partidos')">Todos los partidos ›</a>
        <p>Los partidos de tus equipos, con el canal donde se emiten.</p>
      </div>
      @if (store.loadState() !== 'ready') {
      <div class="pf-skel" aria-busy="true"><div></div><div></div></div>
      } @else if (live().length + upcoming().length) {
      <ul class="pf-rows">
        @for (m of live().concat(upcoming()); track m.slug) {<ng-container *ngTemplateOutlet="row; context: { $implicit: m }"></ng-container>}
      </ul>
      } @else {
      <div class="pf-empty"><strong>{{ store.followedTeams().length ? 'Tus equipos no juegan en los próximos días' : 'Aún no sigues ningún equipo' }}</strong><span>Sigue equipos abajo y verás aquí sus partidos y dónde verlos.</span></div>
      }
    </section>

    @if (results().length) {
    <section class="pf-sec" aria-labelledby="fb-res">
      <div class="pf-head"><h2 id="fb-res">Últimos resultados</h2><a [routerLink]="link('resultados')">Resultados ›</a></div>
      <ul class="pf-rows">@for (m of results(); track m.slug) {<ng-container *ngTemplateOutlet="row; context: { $implicit: m }"></ng-container>}</ul>
    </section>
    }

    <section class="pf-sec" aria-labelledby="fb-teams">
      <div class="pf-head"><h2 id="fb-teams">Equipos que sigues</h2></div>
      <div class="pf-card">
        <input type="search" class="pf-input" placeholder="Buscar equipo para seguirlo (Real Madrid, Betis, Arsenal…)" aria-label="Buscar equipo" [value]="query()" (input)="query.set($any($event.target).value)" />
        @if (query().trim().length > 1) {
        <div class="pf-chips">
          @for (t of found(); track t.slug) {<button type="button" class="pf-chip" [attr.aria-pressed]="store.isTeamFollowed(t.slug)" (click)="store.toggleTeam(t.slug)">{{ t.name }}</button>}
          @empty {<span class="pf-muted">Ningún equipo coincide.</span>}
        </div>
        }
        <div class="fb-teams">
          @for (t of store.followedTeams(); track t.slug) {
          <div class="fb-team">
            <a [routerLink]="link('equipos', t.slug)" class="fb-team__id"><span class="fb-crest" [style.--hue]="t.hue">@if (t.crestUrl) {<img [src]="t.crestUrl" alt="" loading="lazy" />} @else { {{ t.shortName }} }</span><strong>{{ t.name }}</strong></a>
            <button type="button" class="pf-btn pf-btn--sm" (click)="store.toggleTeam(t.slug)" [attr.aria-label]="'Dejar de seguir a ' + t.name">Dejar de seguir</button>
          </div>
          } @empty {<p class="pf-muted">No sigues ningún equipo todavía.</p>}
        </div>
        @if (store.suggestedTeams().length && store.followedTeams().length < 3) {
        <h3>Sugerencias</h3>
        <div class="pf-chips">@for (t of store.suggestedTeams().slice(0, 10); track t.slug) {<button type="button" class="pf-chip" (click)="store.toggleTeam(t.slug)">+ {{ t.name }}</button>}</div>
        }
      </div>
    </section>

    <section class="pf-sec" aria-labelledby="fb-comps">
      <div class="pf-head"><h2 id="fb-comps">Competiciones favoritas</h2><a [routerLink]="link('competiciones')">Ver competiciones ›</a></div>
      <div class="pf-chips">
        @for (c of store.competitions(); track c.slug) {<button type="button" class="pf-chip" [attr.aria-pressed]="store.isCompetitionFollowed(c.slug)" (click)="store.toggleCompetition(c.slug)">{{ c.name }}</button>}
      </div>
    </section>

    <p class="pf-small">Lo que sigues se guarda en tu cuenta y se comparte con la sección de Fútbol en todos tus dispositivos.</p>

    <ng-template #row let-m>
      <li class="pf-row fb-row">
        <span class="fb-when">
          @if (m.status === 'live') {<span class="fb-live">EN DIRECTO{{ m.minute ? ' ' + m.minute + "'" : '' }}</span>}
          @else {<strong>{{ m.kickoff | date: 'EEE d' }}</strong><span class="pf-small">{{ m.kickoff | date: 'HH:mm' }}</span>}
        </span>
        <a class="pf-row__main" [routerLink]="link('partido', m.slug)">
          <strong>{{ team(m.homeSlug)?.name }} @if (m.status === 'scheduled' || m.status === 'postponed') {–} @else { {{ m.homeScore ?? '-' }} – {{ m.awayScore ?? '-' }} } {{ team(m.awaySlug)?.name }}</strong>
          <span class="pf-small">{{ store.competition(m.competitionSlug)?.name }}@if (m.round) { · {{ m.round }}}</span>
        </a>
        @if (m.broadcasts[0]; as b) {
          @if (b.channelPath) {<a class="fb-tv" [routerLink]="b.channelPath">{{ b.channel }}</a>} @else {<span class="fb-tv">{{ b.channel }}</span>}
        }
      </li>
    </ng-template>
  `,
})
export class MyFootballComponent {
  protected readonly store = inject(SportsStore);
  readonly query = signal('');

  readonly live = computed(() => this.store.myMatches().filter((m) => m.status === 'live'));
  readonly upcoming = computed(() => this.store.myMatches().filter((m) => m.status === 'scheduled' || m.status === 'postponed').slice(0, 8));
  readonly results = computed(() => this.store.myMatches().filter((m) => m.status === 'finished').reverse().slice(0, 5));
  readonly found = computed(() => {
    const q = normalize(this.query().trim());
    return q.length > 1 ? this.store.teams().filter((t) => normalize(`${t.name} ${t.shortName}`).includes(q)).slice(0, 12) : [];
  });

  constructor() {
    void this.store.load();
    const user = inject(UserService);
    const destroyRef = inject(DestroyRef);
    // Follows live in localStorage and the account: read them after hydration and again when the profile arrives.
    afterNextRender(() => {
      user.getProfile().pipe(
        map((p) => JSON.stringify([p.tvPreferences?.favoriteFootballTeamIds, p.tvPreferences?.favoriteFootballCompetitionIds])),
        distinctUntilChanged(),
        takeUntilDestroyed(destroyRef)
      ).subscribe(() => this.store.restoreFollows());
    });
  }

  team(slug: string): Team | undefined {
    return this.store.team(slug);
  }

  link(...segments: string[]): string[] {
    return sv2Link(...segments);
  }
}
