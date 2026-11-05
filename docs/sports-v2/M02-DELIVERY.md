# M02 Delivery: Complete football product experience

Branch: `feat/sports-v2-m02-football-experience` (from `main` at `8fe95a2f`). Preview: `/laboratorio/futbol/**` (noindex). Not pushed; no PR opened yet.

## Verdict: PASS for the interaction model on demo data. Not production-ready until M03 supplies real data.

Every screen is a real routed Angular component driven by one store; there are no static mockups or placeholder links. All data is fictional demo data, labelled as such in the UI.

## Screens

| Screen | Route | Notes |
|---|---|---|
| Home | `/` | Live now (cards), today, My teams, favourite competitions, important upcoming, recent results, personalised news. Anonymous users get empty states with follow suggestions |
| Live scores | `/en-directo` | Grouped by competition, minute/status, filter by competition or "Mis equipos" (URL params) |
| Fixtures / Results | `/partidos?dia=`, `/resultados` | Day strip, prev/next, date jump, "next day with matches", time zone stated ("hora de Madrid (CET)") |
| Competition | `/competiciones/:slug?tab=` | Overview, fixtures, results, standings, teams, news; follow button |
| Team | `/equipos/:slug` | Identity, league position (only for league competitions), next match, results, fixtures, table, news, follow |
| Match Center | `/partido/:slug?tab=` | Desktop: contextual sidebar with "full screen" link; tablet: drawer; mobile: dedicated full screen (top bar and tab bar hidden). Tabs: Resumen (timeline, competition context, related), Estadísticas, Alineaciones, Dónde verlo |
| Standings | `/clasificaciones[/:slug]` | #, PJ, G, E, P, DG, Pts; zones/legend only when `competition.zones` is supplied; mobile hides G/E/P |
| News | `/noticias`, `/noticias/:slug` | Featured lead, editorial cards, article with author, date, links to team/competition/match |
| Search | top-bar combobox + `/buscar?q=` | Teams, competitions, fixtures, news over loaded data only; arrows/Enter/Esc; empty and short-query states |
| My Football | `/siguiendo` | Followed teams, favourite competitions, saved fixtures, suggestions |

Route details are in `ROUTES.md`.

## Architecture changes (M01 structure kept)

- Domain gained standings, zones, articles, rounds; `FootballData` gained `source: 'demo' | 'live'` (drives the demo banner). `SportsSnapshot` now carries standings and news bodies.
- `FollowStorage` port with `BrowserFollowStorage` (localStorage, SSR no-op, tolerant of corrupt data) and an in-memory test adapter. Follows are restored in `afterNextRender` so server and client markup match.
- Demo fixtures are generated relative to an injectable clock (`SPORTS_NOW`) and slugs are `<home>-<away>-<YYYY-MM-DD>`.
- New primitives: match row (fixed-width score and clock cells, so no layout shift), follow button, tabs (WAI-ARIA), article card. `section-page`, `news-list` removed.
- Filters, day and tab live in the URL; `Sv2Viewport` makes match selection open the full page on mobile and the sidebar elsewhere.

## Evidence

- Frontend suite: **549 SUCCESS** (462 before M02). 87 new tests: calendar, demo-data integrity (scores vs events, standings arithmetic, zones), store, UI components, and 50 route-level flow tests covering every navigation path above.
- `npm run check:sports-v2`: 63 files, 0 legacy imports. ESLint on `sports-v2/**`: clean.
- `npm run build:ssr` passes; initial bundle unchanged at 1.19 MB. Production SSR server returns 200 for all 11 sampled routes, content in server HTML, `X-Robots-Tag: noindex, follow`.
- Screenshots (`evidence/m02/`, 13 pages x mobile 390 / tablet 768 / desktop 1440, plus desktop sidebar), produced by `apps/frontend/scripts/sv2-screenshots.mjs`. Script check: zero horizontal overflow on every page and zero console errors.

## Defects found and fixed during this milestone

1. `DatePipe('es-ES')` threw without registered locale data → replaced by `Intl` helpers.
2. The "Todos" chip fired two URL updates that overwrote each other → single reset event.
3. Independent review (below): Back leaving the app after tab changes (query-only navigations no longer count), selected day chip clipped on mobile (scrolled into view), search list closing before click in Safari (mousedown no longer steals focus), impossible dates like `2026-02-31` accepted, `?seguidos=1` with no follows showing an empty list (filter ignored), `aria-pressed` misused for "selected" (now `aria-current`), Match Center tabs clipped on mobile (wrap), no demo marker in the sidebar (added).

## Independent review

A separate reviewer read the code and screenshots without running them. Of its 10 findings, the fixes above were applied and the test suite re-run (98 sports-v2 tests pass after the fixes). Not fixed, by decision:

- Results has no day navigation (it lists finished matches grouped by day, newest first). The time-zone label is computed once from "now" and could be wrong when browsing across a DST change.
- Tablet drawer is not a modal: no focus trap, no focus restore.
- Live scores and "today" do not update after load; tracked matches are not persisted.
- Editorial `image.alt` is dropped (art is decorative until licensed images exist).
- The fixes were not re-screenshotted after review; the mobile date strip and tab wrapping are verified only by reasoning and tests.

## Needs M03 (backend)

- HTTP adapter with scoped endpoints (day range, competition, team, match, standings, news, search); today everything loads as one snapshot.
- Live updates (polling/SSE) and a ticking clock.
- Real standings, verified zone rules, crests/licensed images, real broadcast data from `BroadcastReconciliationService`.
- Account-backed follows (currently device-only).
- Canonical/meta/structured data and the cutover from `/laboratorio/futbol` (not started, per brief).

## Not verified

No axe-core or screen-reader run; no cross-browser run (Chromium only); no keyboard-only walkthrough beyond the unit-tested tab and combobox behaviour.
