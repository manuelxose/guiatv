# M06 — Independent review

Reviewer: **Codex `gpt-6.1-terra`, reasoning effort `medium`** (`subagent_codex_61_terra`), a different
model family from every implementer (DeepSeek). The reviewer wrote none of the code under review.

| Item | Value |
|---|---|
| Branch | `feat/sports-v2-m06-integration` |
| Commit reviewed | `e2dd4bb48a58d0dc01428059cfc4d16604079bf8` |
| Date | 2026-11-06 |
| Verdict | **Production readiness: BLOCKED** |

This file is a faithful record of the reviewer's own output. Where the reviewer's output is
reproduced, it is not edited. The reviewer could not write this file itself (its sandbox denied the
worktree path), so the captain persisted its verbatim report; that is a transcription, not an editorial
pass.

Two earlier independent-review attempts were refused rather than fabricated:

- `subagent_claude_code_sonnet_55` — Bash/Read/Glob denied by session permission mode. Wrote nothing.
- A second Codex attempt (`sol`) — could read (confirmed HEAD, isolation check exit 0) but
  `npm run build` failed writing `dist/` (`TS5033 EPERM`); sandbox permits writes only under
  `guiatv`, not the reviewed worktree. Wrote nothing.

Both refusals are recorded here because a review that was not produced must never be reported as a
review that passed.

---

## 1. Scope and execution (reviewer's account)

Reviewed branch `feat/sports-v2-m06-integration` at commit `e2dd4bb4`, on 2026-11-06. Inspected the
ingestion factory and tick, provider admission, snapshot identity and persistence, admin services and
routes, frontend admin data service, public provider wiring, SSR configuration, deployment workflow,
and the saved browser-pass evidence.

| Command | Independently observed result |
|---|---|
| `git rev-parse HEAD`, `branch --show-current`, `status --short` | Commit, branch and artifact changes confirmed |
| `node scripts/run-tsc.mjs` | **Exit 0**, no output |
| `node apps/frontend/scripts/check-sports-v2-isolation.mjs` | **Exit 0**: `sports-v2 isolation OK (86 files, 0 legacy imports)` |
| Backend compiled suite | **Exit 1**: 198 test-file launches, 0 passed, 198 failed at worker creation with `spawn EPERM` — infrastructure failures, not 198 demonstrated test failures |
| `npm run test -w apps/frontend` | **Exit 1**: Karma could not spawn ChromeHeadless (`spawn EPERM`); claimed 699 successes unverified |
| Named backend failures ×3 in isolation | content-certify: 0/1 three times (`null !== 0`); editorial runner: 1/2 three times (`spawn EPERM`). Neither establishes the claimed Windows file-mode cause or load flakiness |

The claimed **1117 / 1066 / 2 / 49** backend totals therefore remain **unverified by the reviewer**.

---

## 2. Attack results

Verdicts marked **PARTIAL** mean the code has relevant defenses or a plausible issue, but the attack was
not fully exercised end to end.

| # | Attack and observation | Verdict |
|---|---|---|
| 1 | `ProviderSelector` uses `assertEligible`, but the production ingestion factory constructs `OpenLigaDbAdapter` directly (`factory.ts:63`). Changing its registry entry to blocked would not gate this path. | **VULNERABLE** |
| 2 | With Mongo connected the factory passes `DurableRequestBudget` and `MongoLock`. Constructed without a ready connection it silently selects process-local budget and lock (`factory.ts:94`). No live two-worker test possible. | **PARTIAL** |
| 3 | Upsert keyed on `(canonicalKey, providerId)` with a unique index, but identity changes when a match slug changes; collision resolution depends on batch order. A restart/reschedule can leave an additional snapshot. | **VULNERABLE** |
| 4 | `anySuccess` is set before the empty check, so an all-empty run is recorded as success with `lastSuccessAt` and health `ok` (`FootballIngestionService.ts:272`, `:336`). | **VULNERABLE** |
| 5 | Coverage projection returns static provider support plus a separate observed snapshot count (`FootballAdminService.ts:132`); UI also returns a static matrix. Displayed wording claiming observed completeness not established. | **PARTIAL** |
| 6 | `seenSlugs` is local to one `buildSnapshots` call; the first match gets the bare slug. Different batches or reversed ordering can overwrite or reassign identities (`snapshots.ts:81`). | **VULNERABLE** |
| 7 | Goals without `goalID` are dropped and an absent goals array becomes `[]` (`OpenLigaDbAdapter.ts:289`). Stable IDs retained when present; no live payload comparison possible. | **PARTIAL** |
| 8 | Absent overview counts become zero (`football-admin-data.service.ts:146`); no database in `durableQuota()` returns zero consumed and enabled (`FootballAdminService.ts:58`). Presents unavailable information as measured values. | **VULNERABLE** |
| 9 | Old admin routes use `adminAccessGuard`; new routes use a fail-closed shared-key guard (`analyticsAdminGuard.ts:20`). No live unauthorized request executed. | **PARTIAL** |
| 10 | No provider credential or keyed URL found in these paths. Not a repository-wide secret scan. | **PARTIAL** |
| 11 | Manual sync awaits `runTick()` but marks the job completed regardless of a `failed`/`skipped` outcome (`FootballAdminService.ts:314`). Idempotency is a separate read-then-create, so concurrent identical requests can race. | **VULNERABLE** |
| 12 | Native buttons and labels exist; keyboard, screen-reader, focus, contrast and responsive accessibility not exercised. | **PARTIAL** |
| 13 | Eight sections render error states after old-API 500s. Routes exist, but the console fails its data task. | **VULNERABLE** |
| 14 | Public football falls through to `RenderMode.Server` (`app.routes.server.ts:32`). No rendered HTML, metadata or crawler response verified. | **PARTIAL** |
| 15 | Both suites returned nonzero on spawn failure; neither falsely reported success. A successful zero-test CI run was not simulated. | **PARTIAL** |
| 16 | Manual sync creates an operation (actor, correlation ID) and an operational event as separate writes; completion is not a separate event. Not all mutation boundaries traced. | **PARTIAL** |
| 17 | A successful CI run for a push to `main` automatically starts production deployment (`deploy-artifact.yml:11`). A merge can deploy without separate release approval. | **VULNERABLE** |

