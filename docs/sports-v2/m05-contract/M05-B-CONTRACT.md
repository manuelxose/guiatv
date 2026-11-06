# M05-B CONTRACT v1 — Central Ingestion, Adaptive Scheduling, Snapshots, Diagnostics

MODULE_ASSIGNMENT
class: L3
primary: deepseek-official/deepseek-v4-pro
escalation: Claude Sonnet 5.5 (only if v4-pro fails twice on the same finding set)
reason: reliability-critical ingestion path with quota, locking and degradation semantics.

## Verified provider facts (captain probe, 2026-11-06)
- `api.openligadb.de/getmatchdata/bl1/2026` -> HTTP 200, no auth, no documented rate limit. Real 2026/27 Bundesliga:
  306 matches, 72 finished, 66 finished with goal events `{goalID, scoreTeam1, scoreTeam2, matchMinute, goalGetterName, scoringTeamId, isPenalty, isOwnGoal, isOvertime}`,
  `matchResults` (Halbzeit / Endergebnis), `matchIsFinished`, `matchDateTimeUTC`, `lastUpdateDateTime`, `location`, `team1/team2`.
  **No live minute field.** Data licence: ODbL (attribution + share-alike for derived databases).
- `api.football-data.org`: catalog is readable anonymously, but `/competitions/PD/standings`, `/PD/matches`, `/CL/standings` return 403 without a key.
  Headers `X-Requests-Available` / `X-RequestCounter-Reset` and `X-Authenticated-Client: anonymous` show a 10 requests/minute anonymous window.

## Files you OWN (create/modify ONLY these)
- `apps/backend/src/application/sports/ingestion/**`                      (new dir)
- `apps/backend/src/infrastructure/sports/providers/openLigaDb/**`        (new dir)
- `apps/backend/src/infrastructure/sports/persistence/**`                (new dir)
- `apps/backend/src/presentation/routes/football-admin.routes.ts` (+ .test.ts, new)
- `apps/backend/src/presentation/controllers/FootballOpsController.ts` (+ .test.ts, new)
- `apps/backend/src/jobs/football/**`                                     (new dir)
- `docs/sports-v2/m05-contract/M05-B-NOTES.md`

Do NOT edit `apps/backend/src/presentation/routes/index.ts` or `server/app.ts` — the captain wires the router (report the exact one-line coupling you need instead).

## Deliverables
### D1 OpenLigaDB adapter (`infrastructure/sports/providers/openLigaDb/`)
- `OpenLigaDbClient`: plain injected `fetch`-like function, timeout (AbortSignal) and a caller-supplied UA string; classifies failures into `{kind:'timeout'|'rate_limited'|'auth'|'http'|'malformed', status?}`.
- `OpenLigaDbAdapter`: payload validation before mapping (reject malformed, never throw a raw parse error up), maps matches to the domain `FootballMatch`-compatible shape:
  `matchDateTimeUTC` -> kickoff, `matchIsFinished` -> finished/scheduled, `matchResults` by `resultTypeKind` (`HalfTime`, `After90Minutes`) -> score + halftime score,
  `goals[]` -> goal events with `minute`, `scorer`, `penalty`, `ownGoal`, `overtime`, `scoreAfter`, `providerEventId = goalID`,
  `team1/team2` -> teams with `providerIds.openligadb`, `location` -> venue, `group.groupName` -> round, `leagueShortcut` -> competition slug mapping.
- **Live minute: undefined always.** Set `minute` only if a provider field explicitly states it (OpenLigaDB does not). Never derive it.
- Competition mapping: `bl1` -> `bundesliga` (catalog slug in `FootballCompetitionCatalog`). Other leagues only through an explicit map you document; unknown -> skip, never guess.
- Determinism: no `Date.now()` inside mapping — pass `now` in.

### D2 Central ingestion (`application/sports/ingestion/`)
- `AdaptiveScheduler` (pure policy, clock injected): returns the next poll interval for a match from its bucket —
  `historical`, `future`, `today`, `approaching_kickoff` (<=2h), `live`, `halftime`, `completed`, plus separate cadences for `standings`, `team_metadata`, `lineup_event_enrichment`.
  Requirements: live buckets poll fastest but are still bounded by the provider's remaining quota and a per-run request budget;
  future/historical use long intervals (e.g. hours/days); completed stops after a final full-time confirmation;
  NEVER a fixed 10s loop — document each interval with its justification and make them configurable constants.
