# M13-B5 — Root cause of the remaining stalls and first remediation

Date: 2026-11-04 · Base `origin/main` = `6e28e88` · Branch `m13b5-attribution` · **Verdict: PARTIAL.** Both 4 s stalls now have one evidence-backed common hot path (the cold `tvread.query` day read behind `CatalogService.query`); a measured, output-identical reduction of it is delivered. Whether it explains the **full** 3.5–4 s seen in production is **not proven** (it was not reproducible locally at that magnitude) and must be read from the first process after a deploy. Not deployed, not merged.

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

Focused: 82 tests across `TvReadQueryService*`, `CatalogService.*`, `TvSurfaceService` — 80 pass, 2 skipped, 0 fail. Full backend suite: 879 tests, 835 pass, 4 fail, 40 skipped; the 4 failures are the environmental Windows ones already documented in M13-B4 (owner-flow permission test, two replay-manifest tests using the Git Bash `tar` with a `C:` path, the editorial-runner EPERM flake) and are unrelated to this change. No frontend code changed (the request-pair analysis is static, section 2); Angular specs were not run.

## 7. What is still open

* **Stall A and B causes are not confirmed.** Evidence: both overlap `tvread.query`/`CatalogService.query`; the local CPU profile of that path is dominated by BSON decode; GC is 5–7 % in both. Unproven: why production takes 4 s for it. Candidates, none measured: much larger real documents, a loaded/slower CPU, TLS/remote Mongo or Valkey transfer of multi-MB replies, a larger real day payload.
* **Instrumentation gap (B5a not PASS):** nothing separates BSON decode from the JS transform, the Valkey `JSON.parse`, or `getItem`, and `getItem`/`CatalogService.transform` are not steps. The next diagnostic step, with no production risk: wrap `tvread.query` sub-phases (`cache_parse`, `mongo_exec`, `hydrate_sort`, `compact_stringify`) and `getItem` in fixed-name steps/phases, and read the first 4 s event after deploy. An authorised `--cpu-prof` window on the VPS would settle it directly.
* Likely next remediation if BSON decode is confirmed: a Mongo projection for `includeChannels:false` reads (drop `sourceProvenance`, `searchTokens`, `*.aliases`, `*.sourceIds`, timestamps; the response is already compacted) and/or a smaller `limit`/an index-covered day listing for the fallback rail (8 results are built from up to 1 200 candidates).
* Production authorisation: none requested or used. No merge, deploy, restart, environment, index, cache or profiler action. Standing SEO blocker unchanged: consumer URLs must not carry technical ids such as `/contenido/program:<id>`.

## 8. Verification

Build passes. Full backend suite: section 6. Rollback: revert the PR (backend only; the cache keys written by the new code are separate and expire on their own).

## 9. Artifacts

`artifacts/m13b5/`: `catalog-pair-bench.mjs` (harness; `--frozen` for parity runs, `--prof <dir>` for a CPU profile), `bench-baseline.json`, `bench-ab-{base,cand}-{1,2}.json`, `bench-parity-{base,cand}.json`.
