# Sports v2: final acceptance (M04)

Evidence: `docs/sports-v2/evidence/m04/` (`qa.json`, screenshots, `journeys-verify.json`) and the scripts in `apps/frontend/scripts/` (`sv2-m04-qa.mjs`, `sv2-journeys.mjs`, `sv2-mobile-nav.mjs`). Everything was run on the production SSR build with the **real production API** (read-only), before deploy.

## Verdicts

| Area | Verdict | Basis |
|---|---|---|
| Engineering | **PASS** | Frontend 626/626, `sports-v2` isolation 0 legacy imports (74 files), ESLint 0 errors, `build:ssr` with budgets OK, backend `tsc` OK, affected backend suites 32/32. Local full backend run: 911 pass, 7 fail, 47 skipped; the 7 are editorial-runner/GeoIP/manifest tests (Windows `tar` path and database-file issues), none touch football; not re-run on `main` locally, CI (Linux) is the authority. |
| Functionality | **PARTIAL** | Every journey passes on real data; product is limited by what the provider supplies (below). |
| Visual | **PASS** (lab) | 13 routes x 390/768/1440/1920 = 52 loads: 0 horizontal overflow, 1 `h1` and 1 `main` each, 0 console/page errors, screenshots reviewed (mobile home, desktop match, wide home). |
| Accessibility | **PARTIAL** | axe-core (WCAG 2.0/2.1/2.2 A+AA tags) **0 violations on all 52 loads**; no screen reader or keyboard-only manual pass. |
| Deployment / production verification | see `M04-DELIVERY.md` | |

## Defects found and fixed in M04

1. **Whole-page re-render after hydration** (CLS 1.25 on every v2 route; reproduced on the live legacy pages). Fixed by blocking initial navigation. See `PERFORMANCE.md`.
2. **Provider outage returned HTTP 200** with an error shell on indexable URLs. Now 503 + Retry-After + noindex (verified with the API pointed at a dead port; no invented scores in the HTML).
3. **"Seguir en directo" offered on finished matches.** Now only for scheduled/live matches.
4. **Not-found pages had no `h1`.** The empty state used as a whole page is now the `h1`.
5. **Interactive targets under 24x24 CSS px** (WCAG 2.5.8): section links, competition links in match headers/lists, breadcrumb, "Ver clasificación" links now have a 24 px minimum block size.
6. **Live score changes were silent for screen readers.** A polite, atomic live region announces "Marcador actualizado: ..." for scores that change while the page is open (not for the first load). Unit-tested.
7. Generic or missing descriptions and "(vista previa)" titles on the main pages; per-page descriptions added.
8. The preview was noindex and under `/laboratorio`; cutover performed (see `SEO-VALIDATION.md`).
9. Stale `partidos-hoy`/`en-directo` references in the nav config, sitemap, editorial link rewrite and one SSR cache test.

## Journeys (real data, Chromium)

| Journey | Result | How |
|---|---|---|
| A. Home -> today's fixtures -> match -> details | PASS | QA sweep + route-level flows (50 specs) |
| B. Competition -> standings -> team -> fixtures | PASS (mobile) | `sv2-mobile-nav.mjs`: Brasileirão -> team Flamengo |
| C. Follow team -> reload -> persists -> personalised home | PASS | `sv2-journeys.mjs` |
| D. Search -> correct page | PASS | keyboard search "SE Palmeiras" -> `/equipos/se-palmeiras` |
| E. Broadcaster information | PARTIAL | The tab renders and states evidence or "Emisión no confirmada". The probe assertion was loose (matched the page text, not a specific channel line); no Spain-specific broadcast verified on real data. |
| F. Mobile navigation | PASS | bottom bar: Inicio, En directo, Partidos, Competiciones, Noticias, one `h1` each |
| G. Provider unavailable | PASS | 503/noindex on SSR; client shows "Reintentar"; no score-like text |
| H. Live tracking without reloads | PASS with a mock | The only mocked endpoint is `/matches/live` (no real live match on demand): the match moved to live 1-0 in place; 0 polls in 120 s hidden; 4 extra calls in 30 min of failure; stale line kept the last score |

Time zone: the same real 23:30Z match renders 23:30 for Madrid and 07:30 for Tokyo, zone stated.

## Audit results

- No legacy import in v2 (isolation script). `portal-navigation.config` is the single allow-listed pure-data read.
- Dead links: none found in the 52 loads; every in-app link comes from `sv2Link`/`sv2Path`. The legacy `FOOTBALL_ROUTES` is no longer mounted.
- Mock/demo data in production: none. The demo adapter is provided only by tests (`store.isDemo` shows a banner if it were ever used).
- Broadcasters: shown only with evidence (EPG, editorial override, high-confidence reconciliation); medium/low are dropped in the mapper (unit-tested).
- Exposed identifiers: URLs and text use slugs/names only.
- Duplicate identities: one URL per page; filters/tabs/days are not canonical; articles canonical to `/guias/:slug`.
- Dependencies: v2 adds none (the QA scripts use `playwright` and `@axe-core/playwright`, already dev dependencies).

## Real data coverage (measured 2026-11-05, see M03)

Fixtures (today on production until the backend range endpoint ships in this release), status and score: yes. Live minute: no. Events, statistics, lineups, venue: no (provider free tier; the UI says so). Standings: 4 of 13 competitions. Broadcasts: partial (EPG-dependent). News: 3 CMS guides, none tagged to teams/competitions, so no team/competition news links yet.

## Remaining non-blocking limitations

- The 9-day fixtures window has not been exercised against the real provider; it falls back to today's matches if rejected.
- No real live match was observed; real minute/half-time behaviour is untested.
- Crests are monograms (licensing unresolved).
- Keyboard-only and screen-reader manual passes are not done; the claim is axe-clean plus the pieces above, not WCAG 2.2 AA conformance.
- Browsers: Chromium only.
- Legacy e2e specs under `e2e/specs/` that target the old football DOM (`football.spec.ts` and football parts of `navigation-unification`, `responsive`, `visual-qa-phase3`, `m08-experience`) are not run in CI and are stale after the cutover; to be replaced with v2 specs in the cleanup change.
