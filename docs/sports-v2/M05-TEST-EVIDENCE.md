# M05 — Test evidence

Every number below comes from a command actually executed on this machine during this session.
Nothing is reported from a model's claim. Environment: Windows 10, Node 24.18.0, branch
`feat/sports-v2-m05-integration`.

---

## 1. Baseline (before any M05 module existed)

Commit `4a4c9103`, command `npm test -w apps/backend`:

| tests | pass | fail |
|---|---|---|
| 968 | 916 | 5 |

The five failures are pre-existing and environmental, unrelated to football:

1. `dist/application/services/EditorialRunnerService.test.js` — `EPERM` deleting a temp directory.
2. `dist/infrastructure/analytics/analyticsGeo.test.js` — 3 cases, GeoIP fixtures absent (later runs often lose the temp-dir case too, hence 4 vs 5).
3. `dist/scripts/content-certify.cli.test.js` — private-key file mode `54 !== 0` on Windows ACL.

Frontend baseline: **630/630 SUCCESS**.

## 2. Per-branch verification (captain-run, unconfined)

| Branch | Command | Result |
|---|---|---|
| `feat/m05-a-provider-core` | `npm test -w apps/backend` | **1023 tests / 971 pass / 5 fail** (only the pre-existing five) |
| `feat/m05-b-ingestion` | same | **1028 / 975 / 5** after fixing one incorrect test (see §5) |
| `feat/m05-c-matchcenter` | `npm run test -w apps/frontend` | **662 / 662 SUCCESS** after fixing two real mapper defects (see §5) |
| all three | `node scripts/run-tsc.mjs` | **exit 0** |

## 3. Integration branch (final)

| Command | Result |
|---|---|
| `npm test -w apps/backend` | **1079 tests / 1027 pass / 4 fail** (all pre-existing) |
| `npm run test -w apps/frontend` | **662 / 662 SUCCESS** |
| `node scripts/run-tsc.mjs` | **exit 0** |
| `node scripts/check-sports-v2-isolation.mjs` | `sports-v2 isolation OK (84 files, 0 legacy imports)` |
| boot smoke (`node dist/server/index.js`) | startup reaches `connectMongoDB` and fails on the deliberately unreachable smoke URI `mongodb://127.0.0.1:1`; no new code path throws earlier |

Net new backend tests: **+111** (968 → 1079). Net new frontend tests: **+32** (630 → 662).

## 4. What the new tests actually assert

- **No fabrication:** absent score stays absent; a real `0` stays `0`; unknown status → `scheduled`,
  never `live`; no minute is ever computed from the kickoff timestamp.
- **Eligibility:** prototype and blocked providers are never selected; when all approved providers
  fail the orchestrator returns the preserved snapshot, never a prototype.
- **Quota/health:** rolling-window bucket denial with `retryAfterMs`; circuit breaker
  closed→open→half-open→closed with probe limit 1; `Retry-After` beats computed backoff;
  a denied request starts the throttle.
- **Identity:** name-only merges refused; men/women and reserve-team merges blocked; two legs kept
  apart; reschedule treated as a MOVE with audit; ambiguity quarantined.
- **Idempotency:** a double tick writes no duplicate snapshots or events (unique index + contentHash).
- **Redaction:** diagnostics never contain a credential or a keyed URL.
- **Frontend:** events/stats/lineups preserved; absent stays `undefined`; dedupe and ordering;
  a disallowed goal never changes the score; every availability state has a message; an absent
  statistic renders `n/d`, never `0`.

## 5. Defects found by really running the suites

| Defect | Caught by | Fix |
|---|---|---|
| Mapper emitted `unit`/`number`/`position`/`substitutedOut` keys with `undefined` | Karma, unconfined | keys omitted when absent (`4eee8f58`, `707178f4`) |
| `mapEvent` dropped side-less events, hiding VAR/disallowed goals | reviewer finding F-2 | side-less events kept |
| `@for track` on non-unique player/stat names | reviewer finding F-1 | `track $index` |
| `RequestBudget` test contradicted its own implementation (throttle vs reserve) | backend suite | test advanced past the throttle (`3c98321e`) |
| OpenLigaDB wrote `''` for a missing scorer/team id | reviewer finding LOW-02 | optional, absent (`f163cb21`) |
| The confined gate returned exit 0 having executed **zero** tests | cross-check of confined vs unconfined | gate now refuses with exit 3 |

## 6. Verification that could NOT be done (and is therefore not claimed)

1. **Real authenticated football-data.org probe** — no `FOOTBALL_DATA_API_KEY` exists. LaLiga,
   Hypermotion, Copa del Rey, UCL, UEL, UECL, Premier League, Serie A, Ligue 1, Primeira Liga,
   World Cup are **not** verified.
2. **A currently live match** — no approved provider supplies a live feed, so live verification is
   **pending**, not passed.
3. **Lineups, statistics, referee, standings** — no free approved source; not verified because
   unobtainable.
4. **Production verification** — nothing deployed.
5. **Performance comparison** (cache hit ratio, SSR impact, payload size, Mongo query cost) — not
   measured; reporting a number here would be fabrication.
