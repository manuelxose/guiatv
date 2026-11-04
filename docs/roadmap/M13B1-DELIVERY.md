# M13-B1 — Production performance diagnostics and event-loop stall attribution

Date: 2026-11-04 · Branch `feat/m13-b1-perf-diagnostics` · draft PR (see the PR list) · **Verdict: ENGINEERING PASS (instrumentation) · production diagnosis PARTIAL**
Scope: observability only. No runtime behaviour, public contract, URL, canonical, robots, sitemap, SSR or EPG-identity change. Nothing merged, deployed, restarted or reconfigured in production.

## 1. Baseline

| Item | Value |
|---|---|
| Base | `origin/main` = `2334f71` (M13-A docs, #163); code baseline `b4978a9` (#162). Local `main` was behind; work is in the new worktree `../guiatv-m13b1`. |
| Production release observed | **Not observable** (BLOCKED, section 6). The process answering at 12:26–12:31Z had `uptimeSeconds` 2735→3011, i.e. it started ≈11:41Z. Whether that process is the #162 deploy was not verified, and the release id was not read. |
| Protected state | M12 worktrees, the `m11b-review-fixes` stash patch and the untracked notes were not touched. `docs/roadmap/M13A-DELIVERY.md` is the M13-A source of truth. |
| Existing M13-B work | None existed (no branch, no PR, no code referencing the M13-B1 names). |

## 2. What was observable before this milestone (phase 1 map)

| Metric | Code path | What it really measures | Blind spot |
|---|---|---|---|
| `process.eventLoopLagMs.{mean,p95,max}` | `runtimeMetrics.ts` `monitorEventLoopDelay` since process start | process-lifetime histogram; `max` never decreases | cannot say **when**, how often, or what was running; a start-up stall is indistinguishable from yesterday's |
| `mongo.latencyMs` | `measureTiming('db')` in Football news, Blog list/categories, `TvReadQueryService.loadQuery` (also tagged `epg`) | request-observed wall clock around an `await` (pool wait, BSON decode, loop wait included) | catalogue and content routes record no `db` phase; not MongoDB execution time |
| `Server-Timing` of `/v2/catalog` | `CatalogService.query` had **no** `measureTiming` | only `total` | cold-miss phases (cache, TMDB, providers, Mongo reads, TV read, transform) invisible |
| Start-up | `server/index.ts`, `container.initialize`, `RelatedWorkIndex.warm()`, football first refresh | one `Container initialized` log with `totalMs` | no per-step time, no CPU vs wait, nothing to correlate a stall with |

## 3. Changes (files)

New (`apps/backend/src/shared/utils/`): `diagnosticsCommon.ts` (bounded buffers, `LogBudget`, env clamp, `errorKind`), `phaseTimer.ts` (`PhaseRecorder`), `stepTimeline.ts`, `eventLoopDiagnostics.ts`, `cpuProfile.ts`, `catalogueDiagnostics.ts`, each with a `*.test.ts`; plus `application/services/CatalogService.query-phases.test.ts`.
Modified: `CatalogService.ts` (`query` wrapper + `runQuery` with the original body and spans; optional `recorder` argument on three private loaders), `performanceTiming.ts` (`addPhaseReport`, optional `desc` on Server-Timing), `runtimeMetrics.ts` (additive `diagnostics` key), `server/index.ts`, `config/container.ts`, `RelatedWorks.ts`, `WorkSeoPolicy.ts` (selection moved verbatim into `selectIndexableWorks`), `ChannelFeedAliases.ts` (one step around the directory read), `runtimeMetrics.test.ts`.

What each piece answers:

* **Windowed event-loop delay** — second `monitorEventLoopDelay`, rotated every 60 s (15 kept): mean/p50/p95/p99/max, process CPU ratio, event-loop utilisation, GC count/total/max, stalls in the window. The cumulative figures are untouched.
* **Stall events** — a 100 ms drift timer (`unref`, ~2.1 µs/tick): any arrival ≥ 250 ms late (`DIAG_STALL_THRESHOLD_MS`, 50–10 000) records wall-clock time, uptime, duration, **CPU consumed in the interval and cpuRatio** (≈1 ⇒ JS/GC on the loop; ≪1 ⇒ descheduled/blocked), involuntary/voluntary context switches, major page faults, RSS and the **named steps that overlapped it**. 25 events + the worst are kept; log lines are capped at 6/min (`suppressedLogs` counts the rest).
* **Step timeline** — `boot.*` (validate config, create container, Mongo connect, ensure collections/indexes, two seeds, cache, repositories, services, use cases, controllers, channel-alias kick-off and its directory load, routes app, jobs import/initialise, chat hub, listening), `boot.modules_loaded` (module-load time before `startServer`), `related_works.{load,read_media_rows,read_airings,select_works,build_graph}` and the football-home refresh. Each has duration and process CPU; the sync ones are flagged. Only the error class name is stored.
* **Catalogue phases** — `cache_lookup`, `parallel` (the `Promise.all`), its legs `channels`/`preferences`/`programme`(`tvread`)/`streaming`(`tmdb_discover`,`providers`), then `transform`, `workpaths`, `interactions`, `response_build`, `cache_set`, `total`. `PhaseRecorder` reports the **wall-clock union** per name (`dur`) plus span count and summed work (`desc="n=24 sum=8022.4"`), so 24 parallel lookups do not appear as sequential time. Exposed as `cat_*` Server-Timing entries (existing entries byte-identical), in the `Request completed` log `timings`, and as miss-only per-phase p50/p95/max plus a bounded slow-query list in `/v2/health/metrics → diagnostics.catalogue`.
* **Optional CPU profile** — `DIAG_CPU_PROFILE=startup` **and** `DIAG_CPU_PROFILE_DIR=<dir>` (both required; default off), 5–300 s (default 60), one `.cpuprofile` per process, in-process inspector session (no port), file mode 0600. Not enabled anywhere by this PR.
* `diagnostics.host` adds load average, CPU count, free/total memory to test the shared-host hypothesis.

## 4. Verification

| Check | Result |
|---|---|
| Typecheck/build (`npm run build -w apps/backend`) | passes |
| New + related tests (`dist/shared/utils/*.test.js`, `CatalogService.query-phases`, `ChannelFeedAliases*`, `RelatedWorks`) | **89/89** |
| Full backend suite (`npm run test -w apps/backend`, final head) | 846 tests: **809 pass, 36 skipped, 1 fail** — `owner flow: only the owner key can authorise…` (`content-certify.cli.test`, owner-only file permissions on Windows). **Identical failure on `origin/main` (`2334f71`) built in a separate worktree**, so pre-existing and unrelated. An earlier run also showed `editorial runner process starts…` failing (EPERM removing a temp dir on Windows): 3/12 failures on **both** baseline and branch in an interleaved comparison — pre-existing flake. |
| Frontend / SSR / SEO suites | not run: no frontend, SSR, route or SEO file changed (`git diff origin/main --stat`: 8 backend files + new files) |
| Unchanged API | `query` returns the value `runQuery` returns; test asserts identical result across miss→hit; a failing dependency rejects with the original error and is counted `error`; Server-Timing without added phases is byte-identical (test); `diagnostics` is an additive top-level key, existing keys asserted |
| Redaction | catalogue shape holds enums/counts/booleans only (test: no query text or user id); step errors keep the class name only (test with a connection-string message); no new log field carries request data |
| Safe failure | diagnostics paths are wrapped; malformed input to the recorder does not throw; unavailable inspector / unwritable directory are logged and swallowed (tests) |
| Real signal | test: 400 ms busy loop under a real timer ⇒ stall ≥300 ms, cpuRatio > 0.3, step `test.synthetic_stall` named, windowed max ≥ 250 ms then the next window clean; idle loop ⇒ no event |

### Synthetic demonstration (`artifacts/m13b1/synthetic-demo.json`, local, no production, no database)

* `RelatedWorkIndex.warm()` with synthetic works: graph build 39 ms (2 000 works), 169 ms (10 000), **836 ms (40 000)** — each recorded as a stall of 152.7 / 830.3 ms with `cpuRatio` 0.97–0.99 and `steps = [related_works.build_graph]`. It scales ≈ 21 µs per work on this machine; a 4–5 s stall from the graph build alone would need ≈ 200 k works. This is a scaling check, **not** a claim about the production catalogue size.
* Cold catalogue miss with stubbed TMDB (700 ms discover, 24 provider lookups of 100–600 ms): `cat_providers;dur=575.6;desc="n=24 sum=8022.4"` against `cat_total;dur=1286.7` — wall time is the slowest chain, summed work is 8 s, and phases are read correctly.

### Instrumentation overhead (`overhead-bench.json`, `tick-cost.json`; Node 24, Windows, fresh process per arm, ABBA order, per-process medians)

| Measure | Before (origin/main build) | After | Noise reference |
|---|---|---|---|
| Cold-miss `CatalogService.query`, zero-latency stubs, 8 × 4 000 queries | 67.5 µs (per-process 60.3–68.8) | 71.9 µs (66.5–75.1) | A/A control of the same build: 72.8 µs |
| Event loop CPU workload, monitor off vs on, 8 × 3 s | 8 275 it/s (6 982–9 034) | 7 833 it/s (7 471–8 314) | arms overlap: **no effect demonstrated**, noise ≈ ±10 % |
| `tick()` (10 per second) | — | 2.11 µs (7 runs 2.09–2.37) | ≈ 0.002 % of one core |

Reading: the instrumentation adds ≈ +4–5 µs (≈ 6 %) to a query whose work is otherwise zero; real cold misses take 0.2–5.5 s, so the added cost is < 0.01 % of them. The loop benchmark cannot resolve effects below ~10 %; the tick micro-benchmark bounds the monitor itself.

## 5. Production observations (public, sequential, read-only; `artifacts/m13b1/prod-steady-sample.json`)

Method: 12 rounds × 6 targets, 20 s between rounds, 300 ms spacing, plus 3 never-seen catalogue variants once each and repeated 2 s later; 72 + 6 requests in 4 min 35 s (12:26:17–12:30:52Z); 0 non-200; honest user agent; no concurrency. n per group is 10–12 or 1, so **no p95 is reported**; min/median/max only. Times are from the measuring machine (not CWV).

| Observation | Value |
|---|---|
| Process | uptime 2 735 s → 3 011 s, 4 531 → 4 920 requests; event-loop `max` **5 549 ms** both times (a stall during the first 46 min, none new in the 4.6 min sample); loop mean 22.2→22.4 ms (timer resolution) |
| Mongo bucket | p99 4 843 ms unchanged (n 148→161): the same single old maximum |
| Cold catalogue, never-seen `limit=17` | server-side `total` **5 516 ms** (client 5 868 ms), repeat 12 ms (client 140 ms). Variants `19` and `21`, requested next, took 37 and 1.6 ms server-side because the TMDB discover/provider data was already cached by the first |
| Hot catalogue key `limit=12`, 12 rounds | median 79.5 ms; two slow rounds: **5 374 ms** (round 5) and 600 ms (round 10) — cache-key expiry events, i.e. further cold misses |
| `/canales` HTML | decoded **3.17 MB**, wire (brotli, via Cloudflare) **≈ 288 KB** (9 %), `cf-cache-status DYNAMIC` (Cloudflare does not cache; nginx does). Median total 136.9 ms on nginx HIT (n=10), 798 ms on the single MISS, 291 ms on the single EXPIRED |
| `/v2/tv/read/channels` | decoded 2.40 MB, wire ≈ 170 KB; HIT median 176.7 ms (n=11) |
| `/guias` | HIT median 80.5 ms (n=11); the single MISS took **3 480 ms** (n=1, matches the 2.3 s / 0.9 s single-sample misses of M13-A: SSR render waiting on API reads that expire together) |
| SSR parity | `/canales` canonical self, robots `index, follow` |

Wire bytes for `/canales` are now measured, but there is **no pre-#162 wire measurement**, so no wire saving is claimed. Cloudflare-vs-origin: every response carried `cf-ray` and `cf-cache-status DYNAMIC`, so all were served by the nginx/origin tier through Cloudflare; the origin host cannot be addressed from outside.

## 6. BLOCKED observations

| Item | Status |
|---|---|
| `guiatv-ops.sh status`, deployed release id, restart history, `journalctl -u guiatv-api` around start-up and slow requests, structured `Request completed` > 3 s, `ps`/CPU/memory of the host, MongoDB `serverStatus`/slow log/`explain` | **BLOCKED**: this session has no authorised remote shell or database access (a read of the local SSH configuration was refused by the permission layer and was not worked around). Not attempted. |
| Direct Mongo query time | not measured, and **not inferred** from the request-level `mongo` bucket |
| Windowed event-loop / stall / step data from production | does not exist until this PR is deployed |

## 7. Causal analysis

| # | Suspected cause | Supports | Contradicts | Confidence | Reproduction | Impact | Remediation | Risk |
|---|---|---|---|---|---|---|---|---|
| H4 | **Cold catalogue miss = TMDB discover + 16–40 provider lookups, no coalescing** | 5.5 s server-side on a never-seen key in a process up 45 min; 5.4 s on the hot key at TTL expiry; 4.9 s (M13-A), 4.3 s maxima (22 Oct, 2 snapshots); the repeat and the next variants are 1–40 ms (TMDB data cached); local stub shows wall = slowest chain | not proven to be TMDB rather than Mongo/CPU until `cat_*` phases are read in production | **medium-high** (cause class), phase split unproven | request a never-seen `limit` (done, n=3); locally `CatalogService.query-phases.test` | each TTL expiry of a hot key; SSR/rails wait | M13-B2: single-flight on the miss, in-flight maps in provider/discover services, short TTL for provider errors, SWR for anonymous hot keys | low/medium |
| H1/H2 | **Start-up stall** from `RelatedWorkIndex.warm()` (full media read + BSON decode + select + SHA-1 ring build) or other boot work | graph build is synchronous CPU (≈ 21 µs/work, 1 s at 40 k works); `read_media_rows` decodes the whole catalogue on the loop; three process lifetimes show a multi-second max within minutes of start; football first refresh and channel-alias load also run at boot | the 22 Oct stall (4 255 ms) predates `warm()` (28 Oct); graph build alone needs ≈ 200 k works for 4–5 s; a 5 549 ms max exists in a process up 45 min, not necessarily at start | low (**unresolved**) | local: `synthetic-demo.mjs`; production: read `diagnostics.steps` + `eventLoop.stalls` after the next deploy | all in-flight requests during the window | M13-B3 only after the stall's step/cpuRatio is read | — |
| H5 | Shared-host CPU/disk/memory contention | stall with `cpuRatio ≪ 1` and many involuntary switches would show it; `diagnostics.host` records load/free memory | no production stall record exists yet; cron children (EPG sync) run as separate processes | unknown | production stall events | — | host-level | — |
| H3 | MongoDB execution or pool wait | the Mongo-touching steps will show duration vs CPU | no server-side data (BLOCKED); `mongo` bucket is request-observed; a 5.5 s Mongo stall would need driver/pool evidence (`MONGODB_WAIT_QUEUE_TIMEOUT_MS` ≈ 5 s default is suggestive but unverified) | unknown | read-only `currentOp`/slow log for the stall window | — | — | — |

**Do the cold miss and the stall share a cause?** Evidence leans to *separate problems*: cold misses of 5.4–5.9 s recur in a 45-min-old process, and they also happen at cache-key expiry, where no start-up work is running. The 5 549 ms event-loop maximum cannot be attributed to either (a 5.5 s request does not imply a 5.5 s loop stall, and the cumulative max cannot be decomposed). Classified:

* Cold-miss hypothesis (H4): **supported, not yet attributed to a phase** (unresolved at phase level).
* Start-up stall (H1/H2): **unresolved**. Missing measurement: the first `Startup step` log lines / `/v2/health/metrics → diagnostics.steps` and `eventLoop.stalls` from the first minutes of a freshly started process (or, without deploying, `journalctl -u guiatv-api` around a start, read-only). Exact signature to look for: a stall with `steps` containing a `sync` step and `cpuRatio ≈ 1` ⇒ CPU on the loop; `cpuRatio ≪ 1` with involuntary context switches ⇒ host contention; a stall with no overlapping step and low CPU ⇒ pool/I/O wait.
* H3 and H5: **unresolved** (BLOCKED / no data).

## 8. Independent reviews (three separate read-only agents, actually run)

* **Node performance and observability — no blocking findings.** Confirmed the union-of-intervals logic, the stall maths and the Server-Timing `desc` grammar. Applied: step overlap now starts after the last on-time tick and ranks sync/longest steps first; stall bookkeeping in `finally`; shape computed inside the guarded block; diagnostics start wrapped so they cannot abort boot; slow threshold read once; `boot.modules_loaded` added; flaky test thresholds relaxed. Accepted: a laptop suspend would read as a stall; `monitorEventLoopDelay` includes its 20 ms resolution (same as the cumulative metric).
* **Backend / MongoDB accuracy — no blocking findings.** Confirmed phases match the code paths and `indexableWorks` is behaviour-identical. Applied: client-observed note in the snapshot; `boot.channel_alias_load` step. Accepted and documented: `workpaths` mixes one Mongo read, up to 200 cache reads and a CPU filter; `tvread` overlaps the legacy `db`/`epg` keys and the service's own coalescing; every Mongo-touching span includes pool wait, encode and BSON decode; anonymous `preferences`/`interactions` are ~0 ms spans; the football first refresh's CPU is contaminated by concurrent boot work; mongoose `autoIndex` and `RedisPresenceStore.connect()` are not observed; driver pool-checkout events are not captured (needed to split pool wait from server time).
* **Security / privacy / API / SEO — no blocking findings.** Confirmed: no port opened by the profiler, no request data in logs, new log lines rate-limited, no route/URL/canonical/robots/SSR change, `cat_*` cannot enter the legacy buckets. Applied: 0700/0600 modes for profiles. **Accepted exposure (owner decision):** `/v2/health/metrics` is public and unthrottled and now also shows host load average and free/total memory and ≤ ~90 KB worst-case (typically < 10 KB) of diagnostics; no user data. It can be restricted or the `host` block dropped before deploy.

## 9. Remaining blockers

1. Authorised read-only access (journalctl, ops status, MongoDB) — or deploying this PR — is required for any production attribution.
2. Owner decision on exposing the `diagnostics.host` block on the public metrics route.
3. **Standing SEO/URL-architecture defect, not touched here and not resolved by this performance work:** consumer-facing content URLs must not contain internal identifiers such as `/contenido/program:20261104_clan_tv_20261104155700`. It stays tracked as a separate **blocking** SEO/URL-architecture remediation milestone; this PR adds no route and changes no URL.

## 10. Production authorisation status

Only public sequential read-only GETs (≈ 90 requests including 3 deliberate cold catalogue variants that populate the application cache) were made. No merge, deploy, restart, environment change, cache clear, MongoDB profiling or data change. **Deploying this PR needs the owner's explicit approval.** Nothing in it is enabled by environment variables (`DIAG_CPU_PROFILE` stays off).

## 11. Rollback

Code: revert the squash-merge commit of this PR (backend only, no data, schema, index or contract involved); the operational rollback of a deployed release is `sudo /var/www/guiatv/scripts/guiatv-ops.sh rollback` as in M13-A section 12. Runtime: nothing to switch off; the only optional behaviours (`DIAG_CPU_PROFILE`, `DIAG_STALL_THRESHOLD_MS`, `DIAG_WINDOW_MS`, `DIAG_CATALOGUE_SLOW_MS`) are unset by default.

## 12. Handoff

* **Next: M13-B2 — catalogue cold-miss remediation** (supported by production evidence; independent of the stall): single-flight on `CatalogService.query` and in-flight maps in `StreamingProvidersService`/`TMDBService.discover`, short TTL for provider errors, then SWR only for anonymous hot keys; local TMDB stub benchmark (the `CatalogService.query-phases` harness is the starting point). Before shipping it, deploy B1 (with owner approval) so `cat_tmdb_discover` / `cat_providers` confirm the phase.
* **M13-B3 — start-up stall remediation: blocked on a measurement**, not on code: the first minutes of `diagnostics.steps` + `eventLoop.stalls` (or an authorised `journalctl` read) from a freshly restarted process; if the stall is `related_works.build_graph`/`read_media_rows`, defer or yield it; if `cpuRatio ≪ 1`, it is a host problem.
* M13 remains **open**; M14 stays NO-GO. M13-B2 was not started in this execution.

## 13. Artifacts

`artifacts/m13b1/`: `prod-steady-sample.mjs/.json` (sampler and 72+6 samples, with the two public metrics snapshots), `overhead-bench.mjs/.json`, `tick-cost.json`, `synthetic-demo.mjs/.json`. All sanitized: timings, sizes, public headers, no credentials or user data.
