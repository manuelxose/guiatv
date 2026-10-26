import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { CatalogItem } from '../../services/catalog.service';
import { CatalogCardComponent } from './catalog-card.component';

describe('CatalogCardComponent links (M10)', () => {
  const item = (over: Partial<CatalogItem>): CatalogItem =>
    ({ catalogId: 'tmdb:tv:1', source: 'tmdb', contentType: 'series', title: 'Serie', genres: [], primaryPlatforms: [], ...over }) as CatalogItem;

  function hrefs(value: CatalogItem): (string | null)[] {
    TestBed.configureTestingModule({ imports: [CatalogCardComponent], providers: [provideRouter([]), provideHttpClient()] });
    const fixture = TestBed.createComponent(CatalogCardComponent);
    fixture.componentInstance.item = value;
    fixture.detectChanges();
    return Array.from(fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>).slice(0, 2).map((a) => a.getAttribute('href'));
  }

  it('never links the shared /sin-titulo 404 of a title without slug characters', () => {
    expect(hrefs(item({ title: 'चार यार', detailPath: '/series/sin-titulo' }))).toEqual([null, null]);
  });

  it('links the API detail path, preferring a verified work path', () => {
    expect(hrefs(item({ detailPath: '/series/serie' }))).toEqual(['/series/serie', '/series/serie']);
    TestBed.resetTestingModule();
    expect(hrefs(item({ source: 'program', detailPath: '/contenido/program:1', workPath: '/series/serie' }))).toEqual(['/series/serie', '/series/serie']);
  });
});
