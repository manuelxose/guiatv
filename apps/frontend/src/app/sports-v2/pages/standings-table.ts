import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Competition, StandingRow, StandingZone, Standings } from '../domain/models';
import { goalDifference, signed, zoneAt } from '../domain/standings';
import { sv2Link } from '../sports-v2.paths';
import { SportsStore } from '../state/sports-store';
import { Sv2TeamIdentityComponent } from '../ui/team-identity';

interface Line {
  readonly position: number;
  readonly row: StandingRow;
  readonly zone?: StandingZone;
}

/**
 * Football table. Qualification/relegation markers come only from `competition.zones`
 * (verified rules supplied by the data source); without zones the table shows none.
 */
@Component({
  selector: 'app-sv2-standings-table',
  standalone: true,
  imports: [RouterLink, Sv2TeamIdentityComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <table>
        <caption class="sr">Clasificación de {{ competition().name }}</caption>
        <thead>
          <tr>
            <th scope="col" class="pos"><abbr title="Posición">#</abbr></th>
            <th scope="col" class="team">Equipo</th>
            <th scope="col" class="num"><abbr title="Partidos jugados">PJ</abbr></th>
            <th scope="col" class="num opt"><abbr title="Partidos ganados">G</abbr></th>
            <th scope="col" class="num opt"><abbr title="Partidos empatados">E</abbr></th>
            <th scope="col" class="num opt"><abbr title="Partidos perdidos">P</abbr></th>
            <th scope="col" class="num"><abbr title="Diferencia de goles">DG</abbr></th>
            <th scope="col" class="num pts"><abbr title="Puntos">Pts</abbr></th>
          </tr>
        </thead>
        <tbody>
          @for (l of lines(); track l.row.teamSlug) {
            <tr [class.me]="l.row.teamSlug === highlight()" [attr.data-zone]="l.zone?.kind">
              <td class="pos">
                <span class="posn">{{ l.position }}</span>
                @if (l.zone) { <span class="sr">, {{ l.zone.label }}</span> }
              </td>
              <td class="team">
                @if (store.team(l.row.teamSlug); as t) {
                  <a [routerLink]="teamLink(t.slug)"><app-sv2-team-identity [team]="t" /></a>
                }
              </td>
              <td class="num">{{ l.row.played }}</td>
              <td class="num opt">{{ l.row.won }}</td>
              <td class="num opt">{{ l.row.drawn }}</td>
              <td class="num opt">{{ l.row.lost }}</td>
              <td class="num">{{ gd(l.row) }}</td>
              <td class="num pts">{{ l.row.points }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    @if (legend().length) {
      <ul class="legend" aria-label="Leyenda de la clasificación">
        @for (z of legend(); track z.label) {
          <li [attr.data-zone]="z.kind"><span class="sw" aria-hidden="true"></span>{{ z.label }}</li>
        }
      </ul>
    }
  `,
  styles: `
    :host { display: block; min-width: 0; container-type: inline-size; }
    .wrap { overflow-x: auto; border-radius: var(--sv2-r-md); background: var(--sv2-surface-2); border: 1px solid var(--sv2-border); }
    table { width: 100%; border-collapse: collapse; font-size: var(--sv2-fs-sm); font-variant-numeric: tabular-nums; }
    th { padding: 10px 6px; text-align: right; font-size: var(--sv2-fs-xs); font-weight: 600; color: var(--sv2-text-faint); border-bottom: 1px solid var(--sv2-border); }
    th abbr { text-decoration: none; }
    td { padding: 0 6px; height: 48px; text-align: right; border-bottom: 1px solid var(--sv2-border); }
    tbody tr:last-child td { border-bottom: 0; }
    tbody tr:hover { background: var(--sv2-surface-3); }
    tr.me { background: color-mix(in srgb, var(--sv2-accent) 10%, transparent); }
    .team, th.team { text-align: left; width: 100%; }
    .team a { display: inline-flex; max-width: 100%; color: var(--sv2-text); text-decoration: none; border-radius: 6px; }
    .team a:hover { text-decoration: underline; text-underline-offset: 3px; }
    .team a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    .team app-sv2-team-identity { --sv2-badge: 24px; }
    .pos { width: 40px; text-align: center; box-shadow: inset 4px 0 0 var(--zone, transparent); }
    .posn { font-weight: 700; }
    .num { min-width: 34px; color: var(--sv2-text-muted); }
    .pts { font-weight: 800; color: var(--sv2-text); }
    [data-zone='promotion'] { --zone: var(--sv2-accent); }
    [data-zone='qualification'] { --zone: var(--sv2-scheduled); }
    [data-zone='relegation'] { --zone: var(--sv2-live); }
    .legend { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 12px 0 0; padding: 0; list-style: none; font-size: var(--sv2-fs-xs); color: var(--sv2-text-muted); }
    .legend li { display: inline-flex; align-items: center; gap: 8px; }
    .sw { width: 4px; height: 16px; border-radius: 2px; background: var(--zone); }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    @container (max-width: 460px) { .opt { display: none; } .team app-sv2-team-identity { --sv2-name-display: block; } }
  `,
})
export class Sv2StandingsTableComponent {
  protected readonly store = inject(SportsStore);
  readonly standings = input.required<Standings>();
  readonly competition = input.required<Competition>();
  readonly highlight = input<string>();
  /** Show only the first N rows (overview cards). */
  readonly limit = input<number>();

  protected readonly lines = computed<readonly Line[]>(() => {
    const all = this.standings().rows.map((row, i) => ({ position: i + 1, row, zone: zoneAt(this.competition().zones, i + 1) }));
    return this.limit() ? all.slice(0, this.limit()) : all;
  });
  protected readonly legend = computed(() => {
    const shown = new Set(this.lines().flatMap((l) => (l.zone ? [l.zone.label] : [])));
    return (this.competition().zones ?? []).filter((z) => shown.has(z.label));
  });

  protected gd(row: StandingRow): string {
    return signed(goalDifference(row));
  }
  protected teamLink(slug: string): string[] {
    return sv2Link('equipos', slug);
  }
}
