# M04 Delivery: hardening, acceptance and release of Sports v2

Branch: `feat/sports-v2-m04-release`. Companion documents: `FINAL-ACCEPTANCE.md`, `PERFORMANCE.md`, `SEO-VALIDATION.md`, `ROUTES.md`.

## Status (independent verdicts)

| Dimension | Verdict | Note |
|---|---|---|
| Engineering | **PASS** | 626 frontend tests, isolation, lint, build with budgets, backend type-check and affected suites |
| Functionality | **PARTIAL** | All journeys pass on real data; the product is bounded by the football-data.org free tier (no minute, events, lineups, venue; 4 of 13 standings) |
| Deployment | **PENDING** | filled in below after the release runs |
| Production verification | **PENDING** | filled in below after the release runs |

## 1. Architecture and product completion

Sports v2 is a self-contained Angular area (`apps/frontend/src/app/sports-v2`, 74 files, 0 legacy imports) on the existing football BFF (`/v2/sports/football/*`), SSR + hydration, route-level lazy. M04 mounts it as the football section at `/deportes/futbol/**` (the identity the legacy section had), unmounts the legacy `FOOTBALL_ROUTES` (the code stays in the repo until the cleanup change so the old experience is recoverable by revert), and adds the redirects and sitemap entries in `SEO-VALIDATION.md`. Changes outside `sports-v2`: `app.routes.ts` (mount), `app.config.ts` (blocking initial navigation), `ssr-server.mjs` (redirects, known routes), the football nav item, `SitemapController` (3 URLs), the editorial link rewrite (`en-directo` rule removed) and `FootballController` (date-range query from M03).

## 2-3. Visual and functional acceptance

See `FINAL-ACCEPTANCE.md`: 52 page loads (13 routes x 4 viewports) with 0 overflow, 0 console errors, axe-core 0 violations; 8 journeys; 9 defects fixed.

## 4. Real data coverage

See `FINAL-ACCEPTANCE.md`. Unchanged since M03 except that the date-range endpoint ships with this release.

## 5. Test execution evidence

| Check | Result |
|---|---|
| `npm run test -w apps/frontend` | 626 / 626 pass (625 + 1 new) |
| `npm run check:sports-v2` | OK, 74 files, 0 legacy imports |
| `npm run lint:frontend` | 0 errors (734 pre-existing warnings, none in `sports-v2`: `eslint sports-v2/**` clean) |
| `npm run lint:backend` (`tsc --noEmit`) | OK |
| `npm run build:ssr` (Angular budgets) | OK; initial 1.19 MB raw / 272.82 kB transfer |
| Backend `EditorialReviewPolicy` + `SitemapController` suites | 32 / 32 |
| Full backend suite, local Windows | 911 pass / 7 fail / 47 skipped. Failing: editorial runner, GeoIP (3), manifest reproducibility (2), owner-flow batch grant; all environmental (`tar` cannot resolve `C:` paths, database files), none football. Not compared with `main` locally. CI is authoritative |
| `scripts/ssr-cache.test.mjs` | 6 / 6 |
| Browser sweeps | `sv2-m04-qa.mjs`, `sv2-journeys.mjs`, `sv2-mobile-nav.mjs` (evidence in `evidence/m04`) |

## 6-8. Performance, accessibility, SEO

`PERFORMANCE.md` (CLS 1.25 -> 0.006 after fixing a re-render on hydration; page cost), `FINAL-ACCEPTANCE.md` (accessibility), `SEO-VALIDATION.md`.

## 9. Git, PR and release identifiers

_PENDING: filled in after the PR is opened and merged._

## 10. Deployment and rollback

Production deploys on merge to `main` once the CI job "Build, test, and performance budgets" is green for that push (`deploy-artifact.yml`, owner decision 2026-11-05; the host builds nothing, deploys the exact CI-built commit and smoke-tests `/deportes/futbol`). Databases are not touched: the release changes only the frontend bundle, `ssr-server.mjs`, one read-only controller parameter, the sitemap list and an editorial link rewrite; no migration, no `BOOTSTRAP_DB`.

Rollback: revert the merge commit on `main` (the revert deploys by the same path), or, on the host, the RUNBOOK "Rollback" procedure (check out the previous commit, build, restart `guiatv-api` and `guiatv-ssr`; requires server access, which this session does not have). The legacy football code is still in the repository, so a revert restores the old section and its URLs.

_PENDING: deployment run, release identifier and live smoke results are recorded below after the release._

## 11. Remaining non-blocking limitations

Listed in `FINAL-ACCEPTANCE.md` and `SEO-VALIDATION.md`. In short: provider-capped data, no real live match observed, monogram crests, no manual keyboard/screen-reader pass, Chromium only, thinner editorial content than the legacy pages, stale legacy e2e specs, a residual double creation of the shell before first paint.
