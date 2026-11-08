import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Output,
  PLATFORM_ID,
  QueryList,
  ViewChildren,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { filter } from 'rxjs';
import { PORTAL_SECTION_NAVIGATION, PortalContextDestination, PortalSection } from '../../config/portal-navigation.config';
import { APP_PATHS } from '../../config/route-map';
import { BreadcrumbComponent, BreadcrumbItem } from '../breadcrumb/breadcrumb.component';

export type PortalContextNavKind = PortalSection;

@Component({
  selector: 'app-portal-context-nav',
  standalone: true,
  imports: [RouterModule, BreadcrumbComponent],
  templateUrl: './portal-context-nav.component.html',
  styleUrl: './portal-context-nav.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalContextNavComponent implements AfterViewInit {
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly kind = input<PortalContextNavKind>('blog');
  readonly breadcrumbItems = input<readonly BreadcrumbItem[]>([]);
  readonly active = input<string | null>(null);
  readonly actionLabel = input<string | null>(null);
  readonly actionCount = input(0);
  @Output() readonly itemSelect = new EventEmitter<string>();
  @Output() readonly action = new EventEmitter<void>();
  @ViewChildren('navItem', { read: ElementRef }) private navItems?: QueryList<ElementRef<HTMLElement>>;
  readonly compact = signal(false);
  private viewReady = false;
  private readonly navigation = toSignal(
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)),
    { initialValue: null }
  );

  readonly config = computed(() => PORTAL_SECTION_NAVIGATION[this.kind()]);
  readonly items = computed<readonly PortalContextDestination[]>(() => this.config().items);
  readonly label = computed(() => this.config().label);
  readonly activeId = computed(() => this.active() || this.resolveActive(this.navigation()?.urlAfterRedirects || this.router.url));
  readonly resolvedBreadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const supplied = this.breadcrumbItems();
    if (supplied.length) {
      return supplied.map((item) => ({ ...item }));
    }

    const activeItem = this.items().find((item) => item.id === this.activeId());
    const root = { name: this.config().rootLabel, url: this.config().rootPath };
    const items: BreadcrumbItem[] = [
      { name: 'Inicio', url: APP_PATHS.home },
      root,
    ];
    if (activeItem && activeItem.path !== root.url) {
      items.push({ name: activeItem.label, url: activeItem.path });
    }
    return items;
  });

  constructor() {
    effect(() => {
      this.activeId();
      if (this.viewReady) queueMicrotask(() => this.scrollActiveIntoView());
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.navItems?.changes.subscribe(() => this.scrollActiveIntoView());
    queueMicrotask(() => this.scrollActiveIntoView());
  }

  @HostListener('window:scroll')
  @HostListener('window:resize')
  onWindowScroll(): void {
    const browserWindow = typeof window === 'undefined' ? null : window;
    this.compact.set(Boolean(browserWindow && browserWindow.innerWidth <= 639 && browserWindow.scrollY > 56));
  }

  select(item: PortalContextDestination): void {
    if ((item.kind || 'route') === 'action') this.itemSelect.emit(item.id);
  }

  private resolveActive(url: string): string {
    const [beforeFragment, fragment = ''] = url.split('#');
    const [path, query = ''] = beforeFragment.split('?');
    if (this.kind() === 'live') return 'now';
    if (this.kind() === 'discover') {
      if (path.startsWith(APP_PATHS.movies)) return 'movies';
      if (path.startsWith(APP_PATHS.series)) return 'series';
      if (path.startsWith(APP_PATHS.stats)) return 'trends';
      return 'all';
    }
    if (this.kind() === 'platforms') {
      return path.startsWith(APP_PATHS.streamingComparison) ? 'compare' : 'platforms';
    }
    if (this.kind() === 'sports') {
      if (path.includes('/noticias')) return 'news';
      if (path.includes('/competiciones')) return 'competitions';
      if (path.includes('/equipos/') || (path.includes('/buscar') && new URLSearchParams(query).get('tipo') === 'equipos')) return 'teams';
      // en-directo / partidos-hoy / calendario / partido detail all collapse
      // into the single "Partidos" destination — they're states of one page,
      // not separate top-level sections (§4 football nav consolidation).
      if (/\/(en-directo|partidos|resultados|partidos-hoy|calendario|partido\/)/.test(path)) return 'matches';
      if (fragment === 'donde-ver') return 'watch';
      return 'home';
    }
    if (path.startsWith(APP_PATHS.top10)) return 'rankings';
    if (path.startsWith(`${APP_PATHS.blog}/categoria/streaming`)) return 'streaming';
    if (path.startsWith(`${APP_PATHS.blog}/categoria/futbol`)) return 'football';
    return 'latest';
  }

  private scrollActiveIntoView(): void {
    if (!this.isBrowser) return;
    const activeElement = this.navItems?.find(
      (item) => item.nativeElement?.dataset?.['navId'] === this.activeId()
    )?.nativeElement;
    if (!activeElement || typeof activeElement.scrollIntoView !== 'function') return;
    const reducedMotion = globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    activeElement.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }
}
