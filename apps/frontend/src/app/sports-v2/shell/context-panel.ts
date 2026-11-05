import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Match } from '../domain/models';
import { MatchTab, Sv2MatchDetailsComponent } from '../pages/match-details';
import { Sv2MatchHeroComponent } from '../pages/match-hero';
import { sv2Link } from '../sports-v2.paths';
import { SportsStore } from '../state/sports-store';
import { Sv2IconComponent } from '../ui/icon';
import { Sv2EmptyStateComponent, Sv2LoadingSkeletonComponent } from '../ui/states';

/** Contextual sidebar: a summary of the selected fixture with a link to the full-page Match Center. */
@Component({
  selector: 'app-sv2-context-panel',
  standalone: true,
  imports: [RouterLink, Sv2IconComponent, Sv2MatchHeroComponent, Sv2MatchDetailsComponent, Sv2EmptyStateComponent, Sv2LoadingSkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <h2 id="sv2-ctx-title">Match Center @if (store.isDemo) { <span class="demo-tag">Demo</span> }</h2>
      @if (match(); as m) {
        <a class="ib" [routerLink]="pageLink(m)" aria-label="Abrir el partido en pantalla completa" title="Pantalla completa" (click)="store.contextOpen.set(false)"><app-sv2-icon name="expand" /></a>
      }
      <button type="button" class="ib close" (click)="store.contextOpen.set(false)" aria-label="Cerrar Match Center"><app-sv2-icon name="close" /></button>
    </header>

    @if (store.loadState() === 'loading' || store.loadState() === 'idle') {
      <app-sv2-loading-skeleton [count]="3" />
    } @else if (match(); as m) {
      <app-sv2-match-hero [match]="m" />
      <app-sv2-match-details [match]="m" prefix="sv2ctx" [(tab)]="tab" [relatedLimit]="2" />
    } @else {
      <app-sv2-empty-state title="Selecciona un partido" hint="Elige un encuentro para ver su cronología, estadísticas y dónde verlo." />
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; height: 100%; overflow-y: auto; padding: 16px; }
    .head { display: flex; align-items: center; gap: 8px; }
    h2 { margin: 0 auto 0 0; font-size: var(--sv2-fs-md); font-weight: 700; }
    .demo-tag { margin-left: 6px; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--sv2-postponed) 22%, transparent); font-size: var(--sv2-fs-xs); font-weight: 700; vertical-align: middle; }
    .ib { display: inline-grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 50%; background: var(--sv2-surface-2); color: var(--sv2-text); cursor: pointer; text-decoration: none; }
    .ib:hover { background: var(--sv2-surface-3); }
    .ib:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    @media (min-width: 1200px) { .close { display: none; } }
  `,
})
export class Sv2ContextPanelComponent {
  protected readonly store = inject(SportsStore);
  protected readonly tab = signal<MatchTab>('resumen');
  protected readonly match = computed<Match | null>(() => this.store.selectedMatch());

  protected pageLink(m: Match): string[] {
    return sv2Link('partido', m.slug);
  }
}
