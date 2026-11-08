# M05-B Notes — Central Ingestion (OpenLigaDB)

Implementation notes for the M05-B module (worktree `m05-b`). Read together with
`M05-B-CONTRACT.md`; these notes document the deliberate limitations and the one
captain-owned wiring step.

## What is covered (D1–D6)
- **D1** `infrastructure/sports/providers/openLigaDb/` — injectable-fetch client
  with timeout + typed failure classification; adapter validates before mapping
  and maps scores/halftime/events/teams/venue/round/competition.
- **D2** `application/sports/ingestion/` — `AdaptiveScheduler`, `RequestBudget`,
  `SingleFlight`, `RefreshCoordinator`, `GracefulDegradation`, `LockPort` +
  `InMemoryLock` + `MongoLock`.
- **D3** `infrastructure/sports/persistence/` — sync state, snapshots, runs,
  `createFootballIndexes()` (TTL + unique indexes), idempotent bulk upsert.
- **D4** `FootballOpsController` + `football-admin.routes.ts` (admin-guarded).
- **D5** `jobs/football/` — lock-guarded idempotent tick + CLI entry + factory.
- **D6** deterministic tests (injected clock, fake fetcher, no network).

## Uncovered capabilities (honest gaps)
- **No live minute.** OpenLigaDB supplies no live minute; `FootballMatch.minute`
  is left `undefined` (never derived from kickoff). The goal event's `minute` is
  the provider's `matchMinute` for that goal, not the live clock.
- **No lineups/statistics for the Bundesliga via OpenLigaDB** — only goals,
  scores, teams, venue, round. `lineup_event_enrichment` is a scheduler cadence
  reserved for a future keyed provider; no lineup data is fabricated now.
- **Other competitions need a keyed provider** — only `bl1 -> bundesliga` is
  mapped (verified by the captain's probe). Unknown leagues are skipped, never
  guessed. The explicit map lives at
  `OPENLIGADB_COMPETITION_MAP` in `OpenLigaDbAdapter.ts`.

## Decisions and semantics
- **Halftime score** is stored under `FootballMatch.statistics.halftime`
  (`{ home, away }`); full-time score is `FootballMatch.score`. The domain type
  has no dedicated halftime field, and this keeps the mapping a plain
  `FootballMatch` shape.
- **Scheduler intervals** (configurable constants): historical/future 6h,
  today 30m, approaching (≤2h) 5m, live 30s, halftime 2m, completed 0 (stop),
  standings 1h, team_metadata 24h, lineup_event_enrichment 2h. The fastest is
  30s — never a fixed 10s loop — and real cadence is still quota-bounded.
- **Quota is process-local.** `RequestBudget` is in-memory and resets at UTC
  midnight; `quotaConsumedToday` is persisted for observability only, not for
  cross-instance enforcement. Multi-instance budget enforcement is out of scope
  for round 1 (single-instance with `InMemoryLock`; use `MongoLock` + a shared
  store to scale out).
- **Failure never downgrades.** On provider failure the tick writes nothing —
  the last good snapshots remain. `GracefulDegradation` refuses an EPG-only
  batch replacing a rich batch; `mergeRichAndEpg` keeps rich records per key.
- **Retention/TTL** (`createFootballIndexes.ts`): snapshots 45 days, runs
  14 days. One season (~306 matches, a few KB each) stays well under a few MB.

## Credentials / environment (names only)
OpenLigaDB is unauthenticated. Configurable via env var **names** (no secrets):
`OPENLIGADB_LEAGUE` (default `bl1`), `OPENLIGADB_SEASON` (default `2026`),
`OPENLIGADB_DAILY_BUDGET`, `OPENLIGADB_LIVE_RESERVE`,
`OPENLIGADB_PER_RUN_CAP`, `OPENLIGADB_THROTTLE_BACKOFF_MS`,
`OPENLIGADB_TIMEOUT_MS`, `OPENLIGADB_USER_AGENT`,
`OPENLIGADB_EMERGENCY_DISABLED` (`1` = emergency stop).

## Captain-owned wiring (not edited here)
1. **Router** (`apps/backend/src/presentation/routes/index.ts`) — one line:
   ```ts
   app.use('/v2/admin/football', createFootballAdminRoutes(footballOpsController));
   ```
   where `footballOpsController` is a `FootballOpsController` wired to the
   ingestion service (see `factory.ts` / `container.ts`).
2. **Indexes at boot** — either call `createFootballIndexes()` once (the CLI
   already does) or add the three `models.ts` models to
   `ensureMongoCollectionsAndIndexes()`.
3. **Job schedule** — register `runFootballIngestionTick` on a cron whose
   interval honours the scheduler's `nextPollIntervalMs`, bounded by the budget.
   A CLI entry exists at `jobs/football/cli/runIngestion.cli.ts`.

## Verification run (from the worktree root)
- `node scripts/run-tsc.mjs` → exit 0 (backend `tsc --noEmit`).
- `node scripts/test.mjs` → exits 3 on purpose (sandbox refuses per-file
  `node --test` spawns) — not a test result; the captain runs the suite
  unconfined (`npm test -w apps/backend`).
