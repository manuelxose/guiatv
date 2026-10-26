# M08 — global product experience

Date: 2026-10-23 (Europe/Madrid). Baseline `main@2aa7389`, canonical repository `manuelxose/guiatv`, no open PRs. Production preflight confirmed release `20261023142416`, code `da9ec11`, API/SSR active with zero restarts; activation flag-name inventory empty in both service env files. No production data writes or flag activation are part of M08.

## Implementation

- A, [PR #73](https://github.com/manuelxose/guiatv/pull/73): mobile global search is a focus-trapped dialog with Escape/trigger restoration and resize/destruction cleanup. Shared breadcrumbs separate compact placement from constant-dark hero colors; channel/entity/catalog callers retain their proper context. Active mobile tabs, channel discovery CTA and discovery labels reuse readable existing theme tokens.
- B, [PR #74](https://github.com/manuelxose/guiatv/pull/74): competition name/country filtering, counts and reset; live/halftime summary; recoverable empty match filters; responsive calendar and standings; consistent child-page containers; readable provider/standings sidebars. Classification links select the actual classification tab, including subsequent fragment navigation. Existing APIs, caches and verified facts remain authoritative.
- C, [PR #75](https://github.com/manuelxose/guiatv/pull/75): immediate cancellation of obsolete typeahead requests, empty-result Enter/Escape, dismissal that survives pending responses, keyboard selection scrolling, clear/focus behavior and accessible loading/empty states. Verified detail paths are retained; TMDB entries without one are omitted. Auth entry controls have readable contrast and registration copy describes user benefits.

No new design system, dependency, route, metadata/indexation policy or search endpoint. Existing M05/M07 components and navigation architecture are reused.

## Independent work and review

Navigation engineer owned shared header/breadcrumb/page styles; football engineer owned only the football feature and its existing e2e; search engineer owned only unified-search and its existing e2e. Integrator owned cross-feature browser checks, auth contrast, evidence, roadmap and release. File ownership avoided edit conflicts.

Search engineer independently reviewed football and shared navigation/auth/QA; football engineer independently reviewed search. Reviews found no significant issues; observed real-page accessibility defects were corrected before the release gate. Ponytail full, Serena, installed design/review skills and existing Playwright/axe tooling were used. Context Mode and Graphify tools were unavailable; bounded searches and Serena were used without building a graph.

## Evidence and gates

- `artifacts/m08/capture.mjs`: reproducible, read-only 375/768/1280/1440 × light/dark matrix for home, TV, channels, discovery, movies, series, football/home/competitions/matches, editorial, signed-out profile, login and registration. Records screenshots, axe WCAG AA, overflow, browser/5xx errors, canonical/robots and three SSR request timings.
- `e2e/entity/m08-experience.spec.ts`: deterministic real-SSR competition filtering, actual mobile focus loop/Escape/resize behavior and theme/width/axe coverage, with isolated test fixtures. Existing M05/M07 and entity suites remain release gates.
- `artifacts/m08/measure.mjs`: initial referenced JS/CSS bytes, public health/robots/sitemap/redirect checks. Initial asset sizes exclude lazy chunks/images; request timings are lab/network observations, not field Core Web Vitals.
- Initial `before/` and `candidate/` reports changed themes in place and could record colors during transitions. They are diagnostic history, not contrast acceptance evidence. `before-settled/`, `candidate-final/` and `after/` persist the theme and reload before scanning. `before-auth/` also uses settled themes. The first broad scan stopped at signed-out profile because that view has no visible h1; the recorder now captures that state without requiring one.
- Angular initial full integration: 336 passed. Application/spec TypeScript and backend strict checks passed. Frontend lint: zero errors, 697 existing warnings. Relevant backend detail/path/identity tests: 22 passed, one Mongo-dependent skip. SSR/cache/canonical tests: 23 passed. First integrated entity/M05/M07/M08 Playwright: 37 passed, three duplicate-matrix skips. Final post-polish runs and CI results are recorded below when observed.

## M06 remainder and M09 handoff

M05 already supplies work-level series detail, verified broadcasts, honest empty states, and no whole-series runtime. M07 preserves verified programme/channel destinations. Backend `detailPath`/`CatalogService` recognize high-confidence episode titles to resolve the work; guide/search prefer verified paths or the known programme ID.

Still missing: dedicated season/episode routes, a public season/episode DTO and season/episode discovery/detail UI. Neither `app.routes.ts` nor the public catalog/entity contracts expose them. EPG films categorized as Series and historical identity remediation remain the separately recorded data-quality follow-ups; M08 does not rewrite production records or pretend M05 completed episode infrastructure. The M08 request explicitly authorizes proceeding while recording these bounded gaps.

M09 next action: establish canonical ownership and sitemap/indexation policy for the existing movie/series/programme URLs, using the preserved SSR invariants and actual airing-dependent noindex behavior. Do not create thin season/episode routes to satisfy a checklist.

## Release status

PARTIAL — implementation and initial checks complete; final combined validation, required CI, merges, artifact deployment and post-release evidence pending. Do not read this draft as production acceptance.

## Final candidate gate (before deployment)

- Shared PR #73 merged as `5662db0`; football PR #74 merged as `ee4dd9e`, each after independent review and green `verify` / `ssr-resilience`. Search/final-polish PR #75 remains gated.
- Candidate matrix: **104/104 cells** (13 surfaces × four widths × two themes), zero axe violations, zero overflow and zero page errors. Baseline had serious contrast violations in **45/104 cells**. `candidate-acceptance.json` merges the unchanged broad surfaces with the final targeted polish scan; original reports remain local diagnostic evidence.
- Football children: **12/12** combinations pass, zero axe/overflow/page errors. Browser geometry and manual screenshots confirm both mobile teams remain visible, kickoff is time-only Madrid, and a fresh SSR classification link renders exactly one standings table. `football-child-final-qa.json` and its reusable capture script retain the verified link sources.
- Final real-data football/search journeys: **17 passed**. Public-shell mobile menu/focus/theme/width checks **4 passed**; admin shared-shell regression/axe **4 passed**; mocked register/login-to-profile journeys **2 passed** (no real account writes). Navigation failures were obsolete expectations for rounded contextual navigation and a fixed commercial-label string; updated checks assert the existing flat design, nonempty accessible provider names and the same canonical destinations; **5 recovery tests passed**.
- Deterministic entity/M05/M07/M08 browser suite **38 passed, four duplicate-matrix skips** before the final targeted football fixes; subsequent relevant football browser and unit checks pass. Full Angular **337 passed** before the two new scoreboard formatter regressions; those two and the final nine competition-detail regressions also pass. CI runs the full final tree.
- Direct SSR status/canonical/robots-meta/header parity passes on **13 routes** (`seo-parity.json`). The signed-out profile briefly exposes shell metadata during browser initialization; raw SSR parity is checked independently rather than accepting an early client snapshot as a metadata change.
- Initial referenced JS/CSS/module-preload bytes: **719,543 → 739,058** (+19,515; +2.71%). Budgeted production initial bundle remains about **1.12 MB** against a **1.5 MB** error budget. No new dependencies or API calls. These asset bytes exclude lazy chunks and images; local SSR timings cannot be compared directly with production network timings.
- Existing production issue retained as bounded debt: five `/storage/channel_icons/{la_1,la_2,antena_3,cuatro,telecinco}.webp` resources return 503 before M08; existing visual fallbacks handle them. Local proxy telemetry/affiliate 503s appeared during earlier concurrent rebuilds, so production post-release checks must distinguish these from the unchanged icon baseline. No browser runtime exception was observed.
