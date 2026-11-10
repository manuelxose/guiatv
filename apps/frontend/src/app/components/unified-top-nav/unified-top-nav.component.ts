import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { filter, map } from 'rxjs';
import { APP_PATHS } from '../../config/route-map';
import {
  PORTAL_ICON_PATHS,
  PORTAL_PRIMARY_DESTINATIONS,
  resolvePortalPrimaryDestination,
} from '../../config/portal-navigation.config';
import { ChatService } from '../../services/chat.service';
import { ThemeService } from '../../services/theme.service';
import { UserService } from '../../services/user.service';
import { NotificationBellComponent } from '../notification-bell/notification-bell.component';
import { UnifiedSearchComponent } from '../unified-search/unified-search.component';

/**
 * The one header of the whole site (portal and football): brand, section links,
 * centred search, theme, notifications and account. Shells can project their own
 * leading control (`utnLead`), search (`utnSearch`) and extra actions (`utnActions`).
 */
@Component({
  selector: 'app-unified-top-nav',
  standalone: true,
  imports: [RouterModule, UnifiedSearchComponent, NotificationBellComponent],
  templateUrl: './unified-top-nav.component.html',
  styleUrl: './unified-top-nav.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnifiedTopNavComponent {
  private readonly router = inject(Router);
  private readonly user = inject(UserService);
  private readonly chat = inject(ChatService);
  readonly theme = inject(ThemeService);

  /** Portal shells pin the header to the viewport; the football shell places it in its own grid. */
  readonly fixed = input(true);
  /** Sub-brand shown after the logo, e.g. "Sports". */
  readonly brandSuffix = input('');
  readonly showLeftRail = input(false);
  readonly showRightRail = input(false);
  readonly rightRailLabel = input('Panel contextual');
  /** The assistant is the centre of the app; shells where it is not available yet pass false. */
  readonly showAssistant = input(true);
  readonly leftRailToggle = output<void>();
  readonly rightRailToggle = output<void>();

  readonly homePath = APP_PATHS.home;
  readonly loginPath = APP_PATHS.login;
  readonly profilePath = APP_PATHS.profile;
  readonly iconPaths = PORTAL_ICON_PATHS;
  readonly tabs = [{ id: 'home', label: 'Inicio', path: APP_PATHS.home }, ...PORTAL_PRIMARY_DESTINATIONS];

  readonly isAuthenticated = toSignal(this.user.isAuthenticated$, { initialValue: false });
  readonly profileName = toSignal(this.user.getProfile().pipe(map((p) => p?.name || 'Cuenta')), { initialValue: 'Cuenta' });
  readonly sectionsOpen = signal(false);
  readonly searchQuery = signal('');

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  readonly activeTab = computed(() => {
    const url = this.url();
    return resolvePortalPrimaryDestination(url) ?? (url.split(/[?#]/)[0] === APP_PATHS.home ? 'home' : null);
  });

  constructor() {
    // The section colour (design-tokens.scss, --section-accent*) follows the route; pages without a section use the home colour.
    const root = inject(DOCUMENT).documentElement;
    effect(() => root.setAttribute('data-section', this.activeTab() ?? 'home'));
  }

  get themeLabel(): string {
    return this.theme.resolved === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
  }

  openAssistant(): void {
    this.chat.requestToggleAssistant();
  }

  sectionsFocusOut(ev: FocusEvent): void {
    if (!(ev.currentTarget as HTMLElement).contains(ev.relatedTarget as Node | null)) this.sectionsOpen.set(false);
  }

  onSearchSubmit(value: string): void {
    this.searchQuery.set(value);
    void this.router.navigate([APP_PATHS.explore], { queryParams: value ? { q: value } : {} });
  }
}
