# M06 — Baseline audit

Date: **2026-11-06**. Author: captain. Branch under audit: `feat/sports-v2-m05-integration`.

Every number here was produced by a command executed on this machine during this session. Nothing
is copied from an earlier report without being re-measured; where a value is re-measured the two
are compared explicitly.

---

## 1. Repository state

| Item | Observed value |
|---|---|
| Current directory | `C:\Users\Admin\Documents\workspace\guiatv` |
| Branch | `feat/sports-v2-m05-integration` |
| HEAD | `05142eca` (`docs(m05): provider research, licensing, architecture, coverage, test evidence, review and delivery`) |
| Commits above the recorded M05 integration | `f163cb21` (LOW-02 fix), `05142eca` (M05 documentation) |
| Remote | `origin` → `https://github.com/manuelxose/guiatv.git` |
| `main` | not checked out locally; merge to `main` triggers `deploy-artifact.yml` |

### 1.1 M05 component branches

The mission brief lists three component branches. **All three are already merged** into the
audited branch: `git log HEAD..<branch>` returns empty for each of them.

| Branch | Tip | Merged into audited branch? |
|---|---|---|
| `feat/m05-a-provider-core` | `fc3a6e71` | yes |
| `feat/m05-b-ingestion` | `5099c20c` | yes |
| `feat/m05-c-matchcenter` | `23130390` | yes |

Consequence for M06: there is no outstanding M05 work to reconcile. The integration base for M06
is `05142eca`, and the brief's instruction not to "casually merge M05 into main" is honoured by
never touching `main` at all.

### 1.2 Untracked work found in the working tree

One pre-existing untracked file was present at session start: `artifacts/baseline-prod-tests.txt`
(created 2026-11-06 01:09). It is **not** M06 work and was not created by this session. Because the
ENGINE-03 toolkit refuses to create a worktree from a dirty repository, it was preserved verbatim in
`git stash@{0}` (message `m06-captain-preserved: artifacts/baseline-prod-tests.txt (pre-existing untracked)`)
rather than deleted. Restore with `git stash pop` (or `git checkout stash@{0} -- artifacts/baseline-prod-tests.txt`).

---

## 2. Test baseline — re-measured, not quoted

### 2.1 Backend

Command (from `apps/backend`):

```
npm run build --silent
node --require ./test-setup.cjs --test --test-reporter=tap "dist/**/*.test.js"
```

Result:

| Metric | Value |
|---|---|
| tests | **1079** |
| pass | **1027** |
| fail | **4** |
| skipped | **48** |
| cancelled | 0 |

The four failures, by name:

1. `GeoIP: IPv4/IPv6 city + ASN, explicit uncertainty, private/malformed/unknown addresses`
2. `GeoIP: disabled, missing database, corrupt refresh keeps the previous reader, changed file is reloaded`
3. `GeoIP: on by default, MaxMind preferred over DB-IP Lite, DB-IP records (no region code, no radius) understood`
4. `owner flow: only the owner key can authorise the exact committed batch; …` — asserts POSIX file
   mode `54 !== 0`, impossible on Windows ACLs.

All four are the environmental failures documented in `M05-TEST-EVIDENCE.md`. **The measured
baseline matches the supplied M05 evidence exactly (1079 / 1027 / 4).** `skipped 48` is now
recorded explicitly; M05's report did not state a skipped count.

A separate earlier run in the same session additionally failed
`stepTimeline.test.js › an async step that only waits shows wall time far above its cpu time` —
a wall-clock-versus-CPU timing test that is load-sensitive and flipped between runs. It is recorded
here as **flaky under load**, not as a stable baseline failure; the M06 gate must not score it as a
regression if it appears once.

**Zero-test guard**: the M06 gate treats a run reporting `tests 0` as a failure regardless of exit
code, per the M05 near-false-green defect (`M05-TEST-EVIDENCE.md` §5).

### 2.2 Frontend

Command: `npm run test -w apps/frontend`

Result: `Executed 662 of 662 SUCCESS`, `TOTAL: 662 SUCCESS`. Matches the M05 evidence exactly.

### 2.3 Not re-run at baseline

`node scripts/run-tsc.mjs`, the isolation check and the SSR production build are cheap to re-run and
are therefore executed on the integrated branch at delivery, not at baseline. Their M05 values
(`exit 0`; `84 files, 0 legacy imports`) are carried as claims to be re-verified, not as M06 facts.

---

## 3. Real provider probing performed at baseline

All probes are anonymous read-only GETs. Raw JSON is committed under
`artifacts/m06/probes/`; the scripts that produced it sit beside them and are re-runnable.

### 3.1 Endpoint sweep

| Endpoint | Status | Bytes |
|---|---:|---:|
| `GET api.openligadb.de/getavailableleagues` | 200 | 123,502 |
| `GET api.openligadb.de/getcurrentgroup/bl1` | 200 | 60 |
| `GET api.openligadb.de/getmatchdata/bl1` | 200 | 7,798 |
| `GET api.openligadb.de/getmatchdata/liga1/2026/8` | 200 | 2 (`[]`) |
| `GET api.openligadb.de/getmatchdata/spa1/2026` | 200 | 2 (`[]`) |
| `GET api.openligadb.de/getmatchdata/ucl/2026` | 200 | 520,599 |
| `GET www.thesportsdb.com/api/v1/json/123/all_leagues.php` | 200 | 750 (truncated demo payload) |
| `GET raw.githubusercontent.com/openfootball/football.json/master/2026-27/es.1.json` | 200 | 50,542 |
| `GET raw.githubusercontent.com/openfootball/football.json/master/2026-27/en.1.json` | 200 | 55,359 |
| `GET raw.githubusercontent.com/openfootball/football.json/master/2026-27/de.1.json` | 200 | 40,307 |
| `GET api.football-data.org/v4/competitions/PD/matches` | **403** | 152 |

