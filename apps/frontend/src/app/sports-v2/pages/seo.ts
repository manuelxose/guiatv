import { DOCUMENT } from '@angular/common';
import { DestroyRef, InjectionToken, RESPONSE_INIT, effect, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { SPORTS_V2_BASE } from '../sports-v2.paths';

/** Public origin used for canonical and structured-data URLs. */
export const SPORTS_SITE_URL = new InjectionToken<string>('SPORTS_SITE_URL', { providedIn: 'root', factory: () => 'https://guiaprogramaciontv.com' });

export const TITLE_SUFFIX = ' · Fútbol - Guía TV';

export interface Sv2Seo {
  readonly title: string;
  readonly description?: string;
  /** Path below the sports mount (e.g. `['partido','a-b-2026-11-05']`). Canonical follows SPORTS_V2_BASE, so it flips at cutover. */
  readonly segments?: readonly string[];
  /** Absolute site path owned by another system (editorial articles live in the CMS). Overrides `segments`. */
  readonly canonicalPath?: string;
  readonly jsonLd?: readonly object[];
  /** Internal search and personal pages: `noindex, follow` (meta + X-Robots-Tag on the server render). */
  readonly noindex?: boolean;
}

export const sv2Path = (segments: readonly string[] = []): string => [SPORTS_V2_BASE, ...segments].join('/');

const ID = 'sv2-jsonld';

/** Title, description, Open Graph, canonical and JSON-LD for one page. Runs on the server too (no window access). */
export function useSeo(input: () => Sv2Seo | null): void {
  const title = inject(Title);
  const meta = inject(Meta);
  const doc = inject(DOCUMENT);
  const site = inject(SPORTS_SITE_URL);
  const response = inject(RESPONSE_INIT, { optional: true });

  effect(() => {
    const seo = input();
    if (!seo) return;
    const hasPath = !!(seo.canonicalPath ?? seo.segments);
    const url = site + (seo.canonicalPath ?? sv2Path(seo.segments));
    title.setTitle(seo.title + TITLE_SUFFIX);
    if (seo.description) meta.updateTag({ name: 'description', content: seo.description });
    meta.updateTag({ property: 'og:title', content: seo.title });
    if (hasPath) meta.updateTag({ property: 'og:url', content: url });
    meta.updateTag({ property: 'og:type', content: 'website' });
    if (seo.noindex) {
      meta.updateTag({ name: 'robots', content: 'noindex, follow' });
      if (response) response.headers = { ...response.headers, 'X-Robots-Tag': 'noindex, follow' };
    }
    if (seo.description) meta.updateTag({ property: 'og:description', content: seo.description });

    let link = doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!hasPath) {
      // A page with no stable identity (not found) must not claim another page's URL.
      if (link?.hasAttribute('data-sv2')) link.remove();
    } else {
      if (!link) {
        link = doc.createElement('link');
        link.setAttribute('rel', 'canonical');
        link.setAttribute('data-sv2', '1');
        doc.head.appendChild(link);
      }
      link.setAttribute('href', url);
    }

    doc.getElementById(ID)?.remove();
    if (seo.jsonLd?.length) {
      const script = doc.createElement('script');
      script.id = ID;
      script.type = 'application/ld+json';
      // `<` is escaped so article text can never close the script element.
      script.textContent = JSON.stringify(seo.jsonLd.length === 1 ? seo.jsonLd[0] : seo.jsonLd).replace(/</g, '\\u003c');
      doc.head.appendChild(script);
    }
  });

  inject(DestroyRef).onDestroy(() => {
    doc.getElementById(ID)?.remove();
    doc.head.querySelector('link[rel="canonical"][data-sv2]')?.remove();
  });
}

/** schema.org BreadcrumbList from `[name, absolute path]` pairs. */
export function breadcrumbs(site: string, crumbs: readonly (readonly [string, string])[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: site + path })),
  };
}

const EVENT_STATUS: Record<string, string> = {
  postponed: 'https://schema.org/EventPostponed',
};

/** SportsEvent for a fixture. Score, venue and broadcasters are left out: none is a verified, stable schema fact here. */
export function sportsEvent(site: string, m: { name: string; kickoff: string; status: string; home: string; away: string; competition: string; path: string }): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: m.name,
    startDate: m.kickoff,
    eventStatus: EVENT_STATUS[m.status] ?? 'https://schema.org/EventScheduled',
    sport: 'Fútbol',
    url: site + m.path,
    homeTeam: { '@type': 'SportsTeam', name: m.home },
    awayTeam: { '@type': 'SportsTeam', name: m.away },
    superEvent: { '@type': 'SportsEvent', name: m.competition },
  };
}

/**
 * Server render: when the page resolved to "not found", send noindex, and a real 404 only when `hard` (the source is
 * authoritative: CMS article, competition catalogue). Provider-derived pages (teams, matches) stay 200 + noindex,
 * because the provider can fail to resolve a real fixture or team outside its current window. No-op in the browser.
 */
export function useNotFound(missing: () => boolean, hard = true): void {
  const response = inject(RESPONSE_INIT, { optional: true });
  effect(() => {
    if (response && missing()) {
      if (hard) response.status = 404;
      response.headers = { ...response.headers, 'X-Robots-Tag': 'noindex' };
    }
  });
}
