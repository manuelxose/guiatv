import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SportsStore } from '../state/sports-store';
import { Sv2CompetitionCardComponent } from '../ui/competition-card';
import { Sv2FollowButtonComponent } from '../ui/follow-button';
import { Sv2ErrorStateComponent, Sv2LoadingSkeletonComponent } from '../ui/states';
import { usePageTitle } from './page-title';

/** Competition catalogue with follow toggles. */
@Component({
  selector: 'app-sv2-competitions-page',
  standalone: true,
  imports: [Sv2CompetitionCardComponent, Sv2FollowButtonComponent, Sv2LoadingSkeletonComponent, Sv2ErrorStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Competiciones</h1>
    @switch (store.loadState()) {
      @case ('error') { <app-sv2-error-state (retry)="store.retry()" /> }
      @case ('ready') {
        <ul>
          @for (c of store.competitions(); track c.slug) {
            <li>
              <app-sv2-competition-card [competition]="c" />
              <app-sv2-follow-button [following]="store.isCompetitionFollowed(c.slug)" [subject]="c.name" (followToggle)="store.toggleCompetition(c.slug)" />
            </li>
          }
        </ul>
      }
      @default { <app-sv2-loading-skeleton [count]="3" /> }
    }
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-content: start; }
    h1 { margin: 0; font-size: var(--sv2-fs-xl); letter-spacing: -.02em; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
    li { display: grid; gap: 8px; justify-items: start; }
    li app-sv2-competition-card { width: 100%; }
  `,
})
export class Sv2CompetitionsPageComponent {
  protected readonly store = inject(SportsStore);
  constructor() {
    usePageTitle(() => 'Competiciones', 'Ligas, copas y torneos de fútbol: partidos, resultados y clasificación de cada competición.');
  }
}
