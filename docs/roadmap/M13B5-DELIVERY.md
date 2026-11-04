# M13-B5 — Root cause of the remaining stalls and first remediation

> **Final state (2026-11-04):** #172 did not remove the 4 s stalls; the cause was `loadChannelMap` (section 10), fixed by #173 (`269c643`), deployed and verified in production (section 11). **Verdict: M13-B5 PASS for the two multi-second stalls (B3b, B5c); not a declaration that M13 is complete.**

Date: 2026-11-04 · Base `origin/main` = `6e28e88` · Branch `m13b5-attribution` · **Verdict: PARTIAL** (B5b output-identical reduction + B5a attribution instrumentation both delivered; causes unconfirmed until read in production). Both 4 s stalls now have one evidence-backed common hot path (the cold `tvread.query` day read behind `CatalogService.query`); a measured, output-identical reduction of it is delivered. Whether it explains the **full** 3.5–4 s seen in production is **not proven** (it was not reproducible locally at that magnitude) and must be read from the first process after a deploy. Not deployed, not merged.

## 1. Call graph (from the code)

```
GET /v2/catalog/                 CatalogController.getCatalog → CatalogService.query → runQuery
  hot L1 (30 s) → cache "catalog:query:v2:<normalised params>" (Valkey, 600 s) → on miss, in parallel:
    loadProgramItems → loadTvReadItems → TvReadQueryService.query({view:'day', limit 1200/2400})   ← hot path
    loadStreamingItems (TMDB discover + per-item providers, only for movie/series types)
    loadChannelMap, loadPreferences
  then mergeItems, sort (localeCompare on ties), filters, markUnresolvedWorkPaths, attachUserInteractions

GET /v2/catalog/:id/enrichment   CatalogController.getDetailEnrichment → CatalogService.getDetailEnrichment
  program id → TvReadQueryService.getItem (2 Mongo reads, cached 30 min)
             → allSettled: providers (TMDB, cached) · loadRelatedForTvReadItem = TvReadQueryService.query({view:'day', category, limit:18}) · social · interaction (the last two are no-ops without a user)
```

**Shared dependency: `TvReadQueryService.query`.** The same function is behind `GET /v2/discovery/browse` (it calls `CatalogService.query`), which is the request open during **stall A** (10.1 s, 3.5 s). So both stalls overlap the same function: `tvread.query` was a running step in A and in the 191 s event of B. In the 89.5 s event no step was running; `getItem` and the `CatalogService` transform are not wrapped in a step, so that event is not contradicted either.

`TvReadQueryService.query` (day view, up to 2 400 rows): Mongo `find().lean()` of whole documents (BSON decode on the main thread) → `hydrateTvReadItemRuntime` per row → `applyViewTransform` (a full sort) → **`buildChannelSummaries` (a second copy + full sort + per-channel scans, built even when `includeChannels:false` and then discarded)** → `compactTvReadItem` → `JSON.stringify` into Valkey. The day view is deliberately **not** kept in the in-process L1, so every `catalog` miss re-reads it from Valkey: `JSON.parse` of the whole payload (~6 MB locally, most of it the channel summaries) and, because the cached response has `channels`, another `buildChannelSummaries` + sort in `hydrateResponseRuntimeState`. `CatalogService` reads only `response.items` at all three call sites, never `channels`.

## 2. Where the pair comes from (frontend / SSR)

A programme/airing detail page whose primary payload has no `related` (`catalog-detail.component.ts`, `ngOnInit`) calls `loadFallbackRelated` (`GET /v2/catalog/?types=…&sort=airtime&limit=8[&genres=<first genre>]`) while `enrichmentPending` triggers `loadEnrichment` (`GET /v2/catalog/:id/enrichment`) from the same subscribe: **one pair per rendered programme page**. Both run during SSR (the render waits for HTTP) and are replayed to the browser by `withHttpTransferCacheOptions` (GET, no auth header), so hydration does not repeat them. Findings:

* **No client loop or polling**: the only timer is a 30 s `setInterval` that updates the clock (browser only, no HTTP); the services dedupe with `shareReplay` and a TTL cache (60 s query, 10 min detail), and a failed enrichment does not retry.
* **The ~102 s periodicity is therefore not a client loop**; it is consistent with distinct programme pages being rendered (crawler traffic) and is **not demonstrated** either way. The query key includes the page's genre, so different pages miss the 600 s catalogue cache and re-run the hot path.
* Request frequency (a pair per rendered page) and CPU per execution are separate things: the pair is expected traffic; the cost of one execution is what this milestone reduces.

## 3. Local reproduction (disposable `mongo:8`, synthetic data)

