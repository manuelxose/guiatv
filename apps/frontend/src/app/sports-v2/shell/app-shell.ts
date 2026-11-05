import { ChangeDetectionStrategy, Component, HostListener, inject, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
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
