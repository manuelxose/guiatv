import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Sv2SiteNavComponent } from './site-nav';

describe('Sv2SiteNavComponent', () => {
  it('links to every top-level Guía TV section and marks football as the current one', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const f = TestBed.createComponent(Sv2SiteNavComponent);
    f.detectChanges();
    const links = Array.from((f.nativeElement as HTMLElement).querySelectorAll('nav a'));
    expect(links.map((a) => a.textContent?.trim())).toEqual(['TV', 'Qué ver', 'Plataformas', 'Fútbol', 'Guías']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/programacion-tv/en-directo', '/programacion-tv/que-ver-hoy', '/plataformas', '/deportes/futbol', '/guias']);
    expect(links.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent?.trim())).toEqual(['Fútbol']);
  });

  it('opens and closes the collapsed menu', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const f = TestBed.createComponent(Sv2SiteNavComponent);
    f.detectChanges();
    const btn = (f.nativeElement as HTMLElement).querySelector('button.more') as HTMLButtonElement;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.click();
    f.detectChanges();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });
});
