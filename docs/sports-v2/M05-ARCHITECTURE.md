# M05-B/C — Architecture

Status: implemented on branch `feat/sports-v2-m05-integration`. Nothing merged to `main`, nothing deployed.

---

## 1. Layers (new code is inside the existing backend, no new service)

```
presentation
  routes/football.routes.ts            existing  /v2/sports/football/*   (unchanged contract)
  routes/football-admin.routes.ts      NEW       /v2/sports/football/admin/diagnostics (admin guard)
  controllers/FootballOpsController    NEW       redacted diagnostics
application
  sports/providers/                    NEW  ProviderSelector, conflictResolution, IdentityReconciler
  sports/services/FootballProviderOrchestrator.ts   NEW  single entry point
  sports/ingestion/                    NEW  AdaptiveScheduler, RequestBudget, SingleFlight,
                                            RefreshCoordinator, GracefulDegradation, Lock,
                                            FootballIngestionService, container
infrastructure
  sports/providers/eligibility/        NEW  frozen registry + assertEligible
  sports/providers/health/             NEW  TokenBucket, CircuitBreaker, backoff
  sports/providers/openLigaDb/         NEW  client + adapter
  sports/persistence/                  NEW  repositories, indexes, TTL
domain
  sports/football/provider-types.ts    NEW  capability-based contracts + provenance
  sports/football/experimental/        NEW  status normalisation, timezone helpers
```

## 2. Provider registry and eligibility

A frozen registry records, per provider: id, auth mode, env-var *name*, documented quota,
capabilities, competitions, eligibility state, rights state and last review date.

Three states, and only one is reachable in production:

- `approved` — only **OpenLigaDB** today.
- `prototype` — implemented and tested, never selected (football-data.org).
- `blocked` — documented, **no adapter file exists** (Google, Flashscore).

`assertEligible()` is the only admission path. `ProviderSelector` takes the gate as a
constructor parameter that defaults to `assertEligible`; tests may inject a permissive gate,
production cannot. A test asserts that when every approved provider fails, the orchestrator
returns the preserved snapshot or an explicit unavailability — it never downgrades to a prototype.

## 3. Capability-based contracts (not one monolith)

`ProviderFixtureSource`, `ProviderLiveSource`, `ProviderEventSource`, `ProviderStandingSource`,
`ProviderTeamSource`. An adapter implements only what its provider genuinely supplies; OpenLigaDB
implements fixtures + results + goal events and simply has no live/lineup/statistics method to stub.

## 4. Field-level provenance and conflict resolution

Every critical field can carry `FieldProvenance {provider, sourceTimestamp, ingestedAt,
verification, confidence, conflict}`. Merge rules are explicit and ordered:

1. capability tier (a live-capable source outranks a fixtures-only one for score),
2. `sourceTimestamp` recency within the same tier,
3. configured source priority,
4. never blind "last response wins".

A disagreement does not silently overwrite: the chosen value is kept **and** the rejected value
is retained with its provenance in `conflicts[]` for audit. Covered cases: score disagreement,
status conflict, VAR-disallowed goal (present then absent in a newer response from the same
provider), duplicate events (dedupe by `type|minute|player` within a one-minute window), penalty
shootouts kept separate from the 90-minute score, and final-score correction.

## 5. Canonical identity

Key = competition + season + home team + away team + kickoff (window) + optional venue.
Team names alone are never sufficient. Guards: men vs women, first team vs reserve ("II"/"B"),
different seasons, similar names, two-leg fixtures, and postponed→rescheduled treated as a
**move with an audit record**, not a duplicate. Ambiguous candidates are **quarantined** with a
reason, never merged.

## 6. Ingestion and polling (no per-visitor upstream calls)

- `AdaptiveScheduler` returns a per-bucket interval: historical, future, today, approaching
  kickoff, live, half-time, completed, plus standings / team metadata / event enrichment.
  There is no fixed 10-second loop anywhere.
- `RequestBudget` enforces a daily budget with a reserve for important matches, a per-run cap,
  automatic throttling, and an emergency disable switch. Budget accounting is **process-local**
  (documented limitation; a cross-instance budget would need shared storage).
- `SingleFlight` dedupes concurrent identical requests; `RefreshCoordinator` serves fresh
  snapshots immediately and revalidates in the background; `Lock` prevents two ticks on the
  same key (in-memory for one instance, Mongo-based for several).
- Boot wiring (`server/index.ts`): shared service container, index creation whose failure is
  logged and not fatal, and an ingestion loop that re-arms a single timeout from the scheduler's
  `nextPollIntervalMs` (clamped 15 s–6 h), stopping on SIGTERM/SIGINT.
- `FOOTBALL_INGESTION_ENABLED=0` disables polling entirely; the diagnostics endpoint then
  reports an empty provider list and zeroed counts rather than invented health.

## 7. Persistence

Collections: `football_snapshots` (canonical key + provider + contentHash, unique index),
`football_ingestion_runs`, sync state and lock. TTL: snapshots 45 days, runs 14 days.
Every write is an idempotent bulk upsert, so a repeated tick cannot duplicate events or snapshots.

## 8. Graceful degradation

A failing provider never takes down `/v2/sports/football/*` and never downgrades a rich record to
an EPG-only one: the last good snapshot is served with staleness metadata. Broadcasts come from
GuíaTV's own EPG and are rendered independently of score/event feeds.

## 9. Frontend Match Center

`football-mapper.ts` previously hardcoded `events: []` / `stats: []`; it now carries events,
statistics, lineups, venue, referee, minute, phase and injury time when supplied, and leaves them
**absent** when not. `availability.ts` maps a fetch outcome to exactly one state
(`loading | fresh | stale | provider_unavailable | unavailable | competition_not_covered`) and the
UI renders an explicit message per state, never `0` for an absent statistic. Live score changes
reuse the existing shell `aria-live` announcer; no new polling and no scroll/reorder side effects.

## 10. Known gaps (deliberately not faked)

- No live minute, lineups, statistics, referee or standings from any approved free provider.
- Coverage beyond German leagues needs a keyed provider; `bl1 → bundesliga` is the only mapping.
- `competition_not_covered` exists and is tested but the store does not yet expose per-competition
  coverage to the page, so the live UI cannot reach that state.
- Quota is per process, not per cluster.