`artifacts/m13b5/catalog-pair-bench.mjs`: real `CatalogService` + `TvReadQueryService` + model from a built backend; 2 600 / 20 000 synthetic airings (160 channels, accented Spanish titles, ~3 KB per document, ties in start times); cache = in-memory with the same `JSON.stringify/parse` as `ValkeyCache` (no socket); a fresh child process per run (cold JIT), 5 runs per scenario, two passes ABAB. It measures wall, CPU, 5 ms drift-timer stall, event-loop delay, GC, heap, Mongo commands/documents, the existing catalogue phases and a digest of the responses. Scenarios: cold/warm list, cold/warm enrichment, concurrent pair, and a pair per genre (a crawl).

Baseline (the unmodified `6e28e88` build): a cold list is **0.35–0.5 s wall / ~0.5 s CPU** with a **~130 ms** maximum stall, almost all in the `tvread` phase (334 of 354 ms; the CatalogService transform is 3.5 ms). A CPU profile of the cold read puts the time in BSON decode of the 2 401 documents (~230 ms inclusive), then the sorts and channel summaries (~60–100 ms) and the cache `set`/`get`. A crawl of 8 distinct genre pairs reaches a **~0.67–1.0 s** maximum stall locally. The warm Valkey path is 23 ms per 6 MB `JSON.parse` plus the rebuild of the summaries. **Locally the pair never exceeds ~1 s; production showed 3.7–3.9 s. That 4–30x gap is not explained by this harness** (production document shapes/sizes, CPU speed under load, Valkey over a socket, 786 k-row collection and its working set are not reproduced).

## 4. Remediation shipped (B5b, output-identical)

1. `TvReadQueryService.loadQuery`: build the channel summaries only when `includeChannels` is true (they were computed and discarded otherwise; pure, no side effects).
2. `CatalogService`: the three `tvReadQueryService.query` calls pass `includeChannels:false` (only `items` is read). The cache key already separates `:items` from `:channels`, so the first request after a deploy fills a new, smaller entry.
3. `sortTvItems`: one shared `Intl.Collator('es', {sensitivity:'base'})` instead of `localeCompare` with options per comparison (identical ordering by ECMA-402).

Not done on purpose: Mongo projection (the dominant BSON cost) was not applied because the share it removes in production is unknown (the excluded fields are small in the synthetic data); `TvSurfaceService` (uses `channels`) and the public `/v2/tv/read` endpoint (returns `channels`) are unchanged; no M13-B2 single-flight/SWR.

### Before / after (medians of 2 passes × 5 runs, ABAB; synthetic data, loopback, same machine)

| Rows | Scenario | Max stall | CPU | Wall |
|---:|---|---:|---:|---:|
| 2 600 | cold list | 154 → 79 ms | 625 → 422 ms | 471 → 304 ms |
| 2 600 | pair, 8 distinct genres | 664 → 416 ms | 1 141 → 1 001 ms | 888 → 703 ms |
| 2 600 | cold pair | 122 → 94 ms | 562 → 547 ms | 389 → 361 ms |
| 20 000 | cold list | 128 → 85 ms | 532 → 500 ms | 364 → 335 ms |
| 20 000 | pair, 8 distinct genres | 673 → 379 ms | 1 265 → 984 ms | 943 → 615 ms |
| 20 000 | cold pair | 113 → 88 ms | 516 → 548 ms | 358 → 364 ms |

Reading: 20–45 % lower maximum stall and 0–25 % less CPU in the repeated-miss case; the cold single read is within noise on CPU (the dominant BSON decode is untouched) and heap peaks fall (127 → 82 MB in the crawl). **This does not remove a multi-second block and is not claimed to; it removes avoidable work from the one function both stalls overlap.** Payload cached for the day read shrinks by the channel summaries (~60 % in the synthetic data; to be measured in production).

## 5. Parity

* Frozen-clock run of the real services against the same fixture, baseline vs candidate builds: SHA-256 of the full list response and of the enrichment response is **identical** (`pair_cold`, `list_movie_cold`; `artifacts/m13b5/bench-parity-*.json`). The genre-per-page scenario's digest covers only timings, so it proves nothing for that case.
* `TvReadQueryService.m13b5.test.ts`: `items` byte-identical with and without channels (60 rows, accents, groups), summaries not built when excluded, ordering equal to the pre-change `localeCompare` ordering, and every `CatalogService` call passes `includeChannels:false`. Public API shape, identities, TMDB disambiguation, work links, ordering, canonicals, robots and sitemap code were not touched (no route, DTO or SSR change).

## 6. Tests

Focused: 82 tests across `TvReadQueryService*`, `CatalogService.*`, `TvSurfaceService` — 80 pass, 2 skipped, 0 fail. Full backend suite (with the instrumentation commit): 880 tests, 836 pass, 4 fail, 40 skipped; the 4 failures are the environmental Windows ones already documented in M13-B4 (owner-flow permission test, two replay-manifest tests using the Git Bash `tar` with a `C:` path, the editorial-runner EPERM flake) and are unrelated to this change. No frontend code changed (the request-pair analysis is static, section 2); Angular specs were not run.

