import { CommonModule, DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Inject,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Params, Router, RouterModule } from '@angular/router';
import { filter } from 'rxjs';
import { PortalContextNavComponent, PortalContextNavKind } from '../../components/portal-context-nav/portal-context-nav.component';
import { UnifiedPortalShellComponent } from '../../components/unified-portal-shell/unified-portal-shell.component';
import { APP_PATHS } from '../../config/route-map';
import { MetaService } from '../../services/meta.service';
import { UserService } from '../../services/user.service';
import { UnifiedGuideStateService, UnifiedGuideTab } from '../../state/unified-guide.state';
import { UnifiedShellUiStateService } from '../../state/unified-shell-ui.state';
import { DiscoverViewComponent } from './views/discover-view.component';
import { StreamingViewComponent } from './views/streaming-view.component';
import { StreamingComparisonComponent } from '../streaming-comparison/streaming-comparison.component';

const TAB_META: Record<UnifiedGuideTab, { title: string; seoTitle?: string; description: string; path: string }> = {
  live: {
    title: 'TV Directo',
    seoTitle: 'TV en directo: qué emiten ahora los canales de España',
    description: 'Guía unificada de emisiones en directo, próximas franjas y parrilla completa.',
    path: APP_PATHS.guide,
  },
  discover: {
    title: 'Qué Ver',
    seoTitle: 'Qué ver hoy en TV y streaming: cine, series y deporte',
    description: 'Descubre qué ver hoy mezclando TV en directo, catálogo editorial y streaming.',
    path: APP_PATHS.explore,
  },
  streaming: {
    title: 'Plataformas',
    seoTitle: 'Plataformas de streaming en España: catálogo y planes',
    description: 'Explora plataformas, novedades y catálogo en streaming dentro del mismo sistema.',
    path: APP_PATHS.platforms,
  },
};

