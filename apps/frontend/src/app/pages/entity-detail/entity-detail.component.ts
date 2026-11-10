import { CommonModule, isPlatformServer } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, DestroyRef, Injector, OnInit, PLATFORM_ID, RESPONSE_INIT, afterNextRender, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, catchError, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MetaService } from '../../services/meta.service';
import { APP_PATHS } from '../../config/route-map';
import { serializeJsonLd } from '../../utils/utils';
import { CatalogDetailComponent } from '../catalog-detail/catalog-detail.component';
import { BreadcrumbComponent, BreadcrumbItem } from '../../components/breadcrumb/breadcrumb.component';
import { EntityBroadcastListComponent } from '../../components/entity-broadcast-list/entity-broadcast-list.component';
import { UnifiedAsyncStateComponent } from '../../components/unified-async-state/unified-async-state.component';
import { UnifiedSkeletonBlockComponent } from '../../components/unified-skeleton-block/unified-skeleton-block.component';
import { WhereToWatchComponent } from '../../components/where-to-watch/where-to-watch.component';
import { PanelNavComponent } from '../../components/panel-nav/panel-nav.component';
import { PanelShellComponent } from '../../components/panel-shell/panel-shell.component';
import { TV_SECTION_LINKS } from '../../config/tv-section-nav';
import { ChatService } from '../../services/chat.service';
import { broadcastDisplay, buildMovieSchema, ENTITY_CANONICAL_PATH, formatRuntime, GUIDE_TIME_ZONE, kindLabel, PublicEntity } from './entity-detail.model';

const SITE = 'https://guiaprogramaciontv.com';
/** The relative times on the page are re-measured this often in the browser (never on the server: a timer would hold the render). */
const TICK_MS = 30_000;