### 3.2 The finding that changes M06's scope

OpenLigaDB was approved in M05 for Bundesliga only (`bl1`). Probing its season-2026 catalogue shows
it carries **real 2026/27 data for far more than the Bundesliga**:

| OpenLigaDB code | Competition | Fixtures | Finished | Goals | Goals without a resolvable side | Final score ≠ last goal |
|---|---|---:|---:|---:|---:|---:|
| `bl1` | 1. Bundesliga | 306 | 72 | 252 | 0 | 0 |
| `bl2` | 2. Bundesliga | 306 | 90 | 271 | 1 | 0 |
| `pl` | Premier League | 380 | 71 | 204 | 1 | 1 |
| `ucl` | Champions League | 144 | 72 | 291 | 0 | 0 |
| `uel2026` | Europa League | 144 | 72 | 214 | 0 | 2 |
| `uecl2026` | Conference League | 108 | 54 | 148 | 1 | 0 |
| `wm2026` | World Cup 2026 | 72 | 72 | 213 | 1 | 4 |
| `dfb` | DFB-Pokal | 56 | 48 | 241 | 0 | 5 |

"Final score ≠ last goal" is the number of finished matches where the last goal event's running
score does not equal the recorded final result — a real data-quality signal that the M06 quality
console must surface rather than hide. **0 matches have a final result missing.** Venue
(`location`) is absent on all finished Bundesliga matches at probe time and present on 8 of 72 UEL
matches, so venue is genuinely partial, not universal.

### 3.3 What OpenLigaDB does **not** carry (confirmed against the raw payload schema)

Present fields: `matchID, matchDateTime, timeZoneID, leagueId, leagueName, leagueSeason,
leagueShortcut, matchDateTimeUTC, group, team1, team2, lastUpdateDateTime, matchIsFinished,
matchResults, goals, location, numberOfViewers`.

Absent: **referee, lineups, player-level statistics, team statistics, standings table, live minute**.
`lastUpdateDateTime` is fresh (2026-11-05/06 for the active competitions), which is the only
freshness signal available and must be used as such — it is **not** a live minute.

### 3.4 LaLiga — the shortfall, stated plainly

LaLiga is **not available free in 2026/27 from any source probed**:

- OpenLigaDB `la1@2014`, `spa1@2026`, `pl1@2026` → `[]`. The code `esp@2026` returns an unrelated
  "ESP8266" league and must never be interpreted as Spain.
- OpenFootball `2026-27/es.1.json` exists with 380 fixtures, but **scores stop at matchday 7
  (2026-09-20)**, contain only `ht`/`ft` with no goal events, and have no live data. Its staleness
  means activating it would publish month-old results as if current.
- football-data.org → 403 without a key; republication rights remain unresolved since M05.

Therefore the M06 acquisition objective is **PARTIAL by construction**: several UEFA competitions and
the Premier League become available, LaLiga and the Spanish domestic competitions do not.

---

## 4. M05 review findings carried into M06

The full matrix is in `M06-M05-FINDINGS-MATRIX.md`. The two that block a truthful product are:

- **LOW-01** — dormant placeholder defaults in the football-data.org adapter. Must be stripped
  before anything else is activated, and absent provider fields must stay absent.
- **LOW-09** — the public match page hardcodes `hasApprovedProvider: true`
  (`apps/frontend/src/app/sports-v2/pages/match-details.ts:166`), which makes the already-implemented
  `competition_not_covered` state unreachable. The fix must bind it to real per-competition coverage.

Ten further LOW findings (LOW-02…LOW-12) remain; LOW-02 is already fixed in `f163cb21`.

---

## 5. Environment facts that constrain M06 verification

| Fact | Value | Consequence |
|---|---|---|
| Node | 24.18.0 | matches `engines: >=24` |
| npm | 12.0.1 | — |
| Shell language mode | ConstrainedLanguage | `.NET` static calls fail; probes are written in Node, not PowerShell |
| MongoDB | not installed; nothing on `127.0.0.1:27017` (`ECONNREFUSED`) | real-database evidence needs a workaround; absence must be reported, not faked |
| Docker | client 29.9.2, **daemon not running** (`dockerDesktopLinuxEngine` pipe missing) | same as above |
| Live data window | Bundesliga `83234` (Hamburger SV v Borussia Mönchengladbach) kicks off **2026-11-06T19:30Z ≈ 20:30 local** | a real live-verification opportunity exists later today |

---

## 6. Baseline verdict

| Dimension | Baseline state |
|---|---|
| Repository | clean, single integration branch, M05 fully merged, nothing on `main` |
| Backend suite | 1079 / 1027 pass / 4 known environmental failures / 48 skipped — **reproduced** |
| Frontend suite | 662 / 662 — **reproduced** |
| Provider coverage | Bundesliga + (newly discovered) PL, UCL, UEL, UECL, WC2026, DFB-Pokal; **no LaLiga** |
| Live data | fixtures and results available; no live minute, no lineups, no statistics, no referee, no standings from any approved source |
| Real database | **unavailable at baseline** — must be resolved or the ingestion evidence will be labelled accordingly |

Nothing in this audit is a claim of completeness: it is the measurement M06 will be judged against.
