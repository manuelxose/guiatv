# M13-B4 — Stall A: GC attribution and start-up read concurrency

Date: 2026-11-04 · Base `origin/main` = `dd3822b` (M13-B3a merged and deployed) · **Verdict: PARTIAL.** B4a (observation) is an engineering pass, **merged (#168 `77e8d3f`) and deployed with B3b** (`997f61f`, section 7). Root cause of stall A remains **unconfirmed**; no remediation is proposed without evidence.

## 1. Why this milestone

M13-B3 section 13: in a second production process a 4 350 ms CPU-bound stall at 16 s overlapped the in-flight `related_works` catalogue reads **and** `tvread.query`, with 406 GCs totalling 3 242 ms (max pause 297 ms) in the first 60 s window, and a 689 ms request-free stall (CPU ratio 1.94) at 125.7 s in a window whose GC max was 300 ms. GC was a lead, but only from window totals.

## 2. M13-B4a — GC inside each stall (observation only)

Each stall event now carries `gc` = `{ count, overlapMs, maxPauseMs, major }` (collections inside the stall interval, their summed duration **clipped** to it, the longest pause, how many were major mark-compact) and `heapUsedMb`. `overlapMs` close to `durationMs` ⇒ the stall was mostly GC; a small value ⇒ the time went to JavaScript between collections (decode/materialisation). Details:

* Node delivers `gc` PerformanceObserver entries **after** the late timer that records the stall (the first version, which flushed with `takeRecords()`, reported zero GC on Linux CI). A collection is therefore added to every already-recorded stall (including the worst, even after eviction) it overlaps **when it arrives**; the snapshot is authoritative, the one-line log written at record time may show an undercount. A bounded ring (256) keeps recent collections; window totals are unchanged.
* No new timers, no environment variable, no extra database call; `process.memoryUsage()` is read only when a stall is recorded. Failure of any part leaves the stall event intact.
* Tests: injected-clock partial overlaps (before / straddling the start / inside and major / straddling the end), the bounded ring and zero case, and a real allocation-heavy stall reporting real collections (3 consecutive runs). The existing 29 related tests pass. Full backend suite: see section 5.

After a deploy, a stall of the 4 s class answers directly: GC-dominated (`overlapMs ≈ durationMs`, several majors) or JavaScript-dominated (`overlapMs` small). That decides whether the next step is about heap pressure (retain/allocate less at start-up) or about the decode work itself.

## 3. Local GC measurement (no production access)

`artifacts/m13b4/gc-bench.mjs` (the M13-B3 harness plus GC accounting and, with `--concurrent`, a second large read of all `tv_read_airings` started together with the refresh, like `tvread.query` at start-up), 3 runs per arm, throwaway `mongo:8`, Node 24 on the developer machine:

| Rows | Concurrent read | GC total / max pause / majors | Max stall |
|---|---|---|---|
| 20 k | no | 90 ms / 23 ms / 2 | 363 ms |
| 60 k | no | 262 ms / 28 ms / 3 | 1 101 ms |
| 20 k | yes (45 k airings) | 157 ms / 27 ms / 2 | 423 ms |
| 60 k | yes (135 k airings) | 306 ms / 23 ms / 3 | 976 ms |

Reading: locally GC is 5–15 % of the refresh, with pauses ≤ 43 ms, and the stall is the synchronous select + graph pass already analysed in M13-B3; the read phase and a concurrent second large read produce **no** block above 100 ms. Production showed 3 242 ms of GC in 62 s with a 297 ms pause and a 4.35 s block during the reads. **The local setup does not reproduce production stall A**, and the GC lead is therefore neither confirmed nor refuted by it.

Untested differences that could explain it (hypotheses, not findings): production runs **Node 22** (`engines`, CI) while the local runs show Node 24 (different V8/GC heuristics and BSON JIT behaviour); a real network to MongoDB (TLS decryption of large replies runs on the main thread; unknown whether the production connection is TLS or remote); production document shapes and counts; a 6-CPU shared VPS with 12 GB.

## 4. Next steps

1. **Deploy B4a with the owner's approval** and read the next process's 4 s-class stall: GC share, majors, heap, in-flight requests, running steps.
2. In parallel, locally and with the owner's approval to download a Node 22 binary (or a `node:22` image): repeat `gc-bench.mjs --concurrent` under Node 22. If the read-phase block appears, the harness becomes the test bed for remediation (stagger `warm()` after the first `tvread.query`, keep the two large reads out of the same window, project fewer fields where eligibility allows), always with exact output parity (the M13-B3 oracle tests apply).
3. B3b ([#167](https://github.com/manuelxose/guiatv/pull/167)) is still unmerged: it removes the separate 508 ms select + graph event and can be deployed independently.
4. Start-up `--trace-gc` or the CPU profile (window ≥ 150 s) remain options that need the owner's separate authorisation of a configuration change.
5. M13-B2 stays deferred. The blocking SEO/URL remediation (no consumer URL may carry internal ids such as `/contenido/program:<id>`) is untouched.

## 5. Verification and safety

`npm run build` passes; full backend suite from a clean `dist`: **865 tests, 825 pass, 4 fail, 36 skipped**. The failures are pre-existing and environmental (the first three verified identical on the unmodified `cf19518` build in M13-B3): the owner-flow permission test, two replay-manifest tests that call the Git Bash `tar` with a `C:\` path, and the known Windows `editorial runner process starts…` flake (EPERM removing a temp dir, documented in M13-B1). No production request was made in this milestone beyond the two GETs of M13-B3 section 13; no merge, deploy, restart, environment change, database write, index, cache purge or profiler was performed. Rollback: revert the PR (backend only; nothing to switch off).

## 6. Artifacts

`artifacts/m13b4/`: `gc-bench.mjs`, `bench-gc-plain.json`, `bench-gc-concurrent.json` (raw runs, digests and GC figures).

## 7. Merge, deploy and production verification (2026-11-04, on the owner's instruction)

* **CI fix before merge:** the first CI run of #168 failed one test: Node delivers GC entries **after** the late timer, so the stall event was always created with zero GC on Linux. The event is now completed when the collections arrive (also for the worst stall after eviction); a deterministic test covers it. #169 (Node 24 in CI/engines) `2e2d94e`, #168 `77e8d3f`, #170 (B3b rebased on main, replaces #167) `997f61f`; all CI green.
* **Deploy:** `deploy-artifact.yml` run 41861326520 on `997f61f`, build + deploy success. Two sequential public GETs of `/v2/health/metrics` 60 s apart (`artifacts/m13b4/post-deploy-metrics-{1,2}.json`), process uptime 191 s, 0 x 5xx, `diagnostics.requests` and per-stall `gc` present. The VPS Node version was not changed or read.

Stall events of this process (7 recorded, `gc` = collections inside the interval):

| Uptime | Duration | CPU ratio | GC inside (count / ms / max pause / major) | Steps running | Requests open (age) |
|--:|--:|--:|---|---|---|
| 3.5 s | 652 ms | 0.76 | 5 / 29 / 10 / 0 | `boot.container_initialize` | none |
| 4.2 s | 605 ms | 1.05 | 5 / 19 / 5 / 1 | catalogue reads, football refresh | none |
| 4.9 s | 266 ms | 1.74 | 10 / 101 / 35 / 1 | catalogue reads | none |
| **10.1 s** | **3 486 ms** | 1.07 | 141 / **202** / 10 / 0 | `related_works.load/read_airings`, `tvread.query` | `/v2/discovery/browse` (3.5 s) |
| 51.5 s | 507 ms | **3.67** | 1 / **556** / **556** / 1 | none | none |
| **89.5 s** | **3 731 ms** | 1.09 | 169 / 189 / 18 / 1 | **none** | `/v2/catalog/:catalogId/enrichment` (3.8 s) and `/v2/catalog/` (3.8 s), nothing else |
| **191.5 s** | **3 928 ms** | 1.13 | 181 / 252 / 18 / 1 | `tvread.query` | the same two requests (4.0 s / 4.0 s) |

Window GC totals: 372 collections / 2 216 ms (max 556 ms) in the first 62 s; 194 / 361 ms; 41 / 142 ms. 8.2 GB free, load < 1. Correlations, not proofs:

* **The GC hypothesis for the 4 s stalls is refuted by the measurement.** Both 4 s-class stalls at start-up and later spent only 5–7 % of their interval in GC (189–252 ms of 3.5–3.9 s): they are JavaScript between collections. Stall A (10.1 s, during the catalogue reads and `tvread.query`) is decode/materialisation work, not GC.
* **GC does explain the small "unattributed" class:** the 507 ms stall at 51.5 s has no step and no request, one **major** collection of 556 ms and CPU ratio 3.67 (GC helper threads). The earlier 0.4–0.7 s events with ratio ≈ 2 and `correlation: none` are this class.
* **Stall B has a new, specific candidate.** Two ~4 s stalls, 102 s apart (89.5 s and 191.5 s), have **no instrumented step** (once) and exactly the **same two requests open and nothing else, both opened when the stall began**: `GET /v2/catalog/:catalogId/enrichment` and `GET /v2/catalog/`, a pair that arrives together. The same pair was open during a 344 ms stall in the previous process. It is still a correlation (the registry cannot prove which of the two burns the CPU, and the periodicity may be a client polling), but it is the first lead with a request-level signature. The handlers were not inspected in this milestone.
* B3b removed the 508 ms select+graph event: none appears at ≈ 28 s in this process (the 4.9 s event is the read phase). Its effect on user-visible latency was not measured in production.

## 8. Next milestone (M13-B5)

1. Read the handlers behind `GET /v2/catalog/:catalogId/enrichment` and `GET /v2/catalog/` and reproduce a pair locally against the throwaway Mongo (the harness in `artifacts/m13b3` and the in-flight registry give the measurement); look for unbounded reads, large sorts/serialisation or per-request catalogue scans.
2. Stall A (start-up reads + `tvread.query`, JS-dominated): reduce what start-up materialises at once with exact output parity; Node 24 is now the project baseline, so the earlier "Node 22 vs 24" local question is moot.
3. M13-B2 stays deferred. The blocking SEO/URL remediation (no consumer URL may carry internal ids such as `/contenido/program:<id>`) is untouched.
