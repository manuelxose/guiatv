import { DOCUMENT } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, effect, HostListener, inject, OnInit, RESPONSE_INIT, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { distinctUntilChanged, filter, map } from 'rxjs';
import { UserService } from '../../services/user.service';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { kickoffTime } from '../domain/calendar';
import { sv2Link } from '../sports-v2.paths';
import { SportsStore } from '../state/sports-store';
import { Sv2OdblAttributionComponent } from '../ui/odbl-attribution';
import { Sv2ContextPanelComponent } from './context-panel';
import { Sv2LiveTrackerShellComponent } from './live-tracker-shell';
import { NAV_ITEMS } from './nav-items';
import { Sv2SearchBoxComponent } from './search-box';
import { Sv2SidebarNavigationComponent } from './sidebar-navigation';
import { PanelShellComponent } from '../../components/panel-shell/panel-shell.component';

/**
 * Football inside the app's shared frame (app-panel-shell): the same header, menu column, right panel,
 * footer, bottom bar and assistant as every section. Football adds its search in the header, the
 * My Football menu, the Match Center as the right panel (hidden on the full-page match) and the tracker.
 */
@Component({
  selector: 'app-sv2-app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, PanelShellComponent, Sv2SearchBoxComponent, Sv2SidebarNavigationComponent, Sv2ContextPanelComponent, Sv2LiveTrackerShellComponent, Sv2OdblAttributionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class Sv2AppShellComponent implements OnInit {
  protected readonly store = inject(SportsStore);
  private readonly user = inject(UserService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly navItems = NAV_ITEMS;
  private readonly document = inject(DOCUMENT);

  /** Wall-clock of the last successful refresh, in the visitor's zone. */
  protected readonly updatedAt = computed(() => {
    this.store.zone();
    const at = this.store.lastUpdated();
    return at === null ? '' : kickoffTime(new Date(at).toISOString());
  });

  private readonly router = inject(Router);
  private lastPath = '';
  /** Screen-reader announcement of a live score change (WCAG 4.1.3); the visible scoreboard changes silently otherwise. */
  protected readonly announcement = signal('');
  private readonly lastScore = new Map<string, string>();

  constructor() {
    // Provider down during the server render: answer 503 (the SSR server adds Retry-After + noindex and never caches it),
    // so a crawler does not index an error shell as a 200 page. No-op in the browser.
    const response = inject(RESPONSE_INIT, { optional: true });
    effect(() => {
      if (response && this.store.loadState() === 'error') response.status = 503;
    });
    effect(() => {
      const changes: string[] = [];
      for (const m of this.store.matches()) {
        if (m.status !== 'live') continue;
        const score = `${m.homeScore ?? '-'}-${m.awayScore ?? '-'}`;
        const before = this.lastScore.get(m.slug);
        this.lastScore.set(m.slug, score);
        if (before !== undefined && before !== score) {
          changes.push(`${this.store.team(m.homeSlug)?.name ?? 'Local'} ${m.homeScore ?? '-'}, ${this.store.team(m.awaySlug)?.name ?? 'Visitante'} ${m.awayScore ?? '-'}`);
        }
      }
      if (changes.length) this.announcement.set('Marcador actualizado: ' + changes.join('. '));
    });
    // Follows come from localStorage: read them after hydration so server and client markup match.
    afterNextRender(() => {
      this.store.restoreFollows();
      this.store.startLive();
      // Signed-in follows live in the account: read them again when the profile arrives or its ids change.
      this.user.getProfile().pipe(
        map((p) => JSON.stringify([p.tvPreferences?.favoriteFootballTeamIds, p.tvPreferences?.favoriteFootballCompetitionIds])),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      ).subscribe(() => this.store.restoreFollows());
    });
    this.router
      .events.pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(() => {
        // Query-only changes (tabs, filters, typing) replace the URL and must not count as history.
        const path = this.router.url.split('?')[0];
        if (path !== this.lastPath) this.store.navigations.update((n) => n + 1);
        this.lastPath = path;
        // The shell's <main> is the scroller, not the window; a #fragment is scrolled by the shell itself.
        if (!this.router.url.includes('#')) this.document.getElementById('panel-main')?.scrollTo?.({ top: 0 });
      });
  }

  ngOnInit(): void {
    void this.store.load();
  }

  @HostListener('document:keydown.escape')
  protected closeDrawer(): void {
    this.store.contextOpen.set(false);
  }

  protected link(segments: readonly string[]): string[] {
    return sv2Link(...segments);
  }
}
