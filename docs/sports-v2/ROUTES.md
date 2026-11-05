# Sports v2: Route map

## M01 mount (live now)

All routes sit under the noindex preview prefix `/laboratorio/futbol`. It is not in the sitemap, carries `robots: noindex, nofollow`, and does not overlap any production URL (`/deportes/futbol/**` is untouched).

| URL | View | Title |
|---|---|---|
| `/laboratorio/futbol` | Home (personalised discovery) | Fútbol (vista previa) |
| `/laboratorio/futbol/en-directo` | Live fixtures | En directo |
| `/laboratorio/futbol/partidos` | Upcoming fixtures | Partidos |
| `/laboratorio/futbol/resultados` | Results | Resultados |
| `/laboratorio/futbol/competiciones` | Competition catalogue | Competiciones |
| `/laboratorio/futbol/competiciones/:slug` | One competition | its name |
| `/laboratorio/futbol/equipos/:slug` | One team | its name |
| `/laboratorio/futbol/partido/:slug` | One match (also opens Match Center) | Partido |
| `/laboratorio/futbol/noticias` | News | Noticias |
| `/laboratorio/futbol/siguiendo` | Followed teams and favourite competitions | Siguiendo |

Unknown paths under the prefix redirect to its home. Every link is built with `sv2Link()` from `sports-v2.paths.ts`, so the prefix changes in exactly one place.

## Identity rules

- Path params are human slugs (`real-costa-racing-sur-...`), never database ids. `SportsStore` tests assert search links match `^[a-z0-9-]+(/[a-z0-9-]+)?$`.
- Match slugs are `<home>-<away>-<disambiguator>`. For production data the disambiguator will be the kickoff date (`2026-11-05`); M01 uses `demo-NN` because the data is fictional.
- Visible UI (breadcrumbs, labels, ARIA) only uses names. No identifier is rendered.

## Cutover plan (not in M01)

Sports v2 **replaces** the legacy football section (`features/football`, served at `/deportes/futbol/**`). `/laboratorio/futbol` is only the staging mount and disappears at cutover.

Decision: keep the existing public identity `/deportes/futbol/**` instead of inventing `/futbol`. It is already indexed, linked and in the sitemap; moving it would cost ranking for no benefit. v2 takes over those URLs and the slug tree below maps onto them:

```
/deportes/futbol                              home
/deportes/futbol/partidos-hoy                 today (legacy path kept)
/deportes/futbol/calendario                   fixtures
/deportes/futbol/competiciones[/:slug]
/deportes/futbol/equipos/:slug
/deportes/futbol/partido/:slug                (slug carries the date)
/deportes/futbol/noticias
```

New v2-only pages (en-directo, resultados, siguiendo) are added under the same prefix. Legacy URLs that have no v2 equivalent get a 301 to the closest page, never a 404.

Rules: one public identity per page (no live duplicate during or after the swap); swap in one release by pointing `/deportes/futbol` at `SPORTS_V2_ROUTES` and deleting `FOOTBALL_ROUTES` and `features/football`; replace preview `noindex` with canonical + `index, follow`; keep the sitemap and `ssr-server.mjs` allow-list in step (the `/laboratorio/futbol` entries are removed in the same change); add `SportsEvent` and `BreadcrumbList` structured data; `RenderMode.Server` stays the default.

Only change `SPORTS_V2_BASE` in `sports-v2.paths.ts` to move the mount; every link derives from it.

## SSR

Preview routes use the default `RenderMode.Server` (no entry in `app.routes.server.ts` needed). Content is rendered from the demo adapter on the server and hydrated.