@Component({
  selector: 'app-entity-detail',
  standalone: true,
  imports: [
    CommonModule, RouterLink, CatalogDetailComponent, BreadcrumbComponent, EntityBroadcastListComponent,
    UnifiedAsyncStateComponent, UnifiedSkeletonBlockComponent, WhereToWatchComponent, PanelShellComponent, PanelNavComponent,
  ],
  styles: [':host { display: block; min-width: 0; }'],
  template: `
    @if (legacy) {
      <app-catalog-detail />
    } @else {
      <app-panel-shell sideLabel="Programación TV" [contextLabel]="entity ? 'Ficha de ' + entity.title : 'Ficha'" [(contextOpen)]="contextOpen">
      <app-panel-nav panelSide title="Programación TV" [links]="sideLinks"></app-panel-nav>
      <section panelContext class="grid gap-3 p-4 text-sm">
        @if (entity; as e) {
          <strong class="text-base">{{ e.title }}</strong>
          <span class="text-[var(--sv2-text-muted)]">{{ kind }}@if (e.year) { · {{ e.year }}}@if (runtime) { · {{ runtime }}}</span>
          @if (e.genres?.length) { <span>{{ e.genres!.join(', ') }}</span> }
        }
        <button type="button" class="min-h-9 rounded-full border border-[var(--sv2-border-strong)] px-3 text-xs font-semibold" (click)="openAssistant()">Pregunta al asistente</button>
      </section>
      <div class="min-h-[60vh] min-w-0 text-[var(--sv2-text)]">
        @if (loading) {
          <div class="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8" role="status" aria-live="polite" aria-busy="true">
            <span class="sr-only">Cargando ficha…</span>
            <app-unified-skeleton-block [count]="6" [columns]="3" cardHeight="13rem"></app-unified-skeleton-block>
          </div>
        } @else if (entity; as content) {
          @if (structuredData) { <div [innerHTML]="structuredData"></div> }
          <article>
            <header class="relative overflow-hidden bg-[var(--hero-bg)]">
              <div class="absolute inset-0" aria-hidden="true">
                @if (content.images?.backdrop; as backdrop) {
                  <img [src]="backdrop" alt="" class="h-full w-full object-cover opacity-55" decoding="async" />
                } @else {
                  <div class="absolute inset-0 bg-[radial-gradient(circle_at_top_left,color-mix(in_oklch,var(--accent-live)_14%,transparent),transparent_38%),radial-gradient(circle_at_top_right,color-mix(in_oklch,var(--accent-discover)_10%,transparent),transparent_32%)]"></div>
                }
                <div class="absolute inset-0 bg-[linear-gradient(90deg,color-mix(in_oklch,var(--hero-bg)_98%,transparent)_0%,color-mix(in_oklch,var(--hero-bg)_78%,transparent)_55%,color-mix(in_oklch,var(--hero-bg)_45%,transparent)_100%)]"></div>
                <div class="absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--hero-bg)_10%,transparent),var(--hero-bg)_100%)]"></div>
              </div>

              <div class="relative mx-auto max-w-7xl px-4 pt-5 sm:px-6 lg:px-8 lg:pt-8">
                <app-breadcrumb [items]="breadcrumbItems" [embedded]="true" [onHero]="true"></app-breadcrumb>
              </div>

              <div class="relative mx-auto flex min-h-[18rem] max-w-7xl flex-col gap-6 px-4 pb-10 pt-6 sm:px-6 md:flex-row md:items-end lg:px-8 lg:pt-8">
                @if (content.images?.poster; as poster) {
                  <div class="mx-auto w-36 flex-shrink-0 overflow-hidden rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)] sm:w-44 md:mx-0 md:w-48 lg:w-56">
                    <img [src]="poster" [alt]="'Cartel de ' + content.title" width="380" height="570" class="aspect-[2/3] w-full object-cover" fetchpriority="high" decoding="async" />
                  </div>
                }
                <div class="min-w-0 flex-1 space-y-4">
                  <p class="inline-block rounded-[var(--radius-pill)] border border-[var(--hero-border)] bg-[var(--hero-bg-soft)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--hero-text-muted)]">{{ kind }}</p>
                  <h1 class="max-w-4xl break-words text-3xl font-black tracking-tight text-[var(--hero-text)] md:text-5xl">{{ content.title }}</h1>
                  @if (content.originalTitle && content.originalTitle !== content.title) {
                    <p class="text-base text-[var(--hero-text-muted)]"><span class="sr-only">Título original: </span><i>{{ content.originalTitle }}</i></p>
                  }
                  @if (content.year || runtime) {
                    <p class="tnum flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--hero-text-muted)]">
                      @if (content.year) { <span>{{ content.year }}</span> }
                      @if (runtime) { <span><span class="sr-only">Duración: </span>{{ runtime }}</span> }
                    </p>
                  }
                  @if (content.genres?.length) {
                    <ul class="flex flex-wrap gap-2" aria-label="Géneros">
                      @for (genre of content.genres; track genre) {
                        <li class="rounded-[var(--radius-pill)] border border-[var(--hero-border)] bg-[var(--hero-bg-soft)] px-3 py-1 text-xs font-semibold text-[var(--hero-text-muted)]">{{ genre }}</li>
                      }
                    </ul>
                  }
                  @if (content.synopsis) {
                    <p class="max-w-3xl whitespace-pre-line text-base leading-7 text-[var(--hero-text-muted)]">{{ content.synopsis }}</p>
                  } @else {
                    <p class="max-w-3xl text-base leading-7 text-[var(--hero-text-muted)]">Sinopsis no disponible.</p>
                  }
                </div>
              </div>
            </header>

            <div class="mx-auto max-w-7xl space-y-10 px-4 pb-16 pt-8 sm:px-6 lg:space-y-14 lg:px-8 lg:pt-10">
              @if (content.broadcasts) {
                <app-entity-broadcast-list [broadcasts]="content.broadcasts" [now]="now" [entityTitle]="content.title" />
              } @else if (content.kind === 'show' || content.kind === 'event') {
                <section aria-labelledby="programme-schedule-title">
                  <h2 id="programme-schedule-title" class="text-xl font-bold">Emisiones en TV</h2>
                  <p class="mt-3 text-sm text-[var(--portal-text-soft)]">No disponemos de un horario verificado para este programa. Consulta la guía para descubrir qué se emite.</p>
                  <a [routerLink]="exploreLinks[0].path" class="mt-3 inline-block font-semibold underline underline-offset-4">Qué ver hoy en TV</a>
                </section>
              }

              @if (content.tmdbId && (content.kind === 'movie' || content.kind === 'series')) {
                <section aria-labelledby="entity-where-title">
                  <p class="eyebrow text-[var(--portal-text-muted)]">Disponibilidad</p>
                  <h2 id="entity-where-title" class="mt-1 text-xl font-bold tracking-tight text-[var(--portal-text)]">Dónde ver</h2>
                  <div class="mt-4">
                    <app-where-to-watch [tmdbId]="content.tmdbId" [contentType]="content.kind === 'series' ? 'tv' : 'movie'" [primaryPlatforms]="[]" placement="catalog-detail"
                      [catalogId]="'tmdb:' + (content.kind === 'series' ? 'tv' : 'movie') + ':' + content.tmdbId" [page]="content.canonicalPath"></app-where-to-watch>
                  </div>
                </section>
              }

              @if (content.credits?.directors?.length || content.credits?.cast?.length) {
                <section aria-labelledby="entity-credits-title">
                  <p class="eyebrow text-[var(--portal-text-muted)]">Equipo</p>
                  <h2 id="entity-credits-title" class="mt-1 text-xl font-bold tracking-tight text-[var(--portal-text)]">Reparto y dirección</h2>
                  @if (content.credits?.directors?.length) {
                    <p class="mt-3 text-sm text-[var(--portal-text-soft)]"><span class="text-[var(--portal-text-muted)]">Dirección:</span> {{ content.credits?.directors?.join(', ') }}</p>
                  }
                  @if (content.credits?.cast?.length) {
                    <ul class="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                      @for (person of content.credits?.cast; track person.name) {
                        <li class="text-[var(--portal-text)]">{{ person.name }}@if (person.character) { <span class="text-[var(--portal-text-muted)]"> · {{ person.character }}</span> }</li>
                      }
                    </ul>
                  }
                </section>
              }

              <nav aria-labelledby="entity-explore-title">
                <h2 id="entity-explore-title" class="text-xl font-bold tracking-tight text-[var(--portal-text)]">Sigue explorando</h2>
                <ul class="mt-4 flex flex-wrap gap-3 text-sm">
                  @for (link of exploreLinks; track link.path) {
                    <li><a [routerLink]="link.path" class="inline-block rounded-[var(--radius-pill)] border border-[var(--portal-border)] bg-[var(--portal-surface)] px-4 py-2 font-semibold text-[var(--portal-text)] hover:border-[var(--portal-border-strong)] focus-visible:border-[var(--portal-border-strong)]">{{ link.label }}</a></li>
                  }
                </ul>
              </nav>

              @if (content.attribution; as attribution) {
                <footer class="border-t border-[var(--portal-border)] pt-6 text-xs leading-5 text-[var(--portal-text-muted)]">
                  <p>{{ attribution.notice }} <a href="https://www.themoviedb.org" rel="noopener noreferrer" class="underline underline-offset-4">themoviedb.org</a></p>
                  @if (updated) { <p>Datos actualizados el <time [attr.datetime]="attribution.updatedAt">{{ updated }}</time>.</p> }
                </footer>
              }
            </div>
          </article>
        } @else {
          <div class="mx-auto max-w-4xl px-4 py-10 sm:px-6">
            <app-unified-async-state [kind]="unavailable ? 'error' : 'empty'"
              [title]="unavailable ? 'Ficha no disponible' : 'Contenido no encontrado'"
              [message]="unavailable ? 'No se pudo cargar la ficha. Inténtalo más tarde.' : 'Esta ficha no está disponible.'" />
            <a routerLink="/" class="mt-6 inline-block underline underline-offset-4">Volver al inicio</a>
          </div>
        }
      </div>
      </app-panel-shell>
    }
  `,
})
export class EntityDetailComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly meta = inject(MetaService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly response = inject(RESPONSE_INIT, { optional: true });
  private readonly server = isPlatformServer(inject(PLATFORM_ID));
  entity?: PublicEntity;
  legacy = false;
  loading = true;
  unavailable = false;
  /** The clock for relative times: the API's `generatedAt` until the browser takes over. */
  now = new Date();
  structuredData: SafeHtml | null = null;
  breadcrumbItems: BreadcrumbItem[] = [];
  runtime: string | null = null;
  kind = '';
  updated = '';
  readonly sideLinks = TV_SECTION_LINKS;
  contextOpen = false;
  private readonly chat = inject(ChatService);
  openAssistant(): void {
    this.chat.requestToggleAssistant();
  }
  readonly exploreLinks = [
    { label: 'Qué ver hoy en TV', path: APP_PATHS.explore },
    { label: 'Películas en TV', path: APP_PATHS.movies },
    { label: 'Canales', path: APP_PATHS.channels },
  ];

  ngOnInit(): void {
    if (!this.server) {
      // Browser only: a repeating timer on the server would keep the render from ever settling.
      afterNextRender(() => {
        const id = setInterval(() => { this.now = new Date(); this.cdr.markForCheck(); }, TICK_MS);
        this.destroyRef.onDestroy(() => clearInterval(id));
      }, { injector: this.injector });
    }
    // While the browser hydrates, the server-rendered head is already right: blanking it until the client's own
    // request settles left a window with noindex and no canonical. Reset it only on later in-app navigations.
    let hydrating = !this.server;
    this.route.paramMap.pipe(
      switchMap(() => {
        this.entity = undefined;
        this.legacy = false;
        this.loading = true;
        this.unavailable = false;
        this.structuredData = null;
        if (!hydrating) this.setMeta('Ficha - Guía TV', null);
        hydrating = false;
        return this.http.get<{ success: boolean; data: PublicEntity }>(`${environment.API_BASE_URL}/entities/resolve`, {
          params: { path: this.router.url.split(/[?#]/)[0], redirect: 'false' },
        }).pipe(catchError((error: HttpErrorResponse) => {
          this.loading = false;
          if (error.status === 404 && error.error?.error?.code === 'ENTITY_PUBLIC_READ_DISABLED' && this.route.snapshot.data['contentType']) {
            this.legacy = true;
          } else {
            this.fail([400, 404, 410].includes(error.status) ? error.status : 503);
          }
          return EMPTY;
        }));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: ({ success, data }) => {
        this.loading = false;
        if (!success || !data?.title || !ENTITY_CANONICAL_PATH.test(data.canonicalPath)) {
          this.fail(503);
          return;
        }
        this.entity = data;
        this.present(data);
        this.markEntityResponse();
        this.setMeta(this.metaTitle(data), data.canonicalPath, 200, this.metaDescription(data), data.images?.poster);
        if (data.canonicalPath !== this.router.url.split(/[?#]/)[0]) {
          if (this.server && this.response) {
            this.response.status = 301;
            this.response.headers = { ...this.response.headers, Location: data.canonicalPath, 'X-Robots-Tag': 'noindex, follow' };
          } else {
            void this.router.navigateByUrl(data.canonicalPath, { replaceUrl: true });
          }
        }
      },
    });
  }

  /** View-model fields derived once per response, so the template stays declarative. */
  private present(data: PublicEntity): void {
    const generated = data.broadcasts?.generatedAt ? new Date(data.broadcasts.generatedAt) : null;
    this.now = this.server && generated && !Number.isNaN(generated.getTime()) ? generated : new Date();
    this.kind = kindLabel(data.kind);
    this.runtime = data.kind === 'series' ? null : formatRuntime(data.runtimeMinutes);
    this.updated = data.attribution ? new Intl.DateTimeFormat('es-ES', { timeZone: GUIDE_TIME_ZONE, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(data.attribution.updatedAt)) : '';
    const hub = data.kind === 'series' ? { name: 'Series', url: APP_PATHS.series } : data.kind === 'movie' ? { name: 'Películas', url: APP_PATHS.movies } : { name: 'Programas', url: APP_PATHS.live };
    this.breadcrumbItems = [{ name: 'Inicio', url: '/' }, hub, { name: data.title, url: data.canonicalPath }];
    const schema = buildMovieSchema(data, SITE);
    this.structuredData = schema
      ? this.sanitizer.bypassSecurityTrustHtml(`<script type="application/ld+json">${serializeJsonLd(schema)}</script>`)
      : null;
  }

  private metaTitle(data: PublicEntity): string {
    return `${data.title}${data.year ? ` (${data.year})` : ''} - Guía TV`;
  }

  private metaDescription(data: PublicEntity): string {
    const next = data.broadcasts?.status === 'ok' ? data.broadcasts.items[0] : undefined;
    const when = next ? `Próxima emisión en ${next.channel.name}: ${broadcastDisplay(next, this.now).day.toLowerCase()} a las ${next.localTime}. ` : '';
    return `${when}${data.synopsis ?? ''}`;
  }

  private fail(status: number): void {
    this.markEntityResponse();
    this.unavailable = status >= 500;
    this.setMeta('Ficha no disponible - Guía TV', null, status);
  }

  private markEntityResponse(): void {
    if (this.response) this.response.headers = {
      ...this.response.headers,
      'Content-Type': 'text/html; charset=utf-8',
      'X-Entity-Public-Read': '1',
      'Cache-Control': 'no-store',
    };
  }

  private setMeta(title: string, canonicalUrl: string | null, httpStatus?: number, description = '', image?: string): void {
    this.meta.setMetaTags({ title, description, canonicalUrl, robots: 'noindex, follow', httpStatus, ...(image ? { image } : {}) });
    if (this.response && httpStatus) this.response.status = httpStatus;
  }
}
