import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { dayKey, dayLabel, longDay } from '../domain/calendar';
import { Match } from '../domain/models';
import { sv2Link } from '../sports-v2.paths';
import { SportsStore } from '../state/sports-store';
import { Sv2MatchRowComponent } from '../ui/match-row';
import { Sv2EmptyStateComponent } from '../ui/states';

interface Group {
  readonly key: string;
  readonly label: string;
  readonly link?: readonly string[];
  readonly matches: readonly Match[];
}

/** Dense list of match rows, optionally grouped by competition or by day, wired to the store. */
@Component({
  selector: 'app-sv2-match-list',
  standalone: true,
  imports: [RouterLink, Sv2MatchRowComponent, Sv2EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (g of groups(); track g.key) {
      <section class="grp">
        @if (grouping() !== 'none') {
          <div class="gh" role="heading" [attr.aria-level]="headingLevel()">
            @if (g.link) {
              <a [routerLink]="g.link">{{ g.label }}</a>
            } @else {
              <span>{{ g.label }}</span>
            }
            <span class="n" aria-hidden="true">{{ g.matches.length }}</span>
          </div>
        }
        <ul>
          @for (m of g.matches; track m.slug) {
            @if (store.team(m.homeSlug); as home) {
              @if (store.team(m.awaySlug); as away) {
                <li>
                  <app-sv2-match-row
                    [match]="m"
                    [home]="home"
                    [away]="away"
                    [competitionName]="store.competition(m.competitionSlug)?.name ?? ''"
                    [showCompetition]="grouping() !== 'competition'"
                    [selected]="store.selectedMatchSlug() === m.slug"
                    [saved]="store.isSaved(m.slug)"
                    (matchSelect)="store.openMatch($event)"
                    (saveToggle)="store.toggleSaved($event)"
                  />
                </li>
              }
            }
          }
        </ul>
      </section>
    } @empty {
      <app-sv2-empty-state [title]="emptyTitle()" [hint]="emptyHint()" [actionLabel]="emptyActionLabel()" [actionLink]="emptyActionLink()" />
    }
  `,
  styles: `
    :host { display: grid; gap: 16px; min-width: 0; }
    .grp { border-radius: var(--sv2-r-md); background: var(--sv2-surface-2); border: 1px solid var(--sv2-border); overflow: hidden; }
    .gh { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; padding: 0 12px; border-bottom: 1px solid var(--sv2-border); font-size: var(--sv2-fs-sm); font-weight: 700; }
    .gh a { color: var(--sv2-text); text-decoration: none; border-radius: 6px; }
    .gh a:hover { text-decoration: underline; text-underline-offset: 3px; }
    .gh a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    .n { min-width: 24px; padding: 2px 8px; border-radius: 999px; background: var(--sv2-surface-3); color: var(--sv2-text-muted); font-size: var(--sv2-fs-xs); text-align: center; }
    ul { list-style: none; margin: 0; padding: 4px; display: grid; gap: 2px; }
  `,
})
export class Sv2MatchListComponent {
  protected readonly store = inject(SportsStore);
  readonly matches = input.required<readonly Match[]>();
  readonly grouping = input<'competition' | 'day' | 'none'>('competition');
  readonly headingLevel = input(2);
  readonly emptyTitle = input('No hay partidos');
  readonly emptyHint = input('');
  readonly emptyActionLabel = input<string>();
  readonly emptyActionLink = input<readonly string[]>();

  protected readonly groups = computed<readonly Group[]>(() => {
    const matches = this.matches();
    if (!matches.length) return [];
    const mode = this.grouping();
    if (mode === 'none') return [{ key: 'all', label: '', matches }];
    const out = new Map<string, Group & { matches: Match[] }>();
    for (const m of matches) {
      const key = mode === 'day' ? dayKey(m.kickoff) : m.competitionSlug;
      let g = out.get(key);
      if (!g) {
        const comp = this.store.competition(m.competitionSlug);
        const label = mode === 'day' ? this.dayHeading(key) : (comp?.name ?? '');
        g = { key, label, link: mode === 'day' ? undefined : sv2Link('competiciones', m.competitionSlug), matches: [] };
        out.set(key, g);
      }
      g.matches.push(m);
    }
    return [...out.values()];
  });

  private dayHeading(key: string): string {
    const today = this.store.today();
    const label = dayLabel(key, today);
    return ['Hoy', 'Ayer', 'Mañana'].includes(label) ? `${label} · ${longDay(key)}` : longDay(key);
  }
}
