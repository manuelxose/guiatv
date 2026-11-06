import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { DemoFootballData, SPORTS_NOW } from '../data/football-data';
import { SportsStore } from '../state/sports-store';
import { Sv2Viewport } from '../state/viewport';
import { sportsV2Routes } from '../sports-v2.routes';
import { TEST_NOW, TEST_TODAY } from '../testing/providers';

const BASE = '/laboratorio/futbol';
const LIVE_SLUG = `real-costa-racing-sur-${TEST_TODAY}`;
const SCHEDULED_SLUG = `ciudad-alta-club-ribera-${TEST_TODAY}`;

/** Drives the real route tree (lazy pages, shell, store) with demo data and a fixed clock. */
describe('sports-v2 navigation flows', () => {
  let h: RouterTestingHarness;
  const root = () => h.fixture.nativeElement as HTMLElement;
  const main = () => root().querySelector('main#sv2-main') as HTMLElement;
  const all = (sel: string, scope: ParentNode = main()) => Array.from(scope.querySelectorAll<HTMLElement>(sel));
  const one = (sel: string, scope: ParentNode = main()) => scope.querySelector<HTMLElement>(sel);
  const store = () => h.routeDebugElement!.injector.get(SportsStore);
  const url = () => TestBed.inject(Router).url;
  /** Karma's iframe can be narrower than 768px; pin the viewport the test is about. */
  const viewport = (mobile: boolean) => h.routeDebugElement!.injector.get(Sv2Viewport).mobile.set(mobile);

  async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
      await h.fixture.whenStable();
      h.detectChanges();
    }
  }
  async function go(path = ''): Promise<void> {
    await h.navigateByUrl(`${BASE}${path}`);
    await settle();
  }
  async function click(el: HTMLElement | null | undefined): Promise<void> {
    expect(el).withContext('element to click').toBeTruthy();
    el?.click();
    await settle();
  }
  const button = (label: string, scope: ParentNode = main()) => all('button', scope).find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label);

  beforeEach(async () => {
    localStorage.removeItem('guiatv.sports-v2.follows');
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'laboratorio/futbol', children: sportsV2Routes(DemoFootballData) }]), { provide: SPORTS_NOW, useValue: () => TEST_NOW }],
    });
    h = await RouterTestingHarness.create();
  });
  afterEach(() => localStorage.removeItem('guiatv.sports-v2.follows'));

  describe('home', () => {
    it('shows live, today and recent sections with an anonymous "follow your teams" state', async () => {
      await go();
      const text = main().textContent ?? '';
      for (const s of ['En vivo ahora', 'Partidos de hoy', 'Mis equipos', 'Próximos partidos importantes', 'Resultados recientes', 'Noticias destacadas']) expect(text).toContain(s);
      expect(text).toContain('Sigue a tus equipos');
      expect(all('app-sv2-match-card').length).toBe(2); // two live matches
      expect(text).toContain('Datos de demostración');
    });

    it('lets an anonymous user follow a suggested team, which fills My teams and the sidebar', async () => {
      await go();
      const follow = all('.suggest app-sv2-follow-button button')[0];
      expect(follow.getAttribute('aria-pressed')).toBe('false');
      await click(follow);
      expect(store().followedTeams().length).toBe(1);
      expect(one('aside[aria-label="Mi fútbol"]', root())?.textContent).toContain(store().followedTeams()[0].name);
      expect(JSON.parse(localStorage.getItem('guiatv.sports-v2.follows') ?? '{}').teams.length).toBe(1);
      expect(all('.chips a').length).toBe(1);
    });
  });

  describe('live scores', () => {
    it('groups every live match by competition and shows minute and status', async () => {
      await go('/en-directo');
      expect(main().querySelector('h1')?.textContent).toContain('En directo');
      expect(main().textContent).toContain('2 partidos en juego');
      expect(all('app-sv2-match-row').length).toBe(2);
      expect(all('.gh').length).toBe(1); // both are Liga Demo A
      expect(one('app-sv2-match-row .clock')?.textContent).toMatch(/\d+'/);
    });

    it('filters by competition through the URL and explains an empty result', async () => {
      await go('/en-directo');
      await click(button('Copa Demo'));
      expect(url()).toContain('competicion=copa-demo');
      expect(all('app-sv2-match-row').length).toBe(0);
      expect(main().textContent).toContain('Ningún partido en directo con estos filtros');
      await click(button('Todos'));
      expect(url()).not.toContain('competicion');
      expect(all('app-sv2-match-row').length).toBe(2);
    });

    it('filters by followed teams, disabled until the user follows one', async () => {
      await go('/en-directo');
      expect((button('Mis equipos') as HTMLButtonElement).disabled).toBeTrue();
      store().toggleTeam('racing-sur');
      await settle();
      await click(button('Mis equipos'));
      expect(all('app-sv2-match-row').length).toBe(1);
    });

    it('opens the contextual Match Center when a row is selected on a wide screen', async () => {
      await go('/en-directo');
      viewport(false);
      await click(one('app-sv2-match-row .body'));
      expect(store().contextOpen()).toBeTrue();
      expect(one('app-sv2-context-panel', root())?.textContent).toContain('Match Center');
      expect(url()).toBe(`${BASE}/en-directo`); // context preserved
    });

    it('opens the dedicated full-screen page when a row is selected on mobile', async () => {
      await go('/en-directo');
      viewport(true);
      await click(all('app-sv2-match-row .body')[0]);
      expect(url()).toBe(`${BASE}/partido/${LIVE_SLUG}`);
      expect(one('.shell', root())?.classList).toContain('expanded');
    });
  });

  describe('fixtures and results', () => {
    it("lists today's matches with the time zone stated", async () => {
      await go('/partidos');
      expect(all('app-sv2-match-row').length).toBe(5);
      expect(main().textContent).toContain('hora de Madrid (CET)');
      expect(all('app-sv2-date-strip ul button')[3].getAttribute('aria-pressed')).toBe('true'); // today is centred
    });

    it('navigates to the next and previous day, keeping the day in the URL', async () => {
      await go('/partidos');
      await click(button('Día siguiente'));
      expect(url()).toContain('dia=2026-11-06');
      expect(all('app-sv2-match-row').length).toBe(2);
      expect(main().textContent).toContain('Aplazado');
      await click(button('Día anterior'));
      await click(button('Día anterior'));
      expect(url()).toContain('dia=2026-11-04');
      expect(all('app-sv2-match-row').length).toBe(2);
      await click(button('Volver a hoy'));
      expect(url()).not.toContain('dia=');
    });

    it('explains an empty day and jumps to the next day with matches', async () => {
      await go('/partidos?dia=2026-11-09');
      expect(all('app-sv2-match-row').length).toBe(0);
      expect(main().textContent).toContain('No hay partidos este día');
      await click(all('button.jump')[0]);
      expect(url()).toContain('dia=2026-11-10');
      expect(all('app-sv2-match-row').length).toBe(1);
    });

    it('ignores a malformed day parameter', async () => {
      await go('/partidos?dia=ayer');
      expect(all('app-sv2-match-row').length).toBe(5);
    });

    it('shows only finished matches, newest day first, on Results', async () => {
      await go('/resultados');
      const rows = all('app-sv2-match-row');
      expect(rows.length).toBe(store().finishedMatches().length);
      expect(rows.every((r) => r.textContent?.includes('FIN'))).toBeTrue();
      expect(all('.gh')[0].textContent).toContain('Hoy');
      expect(one('app-sv2-date-strip')).toBeNull();
    });

    it('carries the competition filter between En vivo, Partidos and Resultados', async () => {
      await go('/partidos?competicion=copa-demo&dia=2026-11-05');
      await click(all('app-sv2-matches-nav a')[2]);
      expect(url()).toContain(`${BASE}/resultados`);
      expect(url()).toContain('competicion=copa-demo');
      expect(url()).not.toContain('dia=');
    });
  });

  describe('competitions', () => {
    it('lists competitions and follows one from the catalogue', async () => {
      await go('/competiciones');
      expect(all('app-sv2-competition-card').length).toBe(3);
      await click(all('app-sv2-follow-button button')[0]);
      expect(store().favoriteCompetitions().length).toBe(1);
    });

    it('shows overview, then standings with zones, through tabs kept in the URL', async () => {
      await go('/competiciones/liga-demo-a');
      expect(main().querySelector('h1')?.textContent).toContain('Liga Demo A');
      expect(main().textContent).toContain('Próximos partidos');
      await click(button('Clasificación'));
      expect(url()).toContain('tab=clasificacion');
      expect(all('tbody tr').length).toBe(6);
      expect(main().querySelector('.legend')?.textContent).toContain('Descenso');
      await click(button('Equipos'));
      expect(all('.teams li').length).toBe(6);
    });

    it('opens directly on a tab from the URL and follows from the header', async () => {
      await go('/competiciones/liga-demo-a?tab=resultados');
      expect(one('[role=tab][aria-selected=true]')?.textContent).toContain('Resultados');
      await click(one('.hero app-sv2-follow-button button'));
      expect(store().isCompetitionFollowed('liga-demo-a')).toBeTrue();
      expect(one('.hero app-sv2-follow-button button')?.getAttribute('aria-pressed')).toBe('true');
    });

    it('says a cup has no table instead of inventing one', async () => {
      await go('/competiciones/copa-demo?tab=clasificacion');
      expect(all('table').length).toBe(0);
      expect(main().textContent).toContain('Las copas no tienen clasificación');
    });

    it('shows a not-found state for an unknown competition', async () => {
      await go('/competiciones/no-existe');
      expect(main().textContent).toContain('No encontramos esta competición');
    });
  });

  describe('team detail', () => {
    it('shows identity, league position, next match, results, fixtures and news', async () => {
      await go('/equipos/real-costa');
      const text = main().textContent ?? '';
      expect(main().querySelector('h1')?.textContent).toContain('Real Costa');
      expect(text).toContain('Posición en Liga Demo A');
      expect(one('.kpi dd')?.textContent).toContain('1.º');
      expect(text).toContain('Próximo partido');
      expect(all('app-sv2-match-card').length).toBe(1);
      expect(text).toContain('Últimos resultados');
      expect(text).toContain('Noticias de Real Costa');
      expect(all('tbody tr.me').length).toBe(1);
    });

    it('omits league position for a team that is in no league', async () => {
      await go('/equipos/ciudad-alta');
      expect(main().textContent).not.toContain('Posición en');
    });

    it('follows and unfollows, and the sidebar and My Football follow', async () => {
      await go('/equipos/racing-sur');
      const follow = () => one('.hero app-sv2-follow-button button');
      await click(follow());
      expect(follow()?.getAttribute('aria-pressed')).toBe('true');
      expect(one('aside[aria-label="Mi fútbol"]', root())?.textContent).toContain('Racing Sur');
      await go('/siguiendo');
      expect(main().textContent).toContain('Racing Sur');
      await click(button('Dejar de seguir Racing Sur'));
      expect(store().followedTeams()).toEqual([]);
    });

    it('re-renders when navigating from one team to another (reused component)', async () => {
      await go('/equipos/real-costa');
      await go('/equipos/racing-sur');
      expect(main().querySelector('h1')?.textContent).toContain('Racing Sur');
    });

    it('shows a not-found state for an unknown team', async () => {
      await go('/equipos/nadie');
      expect(main().textContent).toContain('No encontramos este equipo');
    });
  });

  describe('Match Center', () => {
    it('expands the sidebar summary to the full page, which hides the sidebar', async () => {
      await go('/en-directo');
      viewport(false);
      await click(one('app-sv2-match-row .body'));
      await click(one('app-sv2-context-panel a[aria-label^="Abrir el partido"]', root()));
      expect(url()).toBe(`${BASE}/partido/${LIVE_SLUG}`);
      expect(one('app-sv2-context-panel', root())).toBeNull();
      expect(one('app-sv2-match-hero', main())?.textContent).toContain('Real Costa');
    });

    it('shows score, status, minute and the timeline for a live match', async () => {
      await go(`/partido/${LIVE_SLUG}`);
      const hero = one('app-sv2-match-hero')!;
      expect(hero.textContent).toContain('En vivo');
      expect(hero.textContent).toContain("72'");
      expect(hero.textContent).toContain('2-1');
      expect(all('.timeline li').length).toBe(5);
      expect(main().textContent).toContain('Contexto de la competición');
      expect(main().textContent).toContain('Contenido relacionado');
    });

    it('switches between statistics, lineups and where to watch, and keeps the tab in the URL', async () => {
      await go(`/partido/${LIVE_SLUG}`);
      await click(button('Estadísticas'));
      expect(url()).toContain('tab=estadisticas');
      expect(main().textContent).toContain('Posesión');
      await click(button('Alineaciones'));
      expect(main().textContent).toContain('4-3-3');
      await click(button('Dónde verlo'));
      expect(main().textContent).toContain('Canal Deportes 1');
      expect(main().textContent).toContain('Canales ficticios de demostración');
    });

    it('supports arrow-key tab navigation', async () => {
      await go(`/partido/${LIVE_SLUG}`);
      const first = one('[role=tab][aria-selected=true]')!;
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await settle();
      expect(one('[role=tab][aria-selected=true]')?.textContent).toContain('Estadísticas');
      expect(url()).toContain('tab=estadisticas');
    });

    it('gives meaningful fallbacks when a scheduled match has no data yet', async () => {
      await go(`/partido/${SCHEDULED_SLUG}`);
      expect(main().textContent).toContain('El partido aún no ha empezado');
      await click(button('Estadísticas'));
      expect(main().textContent).toContain('Estadísticas aún no disponibles');
      await click(button('Alineaciones'));
      expect(main().textContent).toContain('Alineaciones pendientes');
    });

    it('says when a postponed match has no confirmed broadcast', async () => {
      await go();
      const slug = store().matches().find((m) => m.status === 'postponed')!.slug;
      await go(`/partido/${slug}?tab=donde-verlo`);
      expect(main().textContent).toContain('Emisión no confirmada');
    });

    it('shows a not-found state for an unknown match and a way back', async () => {
      await go('/partido/no-existe');
      expect(main().textContent).toContain('No encontramos este partido');
      expect(one('app-sv2-empty-state a')?.getAttribute('href')).toBe(`${BASE}/partidos`);
    });

    it('goes back through the browser history when the user arrived from another page', async () => {
      await go('/partidos');
      await go(`/partido/${LIVE_SLUG}`);
      const back = spyOn(TestBed.inject(Location), 'back');
      await click(button('Volver'));
      expect(back).toHaveBeenCalled();
    });

    it('falls back to the calendar when the match page was the entry point', async () => {
      await go(`/partido/${LIVE_SLUG}`);
      const back = spyOn(TestBed.inject(Location), 'back');
      await click(button('Volver'));
      expect(back).not.toHaveBeenCalled();
      expect(url()).toBe(`${BASE}/partidos`);
    });

    it('saves a match from the hero and shows it in My Football', async () => {
      await go(`/partido/${SCHEDULED_SLUG}`);
      await click(button('Guardar'));
      await go('/siguiendo');
      expect(all('app-sv2-match-row').length).toBe(1);
    });
  });

  describe('standings', () => {
    it('redirects to the first competition that has a table and lists every column', async () => {
      await go('/clasificaciones');
      expect(url()).toBe(`${BASE}/clasificaciones/liga-demo-a`);
      const heads = all('thead th').map((t) => t.textContent?.trim());
      expect(heads).toEqual(['#', 'Equipo', 'PJ', 'G', 'E', 'P', 'DG', 'Pts']);
      expect(all('tbody tr').length).toBe(6);
      expect(all('tbody tr')[0].textContent).toContain('+11');
    });

    it('marks qualification and relegation only where zones are supplied', async () => {
      await go('/clasificaciones/liga-demo-a');
      expect(all('tbody tr[data-zone="qualification"]').length).toBe(2);
      expect(all('tbody tr[data-zone="relegation"]').length).toBe(1);
      await go('/clasificaciones/liga-continental-demo');
      expect(all('tbody tr[data-zone]').length).toBe(0);
      expect(all('.legend').length).toBe(0);
    });

    it('says when a competition has no table', async () => {
      await go('/clasificaciones/copa-demo');
      expect(main().textContent).toContain('Copa Demo no tiene clasificación');
    });
  });

  describe('news', () => {
    it('shows a featured lead and editorial cards, filterable by competition', async () => {
      await go('/noticias');
      expect(all('app-sv2-article-card').length).toBe(5);
      expect(one('.hero')).toBeTruthy();
      await click(button('Copa Demo'));
      expect(all('app-sv2-article-card').length).toBe(1);
    });

    it('opens an article with author, date and links to its team, competition and match', async () => {
      await go('/noticias');
      await click(one('app-sv2-article-card a'));
      expect(url()).toContain(`${BASE}/noticias/claves-del-duelo-real-costa-racing-sur`);
      expect(main().querySelector('h1')?.textContent).toContain('Las claves del duelo');
      expect(main().textContent).toContain('Por Redacción de demostración');
      expect(one('time')?.getAttribute('datetime')).toBeTruthy();
      const hrefs = all('aside a').map((a) => a.getAttribute('href'));
      expect(hrefs).toContain(`${BASE}/competiciones/liga-demo-a`);
      expect(hrefs).toContain(`${BASE}/equipos/real-costa`);
      expect(hrefs).toContain(`${BASE}/partido/${LIVE_SLUG}`);
    });

    it('shows a not-found state for an unknown article', async () => {
      await go('/noticias/no-existe');
      expect(main().textContent).toContain('No encontramos esta noticia');
    });
  });

  describe('search', () => {
    it('shows grouped results for a query in the URL', async () => {
      await go('/buscar?q=real');
      const titles = all('h2').map((e) => e.textContent?.trim());
      expect(titles.some((t) => t?.startsWith('Equipos'))).toBeTrue();
      expect(titles.some((t) => t?.startsWith('Partidos'))).toBeTrue();
      expect(titles.some((t) => t?.startsWith('Noticias'))).toBeTrue();
    });

    it('guides the user for a short query and for no results', async () => {
      await go('/buscar');
      expect(main().textContent).toContain('Escribe al menos dos letras');
      await go('/buscar?q=zzzzz');
      expect(main().textContent).toContain('Sin resultados para «zzzzz»');
    });

    it('updates the URL as the user types', async () => {
      await go('/buscar');
      const input = one('input[type=search]') as HTMLInputElement;
      input.value = 'racing';
      input.dispatchEvent(new Event('input'));
      await settle();
      expect(url()).toContain('q=racing');
      expect(all('li a').length).toBeGreaterThan(0);
    });

    it('opens a combobox from the top bar, navigable by keyboard', async () => {
      await go();
      const input = one('input[role=combobox]', root()) as HTMLInputElement;
      input.value = 'racing';
      input.dispatchEvent(new Event('input'));
      await settle();
      expect(input.getAttribute('aria-expanded')).toBe('true');
      expect(all('[role=option]', root()).length).toBeGreaterThan(1);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await settle();
      expect(input.getAttribute('aria-activedescendant')).toBe('sv2-hit-0');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
      expect(input.getAttribute('aria-expanded')).toBe('false');
    });

    it('goes to the full results page on Enter without a selection, and to the hit when one is active', async () => {
      await go();
      const input = one('input[role=combobox]', root()) as HTMLInputElement;
      input.value = 'racing';
      input.dispatchEvent(new Event('input'));
      await settle();
      one('form[role=search]', root())!.dispatchEvent(new Event('submit'));
      await settle();
      expect(url()).toContain(`${BASE}/buscar?q=racing`);

      await go();
      const again = one('input[role=combobox]', root()) as HTMLInputElement;
      again.value = 'racing';
      again.dispatchEvent(new Event('input'));
      await settle();
      again.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await settle();
      one('form[role=search]', root())!.dispatchEvent(new Event('submit'));
      await settle();
      expect(url()).toMatch(/\/(equipos|competiciones|partido|noticias)\//);
    });

    it('reports no results inside the combobox', async () => {
      await go();
      const input = one('input[role=combobox]', root()) as HTMLInputElement;
      input.value = 'qqqqq';
      input.dispatchEvent(new Event('input'));
      await settle();
      expect(one('#sv2-search-results', root())?.textContent).toContain('Sin resultados');
    });
  });

  describe('My Football', () => {
    it('shows anonymous empty states with suggestions and calls to action', async () => {
      await go('/siguiendo');
      const text = main().textContent ?? '';
      expect(text).toContain('Aún no sigues ningún equipo');
      expect(text).toContain('Aún no tienes competiciones favoritas');
      expect(text).toContain('No has guardado ningún partido');
      expect(all('.teams li').length).toBeGreaterThan(0); // suggestions
    });

    it('saves a fixture from a row and lists it under saved matches', async () => {
      await go('/partidos');
      await click(all('app-sv2-match-row .save')[0]);
      expect(store().savedMatchSlugs().length).toBe(1);
      expect(all('app-sv2-match-row .save')[0].getAttribute('aria-pressed')).toBe('true');
      await go('/siguiendo');
      expect(all('app-sv2-match-row').length).toBe(1);
    });

    it('restores follows from storage after a reload', async () => {
      localStorage.setItem('guiatv.sports-v2.follows', JSON.stringify({ teams: ['real-costa'], competitions: ['copa-demo'], matches: [] }));
      await go();
      expect(one('aside[aria-label="Mi fútbol"]', root())?.textContent).toContain('Real Costa');
      expect(one('aside[aria-label="Mi fútbol"]', root())?.textContent).toContain('Copa Demo');
    });

    it('survives corrupt storage', async () => {
      localStorage.setItem('guiatv.sports-v2.follows', '{not json');
      await go('/siguiendo');
      expect(store().followedTeams()).toEqual([]);
    });
  });

  it('redirects unknown paths to the home', async () => {
    await go('/algo/que-no-existe');
    expect(url()).toBe(BASE);
  });

  it('keeps a skip link, one main landmark and an accessible tab bar on every page', async () => {
    for (const path of ['', '/en-directo', '/partidos', '/competiciones', '/noticias', '/siguiendo']) {
      await go(path);
      expect(root().querySelectorAll('main').length).withContext(path).toBe(1);
      expect(one('a.skip', root())).withContext(path).toBeTruthy();
      expect(one('nav.tabbar[aria-label]', root())).withContext(path).toBeTruthy();
      expect(main().querySelectorAll('h1').length).withContext(path).toBe(1);
    }
  });
});
