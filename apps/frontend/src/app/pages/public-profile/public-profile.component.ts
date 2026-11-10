import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PanelNavComponent } from '../../components/panel-nav/panel-nav.component';
import { PanelShellComponent } from '../../components/panel-shell/panel-shell.component';
import { PERFIL_LINKS } from '../../config/perfil-nav';
import { APP_PATHS } from '../../config/route-map';
import { MetaService } from '../../services/meta.service';
import { UserService } from '../../services/user.service';
import { resolvePlatformLogoUrl } from '../../utils/platform-logos';
import { sameValue } from '../../utils/taste-profile';
import { avatarSrc } from '../../utils/avatar-src';

interface PublicProfile {
  id: string;
  name: string;
  avatar?: string;
  bio?: string;
  location?: string;
  favoriteGenres?: string[];
  preferredPlatforms?: string[];
  isFollowing?: boolean;
  isFollower?: boolean;
  blocked?: boolean;
  stats?: { followers: number; following: number; ratings: number; lists: number };
}

/** Public profile (/perfil/:userId): who the person is, what they watch and where, and what you have in common. */
@Component({
  selector: 'app-public-profile',
  standalone: true,
  imports: [AsyncPipe, RouterLink, PanelShellComponent, PanelNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../user-area/perfil-ui.scss', './public-profile.component.scss'],
  template: `
    <app-panel-shell sideLabel="Perfil" contextLabel="Guía TV" [(contextOpen)]="contextOpen">
      @let auth = user.isAuthenticated$ | async;
      <div panelSide>@if (auth) {<app-panel-nav title="Mi perfil" [links]="links"></app-panel-nav>}</div>

      <section panelContext class="pp-ctx" aria-label="Guía TV">
        @if (auth) {
        <div class="pf-card">
          <h3>Tu perfil</h3>
          <p class="pf-muted">Tus canales, tu lista y un asistente que conoce tus gustos.</p>
          <a class="pf-btn pf-btn--pri" [routerLink]="appPaths.profile">Ir a mi perfil</a>
        </div>
        } @else {
        <div class="pf-card">
          <h3>Crea tu perfil gratis</h3>
          <p class="pf-muted">Guarda tus canales y tu lista, sigue a tus equipos y recibe recomendaciones de qué ver.</p>
          <a class="pf-btn pf-btn--pri" routerLink="/registro">Crear cuenta</a>
          <a class="pf-link" routerLink="/iniciar-sesion">Ya tengo cuenta ›</a>
        </div>
        }
        <div class="pf-card">
          <h3>Descubre</h3>
          <div class="pp-links">
            <a routerLink="/programacion-tv/que-ver-hoy">Qué ver hoy</a>
            <a routerLink="/programacion-tv/en-directo">TV en directo</a>
            <a routerLink="/plataformas">Plataformas</a>
          </div>
        </div>
      </section>

      <div class="pp">
        <nav class="pp-bc" aria-label="Migas de pan"><a [routerLink]="appPaths.home">Inicio</a><span aria-hidden="true">›</span><span aria-current="page">Perfil</span></nav>

        @if (loading()) {
        <div class="pf-skel" aria-busy="true"><div></div><div></div></div>
        } @else if (error() || !profile()) {
        <div class="pf-empty"><strong>{{ error() || 'Este perfil no existe.' }}</strong>@if (!auth) {<span>Inicia sesión para ver perfiles de otros usuarios.</span><a class="pf-btn pf-btn--pri" routerLink="/iniciar-sesion">Iniciar sesión</a>}</div>
        } @else if (profile()!.blocked) {
        <div class="pf-empty"><strong>Este perfil no está disponible.</strong></div>
        } @else {
        @let p = profile()!;
        <header class="pp-hero">
          <span class="pp-avatar">@if (photo(p.avatar); as src) {<img [src]="src" alt="" />} @else { {{ initials(p.name) }} }</span>
          <div class="pp-hero__body">
            <h1>{{ p.name }}</h1>
            @if (p.location && p.location !== '-') {<span class="pf-small">{{ p.location }}</span>}
            @if (p.bio) {<p class="pf-muted">{{ p.bio }}</p>}
            <div class="pf-actions">
              @if (isMe()) {
              <a class="pf-btn" [routerLink]="appPaths.profile" [queryParams]="{ tab: 'cuenta' }">Editar mi perfil</a>
              } @else if (auth) {
              <button type="button" class="pf-btn" [class.pf-btn--pri]="!p.isFollowing" (click)="toggleFollow()">{{ p.isFollowing ? 'Siguiendo' : 'Seguir' }}</button>
              @if (p.isFollower) {<span class="pf-small">Te sigue</span>}
              }
            </div>
          </div>
        </header>

        @if (p.stats) {
        <div class="pp-stats">
          <div><strong>{{ p.stats.ratings }}</strong><span>valoraciones</span></div>
          <div><strong>{{ p.stats.lists }}</strong><span>listas públicas</span></div>
          <div><strong>{{ p.stats.followers }}</strong><span>seguidores</span></div>
          <div><strong>{{ p.stats.following }}</strong><span>siguiendo</span></div>
        </div>
        }

        @if (common().platforms.length || common().genres.length) {
        <section class="pf-card pp-common" aria-labelledby="pp-common">
          <h2 id="pp-common">En común contigo</h2>
          @if (common().platforms.length) {<p>Los dos tenéis <strong>{{ common().platforms.join(', ') }}</strong>.</p>}
          @if (common().genres.length) {<p>A los dos os gusta <strong>{{ common().genres.join(', ').toLowerCase() }}</strong>.</p>}
        </section>
        }

        <section class="pf-sec" aria-labelledby="pp-plat">
          <div class="pf-head"><h2 id="pp-plat">Dónde ve la tele</h2></div>
          @if (p.preferredPlatforms?.length) {
          <div class="pf-chips">@for (pl of p.preferredPlatforms; track pl) {<span class="pf-chip">@if (logo(pl); as src) {<img [src]="src" alt="" width="22" height="22" />}{{ pl }}</span>}</div>
          } @else {<p class="pf-muted">No ha compartido sus plataformas.</p>}
        </section>

        <section class="pf-sec" aria-labelledby="pp-gen">
          <div class="pf-head"><h2 id="pp-gen">Lo que le gusta</h2></div>
          @if (p.favoriteGenres?.length) {
          <div class="pf-chips">@for (g of p.favoriteGenres; track g) {<span class="pf-chip">{{ g }}</span>}</div>
          } @else {<p class="pf-muted">{{ p.bio === undefined ? 'Su perfil es privado.' : 'No ha compartido sus gustos.' }}</p>}
        </section>
        }
      </div>
    </app-panel-shell>
  `,
})
export class PublicProfileComponent {
  protected readonly user = inject(UserService);
  private readonly meta = inject(MetaService);

  readonly links = PERFIL_LINKS;
  readonly appPaths = APP_PATHS;
  readonly contextOpen = signal(false);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly profile = signal<PublicProfile | null>(null);
  private readonly me = toSignal(this.user.getProfile(), { requireSync: true });

  readonly isMe = computed(() => !!this.profile() && this.profile()!.id === this.me().id);
  /** Platforms and genres the viewer shares with this person (only when signed in and both are known). */
  readonly common = computed(() => {
    const p = this.profile();
    const me = this.me();
    if (!p || this.isMe() || !me.id) return { platforms: [] as string[], genres: [] as string[] };
    return {
      platforms: (p.preferredPlatforms ?? []).filter((x) => me.preferredPlatforms.some((y) => sameValue(x, y))),
      genres: (p.favoriteGenres ?? []).filter((x) => me.favoriteGenres.some((y) => sameValue(x, y))),
    };
  });

  constructor() {
    inject(ActivatedRoute)
      .paramMap.pipe(takeUntilDestroyed())
      .subscribe((params) => this.load(String(params.get('userId') || '')));
  }

  initials(name: string): string {
    return (name || 'U').split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');
  }

  photo(avatar?: string): string {
    return avatarSrc(avatar);
  }

  logo(name: string): string {
    return resolvePlatformLogoUrl(name);
  }

  toggleFollow(): void {
    const p = this.profile();
    if (!p) return;
    this.user.toggleFollow(p.id).subscribe(() => this.profile.set({ ...p, isFollowing: !p.isFollowing }));
  }

  private load(userId: string): void {
    this.loading.set(true);
    this.error.set('');
    // Personal pages are never indexed.
    this.meta.setMetaTags({ title: 'Perfil | Guía TV', description: 'Perfil de usuario en Guía TV.', canonicalUrl: `/perfil/${userId}`, robots: 'noindex, follow' });
    this.user.getPublicProfile(userId).subscribe({
      next: (profile: PublicProfile | null) => {
        this.profile.set(profile);
        this.loading.set(false);
        if (profile?.name) this.meta.setMetaTags({ title: `${profile.name} | Guía TV`, description: `Perfil de ${profile.name} en Guía TV.`, canonicalUrl: `/perfil/${userId}`, robots: 'noindex, follow' });
      },
      error: () => {
        this.error.set('No se pudo cargar este perfil.');
        this.loading.set(false);
      },
    });
  }
}
