import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { of } from 'rxjs';
import { CatalogItem, CatalogService } from '../../services/catalog.service';
import { CatalogDetailComponent } from './catalog-detail.component';

// M10-B: the "Relacionados" rail of a work page links only the verified, indexable works the API returns.
const work = (over: Partial<CatalogItem> = {}): CatalogItem => ({
  catalogId: 'tmdb:tv:1421', source: 'tmdb', contentType: 'series', title: 'Modern Family', slug: 'modern-family', detailPath: '/series/modern-family',
  synopsis: 'Tres familias', genres: [], tmdbId: 1421, primaryPlatforms: [], enrichmentPending: true, ...over,
});
const related = (id: number, slug: string): CatalogItem => ({
  catalogId: `tmdb:tv:${id}`, source: 'tmdb', contentType: 'series', title: slug, slug, detailPath: `/series/${slug}`, genres: [], tmdbId: id, primaryPlatforms: [],
});
const popular = related(9, 'popular-sin-verificar');

describe('CatalogDetailComponent: M10-B related works', () => {
  function render(item: CatalogItem, enrichmentRelated: CatalogItem[]) {
    const query = jasmine.createSpy('query').and.returnValue(of({ items: [popular] }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ slug: item.slug })), data: of({ contentType: item.contentType }), snapshot: { data: {} } } },
        {
          provide: CatalogService,
          useValue: {
            getBySlugState: () => of({ data: item, unavailable: false, stale: false }),
            getDetailEnrichment: () => of({ related: enrichmentRelated }),
            query,
          },
        },
      ],
    });
    spyOnProperty(TestBed.inject(Router), 'url', 'get').and.returnValue(item.detailPath);
    const fixture = TestBed.createComponent(CatalogDetailComponent);
    fixture.detectChanges();
    fixture.detectChanges();
    return { fixture, query };
  }
  const hrefs = (el: HTMLElement) => Array.from(el.querySelectorAll('app-catalog-rail a[href]')).map((a) => a.getAttribute('href'));

  it('renders the API related works as plain anchors to their canonical paths, never a popular-titles query', () => {
    const { fixture, query } = render(work(), [related(2, 'malcolm'), related(3, 'friends')]);
    expect(query).not.toHaveBeenCalled();
    expect(hrefs(fixture.nativeElement)).toContain('/series/malcolm');
    expect(hrefs(fixture.nativeElement)).toContain('/series/friends');
    expect(hrefs(fixture.nativeElement)).not.toContain('/series/popular-sin-verificar');
    fixture.destroy();
  });

  it('a work page with no verified related works shows no rail', () => {
    const { fixture, query } = render(work(), []);
    expect(query).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('app-catalog-rail')).toBeNull();
    fixture.destroy();
  });

  it('a programme page keeps its existing fallback', () => {
    const { fixture, query } = render(work({ source: 'program', catalogId: 'program:x', detailPath: '/programas/modern-family' }), []);
    expect(query).toHaveBeenCalled();
    fixture.destroy();
  });
});

describe('CatalogDetailComponent: M10-B airing to programme page', () => {
  function render(item: CatalogItem, path: string) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ catalogId: item.catalogId })), data: of({}), snapshot: { data: {} } } },
        {
          provide: CatalogService,
          useValue: {
            getBySlugState: () => of({ data: item, unavailable: false, stale: false }),
            getDetailState: () => of({ data: item, unavailable: false, stale: false }),
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
  const airing = (over: Partial<CatalogItem> = {}): CatalogItem => ({
    catalogId: 'program:20261028_la_2_x', source: 'program', contentType: 'program', title: 'La revuelta', slug: 'la-revuelta',
    detailPath: '/contenido/program:20261028_la_2_x', genres: [], primaryPlatforms: [], ...over,
  });

  it('links the indexable programme page as a plain anchor, and not from that page itself', () => {
    const fixture = render(airing({ programmePath: '/programas/la-revuelta' }), '/contenido/program:20261028_la_2_x');
    expect(fixture.nativeElement.querySelector('a[data-testid="programme-page-link"]')?.getAttribute('href')).toBe('/programas/la-revuelta');
    fixture.destroy();
    TestBed.resetTestingModule();
    const own = render(airing({ programmePath: '/programas/la-revuelta' }), '/programas/la-revuelta');
    expect(own.nativeElement.querySelector('a[data-testid="programme-page-link"]')).toBeNull();
    own.destroy();
  });

  it('renders no programme link without the API field', () => {
    const fixture = render(airing(), '/contenido/program:20261028_la_2_x');
    expect(fixture.nativeElement.querySelector('a[data-testid="programme-page-link"]')).toBeNull();
    fixture.destroy();
  });
});
