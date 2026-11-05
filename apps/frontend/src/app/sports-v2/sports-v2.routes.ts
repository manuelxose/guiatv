import { Type } from '@angular/core';
import { Routes } from '@angular/router';
import { FootballData } from './data/football-data';
import { HttpFootballData } from './data/http-football-data';
import { BrowserFollowStorage, FollowStorage } from './data/follow-storage';
import { SportsStore } from './state/sports-store';
import { Sv2Viewport } from './state/viewport';

// Full-screen football app: does not inherit the consumer portal shell. Indexing is decided per page (seo.ts).
const SHELL = { layout: 'minimal-shell' } as const;
const TITLE = (name: string) => `${name} · Fútbol - Guía TV`;

/** Lazy route tree mounted at SPORTS_V2_BASE (/deportes/futbol) by app.routes.ts. Tests pass the demo adapter. */
export const sportsV2Routes = (data: Type<FootballData> = HttpFootballData): Routes => [
  {
    path: '',
    loadComponent: () => import('./shell/app-shell').then((m) => m.Sv2AppShellComponent),
    providers: [{ provide: FootballData, useClass: data }, { provide: FollowStorage, useClass: BrowserFollowStorage }, Sv2Viewport, SportsStore],
    data: SHELL,
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./pages/home-page').then((m) => m.Sv2HomePageComponent), title: 'Fútbol hoy: partidos, resultados y dónde verlos - Guía TV' },
      { path: 'en-directo', loadComponent: () => import('./pages/live-page').then((m) => m.Sv2LivePageComponent), title: TITLE('En directo') },
      { path: 'partidos', loadComponent: () => import('./pages/fixtures-page').then((m) => m.Sv2FixturesPageComponent), title: TITLE('Partidos'), data: { mode: 'fixtures' } },
      { path: 'resultados', loadComponent: () => import('./pages/fixtures-page').then((m) => m.Sv2FixturesPageComponent), title: TITLE('Resultados'), data: { mode: 'results' } },
      { path: 'competiciones', loadComponent: () => import('./pages/competitions-page').then((m) => m.Sv2CompetitionsPageComponent), title: TITLE('Competiciones') },
      { path: 'competiciones/:slug', loadComponent: () => import('./pages/competition-page').then((m) => m.Sv2CompetitionPageComponent), title: TITLE('Competición') },
      { path: 'clasificaciones', loadComponent: () => import('./pages/standings-page').then((m) => m.Sv2StandingsPageComponent), title: TITLE('Clasificaciones') },
      { path: 'clasificaciones/:slug', loadComponent: () => import('./pages/standings-page').then((m) => m.Sv2StandingsPageComponent), title: TITLE('Clasificación') },
      { path: 'equipos/:slug', loadComponent: () => import('./pages/team-page').then((m) => m.Sv2TeamPageComponent), title: TITLE('Equipo') },
      { path: 'partido/:slug', loadComponent: () => import('./pages/match-page').then((m) => m.Sv2MatchPageComponent), title: TITLE('Partido') },
      { path: 'noticias', loadComponent: () => import('./pages/news-page').then((m) => m.Sv2NewsPageComponent), title: TITLE('Noticias') },
      { path: 'noticias/:slug', loadComponent: () => import('./pages/article-page').then((m) => m.Sv2ArticlePageComponent), title: TITLE('Noticia') },
      { path: 'buscar', loadComponent: () => import('./pages/search-page').then((m) => m.Sv2SearchPageComponent), title: TITLE('Buscar') },
      { path: 'siguiendo', loadComponent: () => import('./pages/following-page').then((m) => m.Sv2FollowingPageComponent), title: TITLE('Mi fútbol') },
      { path: '**', redirectTo: '' },
    ],
  },
];

export const SPORTS_V2_ROUTES: Routes = sportsV2Routes();
