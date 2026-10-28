import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { of } from 'rxjs';
import { CatalogItem, CatalogService } from '../../services/catalog.service';
import { CatalogDetailComponent } from './catalog-detail.component';

// M09-B: a /programas/ page declares the canonical and robots of its API payload (backend ProgrammeSeoPolicy).
const programme = (over: Partial<CatalogItem> = {}): CatalogItem => ({
  catalogId: 'program:a1', source: 'program', contentType: 'movie', title: 'El último sol', slug: 'el-ultimo-sol', detailPath: '/contenido/program:a1',
  synopsis: 'Sinopsis', genres: [], tmdbId: 9, primaryPlatforms: [], airings: [], ...over,
});

describe('CatalogDetailComponent: M09-B programme SEO signals', () => {
  function render(item: CatalogItem, path: string) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ slug: path.split('/').pop() })), data: of({ contentType: 'program' }), snapshot: { data: {} } } },
        { provide: CatalogService, useValue: { getBySlugState: () => of({ data: item, unavailable: false, stale: false }), getDetailEnrichment: () => of({ related: [] }), query: () => of({ items: [] }) } },
      ],
    });
    spyOnProperty(TestBed.inject(Router), 'url', 'get').and.returnValue(path);
    const fixture = TestBed.createComponent(CatalogDetailComponent);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }
  const robots = () => TestBed.inject(Meta).getTag('name="robots"')?.content;
  // MetaService prefixes the page origin (localhost under Karma): the path is the declared canonical.
  const canonical = () => new URL(document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '', 'https://x').pathname;
  const ld = (el: HTMLElement) => Array.from(el.querySelectorAll('script[type="application/ld+json"]')).flatMap((s) => [JSON.parse(s.textContent || '[]')].flat());

  afterEach(() => TestBed.resetTestingModule());

  it('a verified work twin declares the work page as canonical, stays indexable, and keeps its own anchors', () => {
    const fixture = render(programme({ seo: { canonicalPath: '/peliculas/el-ultimo-sol', disposition: 'work', applied: true } }), '/programas/el-ltimo-sol');
    expect(canonical()).toBe('/peliculas/el-ultimo-sol');
    expect(document.querySelectorAll('link[rel="canonical"]').length).toBe(1);
    expect(robots()).toContain('index, follow');
    expect(robots()).not.toContain('noindex');
    const movie = ld(fixture.nativeElement).find((s: { '@type'?: string }) => s['@type'] === 'Movie');
    expect(movie?.url).toBe('https://guiaprogramaciontv.com/peliculas/el-ultimo-sol');
    expect(fixture.componentInstance.broadcastHref).toBe('/programas/el-ltimo-sol#emisiones');
    fixture.destroy();
  });

  it('an episode or thin page is noindex, follow with its own canonical', () => {
    const fixture = render(programme({ title: 'Fallen T1 E3', seo: { canonicalPath: '/programas/fallen-t1-e3', robots: 'noindex, follow', disposition: 'episode', applied: true } }), '/programas/fallen-t1-e3');
    expect(robots()).toBe('noindex, follow');
    expect(canonical()).toBe('/programas/fallen-t1-e3');
    fixture.destroy();
  });

  it('a legacy accent-dropping slug declares the folded slug', () => {
    const fixture = render(programme({ seo: { canonicalPath: '/programas/el-ultimo-sol', disposition: 'ambiguous', applied: false } }), '/programas/el-ltimo-sol');
    expect(canonical()).toBe('/programas/el-ultimo-sol');
    fixture.destroy();
  });

  it('ignores a malformed declared canonical, and any declaration outside /programas/', () => {
    const bad = render(programme({ seo: { canonicalPath: 'https://example.com/peliculas/x' } }), '/programas/el-ultimo-sol');
    expect(canonical()).toBe('/programas/el-ultimo-sol');
    bad.destroy();
    TestBed.resetTestingModule();
    const work = render(programme({ source: 'tmdb', airings: [{ channelId: 'la1', channelName: 'La 1', start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString(), title: 'El último sol', catalogId: 'program:a1', detailPath: '/contenido/program:a1' }], seo: { canonicalPath: '/series/otra' } }), '/peliculas/el-ultimo-sol');
    expect(canonical()).toBe('/peliculas/el-ultimo-sol');
    work.destroy();
  });
});
