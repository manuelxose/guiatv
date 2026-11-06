import { afterNextRender, ChangeDetectionStrategy, Component, computed, effect, ElementRef, HostListener, inject, OnInit, RESPONSE_INIT, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { kickoffTime } from '../domain/calendar';
import { sv2Link } from '../sports-v2.paths';
import { SportsStore } from '../state/sports-store';
import { Sv2IconComponent } from '../ui/icon';
import { Sv2ContextPanelComponent } from './context-panel';
import { Sv2LiveTrackerShellComponent } from './live-tracker-shell';
import { NAV_ITEMS } from './nav-items';
import { Sv2SidebarNavigationComponent } from './sidebar-navigation';
import { Sv2TopNavigationComponent } from './top-navigation';

/**
 * Three-panel shell: top bar, My Football sidebar, main, Match Center, bottom tracker.
 * Desktop >=1200 shows all panels; tablet keeps a sidebar rail and a Match Center drawer;
 * mobile swaps the sidebar for a bottom tab bar.
 */
@Component({
  selector: 'app-sv2-app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Sv2TopNavigationComponent, Sv2SidebarNavigationComponent, Sv2ContextPanelComponent, Sv2LiveTrackerShellComponent, Sv2IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class Sv2AppShellComponent implements OnInit {
  protected readonly store = inject(SportsStore);
  protected readonly mobileItems = NAV_ITEMS.filter((i) => i.mobile);
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');

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
    });
    this.router
      .events.pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(() => {
        // Query-only changes (tabs, filters, typing) replace the URL and must not count as history.
        const path = this.router.url.split('?')[0];
        if (path !== this.lastPath) this.store.navigations.update((n) => n + 1);
        this.lastPath = path;
        this.main().nativeElement.scrollTo?.({ top: 0 }); // <main> is the scroller, not the window
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
