import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, of } from 'rxjs';
import { catchError, distinctUntilChanged, map } from 'rxjs/operators';
import { PanelNavComponent } from '../../components/panel-nav/panel-nav.component';
import { PanelShellComponent } from '../../components/panel-shell/panel-shell.component';
import { PanelTileComponent } from '../../components/panel-tile/panel-tile.component';
import { QUE_VER_LINKS, QUE_VER_PATH } from '../../config/que-ver-nav';
import { APP_PATHS } from '../../config/route-map';
import { CatalogItem, CatalogService } from '../../services/catalog.service';
import { ChatService } from '../../services/chat.service';
import { MetaService } from '../../services/meta.service';
import { UserService } from '../../services/user.service';
import { TvDataFacade } from '../../state/tv-data.facade';

interface WhereToWatchProvider {
  id: number;
  name: string;
  logoUrl: string;
  type: 'flatrate' | 'rent' | 'buy' | 'free';
}

interface ForYouItem {
  item: {
    catalogId: string;
    source: 'program' | 'tmdb';
    contentType: 'movie' | 'series' | 'program';
    title: string;
    slug: string;
    detailPath: string;
    subtitle?: string;
    synopsis?: string;
    image?: string;
    backdrop?: string;
    genres: string[];
    tmdbId?: number;
    rating?: number;
    releaseYear?: number;
    durationMinutes?: number;
    primaryPlatforms: string[];
    channel?: { name: string; logo?: string };
  };
  score: number;
  reason: string;
  matchedGenres: string[];
  whereToWatch?: WhereToWatchProvider[];
}

@Component({
  selector: 'app-for-you',
  standalone: true,
  imports: [CommonModule, RouterModule, PanelShellComponent, PanelNavComponent, PanelTileComponent],
  templateUrl: './for-you.component.html',
  styleUrls: ['../que-ver/que-ver.component.scss', './for-you.component.scss'],
})
export class ForYouComponent implements OnInit {
  items: ForYouItem[] = [];
  loading = true;
  loadingMore = false;
  error: string | null = null;
  noPreferences = false;
  hasMore = false;
  requiresAuth = false;

  private readonly destroyRef = inject(DestroyRef);
  private readonly pageSize = 12;
  private readonly chat = inject(ChatService);
  private readonly facade = inject(TvDataFacade);
  private readonly meta = inject(MetaService);

  readonly appPaths = APP_PATHS;
  readonly sideLinks = QUE_VER_LINKS;
  readonly queVer = QUE_VER_PATH;
  readonly contextOpen = signal(false);
  readonly assistantAsks = ['Recomiéndame una película', 'Una serie como la última que vi', '¿Qué veo esta noche?'];
  /** Shown to everyone below the recommendations, so the page is never just a box. */
  readonly popular = toSignal(
    this.facade.discoverContent({ types: ['movie', 'series'], sort: 'popular', limit: 24 }).pipe(
      map((r) => r.items.slice(0, 12) as CatalogItem[]),
      catchError(() => of([] as CatalogItem[]))
    ),
    { initialValue: [] as CatalogItem[] }
  );

  constructor(
    private readonly catalogService: CatalogService,
    private readonly userService: UserService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    // Personal page: never indexed (the route's `robots` data is not read by anything).
    this.meta.setMetaTags({
      title: 'Para ti: recomendaciones personalizadas | Guía TV',
      description: 'Películas y series recomendadas según tus gustos y tus plataformas, con dónde verlas.',
      canonicalUrl: APP_PATHS.forYou,
      robots: 'noindex, follow',
    });
    combineLatest([this.userService.isAuthenticated$, this.userService.getProfile()])
      .pipe(
        map(([isAuthenticated, profile]) => ({
          isAuthenticated,
          profile,
          signature: JSON.stringify({
            isAuthenticated,
            favoriteGenres: profile?.favoriteGenres || [],
            preferredPlatforms: profile?.preferredPlatforms || [],
          }),
        })),
        distinctUntilChanged((left, right) => left.signature === right.signature),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ isAuthenticated, profile }) => {
        if (!isAuthenticated) {
          this.requiresAuth = true;
          this.noPreferences = false;
          this.items = [];
          this.error = null;
          this.loading = false;
          this.loadingMore = false;
          this.hasMore = false;
          return;
        }

        this.requiresAuth = false;
        if (!profile.favoriteGenres?.length && !profile.preferredPlatforms?.length) {
          this.noPreferences = true;
          this.loading = false;
          this.items = [];
          this.error = null;
          this.hasMore = false;
          return;
        }

        this.noPreferences = false;
        this.loadRecommendations();
      });
  }

  loadRecommendations(): void {
    if (this.requiresAuth) {
      this.loading = false;
      return;
    }

    this.loading = true;
    this.error = null;
    this.items = [];

    this.catalogService.getForYou(this.pageSize)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.items = (data || []) as ForYouItem[];
          this.hasMore = this.items.length >= this.pageSize;
          this.loading = false;
        },
        error: () => {
          this.error = 'No se pudieron cargar las recomendaciones. Inténtalo de nuevo.';
          this.loading = false;
        },
      });
  }

  loadMore(): void {
    if (this.loadingMore || this.requiresAuth) return;
    this.loadingMore = true;
    
    this.catalogService.getForYouState(this.pageSize)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          const newItems = ((result.data || []) as ForYouItem[])
            .filter((r) => !this.items.some((e) => e.item.catalogId === r.item.catalogId));
          this.items = [...this.items, ...newItems];
          this.hasMore = newItems.length >= this.pageSize;
          this.loadingMore = false;
        },
        error: () => {
          this.loadingMore = false;
        },
      });
  }

  openDetail(rec: ForYouItem): void {
    if (rec.item.detailPath) {
      void this.router.navigateByUrl(rec.item.detailPath);
    } else {
      void this.router.navigate(['/contenido', rec.item.catalogId]);
    }
  }

  goToSettings(): void {
    void this.router.navigate(['/perfil'], { queryParams: { tab: 'gustos' } });
  }

  goToLogin(): void {
    void this.router.navigate(['/iniciar-sesion'], {
      queryParams: { redirect: '/para-ti' },
    });
  }

  asCatalogItem(rec: ForYouItem): CatalogItem {
    return rec.item as unknown as CatalogItem;
  }

  openAssistant(): void {
    this.chat.requestToggleAssistant();
  }

  trackById(_index: number, rec: ForYouItem): string {
    return rec.item.catalogId;
  }
}
