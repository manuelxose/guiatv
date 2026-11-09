import { CommonModule, DOCUMENT } from '@angular/common';
import {
  Component,
  HostListener,
  Inject,
  OnDestroy,
  OnInit,
  ElementRef,
  ViewChild,
  inject,
} from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterModule, RouterOutlet, Routes } from '@angular/router';
import { Subject, filter, takeUntil } from 'rxjs';
import { AuthLoginModalComponent } from './components/auth-login-modal/auth-login-modal.component';
import { AppPublicLayoutShellComponent } from './components/app-public-layout-shell/app-public-layout-shell.component';
import { ModalComponent } from './components/modal/modal.component';
import { UnifiedChatShellComponent } from './components/unified-chat-shell/unified-chat-shell.component';
import { AnalyticsService } from './services/analytics.service';
import { ConsentBannerComponent } from './components/consent-banner/consent-banner.component';
import { ConsentService } from './services/analytics/consent.service';
import { ChatService } from './services/chat.service';
import { MetaService } from './services/meta.service';
import { environment } from '../environments/environment';
import { APP_PATHS, normalizePath as normalizeRoutePath } from './config/route-map';
import {
  PORTAL_ACCOUNT_DESTINATIONS,
  PORTAL_MOBILE_MORE_DESTINATIONS,
  PORTAL_MOBILE_PRIMARY_DESTINATIONS,
  PortalMobileDestination,
} from './config/portal-navigation.config';
import { ThemeMode, ThemeService } from './services/theme.service';

type AppLayoutMode = 'portal-page' | 'public-shell' | 'minimal-shell' | 'private-shell' | 'admin-shell';

/**
 * The layout a URL will get, read from the top-level route config WITHOUT running the router.
 * The root component must pick the same shell as the server on the first client render; with
 * hydration the initial navigation is not blocking, so the router state is still empty then.
 * Same matching as Angular: ':param' matches one segment, a leaf route must consume the whole
 * path, a route with children may match a prefix. Redirects resolve server-side (HTTP 301) and
 * are skipped. Returns undefined when nothing matches, so the router-derived layout applies.
 */
