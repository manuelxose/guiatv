# M05-A CONTRACT v1 — Provider Core Module (backend only)

MODULE_ASSIGNMENT
class: L3
primary: deepseek-official/deepseek-v4-pro
escalation: Claude Sonnet 5.5 (only if v4-pro fails twice on the same finding set)
reason: new provider-orchestration layer with capability contracts, identity rules and quota semantics.

## Absolute constraints
1. FREE-FIRST, ZERO SPEND. No paid API, no signup, no subscription. Write no code path that can incur cost.
2. NO FABRICATED DATA. Never invent scores, minutes, goals, cards, lineups, stats, stadiums, referees, standings, broadcasts. A field that a provider does not supply MUST stay `undefined`/absent — never 0, never '', never a guess.
3. NEVER derive a live minute from the kickoff timestamp. Only report `minute` when the provider explicitly supplies it (or derive it from an explicit provider event timestamp, documented as DERIVED and lower confidence).
4. No scraping of Google/Flashscore or any site whose reuse rights are unverified. No CAPTCHA/anti-bot bypass, no proxy rotation.
5. Credentials: reference environment variable NAMES only (`FOOTBALL_DATA_API_KEY`). Never read, log, commit or expose a credential VALUE. Never print env values in tests or diagnostics.
6. Do NOT add npm dependencies. Do NOT modify package.json / package-lock.json / tsconfig / jest config.
7. Do NOT touch production (`main`), do not run git write commands, do not access the network in tests.

## Verified facts from the captain's probe (2026-11-06, anonymous curl)
- `api.football-data.org/v4/competitions` → 200 anonymous (catalog only).
- `/v4/competitions/PD/standings`, `/PD/matches`, `/CL/standings` without a key → **403** `{"message":"...restricted ... check your subscription","errorCode":403}`.
- Anonymous headers show `X-Authenticated-Client: anonymous`, `X-Requests-Available`, `X-RequestCounter-Reset` → the anonymous limit is **10 requests/minute**, so the quota must be modelled as a rolling per-minute window with those header names.
- `api.openligadb.de/getmatchdata/bl1/2026` → 200, real 2026/27 Bundesliga: 306 matches, 72 finished, 66 finished with goal events `{goalID, scoreTeam1, scoreTeam2, matchMinute, goalGetterID, goalGetterName, scoringTeamId, isPenalty, isOwnGoal, isOvertime}`, `matchResults` (Halbzeit / Endergebnis), `location`, `matchIsFinished`, `matchDateTimeUTC`, `team1/team2 {teamId, teamName, shortName, teamIconUrl, wikidataId}`. **No live minute field.**
Do not treat the following as approved providers: Google, Flashscore, SerpApi/ScrapingBee.

## Files you OWN (create/modify ONLY these)
- `apps/backend/src/domain/sports/football/provider-types.ts`      (capability contracts, provenance)
- `apps/backend/src/domain/sports/football/experimental/**`         (new dir)
- `apps/backend/src/infrastructure/sports/providers/eligibility/**` (new dir)
- `apps/backend/src/infrastructure/sports/providers/health/**`      (new dir)
- `apps/backend/src/application/sports/providers/**`                (new dir)
- `apps/backend/src/application/sports/services/FootballProviderOrchestrator.ts` (+ .test.ts)
- `docs/sports-v2/m05-contract/**` (your own notes only)

## Deliverables
### D1 `provider-types.ts`
- `FootballProviderCapability = 'fixtures'|'results'|'live_score'|'live_minute'|'events'|'lineups'|'statistics'|'standings'|'team_metadata'|'venue'|'referee'`.
- `ProviderEligibility`: `{ state: 'approved'|'prototype'|'blocked'; reason: string; evidenceRef: string; approvedBy?: 'user'|'owner' }`. The literal `'approved'` may ONLY be used by a registry entry that carries user approval — every other entry is `'prototype'` (implemented+tested but never selected in production) or `'blocked'` (documented, no code).
- `FieldProvenance`: `{ provider: ProviderId; sourceTimestamp?: string; ingestedAt: string; verification: 'verified'|'inferred'|'derived'|'single_source'; confidence: number; conflict: boolean }`.
- `ProvenancedValue<T> = { value: T; provenance: FieldProvenance }`.
- `ProviderMatchRecord`: one provider's view of a match — providerId, providerMatchId, competition slug, season, kickoff ISO, home/away {providerTeamId, name, shortName?, wikidataId?}, status, minutes?, score?, events?, statistics?, lineups?, venue?, referee?, plus `capabilities: FootballProviderCapability[]` and `raw` NOT stored.
- Capability-based interfaces (`ProviderFixtureSource`, `ProviderLiveSource`, `ProviderEventSource`, `ProviderStandingSource`, `ProviderTeamSource`) so an adapter implements ONLY what its provider really supplies. No monolithic interface that forces every provider to implement irrelevant methods.
- `PlatformMatchRecord` + `EnrichedMatch`: the merged record where every critical field carries `FieldProvenance | undefined` (absent when no provider supplied it).

### D2 `providers/eligibility/`
- `providerEligibilityRegistry.ts`: frozen registry with, per provider: id, name, authMode ('none'|'api_key'), envVarName?, docsUrl, freeQuota {kind:'rolling_window'|'monthly'|'none', limit, windowSeconds?}, capabilities, competitions, eligibility, legalNotes, rightsState ('verified'|'unverified'|'prohibited'), lastReviewedOn.
  Seed entries: `openligadb` (auth none, no published quota, capability: fixtures/results/events/goals/venue/team_metadata — NOT live_minute, NOT lineups, NOT statistics, NOT standings), `football-data-org` (auth api_key `FOOTBALL_DATA_API_KEY`, anonymous 10/min, capabilities documented but tier-restricted → eligibility 'prototype'), `google-search`, `flashscore` (both `blocked`, `rightsState:'prohibited'|'unverified'`, no adapter).