## 6b. CI and review

* GitHub Actions on PR #172 (Linux, Node 24): `backend`, `frontend`, `changes`, `verify` all green on `15e6b71`; they cover the full backend suite and the Angular specs, so the four Windows-only failures above do not occur there. The re-run for the instrumentation commit is read in the PR.
* **Independent reviews (CPU/event loop, Mongo/concurrency/memory, Angular SSR, security/API/SEO) were not performed as independent reviewers**; no reviewer was available in this session. An author review of the whole diff found: `buildChannelSummaries` still runs after `applyViewTransform` and on the same array, so its input order is unchanged; an error in the summaries can no longer surface for `includeChannels:false` callers (intended); the new `:items` cache keys are separate from the `:channels` ones, so no stale-shape reads; steps are bounded (64 active / ring buffers), carry fixed names only and are stored only above 50–100 ms; `ValkeyCache` times large values only on read, every `set` pays one `timeStepSync` (microseconds). No route, DTO, SSR, identity, canonical, robots or sitemap code is touched; no new data leaves the process. This is **not** a substitute for the independent review the milestone asks for and is listed as open.

## 7. What is still open

* **Stall A and B causes are not confirmed.** Evidence: both overlap `tvread.query`/`CatalogService.query`; the local CPU profile of that path is dominated by BSON decode; GC is 5–7 % in both. Unproven: why production takes 4 s for it. Candidates, none measured: much larger real documents, a loaded/slower CPU, TLS/remote Mongo or Valkey transfer of multi-MB replies, a larger real day payload.
* **Instrumentation (B5a, shipped in a separate commit, observation only):** fixed-name steps so a stall event names the segment that overlapped it: `catalog.query`, `tvread.get_item`, and synchronous `tvread.hydrate_sort`, `tvread.compact`, `tvread.hit_hydrate` (stored when ≥ 50 ms), plus `cache.json_parse` / `cache.json_stringify` in `ValkeyCache` (only for values ≥ 256 k chars; ≥ 50 ms stored). `Server-Timing` gains `tv_cache_set`, `cache_parse`, `cache_stringify`. No new timers, logs, env vars or database calls; no request data in any name. Local overhead: none measurable (20 000 rows, 5 runs: cold list max stall 63 ms, crawl 346 ms / 781 ms CPU, in line with the candidate without it). Still **not separable**: BSON decode versus the rest of the Mongo `exec` wait (no isolated CPU attribution is possible while requests overlap); an authorised `--cpu-prof` window on the VPS would settle it. After a deploy, a 4 s event answers: sync step overlapped (`hydrate_sort`/`compact`/`json_parse`/`hit_hydrate`) → JS transform or cache parse; only `tvread.query`/`catalog.query` running with no sync step → Mongo decode or I/O; nothing → outside this path.
* Likely next remediation if BSON decode is confirmed: a Mongo projection for `includeChannels:false` reads (drop `sourceProvenance`, `searchTokens`, `*.aliases`, `*.sourceIds`, timestamps; the response is already compacted) and/or a smaller `limit`/an index-covered day listing for the fallback rail (8 results are built from up to 1 200 candidates).
* Independent review by a second person (see 6b) before merge.
* Production authorisation: none requested or used. No merge, deploy, restart, environment, index, cache or profiler action. Standing SEO blocker unchanged: consumer URLs must not carry technical ids such as `/contenido/program:<id>`.

## 8. Verification

Build passes. Full backend suite: section 6. Rollback: revert the PR (backend only; the cache keys written by the new code are separate and expire on their own).

## 9. Artifacts

`artifacts/m13b5/`: `catalog-pair-bench.mjs` (harness; `--frozen` for parity runs, `--prof <dir>` for a CPU profile), `bench-baseline.json`, `bench-ab-{base,cand}-{1,2}.json`, `bench-parity-{base,cand}.json`.

## 10. Production evidence after the #172 deploy, and the real cause (M13-B5c)

