# M05 — Delivery report

Date: **2026-11-06**. Branch: `feat/sports-v2-m05-integration`. Nothing merged to `main`,
nothing deployed. This document supersedes the earlier stub, which described M05 as blocked and
unimplemented.

---

## 1. Milestone verdicts

| Dimension | Verdict | Reason |
|---|---|---|
| Engineering | **PASS** | 3 isolated worktrees, sealed branches, conflict-free integration; 1079 backend tests / 1027 pass, 662/662 frontend, `tsc` clean, isolation check clean |
| Functionality | **PARTIAL** | Match Center now carries and renders real events/statistics/lineups; no free approved provider supplies live minute, lineups, statistics, referee or standings |
| Coverage | **PARTIAL** | Bundesliga LIVE with real fixtures/results/goal timelines; every other requested competition remains EPG-only pending a keyed provider |
| Legal | **PARTIAL** | One provider approved on verified rights (OpenLigaDB/ODbL). football-data.org republication terms unresolved; Google/Flashscore/SerpApi/StatsBomb blocked |
| Deployment | **BLOCKED** | Requires your explicit authorisation; PR #191 (M04) is still open, so the integration base is unsettled |
| Production verification | **BLOCKED** | Nothing deployed; no live match was available from an approved provider to verify |

No dimension is collapsed into a global PASS.

## 2. What was actually implemented

- **Provider core**: capability-based contracts (no monolithic interface), frozen eligibility
  registry where only `assertEligible` admits a provider, rolling-window quota bucket, circuit
  breaker, jittered backoff with `Retry-After`, policy-driven selector, field-level provenance with
  audited conflicts, canonical identity with quarantine, orchestrator with graceful degradation.
- **Ingestion**: validated OpenLigaDB adapter (fixtures, results, goal events, venue, round), an
  adaptive scheduler with ten buckets and no fixed polling loop, request budget with reserve and
  emergency switch, single-flight, stale-while-revalidate, in-memory and Mongo locks, idempotent
  snapshot persistence with TTL, admin-only redacted diagnostics, one adaptive cron loop.
- **Match Center**: typed models (phase, injury time, own goal, penalty, disallowed, VAR,
  substitutions), a mapper that stops discarding provider data, an availability state machine with
  six states, and accessible event/lineup/statistics components that never render an absent value
  as `0`.

## 3. What remains blocked

1. **LaLiga, Hypermotion, Copa del Rey, UCL, UEL, UECL, PL, Serie A, Ligue 1, Primeira Liga,
   World Cup** — EPG only. Blocker: no approved free provider, and no `FOOTBALL_DATA_API_KEY`
   exists to even probe the adapter.
2. **Live minute, lineups, statistics, referee, live score** — no free approved source.
3. **Standings for most competitions** — same blocker.
4. **football-data.org rights** — republication into a commercial site not evidenced; adapter is
   `prototype` and cannot be selected by any code path.
5. `competition_not_covered` is implemented and tested but **unreachable from the live UI**
   (the page hardcodes `hasApprovedProvider: true`) — review finding LOW-09.
6. Quota accounting is per-process, not per-cluster.

## 4. Git

| Item | Value |
|---|---|
| Integration base | `feat/sports-v2-m05-providers` (contains the earlier session's uncommitted work as `7d0c2000`) |
| Provider core | branch `feat/m05-a-provider-core`, tip `fc3a6e71` |
| Ingestion | branch `feat/m05-b-ingestion`, tip `5099c20c` (wiring `7034add6`) |
| Match Center | branch `feat/m05-c-matchcenter`, tip `23130390` |
| Integration | branch `feat/sports-v2-m05-integration`, HEAD after merge `b8f00c8c`, plus `f163cb21` |
| PR | not opened yet — opening pushes nothing live, but you asked not to merge/deploy; say the word and I will open the PR against the M04 branch or `main` as you prefer |

Worktrees `guiatv-m05-a/-b/-c` remain on disk for inspection.

## 5. Deployment and rollback strategy

- The integration only adds routes (`/v2/sports/football/admin/diagnostics`, admin-guarded) and a
  background loop; existing `/v2/sports/football/*` behaviour is unchanged.
- `FOOTBALL_INGESTION_ENABLED=0` disables all polling instantly without a code change — that is
  the rollback lever.
- Index creation is additive and non-destructive; TTLs only expire the new collections.
- Merging the integration branch is what triggers production; it is deliberately not done.

## 6. Before a safe production release

1. Decide the football-data.org rights position (and supply the key) → unlocks 10 competitions.
2. Confirm the exact OpenLigaDB attribution text/place (ODbL requires it).
3. Resolve whether M04 lands first; then open the M05 PR on that base.
4. Run an authenticated probe for each competition before claiming coverage.
5. Watch the first live Bundesliga matchday to verify the goal timeline end-to-end.
6. Address the 12 LOW review findings, at minimum LOW-01 (placeholder defaults) and LOW-09
   (coverage state reachable from the UI).

