import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Meta } from '@angular/platform-browser';
import { PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { By } from '@angular/platform-browser';
import { WhereToWatchComponent } from '../../components/where-to-watch/where-to-watch.component';
import { EntityDetailComponent } from './entity-detail.component';
import { PublicEntity } from './entity-detail.model';


describe('EntityDetailComponent', () => {
  let http: HttpTestingController;
  let response: ResponseInit;
  beforeEach(() => {
    response = {};
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ slug: 'test-film' })), fragment: of(null), snapshot: { data: { contentType: 'movie' } } } },
      { provide: PLATFORM_ID, useValue: 'server' },
      { provide: RESPONSE_INIT, useValue: response },
    ] });
    spyOnProperty(TestBed.inject(Router), 'url').and.returnValue('/peliculas/test-film');
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('renders verified public fields with a single self canonical and noindex', () => {
    const fixture = TestBed.createComponent(EntityDetailComponent);
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith('/entities/resolve')).flush({ success: true, data: {
      entityId: 'verified', kind: 'film', title: 'Test film', canonicalPath: '/peliculas/test-film', year: 2024,
    } });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Test film');
    expect(TestBed.inject(Meta).getTag('name="robots"')?.content).toBe('noindex, follow');
    expect(document.querySelectorAll('link[rel="canonical"]').length).toBe(1);
    expect(new Headers(response.headers).get('Content-Type')).toBe('text/html; charset=utf-8');
    fixture.destroy();
  });

  it('falls back only for an explicitly disabled endpoint', () => {
    const fixture = TestBed.createComponent(EntityDetailComponent);
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith('/entities/resolve')).flush({ error: { code: 'ENTITY_PUBLIC_READ_DISABLED' } }, { status: 404, statusText: 'Not Found' });
    expect(fixture.componentInstance.legacy).toBeTrue();
    fixture.destroy();
  });

  for (const status of [404, 410, 503]) {
    it(`keeps ${status} errors out of the legacy title resolver`, () => {
      const fixture = TestBed.createComponent(EntityDetailComponent);
      fixture.detectChanges();
      http.expectOne(r => r.url.endsWith('/entities/resolve')).flush({ error: { code: 'ENTITY_NOT_FOUND' } }, { status, statusText: 'Error' });
      fixture.detectChanges();
      expect(fixture.componentInstance.legacy).toBeFalse();
      expect(response.status).toBe(status);
      expect(TestBed.inject(Meta).getTag('name="robots"')?.content).toBe('noindex, follow');
      expect(document.querySelector('link[rel="canonical"]')).toBeNull();
      fixture.destroy();
    });
  }

  it('returns a permanent SSR redirect only to a validated canonical site path', () => {
    const fixture = TestBed.createComponent(EntityDetailComponent);
    fixture.detectChanges();
    http.expectOne(r => r.params.get('redirect') === 'false').flush({ success: true, data: {
      entityId: 'verified', kind: 'movie', title: 'Test film', canonicalPath: '/peliculas/current-film',
    } });
    expect(response.status).toBe(301);
    expect(new Headers(response.headers).get('Location')).toBe('/peliculas/current-film');
    expect(new Headers(response.headers).get('X-Robots-Tag')).toBe('noindex, follow');
    fixture.destroy();
  });

  it('rejects a malformed response instead of redirecting outside the site', () => {
    const fixture = TestBed.createComponent(EntityDetailComponent);
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith('/entities/resolve')).flush({ success: true, data: {
      entityId: 'verified', kind: 'movie', title: 'Test film', canonicalPath: '//example.com/film',
    } });
    expect(fixture.componentInstance.unavailable).toBeTrue();
    expect(fixture.componentInstance.legacy).toBeFalse();
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    fixture.destroy();
  });

  describe('enriched movie', () => {
    const movie = (over: Partial<PublicEntity> = {}): PublicEntity => ({
      entityId: 'ce_1', kind: 'movie', title: 'La cura del bienestar', canonicalPath: '/peliculas/test-film', originalTitle: 'A Cure for Wellness', year: 2017,
      synopsis: 'Un joven ejecutivo viaja a un centro de bienestar en los Alpes suizos.', genres: ['Terror', 'Misterio'], runtimeMinutes: 147, tmdbId: 340837,
      images: { poster: 'https://image.tmdb.org/t/p/w500/p.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/b.jpg' },
      credits: { directors: ['Gore Verbinski'], cast: [{ name: 'Dane DeHaan', character: 'Lockhart' }, { name: 'Mia Goth' }] },
      attribution: { source: 'tmdb', updatedAt: '2026-10-21T23:15:00.000Z', notice: 'Datos e imágenes de TMDB.' },
      broadcasts: { status: 'ok', generatedAt: '2026-10-22T10:00:00.000Z', timeZone: 'Europe/Madrid', items: [{
        airingId: 'a1', channel: { id: 'amc', name: 'AMC', path: '/canales/amc' }, programmeTitle: 'La cura del bienestar', start: '2026-10-26T20:00:00.000Z', end: '2026-10-26T22:30:00.000Z',
        startLocal: '2026-10-26T21:00:00+01:00', localDate: '2026-10-26', localTime: '21:00', durationMinutes: 150 }] }, ...over,
    });
    const open = (data: PublicEntity) => {
      const fixture = TestBed.createComponent(EntityDetailComponent);
      fixture.detectChanges();
      http.expectOne(r => r.url.endsWith('/entities/resolve')).flush({ success: true, data });
      fixture.detectChanges();
      // The reusable availability block makes its own requests; they are not what is under test here.
      http.match(r => !r.url.endsWith('/entities/resolve'));
      return fixture;
    };

    it('shows the loading state first, as a polite status', () => {
      const fixture = TestBed.createComponent(EntityDetailComponent);
      fixture.detectChanges();
      const status = fixture.nativeElement.querySelector('[role="status"]');
      expect(status.getAttribute('aria-busy')).toBe('true');
      expect(status.textContent).toContain('Cargando ficha');
      http.expectOne(r => r.url.endsWith('/entities/resolve')).flush({ success: true, data: movie() });
      fixture.destroy();
    });

    it('renders the header, facts, broadcasts, credits, availability and attribution under one h1', () => {
      const fixture = open(movie());
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelectorAll('h1').length).toBe(1);
      expect(el.querySelector('h1')!.textContent).toContain('La cura del bienestar');
      expect(el.textContent).toContain('A Cure for Wellness');
      expect(el.textContent).toContain('2017');
      expect(el.textContent).toContain('2 h 27 min');
      expect(Array.from(el.querySelectorAll('ul[aria-label="Géneros"] li')).map(li => li.textContent!.trim())).toEqual(['Terror', 'Misterio']);
      expect(el.textContent).toContain('Alpes suizos');
      expect(el.querySelector('img[alt="Cartel de La cura del bienestar"]')!.getAttribute('src')).toBe('https://image.tmdb.org/t/p/w500/p.jpg');
      expect(el.querySelector('app-entity-broadcast-list a[href="/canales/amc"]')).not.toBeNull();
      expect(fixture.debugElement.query(By.directive(WhereToWatchComponent)).componentInstance.tmdbId).toBe(340837);
      expect(el.textContent).toContain('Dirección: Gore Verbinski');
      expect(el.textContent).toContain('Dane DeHaan');
      expect(el.textContent).toContain('Lockhart');
      expect(el.textContent).toContain('Datos e imágenes de TMDB.');
      expect(el.textContent).toContain('Datos actualizados el 22 de octubre de 2026');
      // every h2 has text, and the section landmarks are labelled
      expect(Array.from(el.querySelectorAll('h2')).every(h => h.textContent!.trim().length > 0)).toBeTrue();
      expect(Array.from(el.querySelectorAll('section[aria-labelledby], nav[aria-labelledby]')).every(n => el.querySelector('#' + n.getAttribute('aria-labelledby'))))
        .toBeTrue();
      expect(Array.from(el.querySelectorAll('a')).every(a => a.getAttribute('href'))).toBeTrue();
      expect(TestBed.inject(Meta).getTag('name="robots"')?.content).toBe('noindex, follow');
      expect(TestBed.inject(Meta).getTag('name="description"')?.content).toMatch(/^Próxima emisión en AMC: .* a las 21:00\./);
      expect(TestBed.inject(Meta).getTag('property="og:image"')?.content).toBe('https://image.tmdb.org/t/p/w500/p.jpg');
      expect(document.title).toBe('La cura del bienestar (2017) - Guía TV');
      fixture.destroy();
    });

    it('emits structured data from the facts only, and no field can close the script element', () => {
      const fixture = open(movie({ title: 'Película </script><img src=x onerror=alert(1)>', canonicalPath: '/peliculas/test-film' }));
      const el: HTMLElement = fixture.nativeElement;
      const scripts = Array.from(el.querySelectorAll('script[type="application/ld+json"]'));
      const movieScript = scripts.map(s => JSON.parse(s.textContent!)).find(j => (Array.isArray(j) ? j[0] : j)['@type'] === 'Movie');
      expect(movieScript['@type']).toBe('Movie');
      expect(movieScript.name).toBe('Película </script><img src=x onerror=alert(1)>');
      expect(movieScript.duration).toBe('PT2H27M');
      expect(movieScript.publication.length).toBe(1);
      expect(el.querySelector('img[onerror]')).toBeNull();
      fixture.destroy();
    });

    it('degrades without invented content: no artwork, no credits, no schedule claim, a series label', () => {
      const fixture = open({ entityId: 'ce_2', kind: 'series', title: 'Una serie', canonicalPath: '/series/una-serie' });
      const el: HTMLElement = fixture.nativeElement;
      expect(el.textContent).toContain('Serie');
      expect(el.textContent).toContain('Sinopsis no disponible.');
      expect(el.querySelectorAll('img').length).toBe(0);
      expect(el.querySelector('app-entity-broadcast-list')).toBeNull();
      expect(fixture.debugElement.query(By.directive(WhereToWatchComponent))).toBeNull();
      expect(el.querySelector('script[type="application/ld+json"]')).not.toBeNull(); // the breadcrumb only
      expect(el.textContent).not.toContain('Datos actualizados');
      expect(Array.from(el.querySelectorAll('nav[aria-label="Breadcrumb"] a')).map(a => a.getAttribute('href'))).toEqual(['/', '/programacion-tv/series']);
      fixture.destroy();
    });

    it('says plainly when the schedule could not be read', () => {
      const fixture = open(movie({ broadcasts: { status: 'unavailable', items: [], generatedAt: '2026-10-22T10:00:00.000Z', timeZone: 'Europe/Madrid' } }));
      expect(fixture.nativeElement.textContent).toContain('No hemos podido comprobar la programación');
      expect(TestBed.inject(Meta).getTag('name="description"')?.content).not.toContain('Próxima emisión');
      fixture.destroy();
    });

    it('offers guide discovery for programmes without a verified schedule or a media identity', () => {
      const fixture = open({ entityId: 'ce_show', kind: 'show', title: 'Magazine', canonicalPath: '/programas/magazine', tmdbId: 123 });
      expect(fixture.nativeElement.textContent).toContain('No disponemos de un horario verificado');
      expect(fixture.nativeElement.querySelector('a[href="/programacion-tv/que-ver-hoy"]')).not.toBeNull();
      expect(fixture.debugElement.query(By.directive(WhereToWatchComponent))).toBeNull();
      fixture.destroy();
    });

    it('uses TV availability for verified series and omits slot runtime', () => {
      const fixture = open(movie({ kind: 'series', canonicalPath: '/series/test-series' }));
      expect(fixture.debugElement.query(By.directive(WhereToWatchComponent)).componentInstance.contentType).toBe('tv');
      expect(fixture.componentInstance.runtime).toBeNull();
      fixture.destroy();
    });
  });
});
