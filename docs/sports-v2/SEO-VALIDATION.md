# Sports v2: SEO validation (M04)

Validated against the production SSR build (`ssr-server.mjs`) with the real production API, before deploy. A post-deploy section is appended in the delivery document once production is verified. **No claim is made about indexing, rankings or traffic: there is no Search Console evidence for the new pages.**

## Cutover decisions

- Identity kept: v2 serves the URLs the football section already had, `/deportes/futbol/**` (already indexed, linked, in the sitemap). `/laboratorio/futbol/**` (noindex preview) is gone and answers a 301 to the same path under `/deportes/futbol`.
- The preview `noindex, nofollow` and the "(vista previa)" titles are removed. Indexing is decided per page in `pages/seo.ts`.
- Legacy URLs: `/deportes/futbol/partidos-hoy` and `/calendario` -> **301** `/deportes/futbol/partidos` (query kept). `/deportes/futbol/en-directo` was a 301 to `partidos-hoy?filter=live`; it is now a real v2 page (the redirect rule and the matching editorial link rewrite were removed, tests updated). `noticias/:slug` keeps its 301 to the guide `/guias/:slug` (the guide stays the one canonical article URL). `/deportes` stays a 301 to `/deportes/futbol`. Editorial slug `futbol-hoy-en-tv` now points to `/deportes/futbol/partidos`.
- Same-path pages that keep their URL: `competiciones[/:slug]`, `equipos/:slug`, `partido/:slug`, `noticias`.
- New in v2 (new URLs, added to the sitemap where indexable): `partidos`, `en-directo`, `resultados`. `clasificaciones` and `siguiendo`, `buscar` are not in the sitemap.

## Measured, per route (local production build)

| Route | HTTP | Canonical | Robots | h1 | Structured data |
|---|---|---|---|---|---|
| `/deportes/futbol` | 200 | self | index (default) | 1 | none |
| `/partidos`, `/resultados`, `/en-directo`, `/competiciones`, `/noticias` | 200 | self | index | 1 | none |
| `/competiciones/:slug` (real) | 200 | self | index | 1 | BreadcrumbList |
| `/equipos/:slug` (real) | 200 | self | index | 1 | BreadcrumbList |
| `/partido/:slug` (real) | 200 | self | index | 1 | SportsEvent, SportsTeam, BreadcrumbList |
| `/buscar?q=` | 200 | none | `noindex, follow` (meta **and** `X-Robots-Tag`) | 1 | none |
| `/siguiendo` | 200 | none | `noindex, follow` (meta and header) | 1 | none |
| `/competiciones/no-existe` | **404** | none | `X-Robots-Tag: noindex` | 1 | none |
| `/equipos/no-existe`, `/partido/no-existe` | 200 | none | `X-Robots-Tag: noindex` | 1 | none |
| `/clasificaciones` | 302 (client redirect to the first competition with a table) | n/a | n/a | n/a | n/a |
| `/partidos-hoy`, `/calendario`, `/laboratorio/futbol/en-directo` | **301** | n/a | n/a | n/a | n/a |
| `/noticias/no-existe` | 301 -> `/guias/no-existe` (existing rule) | n/a | n/a | n/a | n/a |
| any page when the provider is down | **503** + `Retry-After` + `noindex, nofollow` | n/a | noindex | n/a | n/a |

Each page now has its own title and description (home, partidos, resultados, en-directo, competiciones, noticias were previously inheriting the generic description). Titles: `<page> · Fútbol - Guía TV`. Canonical never carries `?dia=`, `?tab=`, `?competicion=`, so filter and day views are not duplicates. Not-found pages declare no canonical. Internal links: 28-49 per entity page, all slug-based, no raw ids; every in-app link derives from `SPORTS_V2_BASE`.

Structured data: `SportsEvent` carries no score or broadcaster claim (none is a verified schema fact here) and is only emitted when the fixture has a venue, because Google requires `location`. The venue is `location.name`; a domestic competition lends its country as `addressCountry`. The competition is the `organizer` — as a nested `superEvent` it was a second Event node with no `startDate`, which Search Console reports as a missing required field. Not run through Google's Rich Results test (no access); only checked for presence and that `<` is escaped.

## Sitemap and unrelated routes

- `SitemapController` static list: `/deportes/futbol/partidos-hoy` replaced by `/partidos`; `/en-directo` and `/resultados` added. Backend test suite for it passes (32/32 together with the editorial policy tests). The generated XML was **not** fetched in M04 pre-deploy (the local backend was not run); it is checked after deploy.
- Unrelated routes: only football paths, the football nav item (`portal-navigation.config`) and two redirect rules changed. `ssr-server.mjs` known-route and noindex lists lose only the `/laboratorio/futbol` entries.
- `robots.txt` was not changed; nothing in it referenced `/laboratorio`.

## Known SEO risks (not blocking)

1. v2 pages are thinner than the legacy football pages in editorial text; their content is what the football-data.org free tier supplies (see FINAL-ACCEPTANCE). Evaluate in Search Console after a few weeks; nothing here predicts the outcome.
2. Match and team pages that the provider cannot resolve return 200 + noindex (soft not-found) by design, because the provider can fail on real fixtures outside its window.
3. `/deportes/futbol/clasificaciones` answers 302 (Angular redirect), not 301. It is not in the sitemap; making it a server 301 needs the competition list on the server.