- `assertEligible(providerId)`: throws a typed error unless state==='approved'. This is the ONLY way provider selection may admit a provider.
- Crucially: a `prototype` provider must be unreachable through ordinary fallback. Prove it: if every approved provider fails, the orchestrator returns the preserved previous snapshot or explicit unavailability — it must NEVER fall back to a prototype provider.

### D3 `providers/health/`
- `TokenBucket`: rolling-window quota accounting keyed by provider; `take(n=1)` returns allowed/denied + `retryAfterMs`; survives quota-reset (`resetAt`).
- `CircuitBreaker`: closed/open/half-open, `failureThreshold`, `cooldownMs`, half-open probe limit 1; `recordSuccess/recordFailure/snapshot()`.
- `backoff.ts`: exponential backoff with full jitter, capped, and `Retry-After` parsing (seconds or HTTP-date) with the retry-after value winning over computed backoff.
- All pure/clock-injected (`now: () => number`) so tests are deterministic. No `setTimeout` in tests.

### D4 `application/sports/providers/`
- `ProviderSelector`: deterministic policy over legal eligibility (hard gate first), capability match, competition coverage, freshness, reliability/health, remaining quota, configured source priority, historical quality. Returns a decision with a per-candidate reason list (needed by diagnostics). No randomness.
- `FieldResolution` / `conflictResolution.ts`: field-level merge with explicit rules — documented precedence, never blind "last response wins": e.g. a provider with `live_score` outranks a fixtures-only source for score; a *newer* `sourceTimestamp` outranks an older one for the same capability tier; a disagreement sets `conflict: true` and keeps BOTH values (chosen + rejected with its provenance) in `conflicts[]` for audit. Cover: score disagreement, status conflict, VAR-disallowed goal (event present then absent from the newer response of the same provider → removed event recorded), duplicate events (dedupe by `${type}|${minute}|${player}` within ±1 minute window), penalty shootouts kept separate from the 90-minute score, final-score correction.
- `IdentityReconciler`: canonical match identity key from competition + season + home + away + kickoff (±window) + optional venue. MUST refuse to merge on team name alone. Guards: men vs women, first team vs reserve ("II"/"B"), different seasons, similar names, repeated fixtures (two legs), postponed→rescheduled (same teams, new kickoff within a reschedule window is a MOVE with audit, not a duplicate). Ambiguous candidates (≥2 equally valid) → `quarantined: true` + reason, never merged.
- `FootballProviderOrchestrator`: the only entry point. For a match/competition it (a) asks the selector for candidates, (b) calls only approved providers, (c) enforces quota + circuit breaker + backoff around each call, (d) reconciles identity, (e) merges fields with provenance, (f) returns `EnrichedMatch[]` and preserves the previous snapshot on total failure (graceful degradation — no EPG-only downgrade of a rich record).
- Must keep the existing `FootballDataProvider` interface working (`apps/backend/src/domain/sports/football/types.ts`): add new optional fields to `FootballMatch` **additively and backwards-compatibly** (existing constructors must still compile; `events?: unknown[]`/`statistics?`/`lineups?` may be narrowed only if every existing call site still compiles).

### D5 Tests (`node --test` via the repo's build, `.test.ts` beside the source)
Deterministic, no network. Minimum coverage: capability gating, prototype-never-selected-in-fallback, quota allow/deny + retryAfter, circuit open/half-open/close, backoff jitter bounds + Retry-After, 429/401/403 classification, status normalization incl. obscure codes, timezone (naive German local time → UTC via Europe/Berlin; kickoff from `matchDateTimeUTC`), event dedupe, VAR-disallowed removal, duplicate/rescheduled fixture handling, ambiguity → quarantine, men-vs-women and reserve-team non-merge, field-conflict kept as conflict, score correction audit.

## Verification you must run (from the worktree root, via `confined_worktree` exec)
- `node scripts/run-tsc.mjs` — backend `tsc --noEmit`; must exit 0.
- `node scripts/test.mjs` — typecheck + build; exits 3 on purpose with `REFUSED: unit tests are not executed here`.
  That is NOT a test failure: the Windows ACL sandbox denies the per-file spawns `node --test` needs.
  Do not try to work around it and do not claim tests passed from this command.
- Unit tests are therefore measured by the captain, unconfined, after the branch is sealed.
  Write them carefully; they must pass under `npm test -w apps/backend` on the first authoritative run.

Pre-existing baseline failures in that suite (NOT yours, do not fix, do not hide):
`dist\application\services\EditorialRunnerService.test.js` (EPERM temp dir),
`dist\infrastructure\analytics\analyticsGeo.test.js` x3,
`dist\scripts\content-certify.cli.test.js` (key mode). Everything else (916 tests) must pass.
Write SMALL, focused modules. Prefer the smallest complete design (no speculative abstractions). Keep files under ~300 lines where reasonable.

## Definition of done
- All D1–D4 files exist, compile, and are covered by tests.
- Final report: files created, test counts (pass/fail), exact commands run with real results, every acceptance item with evidence, and an explicit list of what is NOT covered (capabilities no free approved provider supplies yet).


