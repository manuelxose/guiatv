import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { of } from 'rxjs';
import { CatalogItem, CatalogService } from '../../services/catalog.service';
import { CatalogDetailComponent } from './catalog-detail.component';

const NOW = Date.now();
const iso = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();

const legacyAiring = (channelId: string, startH: number, title = 'La cura del bienestar') => ({
  channelId, channelName: channelId.toUpperCase(), start: iso(startH), end: iso(startH + 2), title, catalogId: `program:${channelId}`, detailPath: '/peliculas/la-cura-del-bienestar',
});
const broadcast = (channelId: string, startH: number, programmeTitle = 'La cura del bienestar') => ({
  airingId: `a-${channelId}`, channel: { id: channelId, name: channelId.toUpperCase(), path: `/canales/${channelId}` }, programmeTitle,
  start: iso(startH), end: iso(startH + 2), startLocal: iso(startH), localDate: '2026-10-23', localTime: '21:30', durationMinutes: 120,
});
const legacy = (over: Partial<CatalogItem> = {}): CatalogItem => ({
  catalogId: 'tmdb:movie:340837', source: 'tmdb', contentType: 'movie', title: 'La cura del bienestar', slug: 'la-cura-del-bienestar', detailPath: '/peliculas/la-cura-del-bienestar',
  synopsis: 'Texto editorial propio', genres: [], tmdbId: 340837, releaseYear: 2016, primaryPlatforms: [], airings: [legacyAiring('amc', 30)], ...over,
});

