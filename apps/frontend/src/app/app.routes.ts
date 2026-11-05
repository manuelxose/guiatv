import { Routes } from '@angular/router';
import { BLOG_ROUTES } from './blog/blog.routes';
import { FOOTBALL_ROUTES } from './features/football/football.routes';
import { adminGuard } from './guards/admin.guard';
import { NotFoundComponent } from './pages/not-found/not-found.component';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/home/home.component').then((m) => m.HomeComponent),
    title: 'Inicio - Guía TV',
    data: { layout: 'portal-page' },
  },
  {
    path: 'iniciar-sesion',
    loadComponent: () =>
      import('./pages/auth/login/login.component').then(
        (m) => m.LoginComponent
      ),
    title: 'Iniciar sesión - Guía TV',
    data: { robots: 'noindex, follow', layout: 'minimal-shell' },
  },
  {
    path: 'registro',
    loadComponent: () =>
      import('./pages/auth/register/register.component').then(
        (m) => m.RegisterComponent
      ),
    title: 'Registro - Guia TV',
    data: { robots: 'noindex, follow', layout: 'minimal-shell' },
  },
  {
    path: 'perfil',
    loadComponent: () =>
      import('./pages/user-area/user-area.component').then(
        (m) => m.UserAreaComponent
      ),
    title: 'Perfil - Guía TV',
    // 'overview' — Mi GuíaTV's content-first home (completion meter, "para
    // ti" rail). /comunidad keeps its own 'feed' default below; these are
    // two distinct entry URLs sharing one component, not meant to converge.
    data: { defaultTab: 'overview', robots: 'noindex, nofollow', layout: 'private-shell' },
  },
  {
    path: 'mi-cuenta',
    redirectTo: 'perfil',
    pathMatch: 'full',
  },
  {
    path: 'comunidad',
    loadComponent: () =>
      import('./pages/user-area/user-area.component').then(
        (m) => m.UserAreaComponent
      ),
    title: 'Comunidad - Guía TV',
    data: { defaultTab: 'feed', robots: 'noindex, nofollow', layout: 'private-shell' },
  },
  {
    path: 'perfil/:userId',
    loadComponent: () =>
      import('./pages/public-profile/public-profile.component').then(
        (m) => m.PublicProfileComponent
      ),
    title: 'Perfil - Guía TV',
    data: { layout: 'public-shell' },
  },
  {
    path: 'para-ti',
    loadComponent: () =>
      import('./pages/for-you/for-you.component').then(
        (m) => m.ForYouComponent
      ),
    title: 'Para ti - Guía TV',
    data: { robots: 'noindex, nofollow', layout: 'private-shell' },
  },
  {
    path: 'admin',
    loadComponent: () =>
      import('./pages/admin/admin.component').then((m) => m.AdminComponent),
    title: 'Admin - Guia TV',
    canActivate: [adminGuard],
    // Admin is a separate operations-console surface from the consumer app —
    // it must not inherit the consumer public layout shell (header/footer/
    // rail/mobile nav/chatbot). See AppComponent's 'admin-shell' switch case.
    data: { robots: 'noindex, nofollow', layout: 'admin-shell' },
  },
  {
    path: 'programacion-tv/series',
    loadComponent: () =>
      import('./pages/content-page/content-page.component').then((m) => m.ContentPageComponent),
    title: 'Series - Guía TV',
    data: { type: 'series', layout: 'public-shell' }
  },
  {
    path: 'programacion-tv/peliculas',
    loadComponent: () =>
      import('./pages/content-page/content-page.component').then(
        (m) => m.ContentPageComponent
      ),
    title: 'Películas - Guía TV',
    data: { type: 'movies', layout: 'public-shell' }
  },
  {
    path: 'programacion-tv/en-directo',
    loadComponent: () =>
      import('./pages/unified-guide/unified-guide.component').then(
        (m) => m.UnifiedGuideComponent
      ),
    title: 'TV en directo - Guía TV',
    data: { tab: 'live', layout: 'portal-page' },
  },
  {
    path: 'canales',
    loadComponent: () =>
      import('./pages/channel-catalog/channel-catalog.component').then(
        (m) => m.ChannelCatalogComponent
      ),
    title: 'Canales de televisión - Guía TV',
    data: { layout: 'public-shell' },
  },
  {
    path: 'canales/:id',
    loadComponent: () =>
      import('./pages/canal-completo/canal-completo.component').then(
        (m) => m.CanalCompletoComponent
      ),
    title: 'Canal - Guía TV',
    data: { layout: 'public-shell' },
  },
  {
    path: 'programacion-tv/ver-canal/:id',
    redirectTo: 'canales/:id',
    pathMatch: 'full',
  },
  {
    path: 'programacion-tv/que-ver-hoy',
    loadComponent: () =>
      import('./pages/unified-guide/unified-guide.component').then(
        (m) => m.UnifiedGuideComponent
      ),
    title: 'Qué Ver Hoy - Guía TV',
    data: { tab: 'discover', layout: 'portal-page' }
  },
  {
    path: 'plataformas',
    loadComponent: () =>
      import('./pages/unified-guide/unified-guide.component').then(
        (m) => m.UnifiedGuideComponent
      ),
    title: 'Plataformas - Guía TV',
    data: { tab: 'streaming', layout: 'portal-page' }
  },
  {
    // Sports v2 (greenfield rebuild, M01): isolated, noindex preview. See docs/sports-v2/ROUTES.md.
    path: 'laboratorio/futbol',
    loadChildren: () => import('./sports-v2/sports-v2.routes').then((m) => m.SPORTS_V2_ROUTES),
    data: { robots: 'noindex, nofollow', layout: 'minimal-shell' },
  },
  {
    path: 'deportes',
    pathMatch: 'full',
    redirectTo: 'deportes/futbol',
  },
  {
    path: 'deportes',
    children: FOOTBALL_ROUTES,
    data: { layout: 'portal-page' },
  },
  {
    path: 'contenido/:catalogId',
    loadComponent: () =>
      import('./pages/catalog-detail/catalog-detail.component').then(
        (m) => m.CatalogDetailComponent
      ),
    title: 'Contenido - Guía TV',
    data: { layout: 'public-shell' },
  },
  {
    path: 'ver-canal/:id',
    redirectTo: 'canales/:id',
    pathMatch: 'full',
  },
  // Legacy single-parameter detail routes (redirect to canonical slug routes)
  {
    path: 'detalles/:id',
    loadComponent: () =>
      import('./pages/catalog-detail/catalog-detail.component').then(
        (m) => m.CatalogDetailComponent
      ),
    title: 'Detalles del Programa - Guía TV',
    data: { legacyCatalogMode: 'program', robots: 'noindex, follow', layout: 'public-shell' },
  },
  {
    path: 'pelicula-details/:id',
    loadComponent: () =>
      import('./pages/catalog-detail/catalog-detail.component').then(
        (m) => m.CatalogDetailComponent
      ),
    title: 'Películas - Detalle - Guía TV',
    data: { legacyCatalogMode: 'movie', robots: 'noindex, follow', layout: 'public-shell' },
  },

  // SEO-friendly movie route: slug-only (no id exposed)
  {
    path: 'peliculas/:slug',
    loadComponent: () =>
      import('./pages/entity-detail/entity-detail.component').then(
        (m) => m.EntityDetailComponent
      ),
    title: 'Películas - Detalle - Guía TV',
    data: { contentType: 'movie', layout: 'public-shell' }
  },
  {
    path: 'series/:slug',
    loadComponent: () =>
      import('./pages/entity-detail/entity-detail.component').then(
        (m) => m.EntityDetailComponent
      ),
    title: 'Series - Detalle - Guía TV',
    data: { contentType: 'series', layout: 'public-shell' }
  },

  // SEO-friendly program route: slug-only (no id exposed)
  {
    path: 'programas/:slug',
    loadComponent: () =>
      import('./pages/entity-detail/entity-detail.component').then(
        (m) => m.EntityDetailComponent
      ),
    title: 'Programas - Detalle - Guía TV',
    data: { contentType: 'program', layout: 'public-shell' }
  },

  // Pre-2026-10-20 URLs (the HTTP 301s live in scripts/ssr-server.mjs; these cover in-app navigation).
  { path: 'programacion-tv/guia-canales', redirectTo: 'programacion-tv/en-directo', pathMatch: 'full' },
  {
    path: 'guias',
    children: BLOG_ROUTES && BLOG_ROUTES.length ? BLOG_ROUTES[0].children : [],
    title: 'Guías - Guía TV',
    data: { layout: 'portal-page' },
  },
  { path: 'editorial/categoria/:slug', redirectTo: 'guias/categoria/:slug', pathMatch: 'full' },
  { path: 'editorial/:slug', redirectTo: 'guias/:slug', pathMatch: 'full' },
  { path: 'editorial', redirectTo: 'guias', pathMatch: 'full' },
  { path: 'blog/top10', redirectTo: 'guias/rankings', pathMatch: 'full' },
  { path: 'blog/categoria/:slug', redirectTo: 'guias/categoria/:slug', pathMatch: 'full' },
  { path: 'blog/:slug', redirectTo: 'guias/:slug', pathMatch: 'full' },
  { path: 'blog', redirectTo: 'guias', pathMatch: 'full' },
  {
    path: 'program-full-details/:id',
    loadComponent: () =>
      import('./pages/catalog-detail/catalog-detail.component').then(
        (m) => m.CatalogDetailComponent
      ),
    title: 'Detalles del Programa - Guía TV',
    data: { legacyCatalogMode: 'program', robots: 'noindex, follow', layout: 'public-shell' },
  },
  {
    path: 'sobre-nosotros',
    loadComponent: () =>
      import('./pages/about/about.component').then((m) => m.AboutComponent),
    title: 'Sobre Nosotros - Guía TV',
    data: { layout: 'public-shell' },
  },
  {
    path: 'prensa',
    loadComponent: () =>
      import('./pages/press-kit/press-kit.component').then(
        (m) => m.PressKitComponent
      ),
    title: 'Kit de Prensa - Guía TV',
    data: { layout: 'public-shell' },
  },
  {
    path: 'comparador-streaming',
    loadComponent: () =>
      import('./pages/unified-guide/unified-guide.component').then(
        (m) => m.UnifiedGuideComponent
      ),
    title: 'Comparador de Streaming - Guía TV',
    data: { tab: 'streaming', platformMode: 'compare', layout: 'portal-page' },
  },
  {
    path: 'developers',
    loadComponent: () =>
      import('./pages/developers/developers.component').then(
        (m) => m.DevelopersComponent
      ),
    title: 'API para Desarrolladores - Guía TV',
    data: { layout: 'public-shell' },
  },
  {
    path: 'embed/programacion',
    loadComponent: () =>
      import('./pages/embed-page/embed-program-guide.component').then(
        (m) => m.EmbedProgramGuideComponent
      ),
    title: 'Widget de Programación - Guía TV',
    data: { layout: 'minimal-shell' },
  },
  {
    path: 'embed',
    loadComponent: () =>
      import('./pages/embed-page/embed-page.component').then(
        (m) => m.EmbedPageComponent
      ),
    title: 'Widget Embebible - Guía TV',
    data: { layout: 'minimal-shell' },
  },
  {
    path: 'tendencias',
    loadComponent: () =>
      import('./pages/stats/stats.component').then(
        (m) => m.StatsComponent
      ),
    title: 'Tendencias TV y Streaming - Guía TV',
    data: { layout: 'public-shell' },
  },
  {
    path: 'avisolegal',
    loadComponent: () =>
      import('./pages/legal/legal-notice/legal-notice.component').then(
        (m) => m.LegalNoticeComponent
      ),
    title: 'Aviso legal | Guía TV',
    data: { layout: 'minimal-shell', description: 'Aviso legal de Guía Programación TV: titular del servicio, datos de contacto, condiciones de uso y propiedad intelectual.' },
  },
  {
    path: 'politica-editorial',
    loadComponent: () => import('./pages/editorial-policy/editorial-policy.component').then(
      (m) => m.EditorialPolicyComponent
    ),
    title: 'Política editorial - Guía TV',
    data: { layout: 'minimal-shell' },
  },
  {
    path: 'privacidad',
    loadComponent: () =>
      import('./pages/legal/privacy/privacy.component').then(
        (m) => m.PrivacyComponent
      ),
    title: 'Política de privacidad | Guía TV',
    data: { layout: 'minimal-shell', description: 'Política de privacidad de Guía Programación TV: qué datos personales tratamos, para qué, durante cuánto tiempo y cómo ejercer tus derechos.' },
  },
  {
    path: 'cookies',
    loadComponent: () =>
      import('./pages/legal/cookies/cookies.component').then(
        (m) => m.CookiesComponent
      ),
    title: 'Política de cookies | Guía TV',
    data: { layout: 'minimal-shell', description: 'Política de cookies de Guía Programación TV: qué cookies usamos, con qué finalidad y cómo aceptarlas, rechazarlas o configurarlas.' },
  },
  {
    path: 'terminos',
    loadComponent: () =>
      import('./pages/legal/terms/terms.component').then(
        (m) => m.TermsComponent
      ),
    title: 'Términos y condiciones | Guía TV',
    data: { layout: 'minimal-shell', description: 'Términos y condiciones de uso de Guía Programación TV: reglas de uso del servicio, contenidos, responsabilidad y propiedad intelectual.' },
  },
  {
    path: 'accesibilidad',
    loadComponent: () =>
      import('./pages/legal/accessibility/accessibility.component').then(
        (m) => m.AccessibilityComponent
      ),
    title: 'Declaración de accesibilidad | Guía TV',
    data: { layout: 'minimal-shell', description: 'Declaración de accesibilidad de Guía Programación TV: nivel de conformidad, limitaciones conocidas y cómo comunicarnos un problema de acceso.' },
  },
  {
    path: 'sitemap',
    loadComponent: () =>
      import('./pages/legal/sitemap/sitemap.component').then(
        (m) => m.SitemapComponent
      ),
    title: 'Mapa del sitio - Guía TV',
    data: { robots: 'noindex, follow', layout: 'minimal-shell' },
  },
  {
    path: '**',
    component: NotFoundComponent,
    title: 'Página no encontrada - Guía TV',
    data: { layout: 'public-shell' },
  },
];
