# M06 — M05 findings matrix (LOW-01..LOW-12)

Owner: `ops` (t6). Scope: the backend findings under
`apps/backend/src/infrastructure/sports/providers/FootballDataOrgAdapter.ts`,
`apps/backend/src/infrastructure/sports/providers/openLigaDb/`,
`apps/backend/src/application/sports/ingestion/FootballIngestionService.ts`,
`apps/backend/src/presentation/controllers/FootballOpsController.ts`, plus this document.

Each finding is **closed** (fixed and covered by a test that fails on the old
behaviour), **accepted-with-reasoning** (documented, deliberately not changed),
or **out-of-t6-scope** (the fix location is owned by another task/owner and is
recorded here so it is not lost). Nothing is marked resolved that was not
verified.

## Summary

| ID | Status in M05 | t6 disposition | Evidence |
|---|---|---|---|
| F-1 | FIXED (`707178f4`) | already fixed (frontend, out of t6 scope) | M05 review record |
| F-2 | FIXED (`707178f4`) | already fixed (mapper, out of t6 scope) | M05 review record |
| LOW-01 | open, accepted | **CLOSED** — placeholders stripped in `FootballDataOrgAdapter` | `FootballDataOrgAdapter.test.ts` |
| LOW-02 | FIXED (`f163cb21`) | **CONFIRMED + completed** — empty-string teamId now also absent | `OpenLigaDbAdapter.test.ts` |
| LOW-03 | open, documented | out-of-t6-scope (`conflictResolution.ts`) | this matrix |
| LOW-04 | open | accepted-with-reasoning (correct skip; counter deferred) | this matrix |
| LOW-05 | open, accepted | **CLOSED by captain (integration)** - constant-time compare | `analyticsAdminGuard.test.ts` |
| LOW-06 | open | out-of-t6-scope (server boot) | this matrix |
| LOW-07 | open, documented | out-of-t6-scope; **contentHash churn fixed by captain** (t4) | `snapshots.test.ts` |
| LOW-08 | open, documented | out-of-t6-scope (availability service) | this matrix |
| LOW-09 | open, documented | **CLOSED (backend half)** — `resolveOpenLigaDbCoverageForCompetition` | `OpenLigaDbAdapter.test.ts` |
| LOW-10 | open | out-of-t6-scope (mapper) | this matrix |
| LOW-11 | open | already fixed by t2 (`job:football:ingestion`) | t2 result |
| LOW-12 | open | **CLOSED by captain (integration)** - dead method removed | build + full suite |

## LOW-01 — placeholder defaults in `FootballDataOrgAdapter` (CLOSED)

**Before:** the dormant prototype mapped an absent team name to `'Equipo'`, an
absent competition name to `'Competición'`, a missing match competition to
`{ id: 'unknown', slug: 'unknown', name: 'Competición' }`, a missing standing
team to `{ id: 'unknown', … name: 'Equipo' }`, and stamped every
`lastUpdatedAt` with `new Date().toISOString()` (a fake "fresh" timestamp).

**After:** absent fields stay absent. `mapFootballDataOrgTeam` /
`mapFootballDataOrgCompetition` / `mapFootballDataOrgStandingRow` return `null`
when a required identity field (name / team) is absent; `mapFootballDataOrgMatch`
returns `null` when the competition is absent. `lastUpdatedAt` is the provider's
`lastUpdated` string or the empty string (`''`, the repo's "unknown timestamp"
sentinel) — never `new Date()`.

**Evidence:** `FootballDataOrgAdapter.test.ts` —
`mapFootballDataOrgTeam returns null when the provider gives no name`,
`mapFootballDataOrgTeam leaves lastUpdatedAt empty when the provider omits it`,
`mapFootballDataOrgCompetition returns null when the provider gives no name`,
`mapFootballDataOrgMatch returns null when the competition is missing, never a placeholder`,
`mapFootballDataOrgMatch leaves lastUpdatedAt empty when the provider omits it`,
`mapFootballDataOrgStandingRow returns null when the team is missing, never a placeholder`.

## LOW-02 — empty-string scorer/team id (CONFIRMED + completed)

M05 fixed the scorer empty-string case. t6 confirmed it and closed the remaining
gap: an empty-string `scoringTeamId` was still emitted as `''` instead of
staying absent. `mapGoalEvents` now treats `''` the same as `null`/`undefined`.

**Evidence:** `OpenLigaDbAdapter.test.ts` — `LOW-02: empty-string scorer/team id
stay absent, never emitted as ""`.

## LOW-03 — conflictResolution / emptyMatch fallback (out-of-t6-scope)

The fix location is `apps/backend/src/application/sports/providers/conflictResolution.ts`
and the normalizer, which are not in t6's writable scope. Documented here for
the integration task; the M05 record already describes it as documented.

## LOW-04 — silent skipped-goal counter (accepted-with-reasoning)

`mapGoalEvents` skips a goal whose `goalID` is absent. This is correct — a goal
without a stable provider identity cannot be deduplicated across a reschedule —
but the skip is currently silent. A skipped-goal counter is an observability
enhancement, not a correctness defect; it belongs with the operational-metrics
surface (t7 admin metrics), not the adapter. Accepted with reasoning.

## LOW-05 — non-constant-time admin guard compare (out-of-t6-scope)

The guard is `presentation/middlewares/analyticsAdminGuard.ts`, which is outside
t6's allowed paths (`presentation/controllers/FootballOpsController.ts` is the
only presentation file in scope). **Not edited.** The M05 record already notes
the fail-closed order is correct and the comparison is defence-in-depth.
Flagged to the captain for routing.