describe('CatalogDetailComponent: Phase 3E legacy enrichment', () => {
  function render(item: CatalogItem, path = '/') {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ slug: 'la-cura-del-bienestar' })), data: of({ contentType: 'movie' }), snapshot: { data: {} } } },
        {
          provide: CatalogService,
          useValue: {
            getBySlugState: () => of({ data: item, unavailable: false, stale: false }),
            getDetailEnrichment: () => of({ related: [] }),
            query: () => of({ items: [] }),
          },
        },
      ],
    });
    spyOnProperty(TestBed.inject(Router), 'url', 'get').and.returnValue(path);
    const fixture = TestBed.createComponent(CatalogDetailComponent);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }
  const robots = () => TestBed.inject(Meta).getTag('name="robots"')?.content;
  const jsonLd = (fixture: { nativeElement: HTMLElement }) =>
    Array.from(fixture.nativeElement.querySelectorAll('script[type="application/ld+json"]')).flatMap((s) => [JSON.parse(s.textContent || '[]')].flat());

  it('keeps exact programme aliases out of the index', () => {
    const fixture = render(legacy({ source: 'program' }), '/contenido/program%3A123');
    expect(robots()).toBe('noindex, follow');
    expect(fixture.nativeElement.querySelector('a[href="/contenido/program%3A123#emisiones"]')).not.toBeNull();
    fixture.destroy();
  });

  it('renders legacy airings through the shared broadcast list without attribution', () => {
    const fixture = render(legacy());
    const text = fixture.nativeElement.textContent as string;
    expect(fixture.nativeElement.querySelector('app-entity-broadcast-list')).not.toBeNull();
    expect(text).toContain('Próximas emisiones');
    expect(text).not.toContain('themoviedb.org');
    expect(robots()).toContain('index, follow');
    fixture.destroy();
  });

  it('adds the verified schedule, original title, genres, runtime and attribution while keeping every legacy fact', () => {
    const base = legacy({ airings: [legacyAiring('amc', 30), legacyAiring('tcm', 50)] });
    const plain = render(base);
    const plainRobots = robots();
    const plainCanonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
    const plainDescription = TestBed.inject(Meta).getTag('name="description"')?.content;
    plain.destroy();
    TestBed.resetTestingModule();

    const fixture = render(legacy({
      airings: [legacyAiring('amc', 30), legacyAiring('tcm', 50)],
      enrichment: {
        version: 1,
        metadata: { originalTitle: 'A Cure for Wellness', runtimeMinutes: 147, genres: ['Terror'] },
        broadcasts: { status: 'ok', generatedAt: iso(0), timeZone: 'Europe/Madrid', items: [broadcast('amc', 30), broadcast('la1', 80)] },
        attribution: { notice: 'Datos e imágenes de TMDB.', updatedAt: '2026-10-01T00:00:00.000Z' },
      },
    }));
    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent as string;
    expect(el.querySelector('app-entity-broadcast-list')).not.toBeNull();
    expect(el.querySelector('a[href="/canales/amc"]')).not.toBeNull();
    expect(el.querySelector('a[href="/canales/la1"]')).not.toBeNull();
    expect(text).toContain('Título original: A Cure for Wellness');
    expect(text).toContain('Terror');
    expect(text).toContain('147 min');
    expect(text).toContain('Datos e imágenes de TMDB.');
    expect(text).toContain('Texto editorial propio');
    // The legacy airing the verification did not confirm (TCM) is still listed: nothing shown before disappears.
    expect(text).toContain('TCM');
    // SEO surface is exactly the legacy one.
    expect(robots()).toBe(plainRobots);
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(plainCanonical);
    expect(TestBed.inject(Meta).getTag('name="description"')?.content).toBe(plainDescription);
    expect(document.querySelectorAll('link[rel="canonical"]').length).toBe(1);
    fixture.destroy();
  });

  it('keeps one Movie entity, extended with the original title and the verified broadcasts', () => {
    const fixture = render(legacy({
      enrichment: {
        version: 1,
        metadata: { originalTitle: 'A Cure for Wellness', runtimeMinutes: 147, genres: ['Terror'] },
        broadcasts: { status: 'ok', generatedAt: iso(0), timeZone: 'Europe/Madrid', items: [broadcast('amc', 30)] },
      },
    }));
    const movies = jsonLd(fixture).filter((d: { '@type'?: string }) => d['@type'] === 'Movie');
    expect(movies.length).toBe(1);
    expect(movies[0].alternateName).toBe('A Cure for Wellness');
    expect(movies[0].duration).toBe('PT2H27M');
    expect(movies[0].genre).toEqual(['Terror']);
    expect(movies[0].publication.length).toBe(1);
    expect(movies[0].publication[0]['@type']).toBe('BroadcastEvent');
    fixture.destroy();
  });

  it('without enrichment, the TMDB detail facts render and reach the Movie entity, with no third-party rating or invented language', () => {
    const fixture = render(legacy({ genres: ['Terror'], durationMinutes: 147, originalTitle: 'A Cure for Wellness', rating: 6.4 }));
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('A Cure for Wellness');
    expect(text).toContain('147 min');
    expect(text).toContain('Terror');
    const [movie] = jsonLd(fixture).filter((d: { '@type'?: string }) => d['@type'] === 'Movie');
    expect(movie.alternateName).toBe('A Cure for Wellness');
    expect(movie.duration).toBe('PT2H27M');
    expect(movie.genre).toEqual(['Terror']);
    expect('aggregateRating' in movie).toBeFalse();
    expect('inLanguage' in movie).toBeFalse();
    fixture.destroy();
  });

  it('separates channel recommendations from this work and hides whole-series runtime', () => {
    const fixture = render(legacy({
      contentType: 'series', durationMinutes: 45, originalTitle: 'La cura del bienestar',
      channelAirings: [legacyAiring('amc', 32, 'Otra obra')],
    }));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-entity-broadcast-list')?.textContent).not.toContain('Otra obra');
    expect(el.querySelector('[aria-labelledby="channel-programmes-heading"]')?.textContent).toContain('Otra obra');
    expect(el.textContent).not.toContain('45 min');
    expect(el.textContent).not.toContain('Título original:');
    fixture.destroy();
  });

  it('structured data cannot be broken out of by a hostile title', () => {
    const fixture = render(legacy({
      enrichment: {
        version: 1,
        metadata: { originalTitle: '</script><img src=x onerror=window.__pwned=1>' },
        broadcasts: { status: 'ok', generatedAt: iso(0), timeZone: 'Europe/Madrid', items: [broadcast('amc', 30, '</script><b>x</b>')] },
      },
    }));
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(fixture.nativeElement.querySelectorAll('script[type="application/ld+json"]').length).toBe(1);
    expect(() => jsonLd(fixture)).not.toThrow();
    fixture.destroy();
  });

  it('says plainly when nothing is scheduled, and falls back to the legacy schedule when the schedule could not be read', () => {
    const none = render(legacy({ airings: [], enrichment: { version: 1, broadcasts: { status: 'none', generatedAt: iso(0), timeZone: 'Europe/Madrid', items: [] } } }));
    expect(none.nativeElement.textContent).toContain('No hay emisiones programadas en la programación disponible');
    none.destroy();
    TestBed.resetTestingModule();
    const unavailable = render(legacy({ enrichment: { version: 1, broadcasts: { status: 'unavailable', generatedAt: iso(0), timeZone: 'Europe/Madrid', items: [] } } }));
    expect(unavailable.nativeElement.querySelector('app-entity-broadcast-list')).not.toBeNull();
    expect(unavailable.nativeElement.textContent).toContain('AMC');
    unavailable.destroy();
  });

  it('a programme page uses the broadcast list for its own airings', () => {
    const fixture = render(legacy({
      contentType: 'program', source: 'program',
      enrichment: { version: 1, metadata: { genres: ['Magazine'] } },
    }));
    expect(fixture.nativeElement.querySelector('app-entity-broadcast-list')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Próximas emisiones');
    fixture.destroy();
  });

  it('M10: links verified programme <-> work pages with descriptive anchors and nothing when unverified', () => {
    const programme = render(legacy({ source: 'program', contentType: 'movie', workPath: '/peliculas/la-cura-del-bienestar', channel: { id: 'dmax', name: 'DMAX', normalizedName: 'discovery' } }));
    expect(programme.nativeElement.querySelector('[data-testid="work-link"]')?.getAttribute('href')).toBe('/peliculas/la-cura-del-bienestar');
    expect(programme.nativeElement.querySelector('[data-testid="work-link"]')?.textContent.trim()).toBe('Ficha completa de la película');
    programme.destroy();
    TestBed.resetTestingModule();

    const work = render(legacy({ programmePath: '/programas/la-cura-del-bienestar' }));
    const link = work.nativeElement.querySelector('[data-testid="programme-link"]');
    expect(link?.getAttribute('href')).toBe('/programas/la-cura-del-bienestar');
    expect(link?.textContent.trim()).toBe('Horarios de La cura del bienestar en televisión');
    // The canonical and robots of the work page are not touched by the link.
    expect(robots()).toContain('index, follow');
    work.destroy();
    TestBed.resetTestingModule();

    const unverified = render(legacy({ source: 'program', contentType: 'movie' }));
    expect(unverified.nativeElement.querySelector('[data-testid="work-link"]')).toBeNull();
    expect(unverified.nativeElement.querySelector('[data-testid="programme-link"]')).toBeNull();
    unverified.destroy();
  });

  it('M10: other programmes on the channel link their verified work page and the canonical channel', () => {
    const fixture = render(legacy({
      source: 'program', contentType: 'program', channel: { id: 'dmax', name: 'DMAX', normalizedName: 'discovery' },
      channelAirings: [{ ...legacyAiring('dmax', 32, 'Otra obra'), detailPath: '/contenido/program:2', workPath: '/peliculas/otra-obra' }],
    }));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[aria-labelledby="channel-programmes-heading"] a')?.getAttribute('href')).toBe('/peliculas/otra-obra');
    expect(el.querySelector('a[href="/canales/discovery"]')?.textContent).toContain('Ver programación de DMAX');
    expect(el.querySelector('a[href="/canales/dmax"]')).toBeNull();
    fixture.destroy();
  });

  it('derives programme state from its verified slot and links back to the channel', () => {
    const fixture = render(legacy({ contentType: 'program', source: 'program', start: iso(-3), end: iso(-1), liveNow: true, channel: { id: 'la1', name: 'La 1' } }));
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Finalizada');
    expect(text).toContain('Horario peninsular (Madrid)');
    expect(text).not.toContain('En directo');
    expect(fixture.nativeElement.querySelector('a[href="/canales/la1"]')?.textContent).toContain('Ver programación de La 1');
    const component = fixture.componentInstance;
    component.now = new Date(NOW);
    expect(component.programmeTiming(legacy({ start: iso(-1), end: iso(1) }))?.state).toBe('live');
    expect(component.programmeTiming(legacy({ start: iso(1), end: iso(2) }))?.state).toBe('soon');
    expect(component.programmeTiming(legacy({ start: 'invalid', end: iso(2) }))).toBeNull();
    expect(component.programmeTiming(legacy({ start: iso(2), end: iso(1) }))).toBeNull();
    fixture.destroy();
  });
});
