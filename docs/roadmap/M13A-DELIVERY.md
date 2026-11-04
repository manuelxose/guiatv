# M13-A — Production performance baseline and first verified fix

Date: 2026-11-04 · Branch `perf/m13a-baseline` · PR [#162](https://github.com/manuelxose/guiatv/pull/162) · **Verdict: PARTIAL** (see "Verdict").
Scope: read-only measurement of production; one bounded frontend fix; nothing merged, deployed or changed in production.

## 1. Git and production state

| Item | Value |
|---|---|
| `origin/main` at start | `571a8fcd3a3df507dc3d624469b640e28d96fcb8` (M12-G3D, #161). Local `main` was behind (`30cdf72`); work was done in the new worktree `../guiatv-m13a` cut from `origin/main`. |
| Production release | `20261104112726`, as reported by the owner. Not readable from outside. Consistent with `/v2/health` `uptime 806 s` at 10:40:59Z (process start 10:27:33Z ≈ 11:27 CET). The release SHA is not exposed publicly and was **not** verified. |
| Protected state | M12 worktrees, `m11b-review-fixes` stash and untracked notes untouched. M12 timer, catch-up, reconciliation and archive data not touched. |

## 2. Methodology and limits

* **Production**: only public GETs, always sequential. `artifacts/m13a/prod-sample.mjs`: 12 rounds × 17 targets, 15 s between rounds, 250 ms between requests (~200 requests, far below the ambient ~3 req/s). Two `/v2/health/metrics` snapshots (uptime 824 s and 1310 s). No concurrent or load test was run against production.
* The first sample of a target is the first request of the sampler, **not** a proven cold process. Rounds straddle cache TTL expiry, so "warm" medians are not steady state. `p99` is not reported for n=12. The first request of each round also pays connection setup (`/v2/health` median 167 ms against `server-timing total;dur=0.9`).
* All times include the network path from the measuring machine; they are synthetic and **not** field Core Web Vitals.
* **Not obtainable** (no authorised access in this session, none attempted): MongoDB slow-op log / profiler, `explain` plans, scanned-vs-returned, document sizes, pool and memory pressure, `journalctl`. Direct MongoDB performance is therefore **not measured**; section 5 says what the existing metrics do and do not show.
* **Controlled comparison**: two production builds of the frontend (before = `origin/main`, after = this PR) rendered by the real `ssr-server.mjs` against identical API fixtures (`apps/frontend/scripts/m13a-transfer-state-bench.mjs`). Fixtures were captured with one sequential GET per URL; every sample is a fresh render (`session=` cookie bypasses the SSR page cache), so timings include render, Express compression and loopback download. They are not production numbers.

## 3. Baseline

### 3.1 Runtime metrics (`/v2/health/metrics`)

| | Snapshot 1 (up 824 s) | Snapshot 2 (up 1310 s) |
|---|---|---|
| Requests / errors (5xx) | 2439 / 0 | 3394 / 0 |
| Request latency (last 2000) p50 / p95 / p99 | 5.2 / 143.6 / 751.5 ms | 5.0 / 131.5 / 642.4 ms |
| "mongo" bucket (n) p50 / p95 / p99 | (54) 44.8 / 3940 / 4852 ms | (85) 51.4 / 794 / 4852 ms |
| Cache hit rate (app cache) | 0.68 | 0.67 |
| RSS / heap used | 304 / 107 MB | 217 / 78 MB |
| Event-loop lag mean / p95 / **max** | 22.1 / 21.7 / **5419 ms** | 22.0 / 21.6 / **5419 ms** |

The historical `docs/seo/phase-3f/prod-metrics-baseline-20261022.json` showed mongo p99 7179 ms, event-loop max 4255 ms and `/v2/catalog/` p95 3676 ms, all at an uptime ~987 s. Same pattern, an older process.

Busiest routes (snapshot 2): `GET /v2/catalog/:catalogId/enrichment` 516 req (p50 8, p95 152, p99 690 ms), `GET /v2/catalog/` 514 (1.2 / 311 / **4310**), `GET /v2/content/:id` 490 (1.5 / 16 / 103), `GET /v2/catalog/:catalogId` 377 (28 / 211 / 843), `GET /v2/catalog/slug/:contentType/:slug` 161 (26 / 300 / 799).

### 3.2 Sequential samples (`artifacts/m13a/prod-sample-1.json`, n=12 each, 0 errors, all 200)

| Target | n | err | p50 ms | p95 ms | max ms | first sample ms | decoded size | transfer state | non-HIT |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| `/v2/health` | 12 | 0 | 167 | 267 | 267 | 228 | 0.5 KB | — | — |
| `/v2/health/metrics` | 12 | 0 | 73 | 90 | 90 | 88 | 5.7 KB | — | — |
| `/v2/tv/read` | 12 | 0 | 130 | 279 | 279 | 279 | 797.6 KB | — | — |
| `/v2/tv/read/channels` | 12 | 0 | 136 | 787 | 787 | 787 | 2.26 MB | — | — |
| `/v2/tv/surface/channels/la-1` | 12 | 0 | 90 | 238 | 238 | 238 | 102.4 KB | — | — |
| `/v2/catalog/slug/movie/gladiator` | 12 | 0 | 88 | 414 | 414 | 120 | 3.4 KB | — | — |
| `/v2/catalog/slug/series/modern-family` | 12 | 0 | 106 | 268 | 268 | 144 | 8.7 KB | — | — |
| `/v2/catalog?types=movie,series&availability=streaming&limit=12` | 12 | 0 | 81 | **4935** | **4935** | **4935** | 41.6 KB | — | — |
| `/v2/sports/football/home` | 12 | 0 | 67 | 456 | 456 | 456 | 34.2 KB | — | — |
| `/v2/sports/football/competitions` | 12 | 0 | 63 | 91 | 91 | 91 | 3.7 KB | — | — |
| `/` | 12 | 0 | 151 | 191 | 191 | 167 | 1.16 MB | 849.6 KB | 1/12 |
| `/canales` | 12 | 0 | 179 | 353 | 353 | 353 | 5.26 MB | **4.52 MB** | 2/12 |
| `/canales/la-1` | 12 | 0 | 67 | 2293 | 2293 | 2293 | 333.8 KB | 109.2 KB | 1/12 |
| `/peliculas/gladiator` | 12 | 0 | 73 | 436 | 436 | 436 | 219.7 KB | 4.6 KB | 1/12 |
| `/series/modern-family` | 12 | 0 | 66 | 381 | 381 | 381 | 227.2 KB | 5.3 KB | 1/12 |
| `/deportes/futbol` | 12 | 0 | 75 | 414 | 414 | 414 | 256.4 KB | 72.7 KB | 1/12 |
| `/guias` | 12 | 0 | 95 | 897 | 897 | 897 | 425.4 KB | 42.8 KB | 1/12 |

Reading: the three slow-looking cells that repeat are first samples after a cache miss (`/v2/catalog` 4.9 s, `/canales/la-1` 2.3 s, `/guias` 0.9 s). For `/canales/la-1` and `/guias` that is one sample each and is **not** a reproducible finding. `nginx: MISS` appears on most API targets that are never nginx-cached, so it does not mean "cold application". SSR parity: every sampled page returned 200 with a self canonical and `index, follow` robots (meta and `X-Robots-Tag`). Wire bytes were not measurable (`content-length` absent; production serves `br` from Cloudflare).

## 4. SSR findings

* `/canales` ships the 2.37 MB `/v2/tv/read/channels` response **twice** in the Angular state (HTTP transfer cache key + `tv-api-v2:` manual key): 5.5 MB HTML, 4.74 MB state. `/` duplicates 4 TV reads, football home and the blog list (~156 KB), `/deportes/futbol` 35 KB, `/guias` 19 KB (`artifacts/m13a/ts-urls-before.txt`).
* The browser reads the manual key before any HTTP call, so the HTTP copy is never consumed for those requests.

## 5. API and MongoDB findings

* The `mongo`/`epg` latency in the metrics is **not** database health. `measureTiming('db')` exists only in `FootballQueryService` (news), `BlogController` (list, categories) and `TvReadQueryService.loadQuery` (dual-tagged `epg`); it is a per-request wall-clock sum around an `await`, so it also contains event-loop stalls, pool waits and BSON decoding. Catalogue/content routes record no `db` phase. With n=54–85 its p99 is the single maximum (p95 fell 3940 → 794 ms between snapshots while p99 stayed 4852). The 4852 ms value cannot come from `/v2/tv/read` (route max 534–575 ms); by elimination it most likely rode a `/v2/catalog/` request with the programme leg (hypothesis).
* The event-loop max of 5419 ms was identical 8 minutes apart: one stall in the first ~13 minutes of the process, not steady state (steady-state lag ≈ the 20 ms timer resolution). The 22 Oct baseline shows the same class of stall (4255 ms) **before** `RelatedWorkIndex.warm()` existed (added 28 Oct), so `warm()` is at most a secondary candidate. Several unrelated routes share 4–6 s maxima in that window (`analytics/events` 5.9 s with p50 11 ms, `analytics/live` 6.0 s, `discovery/home` 4.2 s, `catalog` 4.3 s), which fits a common-cause stall better than independent misses. Unproven.
* `GET /v2/catalog/` cold miss: 2 TMDB `discover` calls + 16–40 provider lookups per type (`resolveProviderHydrationLimit`), no single-flight around the miss, 8 s TMDB timeout. The cold sample (`availability=streaming`, no programme leg) took 4.9 s and then 60–110 ms. Repeated ≥4.3 s maxima in two snapshots and in the 22 Oct baseline rule out a single outlier.
* `TvReadQueryService.loadQuery`: `now`/`next`/`night` are neither projected nor limited in MongoDB (only `day`/`search` are database-paged); plausible CPU/memory contributor, not shown to be the main one. `explain` not run.
* `StreamingProvidersService` caches a TMDB error as `null` for 24 h (existing hazard).

## 6. Ranked bottlenecks

| # | Suspect | Evidence | Frequency / impact | Root cause | Confidence | Fix cost | Regression risk |
|--:|---|---|---|---|---|---|---|
| 1 | `/v2/catalog/` cold miss (≈4.3–4.9 s) | prod sample 4935 ms; p99 4310 in 2 snapshots + 22 Oct | ~1 % of the busiest route; SSR/related rails wait | TMDB fan-out, no coalescing (part may be the shared stall) | medium | low (single-flight) – medium (SWR) | low / medium |
| 2 | Process-wide stall (loop max 5.4 s, mongo/epg max 4.85 s, admin routes 5.9 s) | two snapshots, two lifetimes | once per deploy window, hits all in-flight requests | unknown (startup work? CPU contention?) | low | needs instrumentation first | none (observability) |
| 3 | **SSR duplicate transfer state** | measured byte-exact, reproducible | every non-cached render/download of `/canales`, `/`, football | two caches serialising one response | **high** | **low** | **low** |
| 4 | `/v2/tv/read/channels` payload 2.37 MB (418 channels) and `/v2/tv/read` 0.8 MB | measured | every `/canales` miss | contract-sized responses | high | medium (contract) | medium |
| 5 | `tv/read` now/next/night unbounded Mongo read | code only | per TTL, coalesced | no limit/projection | low as a tail cause | medium | medium |
| 6 | Remaining duplicate state: `/v2/blog?limit=0` (19 KB), `/v2/discovery/home` (177 KB beside `portal-home-state-v3`) | measured | home, `/guias` | same pattern, other services | high | low | low |
| 7 | Single-sample SSR misses (`/canales/la-1` 2.3 s, `/guias` 0.9 s) | n=1 | unknown | unknown | very low | — | — |

Selected: **#3**, the highest-confidence item that is low-risk, byte-exact verifiable and independent of upstream/TMDB. It is *not* the largest tail latency; #1/#2 are, and they are left for M13-B because their causes are not yet proven.

## 7. The fix

`ApiClientService.get(path, params, { transferCache: false })` opts a request out of Angular's HTTP transfer cache. `TvApiService.cachedGet` (all TV reads) and `FootballApiService` (all football reads, whose results `FootballFacade` already stores under its own TransferState keys) use it. Nothing else changes: URLs, params, cache keys, TTLs, manual TransferState keys, API contract, backend, canonical/robots/sitemap. No MongoDB read or write is involved.

Known behaviour change (security/SEO review, non-blocking): `FootballLiveRefreshService` calls `getLiveMatches()` directly; on `/deportes/futbol/partidos-hoy?filter=live` its first poll at hydration can no longer be answered from the HTTP transfer cache and becomes one real GET (anonymous users only; authenticated requests were never cached). The data is fresher, as that service's own comment intends.

## 8. Before / after (local, controlled, identical fixtures)

Bytes (deterministic, `/canales` HTML varies ±70 B per render):

| Route | HTML | State | gzip | brotli q5 | `JSON.parse(state)` p50 |
|---|---|---|---|---|---|
| `/canales` | 5.51 → **3.15 MB** (−43 %) | 4.74 → **2.37 MB** (−50 %) | 430 → 238 KB (−45 %) | 187.7 → 187.7 KB (**0 %**) | 90 → 58 ms (Node, not a browser) |
| `/` | 1.30 → 1.16 MB (−11 %) | 967 → 828 KB | 160 → 152 KB | 70.9 → 70.3 KB | 27 → 25 ms |
| `/deportes/futbol` | 262 → 227 KB | 74 → 39 KB | 34.8 → 31.6 KB | 28.5 → 28.4 KB | 6.5 → 5.8 ms |
| `/canales/la-1`, `/guias`, work pages | unchanged (or only the la-1 surface copy) | | | | |

Time (render + compression + loopback download, ms, fresh renders; raw samples in `artifacts/m13a/ssr-bench*.json`):

* `/canales`, runs 1–2 (4 launches/arm, order before-first and after-first): median 524 → 459 (bootstrap 95 % CI of the median difference −91…−45). Per-process medians before 562, 528, 503, 521; after 463, 449, 433, 473 — no overlap.
* `/canales`, reversed-order runs (3 files, 6 launches/arm, after first): per-process medians before 351, 353, 500, 476, 462, 330; after 413, 280, 289, 422, 263, 284 → median of medians 353 → 284 (arms overlap; machine noise was higher).
* Controls with identical bytes: `/guias` 74 → 67 and 69 → 66 ms; the 404 shell of the work pages moves ±5 ms. **The harness noise floor is ~5–10 ms.**
* `/` : 118 → 112 ms (n=390), `/deportes/futbol` 45.3 → 46.2 ms (n=390; isolated n=160 reruns 45.6 → 44.8 and 45.3 → 45.6). Both are within the noise floor: "directionally lower or equal, not demonstrated".
* p95 / tail: **not improved and not characterised** (`/canales` pooled p95 726 → 806 ms, noisy; the n=12 production sample cannot support p99).

Corrections made after review: the first "flipped" benchmark order was a palindrome (`reverse()` of ABBA) and therefore not flipped; the harness now uses a real after-first order and the reversed runs above were re-collected. Bootstrap CIs treat samples as independent although they are autocorrelated inside a process; the per-process medians above are the stronger evidence.

### What may and may not be claimed

* May: decoded HTML/state bytes −43 %/−50 % on `/canales`, origin-gzip bytes −45 %, median server render+download ≈ −50…−90 ms on cache-miss renders, byte-identical output elsewhere.
* May **not**: production wire-byte savings (Cloudflare serves brotli; local brotli is unchanged — measure after deploy), any Core Web Vitals figure, any p95/p99 improvement, any production improvement at all. Production nginx caches SSR HTML for 5 minutes (prod `/canales` median 179 ms), so the render gain applies to MISS/EXPIRED fills.

## 9. Functional verification

| Check | Result |
|---|---|
| Karma (`npm run test -w apps/frontend`) | 391/391, including 5 new in `src/app/api/transfer-cache.spec.ts`; reverting the `TvApiService` argument makes the spec fail (mutation check) |
| Lint (changed files) | 0 errors; warnings are the pre-existing `any`/constructor-injection kind |
| Production build with Angular budgets (`ng build --configuration production --ssr`) | passes, before and after |
| SSR/SEO node tests (`ssr-cache`, `ssr-canonical`, `entity-*`, `legacy-enrichment-ssr`, `m10b`, `m10c`) | 30/30 |
| `npm run seo:ssr-resilience` | all `ok` |
| Headless Chrome on both builds, `/canales`, `/`, `/deportes/futbol`, `/canales/la-1` | identical browser API calls (telemetry/affiliate only, no TV/football refetch), identical title, link count, text length, canonical, robots and console-error count |
| API calls per SSR round | 30 before / 30 after (no extra backend load) |
| Backend / MongoDB | no backend file changed; no write, index or contract change |

Not run: backend suite (no backend change), Playwright entity specs (CI), load test (none permitted on production; none relevant locally). Left to CI on the final head: `verify`, `ssr-resilience`.

## 10. Independent reviews (three separate agents, read-only)

* **Performance — PASS-WITH-FIXES.** Numbers recomputed and confirmed. Blocking B-1 (flip order not flipped) fixed and re-run; B-2 (CIs assume independence) addressed by per-process reporting and by downgrading `/` and the futbol result to "not demonstrated". Non-blocking accepted: the work-page "controls" are 404 shells (noise control only; `/guias` is the real control); `/` fixture state is 11 % smaller than production; local timing includes compression and download; the "before" commit is `571a8fc` and builds are not retained.
* **Backend/MongoDB — PASS-WITH-FIXES, no blocking finding.** Confirmed no backend change. Diagnosis corrected as in section 5: "mongo" is request-observed db wait, catalogue Mongo reads are not instrumented, the 4.85 s epg value did not come from `/v2/tv/read`, `warm()` does not explain the pre-28-Oct stall, a common-cause stall fits better than independent cold misses.
* **Security/SEO — PASS / PASS.** No auth, CORS, rate-limit, escaping or credential change; nothing reads `ng-state` outside Angular; canonical/robots/JSON-LD come from the server render. Non-blocking: the option type was `boolean` but only `false` acts → narrowed to `false`; live-refresh behaviour change documented in section 7; no integration test with the real transfer-cache interceptor; `fetch-fixtures` hardened with `redirect: 'manual'` and a timeout.

## 11. PR, CI and deployment

PR [#162](https://github.com/manuelxose/guiatv/pull/162), squash-merged by the owner's instruction as `b4978a9` (CI green on the final head). Deployed the same day through the artifact workflow (`deploy-artifact.yml`, run 41822615710, `build` + `deploy` success, deployed commit `b4978a9`). Production authorisation boundaries respected: public sequential GETs, then the owner-authorised merge and deploy; no SSH, database access or manual configuration change by this milestone.

### Production verification after the deploy (`artifacts/m13a/prod-sample-post-deploy.json`, `ts-urls-after.txt`, `post-deploy-metrics.json`)

| Check | Before (deploy of `571a8fc`) | After (`b4978a9`) |
|---|---|---|
| `/canales` transfer state | 4.52–4.74 MB (two copies) | **2.41 MB** (one copy, `tv-api-v2:` only) |
| `/canales` decoded HTML | 5.26–5.52 MB | **3.18 MB** |
| `/` decoded HTML / state | 1.16–1.21 MB / 0.85 MB | 1.08 MB / 0.74 MB |
| `/deportes/futbol` decoded HTML / state | 0.26 MB / 74 KB | 0.23 MB / 39 KB |
| Status / canonical / robots (meta + `X-Robots-Tag`) of the 7 pages | 200, self, `index, follow` | 200, self, `index, follow` (4 rounds, 0 errors) |
| `/v2/health` | healthy | healthy, `5xx` 0 (142 s uptime, 229 requests) |
| API payload sizes (`tv/read`, `channels`, `catalog`, football) | unchanged by design | unchanged apart from live data drift |

No HTTP transfer-cache copy remains for the TV and football reads; the blog list and `discovery/home` copies are still there (M13-B5). Wire bytes are still **not** measured in production (Cloudflare brotli; the sample has no `content-length`), so no production wire-byte or Core Web Vitals gain is claimed.

Timing right after the restart (n=4, rounds 8 s apart) is **not** a valid comparison: the fresh process and an empty SSR page cache made even byte-identical pages slower (`/peliculas/gladiator` 73 → 102 ms, `/canales/la-1` 67 → 111 ms), while `/canales` 179 → 165 ms and `/` 151 → 138 ms. A steady-state re-sample is required before saying anything about production latency.

New evidence for M13-B: the freshly started process already reports an event-loop maximum of **3676 ms within its first 142 s**. That is the third process lifetime with a multi-second stall shortly after start (4255 ms on 22 Oct, 5419 ms earlier today, 3676 ms now), which supports a start-up cause and makes the `journalctl` correlation in M13-B1 the first thing to do.

If the owner authorises deployment of further changes: same workflow; compare against these artifacts.

## 12. Rollback

`sudo /var/www/guiatv/scripts/guiatv-ops.sh rollback` repoints `current` at the previous release and restarts API then SSR (see `docs/ops/VPS-RELIABILITY-RUNBOOK.md`). The release to return to is the one **before** this change, i.e. `20261104112726` if this PR becomes the next release; the exact id of any newer release must be read from `guiatv-ops.sh status` at deploy time. Code-level rollback: revert `b4978a9` (3 source files, no data or schema involved). The release deployed before this change is the one built from `571a8fc` (`20261104112726`, as reported by the owner); the id of the release created by this deploy must be read from `guiatv-ops.sh status` and was not observed here.

## 13. Remaining M13 work, ordered

1. **M13-B1 Observability, no behaviour change**: `measureTiming` phases (`tmdb`, `providers`, `db`, `tvread`) in `CatalogService.query`; windowed event-loop histogram (reset per scrape) and a stall logger with timestamp and CPU-profile hook; owner-authorised read-only look at `journalctl -u guiatv-api` for requests > 3 s ("Request completed", `durationMs`) to settle common-cause stall vs independent misses; read-only Mongo `serverStatus`/profiler for the same window.
2. **M13-B2 Catalogue cold miss**: single-flight on `CatalogService.query` (keyed by the existing Redis key, which includes `userId`), in-flight maps in `StreamingProvidersService.getProviders` and `TMDBService.discover`; short TTL for provider errors instead of 24 h `null`; then, only for anonymous hot keys, stale-while-revalidate with a new key version (watch `workPathUnresolved` and programme identity); post-deploy warm of hot keys. Local TMDB stub for the before/after.
3. **M13-B3 Startup stall**: only after B1 names the cause (candidates: `relatedWorkIndex.warm()` full catalogue read + `$group` over the airing history + SHA-1 ring build, startup warmers, CPU contention); defer/yield/materialise accordingly.
4. **M13-B4 TV read model**: `explain` for `next`/`night`, projection and bounded read after output-equivalence tests; `/v2/tv/read/channels` and `/v2/tv/read` payload slimming (contract change: owner/frontend coordination).
5. **M13-B5 Remaining duplicate state** in the blog list and discovery home (same opt-out pattern, ~196 KB on `/`).
6. **M13-B6 Field data**: CrUX/GSC Core Web Vitals and a repeatable SSR cold-render sample (the `/canales/la-1` 2.3 s and `/guias` 0.9 s single samples).

M13 stays open; M14 stays NO-GO until M13 is closed or accepted by the owner.

## 14. Verdict

**PARTIAL** (merged and deployed; production latency and wire-byte benefit unmeasured). Met: a reproducible production baseline (AC-01 for API and SSR), an evidenced ranking (AC-02, AC-10), one bounded fix (AC-03) with equivalent behaviour (AC-04), passing relevant tests (AC-05), a controlled before/after for bytes and median render time (AC-06), no regression found (AC-07), three reviews with blockers fixed (AC-08), authorisation boundaries respected (AC-09). Not met: direct MongoDB diagnostics were not obtainable, the largest tail latencies (#1, #2) are diagnosed but not fixed, the fix has no demonstrated tail or wire-byte benefit, and production was only checked structurally after the deploy (state size, parity, health); steady-state latency and wire bytes in production remain unmeasured.