---

## 3. Findings

| ID | Severity | Evidence | Required fix and verification |
|---|---|---|---|
| **F01** | **Blocker** | `football-admin-data.service.ts:54`, `routes/index.ts:135` — the eight sections call legacy projections instead of the new admin API; saved pass records 500s | Wire real endpoint contracts and compatible server-side authorization; prove all eight sections and sync against populated snapshots incl. error states; capture server exceptions for the 500s |
| **F02** | **Blocker — disclosed** | `M06-FREE-DATA-RESEARCH.md:131` — exact ODbL attribution text not captured | Obtain authoritative attribution requirements, implement them, verify release placement and database obligations |
| **F03** | **High** | `FootballIngestionService.ts:272` — empty responses set aggregate success before the empty branch; run schema also excludes `empty` (`models.ts:99`) | Persist an aggregate `empty` outcome without advancing success/healthy; test all-empty and mixed runs and admin projections |
| **F04** | **High** | `snapshots.ts:90`, `FootballIngestionRepository.ts:31` — mutable, batch-order-dependent slug is the upsert identity | Key provider snapshots by stable provider match ID; handle existing records; test reordered collisions, reschedules, restarts against Mongo |
| **F05** | **High** | `factory.ts:68` — direct adapter construction bypasses the declared eligibility admission gate | Require the gate before constructing/invoking the ingestion provider; test that blocking OpenLigaDB prevents requests and writes |
| **F06** | **High** | `FootballAdminService.ts:319` — failed/skipped ticks become completed jobs; separate lookup/create permits idempotency races | Map tick outcomes honestly, enforce idempotency atomically; test failed/skipped/partial/concurrent submissions |
| **F07** | **High** | `factory.ts:94` — a service constructed before Mongo is ready silently retains local lock and quota | Fail closed or initialise durable authorities only after connection; restrict any local mode to single-worker operation; test disconnected startup |
| **F08** | **Medium — disclosed** | `FootballAdminService.ts:187` — entity mappings load both entire collections, sort, then slice | Paginate and count in the database; test large collections and stable pages |
| **F09** | **Medium** | `football-admin-data.service.ts:146`, `FootballAdminService.ts:60` — unavailable counts and quota become zero | Represent unavailable values explicitly and render them as unavailable |
| **F10** | **High — release process** | `deploy-artifact.yml:11` — merging to `main` can auto-deploy after CI | Do not merge this blocked milestone; enforce any separate release gate in deployment configuration |

---

## 4. Verdicts

| Dimension | Verdict |
|---|---|
| Security | **PARTIAL** — guards exist, but production authorization and concurrency were not exercised |
| Legal | **BLOCKED** — attribution evidence incomplete and the ingestion path bypasses the eligibility gate |
| Data honesty | **FAIL** — empty runs and manual-sync outcomes can be reported as success |
| Engineering | **FAIL** — admin integration and stable snapshot identity have material defects |
| Production readiness | **BLOCKED** — open blockers and high-severity findings, with automatic deployment possible after merge |

## 5. What the reviewer could NOT verify

Live Mongo concurrency; indexes in the deployed database; real API authorization; the exact 500 stack
traces; real provider payload completeness; browser accessibility; rendered public SSR/SEO; production
environment settings; the claimed successful test totals (blocked by `spawn EPERM`).

## 6. Captain notes (added, clearly separated from the review above)

The reviewer's two most consequential corrections of the captain's own claims:

1. **`empty` is still reported as success at the aggregate level.** The captain fixed the
   per-competition outcome to `empty`, but `anySuccess` is set *before* the empty branch, so an
   all-empty run still records `lastSuccessAt` and health `ok`. The captain's own evidence run
   (`wm2026 → empty`) was therefore only half-fixed. **Accepted as correct.**
2. **The eligibility gate is bypassed by the ingestion factory.** `assertEligible` is described in M05
   and M06 documentation as the sole admission gate, but `factory.ts` constructs `OpenLigaDbAdapter`
   directly. The claim that a blocked provider cannot be selected is therefore **not true for the
   ingestion path**. **Accepted as correct and serious** — it invalidates part of the M06 legal
   posture as written.

Fix status is recorded in `M06-DELIVERY.md`; findings marked repaired there carry the command and its
real output. Findings not repaired remain open and are reported as open.
