# M09 — canonical ownership, indexation policy and sitemap correctness

Written for: the owner and whoever executes M10. Everything below marked **existing** was read from the code or observed on production on 2026-10-26 (public GETs only; SSH and Search Console were not available). Anything marked **proposed** is not implemented and not active.

## 1. Canonical ownership matrix (existing behaviour)

| Route family | Intent | Canonical owner | Robots (SSR) | In sitemap | Notes |
|---|---|---|---|---|---|
| `/` | Today's TV guide | itself | index | static | |
| `/programacion-tv/{en-directo,que-ver-hoy,peliculas,series}`, `/plataformas`, `/comparador-streaming`, `/canales`, `/guias`, `/deportes/futbol…` | Live hubs | itself | index | static | hubs carry `lastmod` only where the content is the day's schedule |
| `/canales/:slug` | One channel's schedule | itself, lowercase hyphenated slug | index | channels (TDT + autonómicos with a schedule: 81 of 82 returned 200) | `_` slugs and trailing `/` 301; `LA-1` answers 200 with a lowercase canonical (not redirected) |
| `/programas/:slug` | When is this programme on TV | itself (self-canonical) | **always index** (`source`/type `program`) | programs (722) | resolves only while an airing exists today/tomorrow; otherwise 404 `noindex, nofollow` |
| `/peliculas/:slug`, `/series/:slug` | Work page (TMDB identity) | itself | **index only while the work has an airing today/tomorrow, else `noindex, follow`** | **never** | guide cards link here |
| `/contenido/:id`, `/detalles/:id`, `/pelicula-details/:id`, `/program-full-details/:id` | Legacy / airing-ID entry points | 301 to the API `detailPath` when it differs; `/contenido/*` renders `noindex, follow` | noindex | no | unknown ids 404; 410 only on API proof |
| `/guias/:slug`, `/guias/categoria/:slug`, `/guias/rankings` | Editorial | itself; merged posts 301 to the consolidated guide (`EDITORIAL_REDIRECTS`) | index | blog (13; categories need ≥3 posts) | `/editorial`, `/blog` 301 |
| `/deportes/futbol…` competitions/teams/matches | Football | itself | index (hubs) | static hubs only; provider-only detail pages are deliberately empty in `sitemap-football.xml` | |
| `/iniciar-sesion`, `/registro`, `/perfil`, `/comunidad`, `/para-ti`, `/admin`, `/sitemap` | Account / tooling | none | noindex | no | |
| Unknown / query variants | | canonical strips `?…#…`; tracking parameters never reach the canonical | | | verified: `?utm_source=…&fbclid=…` → clean canonical |

SSR invariants (existing, unchanged): one absolute canonical, added server-side only for an indexable 200 that rendered none (`ssr-canonical.mjs`); errors ≥400 carry none and `noindex, nofollow`; `X-Robots-Tag` mirrors the meta robots; the entity routes (flag-off in production) always render `noindex, follow`.

## 2. Indexation eligibility (existing policy, made explicit)

1. A URL is a sitemap candidate only if it is a **self-canonical, indexable 200**.
2. `/programas/:slug` is indexable while the programme resolves; the programme sitemap is limited to **tomorrow + today with a TMDB match, not suppressed, not generic**.
3. `/peliculas|/series/:slug` is indexable only with an airing in the lookup window; it is not submitted. The flip to `noindex` when the last airing passes is **existing, intentional, and left untouched**.
4. No `lastmod` unless it is a real change time (existing rule; M09 extends it to the sitemap index).
5. **New (M09, sitemap only):** a programme URL is listed only if the same resolver the page uses finds it and the item is consumer-visible. Page robots/canonical behaviour is unchanged.

## 3. Duplicate-URL audit

`scripts/seo-ownership-audit.mjs` (public API, paced under the 300 req/min limit, 722 sitemap slugs, `artifacts/m09/ownership-before.json`). A first pass ran unpaced, hit 429s and was discarded; only the paced run is reported.