- `RequestBudget`/quota: per-provider daily budget, minimum reserve for matches in the live/approaching buckets, automatic throttling when reserve is reached, emergency disable switch, and a per-run cap.
- `SingleFlight`: in-flight request deduplication keyed by `provider:resource`.
- `RefreshCoordinator`: stale-while-revalidate — return the cached snapshot immediately when fresh enough, refresh in the background, never let a slow provider block a read.
- `GracefulDegradation`: if the provider fails, return the last good snapshot with `staleness` metadata, and NEVER replace a rich record with an EPG-only record.
- Distributed lock port: interface `LockPort { acquire(key, ttlMs): Promise<boolean>; release(key) }` with an in-memory implementation for single instance and a documented Mongo-based implementation (findOneAndUpdate with expiry) for multi-instance. Do not add a new service.
- All policies pure/testable; no `setInterval` inside the policy layer.

### D3 Persistence (`infrastructure/sports/persistence/`)
- Mongo models using the repo's existing Mongoose/mongo patterns (inspect `apps/backend/src/infrastructure/repositories` first and match style):
  `FootballProviderSyncState` (provider, lastSuccessAt, lastErrorAt, consecutiveFailures, quotaConsumedToday, quotaResetAt, circuitState),
  `FootballSnapshot` (canonical match key, providerId, payload mapped to domain, `sourceTimestamp`, `ingestedAt`, `contentHash`),
  `FootballIngestionRun` (runId, providerId, startedAt, finishedAt, requestsUsed, outcome, errors[]).
- Idempotent bulk upserts (unique index on `{canonicalKey, providerId}` and on `contentHash`), no duplicate events, no duplicate snapshots, retention/TTL policy with a documented storage budget.
- Every write path must be safe to run twice. Provide `createFootballIndexes()` in the repo's `create-indexes` style.

### D4 Diagnostics (`presentation/` admin surface)
- `FootballOpsController` + `football-admin.routes.ts`, mounted by the captain behind the repo's EXISTING admin guard (`analyticsAdminGuard`, same pattern as `football.routes.ts`). Never public.
- Endpoint returns: per-provider health, quota remaining, last sync, latency, active matches, stale data count, field coverage, provider errors, identity conflicts, ingestion queue size, last successful run.
- MUST NOT leak credential values, full URLs with keys, or raw provider payloads. Add a redaction test.

### D5 Scheduling job (`jobs/football/`)
- A job entry (in the repo's existing jobs style) that runs one ingestion tick: selects due buckets, respects budget + lock + circuit breaker, writes snapshots, records the run.
- Idempotent and safe to run concurrently (lock-guarded). No cron registration inside lib code.

### D6 Tests
Deterministic, injected clock and fake fetcher, no network. Minimum: scheduler intervals per bucket; quota deny + reserve; single-flight dedupe; SWR returns stale then refreshes; degradation keeps last snapshot and never downgrades to EPG; lock prevents double ingest; adapter mapping of a captured payload; malformed payload rejected; 429/timeout/403 classification; idempotent double-write (no duplicates); diagnostics redaction; live minute stays undefined.
## Shared rules (identical for every M05 worktree)
- FREE-FIRST, ZERO SPEND. No paid API, no signup, no subscription, no code path that can incur cost.
- NO FABRICATED DATA. A field the provider does not supply stays absent/undefined — never 0, never '', never a guess. Never derive a live minute from the kickoff time.
- No scraping of Google/Flashscore or any site whose reuse rights are unverified. Never evade access controls, CAPTCHA, rate limits or terms.
- Credentials: reference environment variable NAMES only. Never read, print, log or commit a credential value.
- Do NOT add npm dependencies. Do NOT modify package.json, package-lock.json or tsconfig files.
- Do NOT touch production (`main`), do NOT run git write commands, do NOT access the network in tests.

## Verification you must run (from the worktree root, via `confined_worktree` exec)
- `node scripts/run-tsc.mjs` — backend `tsc --noEmit` (M05-B/C) or the Angular typecheck for M05-C; must exit 0.
- `node scripts/test.mjs` — typecheck + build; it exits 3 on purpose with `REFUSED: unit tests are not executed here`.
  That is NOT a test failure: the Windows ACL sandbox denies the per-file spawns `node --test` needs.
  Do not work around it and never claim tests passed from this command.
- Unit tests are measured by the captain, unconfined, after the branch is sealed. Write them so they
  pass on the first authoritative run under `npm test -w apps/backend` / `npm run test -w apps/frontend`.
Pre-existing baseline failures in the backend suite (NOT yours, do not fix, do not hide):
`EditorialRunnerService.test.js` (EPERM temp dir), `analyticsGeo.test.js` x3, `content-certify.cli.test.js` (key mode). The other 916 backend tests pass; the frontend suite is 630/630 green.
## Definition of done
All D1-D6 present and covered; final report lists files, the exact commands run with real output, and what is NOT covered (no live minute source, no lineups/statistics for Bundesliga via OpenLigaDB, other competitions needing a keyed provider).
