import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DataAvailability } from '../data/availability';
import { Lineup, LineupPlayer, Match } from '../domain/models';
import { SportsStore } from '../state/sports-store';
import { Sv2MatchDataStatusComponent } from './match-data-status';
import { Sv2EmptyStateComponent } from './states';

type Side = 'home' | 'away';

/** Starting XI, bench, formation and coach. Substituted players are marked only when the provider reports it. */
@Component({
  selector: 'app-sv2-match-lineups',
  standalone: true,
  imports: [Sv2EmptyStateComponent, Sv2MatchDataStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hasLineups()) {
      <div class="lineups">
        @for (side of sides; track side) {
          <div>
            <h3>{{ teamName(side) }}@if (formation(side); as f) { · {{ f }} }</h3>
            @if (coach(side); as c) { <p class="coach">Entrenador: {{ c }}</p> }
            @if (starters(side).length) {
              <ol class="xi">
                @for (p of starters(side); track $index) {
                  <li [class.subbed]="p.substitutedOut">
                    @if (p.number != null) { <span class="num">{{ p.number }}</span> }
                    <span class="name">{{ p.name }}</span>
                    @if (p.position) { <small>{{ p.position }}</small> }
                    @if (p.substitutedOut) { <span class="sr">, sustituido</span> }
                  </li>
                }
              </ol>
            }
            @if (bench(side).length) {
              <p class="bench-h">Banquillo</p>
              <ol class="bench">
                @for (p of bench(side); track $index) {
                  <li>
                    @if (p.number != null) { <span class="num">{{ p.number }}</span> }
                    <span class="name">{{ p.name }}</span>
                    @if (p.position) { <small>{{ p.position }}</small> }
                  </li>
                }
              </ol>
            }
          </div>
        }
      </div>
      @if (availability() === 'stale') {
        <app-sv2-match-data-status [availability]="availability()" noun="alineaciones" />
      }
    } @else if (pending()) {
      <app-sv2-empty-state [title]="emptyTitle()" [hint]="emptyHint()" />
    } @else {
      <app-sv2-match-data-status [availability]="availability()" noun="alineaciones" />
    }
  `,
  styles: `
    :host { display: grid; gap: 12px; min-width: 0; }
    .lineups { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; font-size: var(--sv2-fs-sm); }
    h3 { margin: 0 0 6px; font-size: var(--sv2-fs-sm); font-weight: 700; color: var(--sv2-text-muted); }
    .coach { margin: 0 0 6px; font-size: var(--sv2-fs-xs); color: var(--sv2-text-muted); }
    .xi, .bench { margin: 0; padding-left: 22px; display: grid; gap: 6px; }
    .xi li { display: grid; grid-template-columns: 22px 1fr auto; gap: 8px; align-items: center; }
    .bench li { display: grid; grid-template-columns: 22px 1fr auto; gap: 8px; align-items: center; }
    .num { font-weight: 700; font-variant-numeric: tabular-nums; color: var(--sv2-text-faint); }
    small { color: var(--sv2-text-faint); }
    .bench-h { margin: 12px 0 6px; font-size: var(--sv2-fs-xs); font-weight: 700; color: var(--sv2-text-muted); }
    .subbed .name { text-decoration: line-through; color: var(--sv2-text-muted); }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    @media (max-width: 480px) { .lineups { grid-template-columns: 1fr; } }
  `,
})
export class Sv2MatchLineupsComponent {
  protected readonly store = inject(SportsStore);
  readonly match = input.required<Match>();
  readonly availability = input.required<DataAvailability>();
  protected readonly sides: readonly Side[] = ['home', 'away'];

  protected readonly pending = computed(() => this.match().status === 'scheduled' || this.match().status === 'postponed');
  protected readonly emptyTitle = computed(() => (this.match().status === 'scheduled' ? 'Alineaciones pendientes' : 'Alineaciones no disponibles'));
  protected readonly emptyHint = computed(() => (this.match().status === 'scheduled' ? 'Suelen confirmarse una hora antes del inicio.' : 'No hay alineaciones para este partido.'));

  protected hasLineups(): boolean {
    return this.match().lineups?.home != null || this.match().lineups?.away != null;
  }
  protected teamName(side: Side): string {
    return this.store.team(side === 'home' ? this.match().homeSlug : this.match().awaySlug)?.name ?? '';
  }
  protected lineup(side: Side): Lineup | undefined {
    return side === 'home' ? this.match().lineups?.home : this.match().lineups?.away;
  }
  protected formation(side: Side): string | undefined {
    return this.lineup(side)?.formation;
  }
  protected coach(side: Side): string | undefined {
    return this.lineup(side)?.coach;
  }
  protected starters(side: Side): readonly LineupPlayer[] {
    const l = this.lineup(side);
    return l?.starters ?? l?.players?.map((name) => ({ name })) ?? [];
  }
  protected bench(side: Side): readonly LineupPlayer[] {
    return this.lineup(side)?.bench ?? [];
  }
}