export function layoutForUrl(url: string, config: Routes): AppLayoutMode | undefined {
  const segments = url.split(/[?#]/)[0].split('/').filter(Boolean);
  for (const route of config) {
    if (route.redirectTo !== undefined || route.matcher) continue;
    const layout = route.data?.['layout'] as AppLayoutMode | undefined;
    if (route.path === '**') return layout;
    const pattern = (route.path ?? '').split('/').filter(Boolean);
    if (pattern.length > segments.length) continue;
    if (!pattern.every((p, i) => p.startsWith(':') || p === segments[i])) continue;
    const canPrefix = route.pathMatch !== 'full' && !!(route.children?.length || route.loadChildren);
    if (pattern.length === segments.length || canPrefix) return layout;
  }
  return undefined;
}

export function shouldMinimizeChatDrag(distance: number, elapsedMs: number): boolean {
  const safeDistance = Math.max(0, distance);
  const velocity = safeDistance / Math.max(1, elapsedMs);
  return safeDistance >= 96 || (safeDistance >= 24 && velocity >= 0.7);
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterModule,
    AppPublicLayoutShellComponent,
    ModalComponent,
    AuthLoginModalComponent,
    UnifiedChatShellComponent,
    ConsentBannerComponent,
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit, OnDestroy {
  public currentPath = '/';
  public currentLayout: AppLayoutMode = 'public-shell';
  public isChatbotOpen = false;
  public isChatMinimized = false;
  public chatPanelWidth = 440;
  public readonly mobileTabs = PORTAL_MOBILE_PRIMARY_DESTINATIONS;
  public readonly moreDestinations = PORTAL_MOBILE_MORE_DESTINATIONS;
  public readonly accountDestinations = PORTAL_ACCOUNT_DESTINATIONS;
  public mobileMoreOpen = false;
  public chatSocialTargetUser: { userId: string; nonce: number } | null = null;
  public readonly theme = inject(ThemeService);
  /** Withdrawing consent must be as easy as giving it: the mobile "Más" sheet reopens the choice (the footer is desktop-only). */
  public readonly consent = inject(ConsentService);
  @ViewChild('mobileMoreTrigger') private readonly mobileMoreTrigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('mobileMoreSheet') private readonly mobileMoreSheet?: ElementRef<HTMLElement>;
  @ViewChild('chatMinibar') private readonly chatMinibar?: ElementRef<HTMLButtonElement>;

  public readonly aiChatbotEnabled = environment.ai.chatbotEnabled;

  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private resizeMoveHandler: ((e: MouseEvent) => void) | null = null;
  private resizeUpHandler: (() => void) | null = null;
  private readonly destroy$ = new Subject<void>();
  private readonly analytics = inject(AnalyticsService);
  private chatReturnFocus: HTMLElement | null = null;
  public chatDragOffset = 0;
  public chatDragging = false;
  private chatDragPointerId: number | null = null;
  private chatDragStartY = 0;
  private chatDragStartTime = 0;

  constructor(
    @Inject(DOCUMENT) private readonly document: Document,
    private readonly router: Router,
    private readonly activatedRoute: ActivatedRoute,
    private readonly metaService: MetaService,
    private readonly chatService: ChatService
  ) {
    void this.chatService;
    // Select the same router-outlet branch before the first render on SSR and
    // in the hydrating browser. The initial navigation is not blocking (hydration),
    // so the router is still at '/' here: the document URL is the real one.
    this.applyRouteState(this.document.location?.pathname || this.router.url);
  }

  ngOnInit(): void {
    this.analytics.init();

    this.chatService.requestOpenChat$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.canRenderChatbot()) {
          this.chatReturnFocus = this.document.activeElement as HTMLElement | null;
          this.isChatbotOpen = true;
          this.isChatMinimized = false;
          this.focusChatDialog();
        }
      });

    this.chatService.requestOpenSocialChat$
      .pipe(takeUntil(this.destroy$))
      .subscribe((target) => {
        if (this.canRenderChatbot()) {
          this.chatSocialTargetUser = target;
          this.chatReturnFocus = this.document.activeElement as HTMLElement | null;
          this.isChatbotOpen = true;
          this.isChatMinimized = false;
          this.focusChatDialog();
        }
      });

    this.applyRobotsMeta();

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntil(this.destroy$)
      )
      .subscribe((event) => {
        const navEnd = event as NavigationEnd;
        const url = navEnd.urlAfterRedirects || navEnd.url;
        this.applyRouteState(url);
        this.analytics.trackPageView(url);
        this.applyRobotsMeta();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.cleanupResizeListeners();
    this.document.body.classList.remove('portal-overlay-open');
  }

  @HostListener('window:resize')
  onResize(): void {
    if (!this.canRenderChatbot()) {
      this.closeChatbot();
    }
  }

  public toggleChatbot(): void {
    if (!this.canRenderChatbot()) {
      return;
    }
    this.isChatbotOpen = !this.isChatbotOpen;
    if (this.isChatbotOpen) {
      this.analytics.trackEvent('assistant_opened', { surface: 'global_shell' });
      this.chatReturnFocus = this.document.activeElement as HTMLElement | null;
      this.focusChatDialog();
    } else {
      this.restoreChatFocus();
    }
  }

  public closeChatbot(): void {
    if (this.isChatbotOpen) this.analytics.trackEvent('assistant_closed');
    this.isChatbotOpen = false;
    this.isChatMinimized = false;
    this.restoreChatFocus();
  }

  public minimizeChatbot(): void {
    this.resetChatDrag();
    this.isChatMinimized = true;
    setTimeout(() => this.chatMinibar?.nativeElement.focus());
  }

  public restoreChatbot(): void {
    this.isChatMinimized = false;
    this.isChatbotOpen = true;
    this.focusChatDialog();
  }

  public onResizeStart(event: MouseEvent): void {
    event.preventDefault();
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.chatPanelWidth;

    this.resizeMoveHandler = (moveEvent: MouseEvent) => {
      const delta = this.resizeStartX - moveEvent.clientX;
      const maxWidth = Math.max(420, this.document.defaultView?.innerWidth || 1280) - 40;
      this.chatPanelWidth = Math.max(360, Math.min(maxWidth, this.resizeStartWidth + delta));
    };

    this.resizeUpHandler = () => this.cleanupResizeListeners();

    this.document.addEventListener('mousemove', this.resizeMoveHandler);
    this.document.addEventListener('mouseup', this.resizeUpHandler);
  }

  // Deliberately not gated on viewport.isMobile(): that signal starts at a
  // guessed default and only settles after client-side hydration, which
  // raced with SSR/first paint and could leave desktop visitors with no
  // visible chat entry point (FAB hidden by CSS, launcher not yet rendered)
  // until the guess corrected itself. The FAB/launcher pair's CSS already
  // fully owns the 768px breakpoint (see .app-shell__chat-fab /
  // .app-shell__chat-launcher in app.component.scss), so both can render
  // unconditionally here and let CSS be the single source of truth for
  // which one is visible at a given width — matching how the mobile/desktop
  // chat panels already resolve their own visibility.
  public shouldShowMobileChatbotFab(): boolean {
    return this.canRenderChatbot() && !this.isChatbotOpen && !this.isChatMinimized;
  }

  public shouldShowDesktopChatbotLauncher(): boolean {
    return this.canRenderChatbot();
  }

  public shouldShowMobileNavigation(): boolean {
    // Admin owns its own mobile navigation (drawer sidebar) — the consumer
    // bottom tab bar must never render underneath/alongside it.
    return this.currentLayout !== 'minimal-shell' && this.currentLayout !== 'admin-shell';
  }

  public isMobileTabActive(tab: PortalMobileDestination): boolean {
    const path = normalizeRoutePath(this.currentPath);
    if (tab.id === 'more') {
      return this.mobileMoreOpen || path.startsWith(APP_PATHS.platforms) || path.startsWith(APP_PATHS.streamingComparison) || path.startsWith(APP_PATHS.blog) || path.startsWith(APP_PATHS.stats);
    }
    if (tab.id === 'home') return path === '/';
    if (tab.id === 'live') {
      return path.startsWith('/programacion-tv/en-directo') || path === '/canales' || path.startsWith('/canales/');
    }
    if (tab.id === 'discover') {
      return path.startsWith('/programacion-tv/que-ver-hoy') || path.startsWith('/programas/') || path.startsWith('/peliculas/') || path.startsWith('/series/');
    }
    return Boolean(tab.path && path.startsWith(normalizeRoutePath(tab.path)));
  }

  public toggleMobileMore(): void {
    if (this.mobileMoreOpen) {
      this.closeMobileMore();
      return;
    }
    this.mobileMoreOpen = true;
    this.document.body.classList.add('portal-overlay-open');
    setTimeout(() => {
      const first = this.getMoreSheetFocusables()[0];
      if (first) first.focus();
      else this.mobileMoreSheet?.nativeElement.focus();
    });
  }

  public closeMobileMore(): void {
    if (!this.mobileMoreOpen) return;
    this.mobileMoreOpen = false;
    this.document.body.classList.remove('portal-overlay-open');
    setTimeout(() => this.mobileMoreTrigger?.nativeElement.focus());
  }

  public setTheme(mode: ThemeMode | string): void {
    if (mode === 'light' || mode === 'dark' || mode === 'system') {
      this.theme.setMode(mode);
    }
  }

  @HostListener('document:keydown.escape')
  public onEscape(): void {
    this.closeMobileMore();
    if (this.isChatbotOpen) {
      if (this.isMobileChatLayout()) this.minimizeChatbot();
      else this.closeChatbot();
    }
  }

  public onChatDragStart(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0 || !this.isMobileChatLayout()) return;
    this.chatDragPointerId = event.pointerId;
    this.chatDragStartY = event.clientY;
    this.chatDragStartTime = event.timeStamp;
    this.chatDragOffset = 0;
    this.chatDragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  public onChatDragMove(event: PointerEvent): void {
    if (!this.chatDragging || event.pointerId !== this.chatDragPointerId) return;
    this.chatDragOffset = Math.max(0, event.clientY - this.chatDragStartY);
    event.preventDefault();
  }

  public onChatDragEnd(event: PointerEvent): void {
    if (!this.chatDragging || event.pointerId !== this.chatDragPointerId) return;
    const shouldMinimize = shouldMinimizeChatDrag(
      this.chatDragOffset,
      event.timeStamp - this.chatDragStartTime
    );
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    this.chatDragging = false;
    this.chatDragPointerId = null;
    if (shouldMinimize) {
      this.minimizeChatbot();
      return;
    }
    this.chatDragOffset = 0;
  }

  public onChatDragCancel(event: PointerEvent): void {
    if (event.pointerId !== this.chatDragPointerId) return;
    this.resetChatDrag();
  }

  @HostListener('document:keydown', ['$event'])
  public trapMobileMoreFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    if (!this.mobileMoreOpen && this.isChatbotOpen && !this.isChatMinimized) {
      this.trapChatDialogFocus(event);
      return;
    }
    if (!this.mobileMoreOpen) return;
    const focusable = this.getMoreSheetFocusables();
    if (!focusable.length) {
      event.preventDefault();
      this.mobileMoreSheet?.nativeElement.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = this.document.activeElement;
    if (event.shiftKey && (active === first || !this.mobileMoreSheet?.nativeElement.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private cleanupResizeListeners(): void {
    if (this.resizeMoveHandler) {
      this.document.removeEventListener('mousemove', this.resizeMoveHandler);
    }
    if (this.resizeUpHandler) {
      this.document.removeEventListener('mouseup', this.resizeUpHandler);
    }
    this.resizeMoveHandler = null;
    this.resizeUpHandler = null;
  }

  private resetChatDrag(): void {
    this.chatDragging = false;
    this.chatDragPointerId = null;
    this.chatDragOffset = 0;
  }

  private isMobileChatLayout(): boolean {
    return (this.document.defaultView?.innerWidth || 1024) < 768;
  }

  private focusChatDialog(): void {
    setTimeout(() => {
      const dialog = this.getVisibleChatDialog();
      const first = dialog?.querySelector<HTMLElement>('textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      (first || dialog)?.focus();
    });
  }

  private restoreChatFocus(): void {
    const target = this.chatReturnFocus;
    this.chatReturnFocus = null;
    setTimeout(() => {
      if (target?.isConnected) {
        target.focus();
        return;
      }
      const launcher = Array.from(this.document.querySelectorAll<HTMLElement>(
        '.app-shell__chat-fab, .app-shell__chat-launcher'
      )).find((element) => element.getClientRects().length > 0);
      launcher?.focus();
    });
  }

  private getVisibleChatDialog(): HTMLElement | null {
    if (this.isChatMinimized) return null;
    return Array.from(this.document.querySelectorAll<HTMLElement>('[role="dialog"][aria-label="Asistente GuíaTV"]'))
      .find((element) => {
        const style = this.document.defaultView?.getComputedStyle(element);
        return element.getClientRects().length > 0 && style?.visibility !== 'hidden' && style?.display !== 'none';
      }) || null;
  }

  private trapChatDialogFocus(event: KeyboardEvent): void {
    const dialog = this.getVisibleChatDialog();
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href], textarea:not([disabled]), input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = this.document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private getMoreSheetFocusables(): HTMLElement[] {
    const sheet = this.mobileMoreSheet?.nativeElement;
    if (!sheet) return [];
    return Array.from(
      sheet.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
    );
  }

  private applyRouteState(url: string): void {
    this.currentPath = normalizePath(url);
    // Before the first navigation the router tree is empty: derive the layout from the URL.
    this.currentLayout = this.activatedRoute.firstChild
      ? this.resolveCurrentLayout()
      : layoutForUrl(url, this.router.config) ?? this.resolveCurrentLayout();
    if (!this.canRenderChatbot()) {
      this.closeChatbot();
    }
  }

  private resolveCurrentLayout(): AppLayoutMode {
    let route = this.activatedRoute;
    let resolvedLayout: AppLayoutMode = 'public-shell';

    while (route.firstChild) {
      const candidate = route.snapshot.data['layout'] as AppLayoutMode | undefined;
      if (candidate) {
        resolvedLayout = candidate;
      }
      route = route.firstChild;
    }

    const finalCandidate = route.snapshot.data['layout'] as AppLayoutMode | undefined;
    return finalCandidate || resolvedLayout;
  }

  private applyRobotsMeta(): void {
    let route = this.activatedRoute;
    while (route.firstChild) {
      route = route.firstChild;
    }
    const routeData = route.snapshot.data;
    // Static pages with no component-level meta (legal pages) declare their own description in route data,
    // instead of inheriting the generic one from index.html.
    if (routeData['description'] && !routeData['robots']) {
      this.metaService.setMetaTags({
        title: route.snapshot.title || 'Guía TV',
        description: routeData['description'],
        canonicalUrl: this.router.url.split(/[?#]/)[0],
      });
    }
    if (routeData['robots']) {
      this.metaService.setMetaTags({
        title: routeData['title'] || route.snapshot.title || 'Guía TV',
        description: '',
        robots: routeData['robots'],
      });
    }
  }

  private canRenderChatbot(): boolean {
    // Admin is an operations console, not a consumer surface — the
    // recommendations assistant FAB/launcher never appears over it.
    return (
      this.aiChatbotEnabled &&
      this.currentLayout !== 'minimal-shell' &&
      this.currentLayout !== 'admin-shell'
    );
  }
}

function normalizePath(value: string): string {
  const raw = String(value || '')
    .split('?')[0]
    .split('#')[0]
    .trim();
  if (!raw || raw === '/') {
    return '/';
  }
  return raw.replace(/\/+$/, '') || '/';
}