@Component({
  selector: 'app-unified-guide',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    UnifiedPortalShellComponent,
    PortalContextNavComponent,
    DiscoverViewComponent,
    StreamingViewComponent,
    StreamingComparisonComponent,
  ],
  templateUrl: './unified-guide.component.html',
  styleUrl: './unified-guide.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnifiedGuideComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly state = inject(UnifiedGuideStateService);
  private readonly shellUi = inject(UnifiedShellUiStateService);
  private readonly meta = inject(MetaService);
  private readonly userService = inject(UserService);
  private readonly isBrowser: boolean;

  readonly activeTab = this.state.activeTab;
  readonly platformMode = signal<'catalog' | 'compare'>('catalog');
  readonly searchQuery = this.state.searchQuery;
  readonly isAuthenticated = toSignal(this.userService.isAuthenticated$, { initialValue: false });
  readonly profile = toSignal(this.userService.getProfile(), {
    initialValue: this.userService.getProfileSnapshot(),
  });

  readonly pageMeta = computed(() => {
    if (this.platformMode() === 'compare') {
      return {
        title: 'Comparador de plataformas',
        description: 'Compara precios, pantallas, resolución y funciones de las principales plataformas de streaming en España.',
        path: APP_PATHS.streamingComparison,
      };
    }
    return TAB_META[this.activeTab()];
  });
  readonly contextNavKind = computed<PortalContextNavKind>(() => {
    const tab = this.activeTab();
    return tab === 'streaming' ? 'platforms' : tab;
  });
  readonly sectionSelection = computed(() => {
    if (this.activeTab() === 'live') {
      return this.state.liveFilters().liveView;
    }

    if (this.activeTab() === 'discover') {
      const filters = this.state.discoverFilters();
      if (filters.types.length === 1 && filters.types[0] === 'movie') return 'movie';
      if (filters.types.length === 1 && filters.types[0] === 'series') return 'series';
      if (filters.availability.includes('live')) return 'live';
      if (filters.availability.includes('free')) return 'free';
      return 'all';
    }

    if (this.activeTab() === 'streaming') {
      const filters = this.state.streamingFilters();
      if (filters.availability.includes('free')) return 'free';
      return filters.sort;
    }

    return '';
  });
  readonly breadcrumbItems = computed(() => [
    { name: 'Inicio', url: APP_PATHS.home },
    { name: this.pageMeta().title, url: this.pageMeta().path },
  ]);
  readonly filterCount = computed(() => {
    if (this.activeTab() === 'live') {
      const filters = this.state.liveFilters();
      return Number(filters.group !== 'tdt') + Number(filters.category !== 'all') +
        Number(Boolean(filters.channel)) + Number(filters.channelType !== 'all') +
        Number(filters.region !== 'all') + filters.flags.length +
        Number(filters.date !== 'today') + Number(Boolean(this.state.searchQuery()));
    }

    if (this.activeTab() === 'discover') {
      const filters = this.state.discoverFilters();
      const defaultTypes = filters.types.length === 3 && ['program', 'movie', 'series'].every((type) => filters.types.includes(type as any));
      return Number(!defaultTypes) + filters.availability.length + filters.platforms.length +
        filters.genres.length + Number(Boolean(filters.intent)) + Number(filters.sort !== 'popular') +
        Number(filters.date !== 'today') + Number(Boolean(this.state.searchQuery()));
    }

    if (this.activeTab() === 'streaming') {
      const filters = this.state.streamingFilters();
      return Number(Boolean(filters.platform)) + Number(Boolean(filters.type)) +
        filters.availability.length + filters.genres.length + Number(filters.sort !== 'popular') +
        Number(Boolean(this.state.searchQuery()));
    }

    return 0;
  });
  constructor(
    @Inject(DOCUMENT) private readonly document: Document,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);

    this.route.data
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((data) => {
        const tab = (data['tab'] || 'live') as UnifiedGuideTab;
        this.platformMode.set(data['platformMode'] === 'compare' ? 'compare' : 'catalog');
        this.state.selectTab(tab);
        this.shellUi.closeFilterDock();
        this.state.syncFromQueryParams(this.route.snapshot.queryParams, tab);
        this.updateMeta();
      });

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        this.state.syncFromQueryParams(paramMapToParams(params.keys, params), this.activeTab());
      });

    effect(() => {
      // URL updates reflect browser filter interactions; SSR must render the canonical URL directly.
      if (!this.isBrowser) return;
      const queryParams = this.state.toQueryParams(this.activeTab());
      const current = this.route.snapshot.queryParams;
      if (sameParams(current, queryParams)) {
        return;
      }
      untracked(() => {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams,
          replaceUrl: true,
          queryParamsHandling: '',
        });
      });
    });

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.updateMeta());
  }

  onSectionSelect(value: string): void {
    if (this.activeTab() === 'live') {
      if (value === 'now' || value === 'next' || value === 'night' || value === 'day') {
        this.state.updateLiveFilters({ liveView: value });
      }
      return;
    }
    if (this.activeTab() === 'discover') {
      if (value === 'movie') {
        this.state.updateDiscoverFilters({ types: ['movie'], page: 1 });
        return;
      }
      if (value === 'series') {
        this.state.updateDiscoverFilters({ types: ['series'], page: 1 });
        return;
      }
      this.state.updateDiscoverFilters({
        types: ['program', 'movie', 'series'],
        intent: '',
        availability: value === 'all' ? [] : [value as any],
        page: 1,
      });
      return;
    }
    if (this.activeTab() === 'streaming') {
      if (value === 'free') {
        this.state.updateStreamingFilters({ availability: ['free'], page: 1 });
        return;
      }
      this.state.updateStreamingFilters({ type: '', availability: [], sort: value as any, page: 1 });
      return;
    }
  }

  toggleFilterDock(): void {
    this.shellUi.toggleFilterDock();
  }

  private pathForTab(tab: UnifiedGuideTab): string {
    return TAB_META[tab].path;
  }

  private updateMeta(): void {
    const meta = this.pageMeta();
    this.meta.setMetaTags({
      title: `${('seoTitle' in meta && meta.seoTitle) || meta.title} | Guía TV`,
      description: meta.description,
      canonicalUrl: meta.path,
      type: 'website',
    });
  }
}

function sameParams(left: Params, right: Params): boolean {
  const leftKeys = Object.keys(left || {}).filter((key) => left[key] != null).sort();
  const rightKeys = Object.keys(right || {}).filter((key) => right[key] != null).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key, index) => key === rightKeys[index] && String(left[key]) === String(right[key]));
}

function paramMapToParams(keys: string[], params: import('@angular/router').ParamMap): Params {
  const result: Params = {};
  keys.forEach((key) => {
    result[key] = params.get(key);
  });
  return result;
}

