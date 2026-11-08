# M06-R1 — Verification environment: what can and cannot be executed here

Captured 2026-11-06 by the captain. This file exists because a verification that could not be run must
never be reported as a verification that passed.

## 1. Gates that WERE executed against the integrated code (real exit codes)

Commit `f28c89ef` (+ `880b6a61`) on branch `feat/m06-r1-recovery`.

| Gate | Command | Result |
|---|---|---|
| Backend typecheck | `tsc -p apps/backend/tsconfig.json --noEmit` | **exit 0** |
| Backend full suite (no Mongo) | `node scripts/m06-r1-run-backend-suite.mjs` | 1150 tests / **1084 pass** / 11 fail / 55 skipped |
| Backend full suite (with real Mongo) | `TEST_MONGO_URI=mongodb://127.0.0.1:27018 …` | 1230 tests / **1195 pass** / 29 fail / 6 skipped |
| Baseline, same code path, Mongo enabled | same runner on `f020ea82` | 1198 tests / 1163 pass / **29 fail** |
| Regression diff vs baseline (both modes) | identity comparison of failing test names | **0 new regressions**, +32 tests, +32 passing |
| Sports V2 isolation | `node apps/frontend/scripts/check-sports-v2-isolation.mjs` | **exit 0** — 88 files, 0 legacy imports |
| Frontend typecheck (app/spec/server) | `tsc -p apps/frontend/tsconfig.{app,spec,server}.json --noEmit` | **exit 0** (before the incident in §3) |
| Frontend lint (eslint) | `eslint "src/**/*.ts" "src/**/*.html"` | 6 errors, all in files **not touched** by M06-R1 (`sports-v2/ui/match-lineups.ts`, `match-statistics.ts`, from commit `707178f4`); **0 errors** in any M06-R1 file |

## 2. The 11 / 29 failures are pre-existing and not football

The same 11 (no Mongo) and the same 26–29 (with Mongo) failing tests fail on the **unmodified review
HEAD** `f020ea82` with the same runner and same database. Their modules are content-identity, sitemap,
editorial, content-canary and content-certify — nothing in football, sports ingest or the admin API.
Causes observed: `spawnSync … EPERM` (the sandbox denies child process piping) and content-identity
tests that need a replica set / specific fixtures.

Enabling Mongo activated tests that the baseline had skipped; because the local `mongod` is a
**standalone** server (`setName: null`, so no transactions), a subset of those new activations cannot
pass here. That is an environment property, not a product regression, and it is proven by the baseline
run producing the identical failure set.

## 3. What could NOT be executed, and why

| Gate | Status | Cause |
|---|---|---|
| Karma (`ng test`) | **NOT RUN** | Karma cannot spawn ChromeHeadless: `spawn EPERM` |
| Angular production SSR build | **NOT RUN** | `@angular/build` spawns esbuild over a pipe → `spawn EPERM`; then `@angular/build-angular/builders.json` is missing from the installed package in this checkout |
| Real-browser Playwright acceptance | **BLOCKED** | It depends on the SSR build above producing a servable bundle |
| Frontend typecheck re-run after a dependency-layout change | **DEGRADED** | The worktree's `apps/frontend/node_modules` junction was replaced during troubleshooting and the directory is now ACL-locked (`Acceso denegado`), so `@angular/forms` no longer resolves (34 TS2307). The **backend** is unaffected (typecheck still exit 0), and the frontend typechecked clean **before** that change. |

The M06 effort spent significant time trying to restore the frontend dependency layout inside this
sandbox; the write/delete denial (`Todos:(DENY)(DC)`, delete-child) makes the junction impossible to
repair from inside the confined workspace. A fresh `npm ci` in a clean checkout, or running the
frontend gates on the CI runner, is the correct place for these three gates.

## 4. Consequence for the verdict

- **Backend engineering, data honesty, data integrity, provider acquisition, security-boundary
  behaviour:** verified by executed tests with real exit codes and real MongoDB.
- **Admin UI functionality in a real browser:** **NOT verified here.** The code is typechecked and
  wired to verified-correct endpoints, and the endpoints themselves were exercised live with real
  data (see `docs/sports-v2/M06-R1-F01-ROOT-CAUSE.md`), but "the user clicks through eight screens in a
  browser and sees real data" remains **unproven**. It must be recorded as such.
- No claim in the delivery report may upgrade these three unexecuted gates to PASS.
