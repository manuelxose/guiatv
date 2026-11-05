import { Routes } from '@angular/router';
import { DemoFootballData, FootballData } from './data/football-data';
import { SportsStore } from './state/sports-store';

// Preview surface: must never be indexed or inherit the legacy consumer shell.
const PREVIEW = { robots: 'noindex, nofollow', layout: 'minimal-shell' } as const;
const section = (path: string, view: string, title: string) => ({
  path,
  loadComponent: () => import('./pages/section-page').then((m) => m.Sv2SectionPageComponent),
  title: `${title} · Fútbol (vista previa) - Guía TV`,
  data: { ...PREVIEW, view },
});

/** Lazy route tree mounted at SPORTS_V2_BASE by app.routes.ts. */
export const SPORTS_V2_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./shell/app-shell').then((m) => m.Sv2AppShellComponent),
    // Swap DemoFootballData for the HTTP adapter in M02; nothing else changes.
    providers: [{ provide: FootballData, useClass: DemoFootballData }, SportsStore],
    data: PREVIEW,
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./pages/home-page').then((m) => m.Sv2HomePageComponent),
        title: 'Fútbol (vista previa) - Guía TV',
        data: PREVIEW,
      },
      section('en-directo', 'live', 'En directo'),
      section('partidos', 'fixtures', 'Partidos'),
      section('resultados', 'results', 'Resultados'),
      section('competiciones', 'competitions', 'Competiciones'),
      section('competiciones/:slug', 'competition', 'Competición'),
      section('equipos/:slug', 'team', 'Equipo'),
      section('partido/:slug', 'match', 'Partido'),
      section('noticias', 'news', 'Noticias'),
      section('siguiendo', 'following', 'Siguiendo'),
      { path: '**', redirectTo: '' },
    ],
  },
];
