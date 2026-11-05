# Sports v2: Route map

## M01 mount (live now)

All routes sit under the noindex preview prefix `/laboratorio/futbol`. It is not in the sitemap, carries `robots: noindex, nofollow`, and does not overlap any production URL (`/deportes/futbol/**` is untouched).

| URL | View | Title |
|---|---|---|
| `/laboratorio/futbol` | Home (personalised discovery) | Fútbol (vista previa) |
| `/laboratorio/futbol/en-directo` | Live fixtures (`?competicion=`, `?seguidos=1`) | En directo |
| `/laboratorio/futbol/partidos` | Fixtures by day (`?dia=YYYY-MM-DD`, plus the same filters) | Partidos |
| `/laboratorio/futbol/resultados` | Results | Resultados |
| `/laboratorio/futbol/competiciones` | Competition catalogue | Competiciones |
| `/laboratorio/futbol/competiciones/:slug` | One competition (`?tab=partidos|resultados|clasificacion|equipos|noticias`) | its name |
| `/laboratorio/futbol/equipos/:slug` | One team | its name |
| `/laboratorio/futbol/partido/:slug` | Full-page Match Center (`?tab=estadisticas|alineaciones|donde-verlo`); dedicated full screen on mobile | home - away |
| `/laboratorio/futbol/noticias` | News home (featured lead + cards; `?competicion=`, `?seguidos=1`) | Noticias |
| `/laboratorio/futbol/noticias/:slug` | Article detail | article title |
| `/laboratorio/futbol/clasificaciones[/:slug]` | Standings (bare path redirects to the first competition with a table) | Clasificación |
| `/laboratorio/futbol/buscar?q=` | Unified search | Buscar |
| `/laboratorio/futbol/siguiendo` | My Football: followed teams, favourite competitions, saved fixtures | Mi fútbol |

Unknown paths under the prefix redirect to its home. Every link is built with `sv2Link()` from `sports-v2.paths.ts`, so the prefix changes in exactly one place.

## Identity rules

- Path params are human slugs (`real-costa-racing-sur-...`), never database ids. `SportsStore` tests assert search links match `^[a-z0-9-]+(/[a-z0-9-]+)?$`.
- Match slugs are `<home>-<away>-<YYYY-MM-DD>` (kickoff day in Madrid), already used by the M02 demo data.
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