## LOW-06 — boot logs `String(error)` (out-of-t6-scope)

The boot/logging code is outside t6's scope. Documented, not changed.

## LOW-07 — snapshot suffix order (out-of-t6-scope)

The fix location is `apps/backend/src/application/sports/ingestion/snapshots.ts`,
outside t6's scope. Documented, not changed.

## LOW-08 — availability treats unknown `updatedAt` as fresh (out-of-t6-scope)

The availability computation lives in the availability/catalog service, outside
t6's scope. Documented, not changed. Note: the LOW-01 fix (no more `new Date()`
stamp for `lastUpdatedAt`) removes the specific "fake fresh" input this finding
was most sensitive to.

## LOW-09 — `hasApprovedProvider: true` hardcode (CLOSED, backend half)

The backend half is delivered: `resolveOpenLigaDbCoverageForCompetition(slug,
season)` in `openLigaDb/OpenLigaDbAdapter.ts` maps a catalog competition slug to
a truthful `OpenLigaDbCoverageDescriptor` — `competition_not_covered` for a slug
with no verified provider, `provider_supported` otherwise — building on the
adapter's existing `resolveOpenLigaDbCoverage` without duplicating it.

**Evidence:** `OpenLigaDbAdapter.test.ts` — `LOW-09: coverage is exposed keyed by
catalog competition slug`.

The public HTTP wiring that serves this to the `sports-v2` match-details page and
the frontend binding are **t9** (out of t6 scope).

## LOW-10 — editorial kicker/author label hardcoding (out-of-t6-scope)

The hardcoding lives in the mapper, outside t6's scope. Documented, not changed.

## LOW-11 — CLI npm script missing (already fixed by t2)

t2 added `"job:football:ingestion": "node dist/jobs/football/cli/runIngestion.cli.js"`
to `apps/backend/package.json`. Closed by t2.

## LOW-12 — `FootballIngestionService.getSnapshot` dead code (CONFIRMED)

`getSnapshot()` is defined at `FootballIngestionService.ts:130` and referenced
nowhere else in `apps/backend/src` (grep: the only match is its definition; the
other `snapshot`/`BudgetSnapshot` hits are unrelated). It is dead code. The
captain is actively editing `FootballIngestionService.ts` for multi-competition
ingestion, so t6 did not delete it — removal is recorded here for the captain.

---

# Captain closures on the integration branch

The three findings below were left open or out-of-scope by t6, correctly, because the
fix location was outside its writable paths or was being edited concurrently. All three
are now closed on `feat/sports-v2-m06-integration`.

## LOW-05 — constant-time admin key compare (CLOSED)

t6 refused to edit `presentation/middlewares/analyticsAdminGuard.ts` and flagged it.
The captain closed it: the guard now compares the provided key with
`crypto.timingSafeEqual`, checking length first (a length mismatch returns false
without comparing content). Failure mode is unchanged and still fails closed: no
configured `ANALYTICS_ADMIN_KEY` rejects every request before any comparison.

**Evidence:** `presentation/middlewares/analyticsAdminGuard.test.ts` — 3 tests, 3 pass:
fails closed when unconfigured; accepts the exact key via `x-admin-key` or
`Authorization: Bearer`; rejects every near-miss including a *prefix of the real key*,
the real key plus one character, a case change, an empty string, and a same-length
different string.

## LOW-12 — dead `getSnapshot()` (CLOSED)

t6 confirmed by grep that `getSnapshot()` had no caller and left the deletion to the
captain, who was editing the same file. Closed on the integration branch: the method was
removed along with the two private fields (`leagueShortcut`, `season`) that only it
still read. The build then failed with `TS6133` unused-field errors, which is itself
the proof that nothing else referenced them.

Beyond being dead, the method was semantically wrong after M06: the service now ingests
multiple competitions, so a single-competition snapshot getter has no meaning.

## LOW-07 — snapshot content-hash churn (CLOSED, in addition to t6's note)

t6 recorded this as out of scope (`snapshots.ts`). It was **worse than the M05 note
suggested** and was found by running the ingestion twice: `buildSnapshotContentHash`
hashed the whole match including `lastUpdatedAt` and the per-team `lastUpdatedAt`, so
every run produced a different hash for identical football data — the hash could not
detect a real change, which is the only reason it exists.

**Fixed:** volatile keys (`lastUpdatedAt`, `ingestedAt`) are excluded before hashing.
**Evidence:** `snapshots.test.ts` gains two regressions — unchanged timestamps hash
identically, and a real result change still hashes differently — plus an end-to-end
observation that the stored `contentHash` for one UCL match was byte-identical across
three separate ingestion runs (see `M06-REAL-INGESTION-EVIDENCE.md` §5).

# Disposition summary after M06

| ID | Final state |
|---|---|
| F-1, F-2, LOW-02 | closed in M05 |
| LOW-01, LOW-09 (both halves) | **closed** |
| LOW-05, LOW-07, LOW-11, LOW-12 | **closed in M06** |
| LOW-03, LOW-06, LOW-08, LOW-10 | open, documented, no M06 behaviour change — carried into release notes |
| LOW-04 | accepted with reasoning (observability, not correctness) |

Four findings remain genuinely open and are **not** claimed as fixed. None is a
correctness or security blocker; they are carried forward explicitly.
