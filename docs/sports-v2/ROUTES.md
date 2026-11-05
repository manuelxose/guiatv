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

Target public identity, to be adopted only after parity review in a later milestone:

```
/futbol                         home
/futbol/en-directo
/futbol/partidos/:fecha         (fecha = YYYY-MM-DD)
/futbol/resultados/:fecha
/futbol/competiciones/:competicion
/futbol/competiciones/:competicion/clasificacion
/futbol/equipos/:equipo
/futbol/partidos/:partido       (slug with date)
/futbol/noticias
```

Rules for the cutover: exactly one public identity per page (legacy `/deportes/futbol/**` gets 301 redirects to the new URL, never two live copies); canonical `<link>` plus `index, follow` replace the preview `noindex`; sitemap entries are generated from the same slug source; structured data (`SportsEvent`, `BreadcrumbList`) is added per page; `RenderMode.Server` stays the default and the Match Center is client-only enhancement over server-rendered content.

## SSR

Preview routes use the default `RenderMode.Server` (no entry in `app.routes.server.ts` needed). Content is rendered from the demo adapter on the server and hydrated.