| Class (per `/programas/:slug` in the sitemap) | URLs | Meaning |
|---|---|---|
| duplicate-indexable-twin | **563** (78 %) | **Proven**: `/peliculas/:slug` or `/series/:slug` resolves to the *same TMDB id* and has an airing, so it is also indexable. Two self-canonical indexable URLs for one work |
| tmdb-work-single-url | 40 | TMDB-matched, no same-id twin at that slug |
| programme-only | 48 | no TMDB identity (genuine programme pages) |
| unresolvable | **70** | 404 at audit time (the sitemap defect, §4) |
| twin-noindex | 1 | twin exists but has no airing (noindex) |

Only same-`tmdbId` matches count as duplicates; title similarity is not used. Not measured: twins published under a *different* slug, and Google's selected canonical (no Search Console). Observed asymmetry: the guide links the work pages (`/peliculas|/series`), the sitemap submits `/programas/`; the work page is not submitted and can flip to `noindex`. This is the conflict M09 leaves **untouched** (§6).

## 4. Sitemap correctness evidence

Production crawl before the fix (`artifacts/m09/crawl-before.json`, 840 sitemap URLs, 0 duplicates, 6 concurrent):

| Sitemap | URLs | 200 + self-canonical + indexable | Notes |
|---|---|---|---|
| static | 23 | 22 | `/canales` 503 once under load; fine on retry |
| channels | 82 | 81 | `/canales/clan` 503 once (4.2 s cold render) |
| programs | 722 | **652** | **70 × 404 `noindex, nofollow`** (51 have season/episode-marked slugs) |
| blog | 13 | 13 | |

Root cause of the 70: **not established** (no database access). Established: the sitemap builder and the page lookup disagree for a stable 10 % of rows. The page lookup returns the earliest airing of the title and then `getItem` answers 404 for a row that is not consumer-visible; the lookup itself never applies that rule, so one suppressed airing of an otherwise visible title is a plausible cause. The guard mirrors the whole page path, so it removes these URLs whatever the cause. If production still shows 404 destinations afterwards, the cause is elsewhere and the post-deploy re-crawl will show it.

Tests (all new, deterministic): `CatalogService.program-slug-resolves.test.ts` (valid today; tomorrow-only; unknown alias; empty slug never queries; suppressed/generic rejected; database failure propagates) and in `SitemapController.test.ts` (only resolvable slugs listed; a lookup failure surfaces as an error, nothing truncated is cached; index has no `lastmod`). Last-good fallback and worker cancellation are exercised by the same failing-lookup path.

## 5. Performance of the guard

`scripts/sitemap-programs-perf.cjs`, throwaway MongoDB 8, 22,000 airings over two days, 760 programme slugs, production indexes:

| | URLs | build | Mongo queries |
|---|---|---|---|
| without guard | 760 | 124 ms | 1 |
| with guard | 760 | 2.5 s | 2,281 (1 find, 1,520 `distinct`, 760 `findOne`) |

All lookups are served by `idx_tvread_search_tokens {searchTokens, date}` (IXSCAN → FETCH, 1,900 keys/docs for the token). The synthetic titles had two tokens each, so the loop ran twice per slug; real titles usually succeed on the first token. The cost is paid at most once per sitemap rebuild (6 h TTL or after an EPG rebuild, deduplicated in flight). Extra RSS is bounded by 722 strings; the 105 MB seen in the harness is the harness's own 22k-document seed. Failure behaviour: a failing lookup aborts the build, stops the other workers, and the last good sitemap is served; with no previous build the request errors rather than caching a truncated list.

## 6. Proposed, NOT active

| Proposal | Evidence | Risk | Decision |
|---|---|---|---|
| Make the work page (`/peliculas|/series`) the single canonical for programmes that resolve to a TMDB work, 301/canonical `/programas/:slug` to it | see §3 | Moves ~hundreds of indexed URLs; `/peliculas` is `noindex` when nothing airs, so a canonical to it would point at a page that can flip to noindex | **Needs a separate owner decision**; prerequisite is a stable (not airing-dependent) robots rule for work pages |
| Stable indexability for work pages (not airing-dependent) | `/peliculas/gladiator` was `noindex` on 2026-10-26 | Mass index change | Separate, evidence-based rollout (needs Search Console) |
| 301 for case variants (`/canales/LA-1`) | answers 200 with a lowercase canonical | negligible | optional |
