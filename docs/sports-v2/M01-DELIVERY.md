# M01 Delivery: Architecture, design system and application shell

Branch: `feat/sports-v2-m01-shell` (cut from `main` at `42498cf2`). Preview URL: `/laboratorio/futbol` (noindex).

## Verdict: PASS, with the caveats listed under Risks

| Gate | Evidence |
|---|---|
| New UI independently implemented | 30 new files under `apps/frontend/src/app/sports-v2/`, all written from scratch |
| No legacy sports UI dependency | `npm run check:sports-v2` → `sports-v2 isolation OK (30 files, 0 legacy imports)`: sports-v2 imports only `@angular/*`, `rxjs`, itself; no legacy file references it except the one route |
| Desktop and mobile shells work | Screenshots in `evidence/` (desktop, tablet, mobile, mobile Match Center); mobile `scrollWidth == clientWidth` (no horizontal overflow) |
| Navigation functional | Sidebar, tab bar, search, chips and cards navigate client-side; titles update (`En directo · Fútbol (vista previa)`) |
| SSR build passes | `npm run build:ssr` exit 0 (only pre-existing socket.io CommonJS warnings); initial bundle 1.19 MB, under the 1.35 MB warning budget; shell is a lazy chunk |
| SSR serves it | Production `scripts/ssr-server.mjs` returns 200 for 4 sampled preview URLs, `X-Robots-Tag: noindex, follow`, `<meta robots noindex, nofollow>`, content present in server HTML |
| Production unaffected | `/deportes/futbol` still 200 `index, follow`; full frontend suite 462/462 pass |
| Lint | `eslint src/app/sports-v2/**` clean under the repo's config (selectors use the required `app-` prefix) |
| Reviewed against the reference | See "Reference review" in `DESIGN.md` |

## Test results

- `ng test --watch=false --browsers=ChromeHeadlessNoSandbox`: **462 SUCCESS** (11 new: store behaviour, tracked-match cap, accent-insensitive search, slug-only links, clock/aria helpers, shell landmarks, Match Center content, sidebar collapse, tracker visibility).
- Not run: backend tests (untouched), Playwright e2e, axe-core scan (see Risks).

## Files changed

New: `apps/frontend/src/app/sports-v2/**` (domain, data, state, ui, shell, pages, styles, routes, 2 spec files), `apps/frontend/scripts/check-sports-v2-isolation.mjs`, `docs/sports-v2/*.md`, `docs/sports-v2/evidence/*.png`.

Modified legacy files (3, all minimal):
- `apps/frontend/src/app/app.routes.ts`: +6 lines, one lazy `laboratorio/futbol` route (noindex, `minimal-shell`).
- `apps/frontend/scripts/ssr-server.mjs`: +2 allow-list lines (`KNOWN_ROUTES`, `NOINDEX_ROUTES`). Without them the production SSR server answers 404 for any unlisted path.
- `apps/frontend/package.json`: +1 script `check:sports-v2`.

Unrelated working-tree changes (editorial pipeline, root `package.json`, etc.) were left untouched and are not in this commit.

## Architecture decisions

See `ARCHITECTURE.md`. Short form: isolated folder + one lazy route; CSS custom-property tokens scoped to the shell (no Tailwind); domain → data port → signal store → presentational UI; demo adapter behind an abstract `FootballData`; slug-only URLs.

## Issues found and fixed during verification

1. A `.collapse` class collided with a global `visibility: collapse` rule from the legacy stylesheet and made the sidebar toggle invisible. Renamed. Lesson for M02: legacy global CSS is still loaded, so avoid generic class names (consider a `sv2-` class prefix inside component styles).
2. The off-canvas Match Center caused page-level horizontal scroll; the shell host now clips it.
3. Horizontal rows pushed the main column wider than its panel; grids now use `minmax(0, 1fr)`.
4. Match Center tabs clipped at 360px; now a 2×2 grid.
5. Followed-team names leaked into the 72px tablet rail; names now hide via a CSS variable.

## Risks

- **Accessibility is not machine-verified.** Contrast was computed from tokens, keyboard behaviour was implemented and the tablist/skip link/landmarks are covered by unit tests, but no axe-core or screen-reader pass was run.
- **Legacy global CSS leaks in** (see issue 1). `minimal-shell` removes the legacy chrome but `styles.scss`/Tailwind utilities still apply.
- **Console shows 5 `502` errors** for `/storage/channel_icons/*.webp` in local runs. They come from the legacy `index.html` preloads with no backend running, not from sports-v2.
- **Demo data only.** Names, scores and players are fictional; monogram badges stand in for crests pending licensing.
- Followed teams/favourites are in-memory defaults (not persisted); news cards are not links yet.
- The `ssr-server.mjs` allow-list is a second place that must change at cutover.
- Screenshots were taken with the Playwright browser against the local production SSR build, not against a deployed environment.

## Handoff to M02

Goal: replace the demo adapter with real data and make the pages meaningful, without touching UI primitives.

1. Implement `HttpFootballData extends FootballData` in `sports-v2/data/` against the existing public football API (read `apps/backend/src/application/sports/services/FootballQueryService.ts` and its routes for contracts; map to `domain/models.ts`, adding fields there only when the API provides them). Keep fixtures in `demo-fixtures.ts` for tests and switch the route provider in `sports-v2.routes.ts` by environment.
2. Add loading by date range and per-competition/team/match detail endpoints; move `SportsStore.load()` from "everything" to scoped loads; keep the selected-match logic.
3. Real slugs and canonical identity: derive match slugs `<home>-<away>-<YYYY-MM-DD>`; verify against `ROUTES.md` cutover rules; add `Meta`/canonical handling per page while the preview stays noindex.
4. Real broadcast data from `BroadcastReconciliationService` into the "Dónde verlo" tab.
5. Persist followed teams/favourites (reuse the existing auth/profile API; no legacy UI).
6. Add axe-core and keyboard Playwright checks for `/laboratorio/futbol/**` (the repo already has `@axe-core/playwright`).
7. Namespace component CSS class names to avoid legacy global collisions.

Do not start cutover (`/futbol/**`, redirects, sitemap) in M02; that needs a parity milestone.
