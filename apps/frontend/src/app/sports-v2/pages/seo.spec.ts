import { DOCUMENT } from '@angular/common';
import { Component, RESPONSE_INIT, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Sv2Seo, breadcrumbs, sportsEvent, sv2Path, useNotFound, useSeo } from './seo';

const seo = signal<Sv2Seo | null>(null);
const missing = signal(false);
const hard = signal(true);

@Component({ selector: 'app-seo-host', standalone: true, template: '' })
class HostComponent {
  constructor() {
    useSeo(() => seo());
    useNotFound(() => missing(), hard());
  }
}

describe('sports-v2 SEO', () => {
  const doc = () => TestBed.inject(DOCUMENT);
  const canonical = () => doc().head.querySelector('link[rel="canonical"]')?.getAttribute('href');
  const ld = () => doc().getElementById('sv2-jsonld')?.textContent;

  // Other specs in the suite may leave a canonical link in the shared document head.
  beforeEach(() => document.head.querySelectorAll('link[rel="canonical"]').forEach((l) => l.remove()));

  afterEach(() => {
    seo.set(null);
    missing.set(false);
    hard.set(true);
  });

  it('does not claim any canonical URL for a page without identity (not found)', () => {
    seo.set({ title: 'Partido', segments: ['partido', 'x'] });
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    expect(canonical()).toContain('/partido/x');
    seo.set({ title: 'Partido' });
    f.detectChanges();
    expect(canonical()).toBeUndefined();
    f.destroy();
  });

  it('keeps a provider-derived not-found page at 200 but noindex', () => {
    hard.set(false);
    const init: { status?: number; headers?: Record<string, string> } = {};
    TestBed.configureTestingModule({ providers: [{ provide: RESPONSE_INIT, useValue: init }] });
    missing.set(true);
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    expect(init.status).toBeUndefined();
    expect(init.headers?.['X-Robots-Tag']).toBe('noindex');
    f.destroy();
  });

  it('answers 404 + noindex on the server only when the page resolved to not found', () => {
    const init: { status?: number; headers?: Record<string, string> } = {};
    TestBed.overrideProvider(RESPONSE_INIT, { useValue: init });
    TestBed.configureTestingModule({ providers: [{ provide: RESPONSE_INIT, useValue: init }] });
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    expect(init.status).toBeUndefined();
    missing.set(true);
    f.detectChanges();
    expect(init.status).toBe(404);
    expect(init.headers?.['X-Robots-Tag']).toBe('noindex');
    f.destroy();
  });

  it('derives the canonical URL from the sports mount, without query or tab', async () => {
    seo.set({ title: 'A - B', description: 'd', segments: ['partido', 'a-b-2026-11-05'] });
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    expect(canonical()).toBe('https://guiaprogramaciontv.com/deportes/futbol/partido/a-b-2026-11-05');
    expect(doc().title).toContain('A - B');
    f.destroy();
    expect(canonical()).toBeUndefined();
  });

  it('lets the CMS own the canonical URL of an editorial article', () => {
    seo.set({ title: 'Guía', segments: ['noticias', 'guia'], canonicalPath: '/guias/guia' });
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    expect(canonical()).toBe('https://guiaprogramaciontv.com/guias/guia');
    f.destroy();
  });

  it('emits JSON-LD that cannot close the script element and removes it on destroy', () => {
    seo.set({ title: 'x', jsonLd: [{ '@type': 'NewsArticle', headline: '</script><b>' }] });
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    expect(ld()).not.toContain('</script>');
    expect(JSON.parse(ld()!).headline).toBe('</script><b>');
    f.destroy();
    expect(ld()).toBeUndefined();
  });

  it('drops the SportsEvent when the venue is unknown, since Google requires a location', () => {
    const e = sportsEvent('https://x.test', { name: 'A - B', kickoff: '2026-11-05T20:00:00Z', status: 'scheduled', home: 'A', away: 'B', competition: 'Liga', path: '/p' });

    expect(e).toBeNull();
  });

  it('builds a SportsEvent with the venue as location, the competition as organizer and no second Event node', () => {
    const e = sportsEvent('https://x.test', {
      name: 'A - B', kickoff: '2026-11-05T20:00:00Z', status: 'postponed', home: 'A', away: 'B',
      competition: 'Liga', path: '/p', venue: 'Estadio Metropolitano', country: 'España',
    }) as Record<string, unknown>;

    expect(e['@type']).toBe('SportsEvent');
    expect(e['eventStatus']).toBe('https://schema.org/EventPostponed');
    expect(e['startDate']).toBe('2026-11-05T20:00:00Z');
    expect(e['location']).toEqual({ '@type': 'Place', name: 'Estadio Metropolitano', address: { '@type': 'PostalAddress', addressCountry: 'España' } });
    expect(e['organizer']).toEqual({ '@type': 'SportsOrganization', name: 'Liga' });
    expect(Object.keys(e)).not.toContain('superEvent');
    expect(Object.keys(e)).not.toContain('offers');
  });

  it('leaves the country out of the location for a cross-border competition', () => {
    const e = sportsEvent('https://x.test', {
      name: 'A - B', kickoff: '2026-11-05T20:00:00Z', status: 'scheduled', home: 'A', away: 'B',
      competition: 'Champions League', path: '/p', venue: 'Estadio Metropolitano',
    }) as Record<string, unknown>;

    expect(e['location']).toEqual({ '@type': 'Place', name: 'Estadio Metropolitano' });
    expect(JSON.stringify(e)).not.toContain('"address"');
  });

  it('builds ordered breadcrumbs with absolute URLs', () => {
    const b = breadcrumbs('https://x.test', [['Fútbol', sv2Path()], ['Liga', sv2Path(['competiciones', 'liga'])]]) as { itemListElement: { position: number; item: string }[] };
    expect(b.itemListElement.map((i) => [i.position, i.item])).toEqual([[1, 'https://x.test/deportes/futbol'], [2, 'https://x.test/deportes/futbol/competiciones/liga']]);
  });
});
