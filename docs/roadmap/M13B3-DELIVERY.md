# M13-B3 — Event-loop stall attribution and related-works remediation

Date: 2026-11-04 · Base `origin/main` = `cf19518` (#165) · Branches `m13b3a-request-stall-observability` (M13-B3a) and `m13b3b-related-works-bounded-read` (M13-B3b, stacked on B3a) · **Verdict: PARTIAL.**
**Update (the owner authorised B3a only):** [#166](https://github.com/manuelxose/guiatv/pull/166) (B3a) was squash-merged as `dd3822b` and deployed with `deploy-artifact.yml` run 41843530126 (build + deploy success), then verified with two sequential public GETs of `/v2/health/metrics` (section 13). [#167](https://github.com/manuelxose/guiatv/pull/167) (B3b) is **not merged and not deployed** (draft, awaiting the owner). No restart, environment change, database write, index creation, cache purge or profiler activation was performed.

| Axis | Status |
|---|---|
| Observability engineering (B3a) | **ENGINEERING PASS, merged `dd3822b`, deployed, verified in production** (section 13). |
| Root-cause attribution, stall A (3 711 ms at 9.5 s) | **Recurs in a second production process (4 350 ms at 16 s), still unconfirmed**: it overlaps the catalogue reads and a concurrent `tvread.query`, with heavy GC in the window (section 13). Not reproduced locally (section 4.3). |
| Root-cause attribution, stall B (4 138 ms at 98.3 s) | **Unresolved.** Not seen again in the second process (to 178 s); a smaller class of unattributed stalls (0.4–0.7 s, `correlation: none`, no request open, CPU ratio ≈ 2) recurs at 94–129 s and is **not** request-caused (section 13). |
| Performance remediation (B3b) | **Local engineering PASS, bounded improvement only**: removes the synchronous refresh block that was reproduced locally. Does **not** claim to fix A or B. |
| Merge / deployment / production verification | **B3a: merged, deployed, verified** (fields live, 0 x 5xx). **B3b: not merged, not deployed.** |

## 1. Baseline

`origin/main` `cf19518` confirmed before branching (local `main` was 16 commits behind; the untracked M09–M11 artifacts of the owner's checkout were not touched). Work lives in the worktrees `../guiatv-m13b3` (branches) and `../guiatv-m13b3-base` (unmodified `cf19518` build used as the benchmark baseline). The M12 worktrees were not touched. Starting facts: section 14 of [M13B1-DELIVERY.md](M13B1-DELIVERY.md) and `artifacts/m13b1/post-deploy-metrics.json`.

## 2. M13-B3a — request-level stall attribution (observation only)

### 2.1 What was built

* `InflightRequestRegistry` (`shared/utils/inflightRequests.ts`) mounted by `inflightRequestTracker` as the **first** middleware of `createApp`, before the sitemap routes, CORS, compression and body parsing, so a stall before routing is still seen.
* Each stall event now carries `requests` (active count, in-flight requests oldest first with age, requests that **completed** inside the stall interval longest first, per-route grouping, omitted count) and `correlation` ∈ `none | steps | requests | steps+requests`. `none` is the explicit "unattributed" class: nothing instrumented overlapped, no cause is guessed.
* A request that blocks the loop synchronously has usually already finished (its `finish` runs on `nextTick`, before the next timers phase) when the 100 ms timer fires, so the completed ring is part of the evidence, not only the in-flight set.
* Route labels: `req.baseUrl + req.route.path` when it is a string that passes a character whitelist and 120-char cap; otherwise the fixed `(unresolved)` (no route matched yet: still in earlier middleware), `(unmatched)` (finished without a route) or `(other)`. Methods come from a fixed list. At most 1 024 distinct labels per process, 256 tracked entries (when full the **oldest** are kept and newcomers only counted), 128 completed, 8 reported per list.
* Never stored: URL, query, headers, cookies, IP, body, user id. `/v2/health/metrics → diagnostics.requests` exposes counters only.
* Named background steps (never in the start-up list, kept only when ≥ 100 ms) for `sitemap.build.<key>` (nine fixed keys) and `tvread.query|channels|schedule`, the two heavy paths that had no step.
* **A request in flight during a stall is a correlation, never a proven cause**; the field names, doc comments and this report keep the two classes apart.

### 2.2 Verification

* `inflightRequests.test.ts` (15 tests): concurrency, abort, route resolution, missing/regex/hostile templates, cleanup incl. double close, all cardinality bounds, stall-time snapshot, redaction (secret in URL, header, cookie, IP, body, user, hostile `baseUrl`), exception safety (throwing clock/getter/provider), overhead, real sockets (bytes unchanged, abort, handler error) and a **real blocking handler named by route** in a real stall event, plus a guard that fails if any router mount carries a `:param` (`req.baseUrl` is the resolved path). Plus `stepTimeline` tests for the `background` option.
* Overhead: `begin`+finish ≈ 1–2 µs (test ceiling 20 µs); loopback Express, 6 runs/arm ABBA, 3 s each: **31 703 vs 31 464 req/s** (median), p50 0.469 vs 0.451 ms, p99 1.094 vs 1.101 ms: no effect distinguishable from noise (`artifacts/m13b3/inflight-overhead.*`).
* Full backend suite: section 7.

### 2.3 Audit: could stall B come from another catalogue read?

* Every path that reaches `indexableWorks()` (warm-up, the sitemap through `indexableWorkPaths`, the `works` sitemap that the sitemap index also triggers) goes through the same `related_works.*` steps. Stall B overlapped **none** of them, and `warm()` had finished at 25 s, so **it was not an `indexableWorks` read**. The 41.9 s sitemap-triggered read produced only a 314 ms stall (steady state), which also shows the 3.7 s of stall A is not simply "the size of the read".
* Not instrumented at `cf19518` and therefore **candidates** (none proven): `TvReadQueryService` reads and its response building (`tv/read` payload ≈ 2.4 MB), the non-works sitemap builders (programmes eligibility, channels, blog, streaming, football), large JSON serialisation, `InMemoryCache.cleanup` (60 s interval; does not match 98.3 s), the Socket.IO metrics timer. EPG sync, schedule precompute and cleanup run in child processes (`createIsolatedJobRunner`), and the stall CPU is this process's own, so they are excluded. The football refresh is a named step.
* B3a instruments the first two classes by step name and lists the in-flight/completed requests for all of them. **Stall B stays an explicit unresolved finding until a deployed B3a records one.** No claim that fixing the `RelatedWorkIndex` path fixes B.

## 3. M13-B3b — related-works refresh

### 3.1 Hot path analysis

`RelatedWorkIndex.refresh → indexableWorks`: one `MediaCatalogModel.find({tmdbId:{$type:'number'}})` (projection already minimal: only the fields eligibility, ambiguity and content-quality read; `castSummary:{$slice:3}`; `synopsis` is needed for its length), one `TVReadAiringModel.aggregate` (`$group`, `allowDiskUse`), the selection loops (`byKey` map, per-row `workDisposition`, path dedupe, sort) and `new RelatedWorkGraph` (SHA-1 ring hashing).

### 3.2 Strategies evaluated

| Strategy | Decision | Evidence |
|---|---|---|
| A. cursor + `batchSize` 500/1 000 with yielding | **Built, benchmarked, removed.** | Ablation (`bench-ablation-cursor-variant.json`, 7 runs, 3 sizes, produced at commit `02fe98a`): cursor-only keeps the stall (354/1 007/2 475 ms vs baseline 449/920/2 560) and costs extra round trips (batch 500: 55/165/412 getMores vs 35/105/263) and up to +20 % CPU; `batchSize` 1 000 adds nothing over slicing. No local evidence that the read decode is a block, so no read change is made. |
| B. smaller projection / fewer records | Not adopted. | Projection is already minimal; fetching only aired rows needs a second read for non-aired namesakes (ambiguity needs them) and the aired share of `media_catalog` is unknown (the catalogue is built from EPG airings, so likely high). Parity risk without a demonstrated gain. |
| C. shared snapshot / single-flight between sitemap and related-works | Not adopted. | Only helps when the two reads overlap; would change the sitemap's freshness semantics. Candidate for later if production shows overlapping `related_works.load` steps. |
| D. worker thread | Not adopted. | Needs its own Mongo connection/model bootstrap and failure handling. Returning only the 11–84 k selected works costs a structured clone of 17 / 58 / 138 ms on the main thread (measured), more than the sliced approach blocks. |
| E. deferred warm-up | Not adopted. | Moving the same block later does not shrink it; rails would be absent longer. |
| **Time-sliced selection + graph build** | **Adopted.** | Below. |

### 3.3 What changed

`TimeSlice` (cooperative yield through `setImmediate` once an 8 ms slice is spent: a microtask `await` never reaches the timers phase). The aired-key `Set`, the `byKey` grouping, the per-row selection and the ring construction/sorting yield between slices; the final sort is one block. `selectIndexableWorks` keeps its per-row logic (`workOfRow`) as the synchronous reference. `RelatedWorkGraph.buildSliced` produces the same rings; the finished graph still replaces the previous one in a single assignment, a failed read **or build** keeps the last good graph, TTL and 60 s back-off unchanged. Public API, routes, canonicals, robots, sitemap eligibility and the Mongo queries are unchanged. `related_works.select_works` and `build_graph` are now async (not flagged `sync`) steps.

## 4. Measurements (local only, throwaway `mongo:8` container, no production access)

Harness `artifacts/m13b3/related-works-bench.mjs`: synthetic but realistically shaped data (1.85 KB documents, 6–11 cast members, 1–3 genres, ~2 % namesakes, ids shared across kinds, 3 airings per aired work), fresh child process per run (cold JIT like a boot), ABBA order, 7 runs per arm, baseline = unmodified `cf19518` build, `control` = a second baseline arm (A/A). Medians; `maxStall` is the largest lateness of a 5 ms timer. **Dataset size in production is unknown**; at 20 k rows (11 k works) the baseline reproduces the production synchronous select+graph magnitude (production: 261 + 273 ms).

| Rows (works) | Arm | Max stall ms (range) | Stalls ≥ 250 ms | Event-loop p99 ms | Wall ms | CPU ms | Peak RSS / heap MB | getMores |
|---|---|---|--:|--:|--:|--:|---|--:|
| 20 k (11 173) | baseline | **378** (331–407) | 1 | 32.7 | 1 108 | 1 250 | 326 / 151 | 35 |
| | control (A/A) | 366 (342–548) | 1 | 33.7 | 1 171 | 1 359 | 324 / 151 | 35 |
| | candidate | **26** (24–35) | 0 | 30.3 | 1 157 | 1 360 | 331 / 152 | 35 |
| 60 k (33 949) | baseline | **951** (880–1 400) | 1 | 29.9 | 2 880 | 3 141 | 536 / 327 | 105 |
| | control | 984 (874–1 276) | 1 | 30.5 | 2 993 | 3 313 | 536 / 327 | 105 |
| | candidate | **36** (31–42) | 0 | 30.8 | 3 327 | 3 406 | 537 / 322 | 105 |
| 150 k (84 440) | baseline | **2 395** (2 301–3 985) | 1 | 33.0 | 7 546 | 8 031 | 802 / 593 | 263 |
| | control | 2 716 (2 365–4 099) | 1 | 34.6 | 7 839 | 8 485 | 805 / 595 | 263 |
| | candidate | **84** (65–121) | 0 | 30.5 | 8 473 | 9 203 | 802 / 604 | 263 |

Reading:

* **Blocking time** falls 14× / 26× / 29× (never above 121 ms in any run, target "no stall above 250 ms" met); **total time** rises 4–12 % and **CPU** 9 % / 8 % / 15 % (yield overhead); memory is unchanged. Database traffic is identical (same queries, same getMores). The remaining blocks grow with the catalogue (final sort, GC, one batch decode): the guarantee is "bounded at the sizes measured", not size-independent.
* Per-step attribution: in every baseline run the worst late tick overlaps `build_graph` and `select_works` and no read step as the running one; in the ablation the cursor-only arm keeps exactly that stall. The stall is the **contiguous synchronous select + graph pass** (2 395 ms ≈ 924 + 1 832 ms of the two steps at 150 k).
* Output equivalence: for all three sizes and every run the SHA-256 of the full `IndexableWork[]` and of every work's `related()` answer is identical in all arms (`outputIdentical: true`, `digestsStable: true`).

### 4.3 What the local data does **not** show

Production stall A (3.7 s, CPU-bound, overlapping the **reads** and not the sync steps) is **not reproduced**: locally the read phase never produced a block above 100 ms in any arm (loopback network, 20–150 k rows). Possible reasons (all untested): production document shapes/sizes, a cold-JIT boot contending with other start-up work, driver behaviour on a real network, or a different cause. So B3b is **not** evidence that stall A is fixed or even explained; the original hypothesis (decode of the read on the main thread) stays **probable, unconfirmed**. In steady state the same read cost only a 314 ms stall in production (41.9 s sample), which argues against a pure "read size" explanation. Confirming it needs the B3a evidence or an authorised start-up CPU profile (`DIAG_CPU_PROFILE=startup` + `DIAG_CPU_PROFILE_DIR`, 60 s covers 9.5 s but **not** the 98 s stall; use ≥ 150 s if authorised).

## 5. SEO parity (exact)

`WorkSeoPolicy.parity.fixtures.ts` holds a **literal copy of the cf19518 selection** as oracle. `WorkSeoPolicy.parity.test.ts`: oracle = synchronous reference = sliced selection, deep-equal on paths, fields and order, for a fixture covering verified works, ambiguous identities, three TMDB candidates for one title, same numeric id across movie/tv, missing / null / malformed genres, thin content (synopsis, poster, cast/directors, year, un-enriched), the short-synopsis tier, accent-variant slug collisions, untitled works, malformed ids, duplicate rows (one destination), historical broadcasts and never-aired works; a seeded property test (3 seeds × 4 000 rows, 12 % namesakes); graph equivalence (identical rings, identical `related()` for every work at limits 3 and 8, a work outside the set) and the **M10-B no-orphan guarantee** on the sliced graph; atomic swap (an in-flight refresh never exposes a partial graph, a failing build keeps the last good one). With `TEST_MONGO_URI` (run locally against `mongo:8`): the real reads give the oracle result for 2 600 rows, a catalogue write during the refresh leaves a sorted, unique result containing every pre-existing work, failing reads reject and recover, and the existing M09-C mongo test passes. Benchmark digests above give the same equality at 20 k–150 k rows. No canonical, robots, sitemap-eligibility or route change; no new indexable page; no orphaned verified work in any fixture.
Caveats: the Mongo tests are skipped without `TEST_MONGO_URI` (like the other `*.mongo.test.ts`); `canary` mode is not re-tested (cohort code untouched); the existing code throws on a `null` entry inside `tmdbGenres` (before and after: left unchanged, not part of this milestone). `RelatedWorks.test.ts` was changed in one line: it waited a single loop turn for the refresh, now it awaits the refresh itself because the build may yield.

## 6. Independent reviews (three separate read-only agents, actually run on `cf19518..HEAD`)

* **Node CPU / event loop — no blocking.** Applied: when the registry is full it now keeps the oldest entries; a quick failure of a `background` step no longer fills the recent ring (an attacker could have pushed out stall evidence with invalid dates). Accepted/documented: `correlation` is `requests` under any traffic so `none` is rare (the field is a candidate list, not a verdict); a `finally`-close of the (abandoned) cursor is moot now that no cursor is used; one `ring.sort` is an unsplittable block (≈ 3–8 ms at 13 k works); a step whose promise never settles holds one of 64 `active` slots (pre-existing).
* **MongoDB batching / memory — no blocking.** Findings drove the decisive experiments: the review asked for an ablation arm, per-step stall attribution, a real A/A control and ≥ 7 runs; all were added and the cursor/`batchSize` change was **removed** because the ablation showed it contributes nothing. Remaining accepted limits: synthetic data on loopback, no concurrent request load, the 25 ms memory sampler is starved during baseline blocks (baseline peaks are lower bounds), a changing collection during a longer scan can duplicate/skip a document (same as before, the stretch is now longer under contention).
* **SEO parity / reliability / security — no blocking.** Equivalence confirmed by code comparison; no URL/query/header/cookie/IP/body/user/token can reach a snapshot, log line or the public metrics. Applied: label cap 256 → 1 024 (the v2 router is mounted twice, ~230 templates) and a test that fails if any router mount carries a `:param` (a resolved `baseUrl` would otherwise put request data into labels). Accepted: internal route templates appear in the public stall list (the API surface is already documented at `/docs`).

## 7. Tests

`npm run build` passes. Full backend suite after the last change (Git Bash, without `TEST_MONGO_URI` for the full run): **876 tests, 829 pass, 3 fail, 44 skipped** (`cf19518` baseline before: 846 → the new tests). The three failures are pre-existing and environmental, **verified to fail identically on the unmodified `cf19518` build**: `owner flow …` (`content-certify.cli.test`, Windows file permissions) and two replay-manifest tests whose `tar xzf C:\…` fails under Git Bash's `tar` ("Cannot connect to C:"); they need PowerShell's `tar`. Frontend/SSR suites not run: no frontend, SSR, route, canonical or robots file changed.

## 8. Production safety

Nothing outside the repository was changed. Production was **not** contacted in this milestone (no GET at all; the evidence is the existing M13-B1 snapshot). Docker containers were local and are removed. Nothing is enabled by environment: no new variable; `DIAG_CPU_PROFILE` stays off.

## 9. Rollback

Each PR is independently revertible (backend only, no data/schema/index/contract): revert B3b (`m13b3b…`) to restore the synchronous refresh without touching the observability; revert B3a to drop the registry (B3b does not depend on it at runtime). After a deploy, the operational rollback is `sudo /var/www/guiatv/scripts/guiatv-ops.sh rollback` (M13-A section 12).

## 10. Is M13-B2 justified?

No new evidence: the two slow catalogue misses of M13-B1 were stall victims. **Keep deferred** until a stall-free window shows multi-second `tmdb_discover`/`providers`.

## 11. Next executable milestone

1. Owner decision to merge/deploy B3a (observation only) → collect `stalls.recent[*].requests` / `correlation` from a fresh process, **sequential public GETs only**; this is the only way to attribute stall B (and to see which requests overlap stall A).
2. Then decide on B3b (deploy is independent): expected production effect = no ≥ 250 ms stall from the refresh's select+graph phase; verify with `related_works.*` steps and stall events, and do **not** present it as the fix for A or B.
3. Optional, needs separate authorisation: start-up CPU profile with a window ≥ 150 s.

The standing blocking SEO/URL remediation (no consumer URL may carry internal ids such as `/contenido/program:<id>`) is untouched and **not** resolved here.

## 12. Artifacts

`artifacts/m13b3/`: `inflight-overhead.mjs/.json`; `related-works-bench.mjs` (harness), `bench-final.json` (baseline / A/A control / candidate, 7 runs × 3 sizes, raw runs and digests), `bench-ablation-cursor-variant.json` (the removed cursor variant, run at commit `02fe98a`), `bench-aa-control.json` (first A/A smoke run). Reproduce: build `cf19518` and the branch, then `node artifacts/m13b3/related-works-bench.mjs --base <cf19518>/apps/backend --candidate apps/backend --runs 7 --aa` (needs Docker).

## 13. Production verification of B3a (2026-11-04, after the deploy of `dd3822b`)

Deploy: `deploy-artifact.yml` run 41843530126, build and deploy jobs success, on the owner's explicit instruction. Verification: two sequential public GETs of `https://guiaprogramaciontv.com/v2/health/metrics` 45 s apart (honest user agent, no other request, no cache purge, no restart): snapshots `artifacts/m13b3/post-deploy-metrics.json` (uptime 109 s) and `post-deploy-metrics-2.json` (uptime 178 s). One process lifetime (n = 2 together with the M13-B1 process): these say what happened in these processes, not how often.

**B3a works in production.** `diagnostics.requests` is present (counters only: active 1, peak 10, 394 started, 0 evicted, 30 labels); every stall event carries `requests` and `correlation`; route templates are real (`/v2/discovery/home`, `/v2/tv/read`, `/v2/catalog/slug/:contentType/:slug`…); no URL, query or identifier appears; 0 x 5xx. The label count (30) is far below the cap.

Stall events of this process (13 recorded; time = process uptime, `*` = step still running):

| Uptime | Duration | CPU ratio | Correlation | Steps | Requests (in flight, oldest age) |
|--:|--:|--:|---|---|---|
| 4.0 s | 793 ms | 0.79 | steps | `boot.container_initialize`, `boot.container.cache*` | none |
| 6.0 s | 1 932 ms | 0.94 | steps | `boot.channel_alias_load*`, `tvread.channels*`, `related_works.load/read_media_rows/read_airings*`, football refresh | none yet |
| 7.6–10.9 s | 285–765 ms (6 events) | 0.94–2.2 | steps+requests | same reads * + `tvread.query*` | `/v2/discovery/home` ×2 (to 2.5 s), `/v2/tv/read` ×2, `/v2/tv/read/channels` ×2, `/v2/discovery/browse` |
| **16.0 s** | **4 350 ms** | **1.12** | steps+requests | `related_works.load/read_media_rows/read_airings*` **and** `tvread.query*` | `/v2/discovery/browse` ×1 (4 668 ms), `/v2/catalog/slug/:contentType/:slug` ×1 (4 665 ms); `/v2/discovery/browse` completed (655 ms) |
| 28.1 s | 508 ms | 1.69 | steps | `related_works.select_works`, `build_graph` (the synchronous pass B3b slices) | none |
| 34.8 s | 344 ms | 1.29 | steps+requests | `tvread.query` ×2 | `/v2/catalog/:catalogId/enrichment`, `/v2/catalog/`, telemetry heartbeat |
| **125.7 s** | **689 ms** | **1.94** | **none** | none | **none open, none completed in the interval** |

What this adds (correlations, not proofs):

* **Stall A recurs (n = 2 processes) and is not an artefact of one start-up.** A 4.35 s CPU-bound stall at 16 s again overlaps the in-flight `related_works` catalogue reads, not the synchronous select/build (that one is the separate 508 ms event at 28 s, the block B3b removes locally). New: `tvread.query` is **also** running during it, and two requests that started ≈ 4.7 s earlier (`/v2/discovery/browse`, `/v2/catalog/slug/…`) were open; several large reads decode at the same time. The registry cannot say which is the CPU consumer. **B3b does not address this stall.**
* **GC is heavy and is a strong new lead.** The first 60 s window recorded 406 GCs totalling 3 242 ms (max pause 297 ms) against 227 ms in the next window; the M13-B1 process had a 48–90 ms max. Stalls with CPU ratio > 1 are consistent with GC helper threads. A start-up that materialises a very large number of BSON-decoded objects on the main thread and the young-generation churn that follows is the most plausible mechanism, but this is **correlation from window totals, not an attribution**.
* **The 125.7 s stall (689 ms, ratio 1.94) has no request and no step.** It is in a window whose GC max is 300 ms (previous quiet window: 57 ms). The M13-B1 process had the same signature at 94 s (435 ms, 1.85) and 129 s (447 ms, 2.01). So the recurring small "unattributed" class is **not caused by a request**; a major GC is the leading candidate and is again unproven.
* **Stall B (4 138 ms at 98 s, no step) did not recur** in this process (observed to 178 s). It remains unresolved; if it was this same non-request class at a larger scale, it would point at GC or a timer, not at a request.
* **Host:** load 0.67–0.77, 8.2 GB free, 10 involuntary context switches in the 689 ms event: host contention is again not supported.

Revised next steps, in this order: (1) a GC-focused observation (windowed GC figures already exist; `--trace-gc` or the start-up CPU profile would confirm it and need the owner's separate authorisation for a configuration change; a profile must cover ≥ 150 s); (2) reduce what start-up materialises at once (the two catalogue reads and `tvread.query` decode large results concurrently; options to evaluate with measurement and exact output parity: stagger `warm()` after the first `tvread.query`, keep the airings read out of the same window, project fewer fields only where eligibility allows); (3) B3b can be deployed independently for its 508 ms event. M13-B2 stays deferred.