* **Deploy:** #172 squash-merged as `82c7327` on the owner's explicit instruction; `deploy-artifact.yml` run 41892931345, build + deploy success. Two public read-only GETs of `/v2/health/metrics` (uptime 73 s and 225 s, `artifacts/m13b5/post-deploy-metrics-{1,2}.json`), 331 requests, 0 x 5xx. No restart, configuration, profiler or write was made.
* **The 4 s stalls are unchanged** (13 s: 4 634 ms; 94 s: 3 841 ms; 164 s: 3 943 ms). The new steps ruled out the JavaScript segments instrumented in #172: no `tvread.hydrate_sort`, `tvread.compact`, `tvread.hit_hydrate` or `cache.json_*` overlapped any of them, and at 164 s `tvread.query` was not even running (only `catalog.query`). So the day-read hypothesis behind B5b was **wrong as the cause of the 4 s** (the change itself remains valid and measured, but small).
* **The catalogue miss phases name the culprit.** In every 4 s `catalog.query` miss (13 s, 94 s, 164 s) the `channels` leg lasted 4 768 / 3 876 / 3 967 ms, the same as the stall, while `transform` was 0.6–1.5 ms. `channels` is `loadChannelMap`: `channelRepository.findAll()` (every channel hydrated as a Mongoose document, `mapToDomain`, `toJSON`) cached in the in-process L1 for **60 s**. Expiry plus the next catalogue miss reproduces the observed cadence (94 s -> 164 s = 70 s) and the first one at start-up (13 s, `/v2/discovery/browse`). `tmdb_discover` and `providers` legs of the same events are long only because the blocked event loop delays their continuations.
* **Why the local harness missed it:** it stubbed `channelRepository.findAll` with `[]`. With the real `MongoChannelRepository` and 1 500 synthetic channels the baseline reproduces it: the `channels` phase takes ~1.7 s and a cold list stalls 1.6–2.0 s (versus ~0.13 s). Production has more channels and slower CPU.
* **What reads the map:** only the last step of `mergeItems`, for an item with airings but no channel. Program items always get their channel in `mapTvReadItemToCatalogItem` and TMDB items have no airings, so in practice the map was never used.
* **Fix (`CatalogService.runQuery`):** the channel map is no longer part of the parallel loads; it is loaded only if some program/streaming item has airings and no channel (a conservative superset of when `mergeItems` could read it). Output is identical either way. Tests: the `query-phases` test no longer expects a `channels` phase on a TMDB-only miss; `TvReadQueryService.m13b5.test.ts` checks no `findAll` for normal program items and the same icon from the map when an item needs it.
* **Before / after** (real channel repository, 1 500 channels, 2 600 airings, 5 runs per arm, medians, frozen-clock digests identical): cold list max stall **1 831 -> 80 ms**, CPU 2 517 -> 438 ms; cold pair 2 010 -> 103 ms, CPU 2 999 -> 547 ms; 8 genre pairs 1 625 -> 427 ms, CPU 2 688 -> 1 016 ms. Full backend suite: 881 tests, 837 pass, 4 fail (the same environmental Windows failures), 40 skipped.
* **Not fixed here, noted:** `tvread.channels` (boot, 852 ms, 1 256 ms CPU) and `ChannelModel.find()` without `lean()` remain; other callers of `channelRepository.findAll()` were not audited. The `channels` 60 s TTL still applies where the map is needed.
* **Status:** branch `m13b5c-lazy-channel-map`, draft PR; **not merged or deployed** (needs the owner's separate authorisation). Verdict for B5 stays PARTIAL until a deployed process shows no 4 s event.

## 11. Merge, deploy and production verification of #173 (owner-authorised, 2026-11-04)

* **Merge/deploy:** #173 squash-merged as `269c643` (CI green on `6cbb75a`); `deploy-artifact.yml` run 41896464092 on `269c643`, build + deploy success. Only read-only public GETs of `/v2/health/metrics` (`artifacts/m13b5/post-deploy-c-metrics.json`, one GET at uptime 261 s); no restart, configuration, profiler or write.
* **Result, same process (uptime 261 s, 666 requests, 0 x 5xx):** event-loop windows max delay **1 156 ms** (first minute, boot) then **325, 118, 165 ms**; **3 stall events in total, none above 1.1 s**, versus 4.6 s at 13 s, 3.8 s at 94 s and 3.9 s at 164 s in the previous process (section 10). The instants where the 4 s events appeared (13 s, ~94 s, ~164 s) are clean.
* **Catalogue:** 85 queries (51 L1 hit, 18 cache hit, 16 miss, 0 error); slowest miss **982 ms** (previously 5 123 ms); the `channels` phase no longer appears among the miss phases.
* **Remaining sub-second boot stalls (not addressed here):** 870 ms (`boot.container_initialize`), 1 113 ms (`boot.channel_alias_load`, `tvread.channels`, related-works reads, football refresh) and 440 ms at 9 s (`related_works` reads + `tvread.query` + `cache.json_stringify`). `tvread.channels` and `ChannelModel.find()` without `lean()` are the natural next candidates.
* **Caveat:** one process, 261 s, observed once; the evidence is the absence of the previously deterministic 4 s events at their usual instants plus the removed phase. Longer observation (several processes, a full 60 s L1 expiry cycle under crawler load) is recommended before closing the performance line of M13 for good.
* **Rollback:** revert `269c643` (and `82c7327` if desired) and redeploy; backend only.
