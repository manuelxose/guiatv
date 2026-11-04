# ANALYTICS-00…06 — consent-aware first-party analytics, GA4, GeoIP

Date: 2026-11-04 · Base: `main` = `a008fb5` (owner's "refresh real-time reports and session tables") · Branch `claude/serene-pascal-l9ixhl` · One commit per milestone (see §9).

**Overall verdict: PARTIAL.** Code, tests, local performance comparison, privacy checks and an independent review are done. Everything that needs production or external accounts is **BLOCKED**: this session's network policy denies `guiaprogramaciontv.com` (HTTPS and DNS), `download.maxmind.com` and `googletagmanager.com`. Nothing was merged, deployed or configured in production, and no GA4 or MaxMind account was touched. No production number in this document was measured; every measurement is local and labelled as such.

## 0. Baseline and live-state facts (ANALYTICS-00)

| Fact | Evidence |
|---|---|
| HEAD = `origin/main` = `a008fb5`; this branch had no other commits | `git log`, `git fetch` |
| **Production runs `269c643`, not `a008fb5`**: deploy run 41907146146 of `a008fb5` aborted on the host with "package-lock.json changed since the last install; an artifact deploy installs nothing. Run a normal deploy first", before build or restart. The last successful deploy is run 41896464092 (`269c643`). | GitHub Actions job 126845978131 log. Inferred from the log; not confirmed live (the site is unreachable from here). |
| Production `ANALYTICS_STORE`, retention, trusted proxies: **unknown** (they live in `/etc/guiatv/api.env`; no public endpoint exposes them) | — |
| Code defaults: store `mongo` (`valkey` if `ANALYTICS_STORE=valkey` and connected, else Mongo fallback); retention `ANALYTICS_TTL_DAYS=14` (Mongo TTL index, Valkey key TTL) | `container.ts`, models |
| Proxy chain (repo config): client → nginx 443 → API on `127.0.0.1:4000`. nginx sets `X-Forwarded-For $proxy_add_x_forwarded_for` and `X-Real-IP`; no `real_ip` module and no Cloudflare config in the repo; ports 3000/4000 are closed by ufw (documented in `rateLimit.ts`, verified 2026-10-20 in M03) | `infra/nginx/guiatv.conf` |
| nginx caches SSR HTML by `$scheme$host$request_uri` with `proxy_ignore_headers Vary`, so **one cached HTML (and its UA-based TransferState) is served to every device** | `guiatv.conf` |
| No consent mechanism existed. The `/cookies` page listed `cookie_consent` and `_ga`, but the collector created `gtv_anon_id` in localStorage and sent 5 requests per page load before any choice | code; baseline bench: 10 telemetry requests / 3.3 kB per two loads |
| GA4 `G-P6Z3BY2DVW`: not present anywhere in the code (confirmed) | `grep` |

Previously reported issues, revalidated on `a008fb5`:

| # | Issue | On HEAD | Resolution |
|---|---|---|---|
| 1 | Admin errors indistinguishable | partly (only the realtime report distinguished statuses) | `describeAnalyticsError` everywhere; `503 storage_unavailable` / `501 unsupported_store` from the API (M02) |
| 2 | Valkey session events = filter over the last ≤250 global events | **confirmed** | per-session bounded lists (M02) |
| 3 | Android shown as desktop/landscape | **confirmed**, root cause: cached SSR TransferState plus no re-measure in the browser | re-measure after first render; separate device class from orientation (M04) |
| 4 | No geolocation enrichment | confirmed (CF headers only, rarely configured) | local MaxMind (M03) |
| 5 | Controller trusts first XFF hop | **already fixed** by `a008fb5` (right-to-left walk) but empty `ANALYTICS_TRUSTED_PROXIES` resolved everyone to `127.0.0.1`, an *always-excluded* address, so analytics silently counted nothing | loopback trusted by default; garbage hops cannot reset the walk (M03) |
| 6 | Mongo stores full IPs, Valkey truncates | **confirmed** | single `ipPrivacy` policy (M02/M03) |
| 7 | Hardcoded panel statistics (`120ms`, `0.6%`, `62/34/4%`) | **already removed** by `a008fb5` | diagnostics tab shows measured values only (M04) |
| 8 | Technical ids in paths and admin | admin: confirmed; public `/contenido/program:<id>` URLs: confirmed (pre-existing SEO blocker) | admin labels done (M04); public URL change **not done**, see §4 |
| 9 | GA4 tag absent | confirmed | M05 |
| 10 | M13 stalls A/B | out of scope; not worsened (§6) | — |

### Baseline measurement method (repeatable)

* **Browser** (`artifacts/analytics/browser-bench.mjs`): production SSR builds (`ng build --configuration production --ssr`) of baseline and candidate behind the same stub API (`stub-backend.mjs`). Content endpoints answer 503, so both arms take the SSR fallback path; there is no MongoDB on this host. Chromium maps `guiaprogramaciontv.com` to the arm, so the collectors don't skip localhost.
  * Mobile profile: Android Chrome UA, viewport 406×724, screen 407×904, 4× CPU throttle, 40 ms RTT.
  * Desktop profile: 1366×768, no throttling.
  * Each run is a cold load in a fresh context plus a warm reload, 7 runs per arm, interleaved ABAB; medians reported.
  * Metrics: TTFB, FCP, LCP, CLS, TBT, long tasks, an INP-like tap, JS transfer, requests, third-party requests, telemetry requests and bytes.
* **Noise floor:** an A/A run (same baseline build on two ports, `bench-baseline-aa.json`). Median LCP differs by **20–60 ms**, mobile TBT by **up to 80 ms**, between identical builds.
* **Pre-existing finding:** CLS ≈ 1.2 (desktop) and 2.0 (mobile) in *both* arms, A/A included. This may be an artifact of the stub (all content 503) and was not caused by analytics. Not investigated further (out of scope).
* **Backend** (`ingest-server.mjs`, `ingest-load.mjs`): the real analytics router, controller and Valkey repository from each build, on a local Valkey. 300 visitors × (session start + 10 page views + 10 clicks) = 6,300 items. The baseline client sends 1 request per item; the candidate client sends the same items in `/collect` batches. Measured: latency p50/p95/p99, event-loop delay (`monitorEventLoopDelay`, 1 ms), process CPU and peak RSS. Three rounds each at 64 and at 8 concurrent clients.
* **Not available here:** production RUM/CrUX, real device hardware, MongoDB-backed runs, and production API p50/p95/p99 and event-loop data (`/v2/health/metrics` is unreachable).

**Verdict ANALYTICS-00: PARTIAL.** The local baseline is recorded and repeatable. Production baseline (SSR timings, RUM vitals, API percentiles, event-loop windows) is BLOCKED by network policy.

## 1. ANALYTICS-01 — non-blocking, consent-aware client collector

Paths: `apps/frontend/src/app/services/analytics.service.ts` (eager facade), `services/analytics/{analytics-collector,analytics-queue,analytics-sanitize,analytics-identifiers,consent.service}.ts`, `components/consent-banner/`, `app.component.{ts,html}`, `components/footer/*`, `pages/legal/cookies/*`, `src/index.html`, specs `analytics.service.spec.ts`, `analytics/*.spec.ts`.

* **Consent:** cookie `cookie_consent=v1.a{1|0}.<ms>`, valid 12 months.
  * Before a choice, nothing is stored or sent. Calls are kept in memory only: at most 20, for at most 10 minutes. They are dropped on deny.
  * The collector, GA4 bridge and sanitisers are a **lazy chunk (5.7 kB gz) imported only after a grant**, on an idle callback.
  * Revocation stops timers, removes listeners (one `AbortController`), clears the queue, deletes `gtv_anon_id`, `gtv_session` and the `_ga*` cookies, and sets GA4 consent to denied plus `ga-disable-<id>`. Identifiers created by the old pre-consent collector are deleted on the first visit.
* **Banner:** "Rechazar" and "Aceptar" have identical size and weight. It reopens from the footer (desktop), the mobile "Más" sheet and the `/cookies` page.
  * It is in the SSR HTML, which is identical for every visitor and therefore cache-safe.
  * A 10-line `<head>` script hides it before first paint when a valid choice exists, mirroring the existing theme bootstrap. The server and the hydrating client render the same DOM.
  * Why this matters: the first version rendered the banner after hydration, and **mobile LCP grew by 1.4 s**, because the banner became the late LCP element (`bench-ab-unset` first run). Painting it with FCP removed that.
* **Transport:**
  * Batches of up to 25 events, flushed after 5 s, one timer at a time.
  * `fetch` outside Angular's zone and `credentials: 'omit'`, so no analytics request is a pending task for hydration or stability.
  * `sendBeacon` (with `fetch keepalive` fallback) on `visibilitychange: hidden` and `pagehide`. BFCache restore resumes the session.
  * Heartbeat every 30 s only while visible, stopping after 30 min idle.
  * Failures retry with 5 → 60 s backoff, then are dropped and counted. Per-page queue cap: 100.
* **Semantics:** the session block always goes out before (or with) the session's first events. Sessions live in `sessionStorage` with a 30-min inactivity rotation. Page views are deduplicated on the sanitised path; SSR does not collect, so hydration plus the router produce exactly one view.
* **Payload minimisation:**
  * Pathname only: no query string or fragment.
  * `/perfil/<id>` becomes `/perfil/:usuario`; UUID- and token-like segments become `:redacted`.
  * External referrer reduced to its host; only `utm_*` values from a safe charset.
  * Bounded event data, with e-mail and long-number values redacted.
  * `/admin` and `/embed` are not measured at all: events, clicks and scroll included.
  * Removed fingerprinting fields: platform, vendor, memory, cores, connection RTT, UA brands.

Tests: 48 frontend specs in the analytics area. They cover consent unset, grant and deny; the in-memory-only buffer; dedup across repeats and query-only changes; 40 rapid route changes; hidden-tab beacons with no heartbeat; pagehide plus BFCache resume; network failure and backoff; revocation, including during an in-flight request; the server switch; admin pages; and the SSR platform. The E2E run (`e2e-consent.mjs`, real Chromium on the production build) passed **19/19** (`e2e-consent-result.json`).

**Verdict: PASS (local).** Production confirmation is pending deployment.

## 2. ANALYTICS-02 — ingestion, storage, admin errors

Paths: `apps/backend/src/application/services/analytics/{telemetryValidation,TelemetryIngestQueue,TelemetryIngestService,telemetryFlags}.ts`, `presentation/controllers/AnalyticsController.ts`, `presentation/routes/{analytics.routes,app}.ts`, `presentation/middlewares/publicCachePolicy.ts`, `infrastructure/repositories/{Mongo,Valkey}AnalyticsRepository.ts`, `analyticsExclusions.ts`, models, `domain/repositories/IAnalyticsRepository.ts`, `config/container.ts`.

* **`POST /v2/telemetry/collect`:**
  * Its own 64 kB JSON / text-plain parser (the global 1 MB parser is skipped for this path), a shared per-IP limit of 240/min, and a strict, linear-time validator: ids, type pattern, ≤ 50 events, clamped timestamps, server-only types rejected, re-sanitised paths and data.
  * The handler only validates and enqueues, then answers **202**. Admin identification (a token-to-role lookup) runs in the drain loop with a 5-min cache, so the request path does no storage I/O.
* **Queue:** in process, no new service.
  * Bounded at 5,000 batches / 50,000 events, after which the endpoint answers `503 + Retry-After` (backpressure).
  * One FIFO drain loop keeps per-session order and yields with `setImmediate` between items.
  * It pauses while the store reports unavailable, and retries 3 times with backoff before dropping.
  * Counters: accepted, rejected-full, processed, failed attempts, dropped, invalid, lag.
  * **Loss window:** items still in memory if the process stops (bounded by the caps; typically under 1 s of traffic).
* **Idempotency:** event ids are assigned at acceptance. Mongo does an unordered `insertMany` and ignores duplicates only when *every* write error is E11000. Valkey uses `SET NX` per id (1 h), released if the write fails, so retries are not lost.
* **Stores:**
  * Same semantics in Mongo and Valkey: `excluded` is decided at ingestion and is always an explicit boolean; excluded traffic stays out of the Valkey aggregates; session counts are idempotent.
  * Valkey per-session lists: up to 200 events, 48 h TTL. This **fixes issue 2** (an old session's events no longer fall out of the global log).
  * Activity-only heartbeats keep the device/UTM metadata; BFCache resume reopens a session.
* **Legacy endpoints** (`/session/*`, `/event`): same response shapes; persist nothing unless `ANALYTICS_LEGACY_ENDPOINTS=accept`, because their data was collected without consent.
* **Emergency switch:** `ANALYTICS_INGEST_ENABLED=false` or the kill file, re-read every 5 s. `/collect` answers 204 with `X-Telemetry-Disabled: 1`, and the public `GET /v2/telemetry/config` (cached 60 s) tells browsers to stop.
* **Admin endpoints:**
  * `503 storage_unavailable` when the store is down (previously the response was an empty report); `501 unsupported_store` for journeys under Valkey (previously journeys silently read Mongo).
  * Clamped query parameters, anonymised IPs in responses, `private, no-store` (unchanged), new `GET /diagnostics`.
  * The UI distinguishes network / 401 / 403 / 404 / 429 / 503 / 501 / 5xx; empty results are an empty state, not an error.

Tests: the backend analytics suites pass 34/34 (including Redis integration on a local Valkey). They cover validation, ReDoS budget, queue bounds/order/retry/restart, a 20,000-batch burst with event-loop max under 200 ms, a 50-session × 10-round isolation test, PII modes, admin exclusion through beacons, Mongo duplicate vs mixed errors, Valkey per-session retrieval beyond the 5,000-event global cap, dedup, retry after a failed write, and the HTTP route (202 / text-plain / 400 / 413 / kill / config cache).
- **Not run here:** Mongo integration (no MongoDB on this host; CI has a `mongo:8.0` service).

Load results: §6.

**Verdict: PASS (local)**, with the documented loss window.

## 3. ANALYTICS-03 — GeoIP

Paths: `infrastructure/analytics/{GeoIpService,ipPrivacy}.ts`, `presentation/controllers/analyticsClientIp.ts`, `scripts/geoip-update.{sh,test.mjs}`, `infra/systemd/guiatv-geoip-update.{service,timer}`, `test-fixtures/geoip/` (MaxMind's official MIT test databases), dependency `maxmind@5.0.8` (MIT; adds `mmdb-lib`, `tiny-lru`; lockfile +34 lines).

* **Lookups:**
  * Local `.mmdb` files (City + ASN, IPv4/IPv6), read with async I/O at start-up and re-opened when their mtime changes (checked every 6 h, unref'd timer). Lookups are in-memory tree walks, measured at under 100 µs each in the test. There is **no network call per event**, and enrichment runs in the drain loop, not in the request.
  * Stored: country, region and Spanish/English names, approximate city, latitude/longitude rounded to 0.1°, accuracy radius, ASN and organisation, database build, plus explicit `status` (`located | country_only | unknown | private | invalid | unavailable | disabled`) and `source` (`maxmind | proxy_header`). No VPN detection is possible with GeoLite2 and none is claimed. No identity or person attributes.
* **Addresses:** the raw address exists only in the in-memory queue item. Stores receive a /24 or /48 prefix, or nothing with `ANALYTICS_PII=none`. `full` is downgraded.
* **Client IP:** XFF is trusted only from configured proxies, by default the local nginx on loopback. The right-to-left walk stops at the first untrusted or invalid hop, so neither forged nor garbage entries change the result.
* **Updates** (`scripts/geoip-update.sh`):
  * Credentials come from `/etc/guiatv/geoip.env`, outside the repo; the key goes to curl through stdin and is never on argv or in logs.
  * The archive's SHA-256 is verified, the file renamed atomically, and `.prev` kept for rollback.
  * The systemd timer runs Wed/Sat as an unprivileged `geoip` user.
  * Tested against a local fake MaxMind server: update, unchanged, checksum mismatch keeps the current file, `.prev`, missing credentials.
* **Limitations:** history is **not backfilled**: existing sessions keep no location, and old full Mongo IPs expire under the 14-day TTL with no migration. Enabling needs a MaxMind account (external).

**Verdict: PARTIAL.** Implemented and tested with official test databases. Real GeoLite2 files, credentials and the production proxy chain are BLOCKED/unverified, and `ANALYTICS_GEOIP_ENABLED` stays off by default.

## 4. ANALYTICS-04 — device detection, semantic labels, admin UI

* **Device** (`device-detector.service.ts`):
  * The browser applies the SSR TransferState for the hydrating render (the DOM must match), then **re-measures the real viewport in `afterNextRender`**.
  * `classifyDevice()` separates hardware class (Client Hints, then UA, then touch plus physical screen) from orientation (viewport). The fixture (Android Mobile Chrome, screen 407×904, viewport 406×724) classifies as **mobile / portrait**, checked by unit spec and E2E.
  * Android tablets without "Mobile" are now `tablet`.
  * The layout breakpoint (`deviceType`, by width) is unchanged for existing consumers.
* **Labels** (`pathLabels.ts`): admin reports show "Emisión · El Hormiguero · Antena 3 · 04/11 21:00" for `/contenido/program:<id>`.
  * The lookup is one projected `$in` over at most 50 ids per request, cached (6 h, misses 10 min). Expired airings use only what the id encodes; no title is invented.
  * Static and prefix routes get Spanish names. Stored paths are unchanged, so historical grouping is intact.
* **Not done: public URLs.** Consumer links to `/contenido/program:<id>` (noindex airing pages) still exist, from `programDetailPath()` and the TV-read and catalogue DTOs. Replacing them needs a semantic airing route and verified redirects, which is an SEO change requiring crawl/GSC data and production verification, and the brief forbids inventing permanent identities for EPG slots. Left as an explicit open item; no new technical-id URL was added.
* **UI:**
  * Labels across the overview, pages, live sessions, events and journeys.
  * A new "Diagnóstico" tab (queue, drops, lag, storage, flags, GeoIP state, GA4 demographics), with explicit loading, error and unavailable states.
  * The existing dashboards from `a008fb5` (live map, geography, sources, events, journeys, retention) are kept; no new charts were added.

**Verdict: PARTIAL.** Device detection and admin labels pass; public semantic URLs are not changed (blocked on SEO verification).

## 5. ANALYTICS-05 — GA4 with Consent Mode v2 (basic)

* `ga4.service.ts`:
  * No Google script, request or cookie before consent.
  * On grant, it queues `consent default` (all denied, including `ad_user_data` and `ad_personalization`), then `consent update {analytics_storage: granted}`, then `set`/`config` with a **sanitised `page_location` and an empty or host-only `page_referrer`**, so automatic hits don't carry query strings, and `send_page_view: false`.
  * gtag.js is injected on an idle callback after `load`.
  * Page views come from the same deduplicated stream (one per page); selected product events are forwarded.
  * Revocation sets consent to denied, sets `ga-disable`, and deletes the cookies.
* **Rollout flag:** GA4 loads only if the server says so (`ANALYTICS_GA4_ENABLED=true`, default **off**). The id comes from `ANALYTICS_GA4_MEASUREMENT_ID`, falling back to `G-P6Z3BY2DVW` in the prod environment.
* **Admin aggregates:** `Ga4ReportingService` uses the GA4 Data API (read-only scope) for `userAgeBracket`, `userGender` and `brandingInterest`. It is cached 6 h (errors 5 min), has an 8 s timeout, returns GA4 values as-is, flags thresholding, and answers `not_configured` / `credentials_error` / `api_error` / `timeout`. Nothing is estimated or inferred.
* **Verified locally** (E2E, production build): no Google request before consent; the gtag.js request starts only after "Aceptar"; dataLayer order default → update → config; exactly one GA4 `page_view` per page, matching the first-party count; revocation disables GA4. **Not verified:** real GA4 collection or DebugView, because `googletagmanager.com` is blocked here and the property is not accessible.
* **External account actions required (owner):**
  1. Confirm `G-P6Z3BY2DVW` belongs to the GuíaTV GA4 property and the stream is `https://guiaprogramaciontv.com`.
  2. In the stream's Enhanced measurement, **turn off "Page changes based on browser history events"** (page views are sent explicitly; leaving it on double-counts SPA navigations). Optionally turn off form, scroll and site-search events, which would otherwise read raw URLs.
  3. Set data retention and IP options as the privacy policy requires; review Google signals. Demographics need Google signals and thresholds, and with advertising consent always denied they will probably stay unavailable. The panel shows that state honestly.
  4. For the admin panel: create a service account, grant it **Viewer** on the property, put its JSON at `/etc/guiatv/ga4-reader.json` (root, 0600), set `ANALYTICS_GA4_PROPERTY_ID`.
  5. Then set `ANALYTICS_GA4_ENABLED=true` and validate with Tag Assistant/DebugView: no hits before consent, one `page_view` per navigation, `gcs`/`gcd` parameters reflect the consent states.
  6. Have the cookie and privacy texts approved by whoever is legally responsible. The `/cookies` table was updated to what the code does; the legal wording was not reviewed by counsel.

**Verdict: PARTIAL.** Implemented and locally verified; GA4 property verification and Data API access are BLOCKED on the owner.

## 6. ANALYTICS-06 — performance, security, release

### Browser (medians of 7, local, stub API; A/A noise: LCP 20–60 ms, mobile TBT ~80 ms)

Initial JS + CSS (build stats): **272.69 → 273.07 kB** estimated transfer (+0.38 kB). The collector chunk (+5.7 kB gz) is downloaded only by consenting visitors.

Consent not given (`bench-ab-unset.json`, final build):

| Profile, page, load | LCP base → cand | TBT | INP-like | Telemetry requests |
|---|---|---|---|---|
| mobile `/` cold | 1336 → 1360 | 942 → 968 | 16 → 16 | 10 → **0** |
| mobile `/` warm | 360 → 348 | 440 → 529 | 16 → 16 | 10 → **0** |
| mobile `/cookies` cold | 504 → 496 | 855 → 801 | 16 → 0 | 10 → **0** |
| desktop `/` cold | 1088 → 1104 | 67 → 61 | 0 → 0 | 10 → **0** |
| desktop `/cookies` cold | 292 → 300 | 65 → 56 | 0 → 0 | 10 → **0** |

Consent granted (`bench-ab-granted.json`; build before the review fixes, which don't touch the consented render path):

| Profile, page, load | LCP base → cand | TBT | Telemetry req (bytes) |
|---|---|---|---|
| mobile `/` cold | 1244 → 1232 | 946 → 946 | 10 (3.4 kB) → 4 (1.0 kB) |
| mobile `/cookies` cold | 448 → 432 | 927 → 908 | 10 → 4 |
| desktop `/` cold | 1088 → 1068 | 79 → 68 | 10 → 4 |
| desktop `/cookies` warm | 88 → 140 | 0 → 0 | 10 → 4 |

* Every LCP difference is within the ≤ 50 ms target or the A/A noise.
* The largest is desktop warm `/cookies`, +52 ms, inside the 60 ms A/A spread.
* Mobile warm TBT +89 ms (consent unset) is at the edge of the ~80 ms noise; the cold runs go the other way. A real-device RUM comparison after deploy should confirm.
* CLS is unchanged (the pre-existing values above).
* Third-party requests before consent: **0**.

### Ingestion (local Valkey, 6,300 items, 3 rounds; `ingest-load-*.jsonl`)

| | Requests | CPU | Peak RSS | Event loop p99 / max | Request p50 / p99 |
|---|---|---|---|---|---|
| 64 concurrent: base | 6,300 | 4.9–5.1 s | 173 MB | 24–25 / 44–51 ms | 41–44 / 128–189 ms |
| 64 concurrent: cand | 600 | 2.3–2.8 s | 120–148 MB | 3–16 / 56–110 ms | 45–57 / 169–688 ms |
| 8 concurrent: base | 6,300 | 5.5–6.0 s | 170 MB | 5.7–6.2 / 12–27 ms | 5.7–6.1 / 19–23 ms |
| 8 concurrent: cand | 600 | 2.1–2.3 s | 119–125 MB | 5.8–6.8 / 18–23 ms | 7.7–8.7 / 40–41 ms |

* Same work with 10× fewer requests, −45 to −60 % CPU and −30 % memory.
* Per-request latency is higher, because each request carries 10 events and the drain loop interleaves. Persistence lags up to 2.1 s under the synthetic burst, by design (asynchronous).
* The event-loop **max** under the 64-client burst is worse in two of three rounds (up to 110 ms vs 51 ms): a regression under saturation, though not at the moderate load closer to this site's traffic.
* None of this was measured against production or MongoDB. The M13 stall paths (catalogue/tvread) are untouched by this change.

### Independent review

A separate reviewer agent read the full diff without running anything. It reported 1 critical, 9 major and 16 minor findings. All critical and major findings and most minor ones are fixed, with regression tests:

| Finding | Fix |
|---|---|
| C1: quadratic e-mail regex (ReDoS) on the public endpoint | linear patterns on capped input; 60 kB adversarial batch now validates within the 250 ms test budget |
| M1: admin-page events leaked and were attributed to the previous page | unmeasured route state |
| M2: GA4 automatic hits used raw URLs | sanitised `page_location` / `page_referrer` |
| M3: Mongo user lookup on the request path | role resolved in the worker, cached |
| M4: admin exclusion lost on beacons | sticky per-session exclusion |
| M5: Valkey dedupe swallowed retries | dedupe keys released on write failure |
| M6: Valkey memory growth | 200 events / 48 h per session |
| M7: PII=none broke the realtime report | explicit `excluded` boolean |
| M8: mixed Mongo write errors swallowed | decide on every write error |
| M9: `/config` never cacheable | `credentials: 'omit'` |
| Minors | shared rate limiter, 64 kB route parser, ids at acceptance, no `null` fields, revoke-in-flight generation counter, re-grant after revoke, XFF garbage, slug over-redaction, GeoIP unit not root, 501 for unsupported store, facade buffer age |

The reviewer's left-open points are listed in §7.

### Test totals (this branch)

Backend 874/914 pass with 0 failures and 40 skipped; frontend 439/439; ops 40/40; E2E 19/19; lint 0 errors (§8).

### Release and rollback

* **Not merged, not deployed.** This needs the owner's authorisation and a **normal (non-artifact) deploy**: the lockfile changes (`maxmind`, and already `a008fb5`).
* Production checks after deploy:
  * `GET /v2/telemetry/config` returns `enabled:true, ga4.enabled:false`.
  * A first visit shows the banner and sends no `/v2/telemetry/*` request before a choice.
  * After "Aceptar", `/collect` returns 202.
  * Admin › Diagnóstico shows `processed` growing and `dropped = 0`.
  * `/v2/health/metrics` event-loop windows are comparable to the M13-B5 §11 values.
* **Progressive activation:**
  1. Deploy (first-party collection on, GA4 off, GeoIP off).
  2. Install GeoLite2 and set `ANALYTICS_GEOIP_ENABLED=true`.
  3. Complete the GA4 account steps, then `ANALYTICS_GA4_ENABLED=true`.
* **Rollback:**
  * Instant: `touch /etc/guiatv/analytics.kill` (with `ANALYTICS_KILL_FILE` set). Server ingestion stops within 5 s, browsers within ~60 s.
  * Partial: `ANALYTICS_GA4_ENABLED=false` / `ANALYTICS_GEOIP_ENABLED=false`.
  * Full: revert the branch's commits and redeploy. No data migration is involved; new keys and fields are additive and expire under TTL.

**Verdict ANALYTICS-06: PARTIAL.** Local gates pass; production benchmark, deploy and verification are BLOCKED (network policy plus owner authorisation).

## 7. Open items and exact next actions

1. **Network policy (this environment):** allow `guiaprogramaciontv.com` to verify production; otherwise the owner runs the production checks in §6.
2. **Owner:** authorise merge and a normal deploy; set `/etc/guiatv/api.env` (`ANALYTICS_KILL_FILE`, keep `ANALYTICS_TRUSTED_PROXIES` empty if nginx is the only proxy; `ANALYTICS_EXCLUDED_IPS` = the admin's and the server's public IPs).
3. **MaxMind:** create an account and licence key, write `/etc/guiatv/geoip.env`, `useradd --system geoip`, install the systemd units, run the update once, enable `ANALYTICS_GEOIP_ENABLED`.
4. **GA4:** the steps in §5.
5. **Public semantic airing URLs** (SEO): design and verify a route plus 301 plan with GSC data, as a separate milestone.
6. **Review points left open:**
   * The kill switch still lets a consenting browser create its identifiers until `/config` answers (the server drops the data).
   * Old full IPs in Mongo expire within 14 days; there is no migration.
   * The banner, while visible on phones, covers the bottom tab bar until a choice is made (a common, non-modal pattern; needs a UX decision if unwanted).
   * Event-loop max under synthetic saturation (§6).
7. **Affiliate impressions (verified 2026-11-04, no change needed):** `AffiliateImpressionDirective` calls `trackImpressions` without an identity. `AffiliateAnalyticsService.emit` stores each impression with a fresh random `affiliate:<uuid>` id and no IP or user agent. Nothing is read from or written to the browser's storage, so ePrivacy consent is not triggered and the data is not linkable to a visitor.

## 10. Merge and deploy status (2026-11-04)

* #175 was merged by the owner as `ee35cb7`.
* **Deploy: BLOCKED.** The owner asked for the deploy. The required route is `deploy.yml` ("Deploy a producción (Contabo)", `workflow_dispatch`): the artifact route refuses this lockfile change. Dispatching it from this session returned `403 Resource not accessible by integration`, because the GitHub App has no Actions write permission. There is also no SSH access or network route to the host.
* **Next action (owner):** Actions → "Deploy a producción (Contabo)" → Run workflow on `main`. Alternatively, grant the app Actions write permission and the session dispatches it. Then run the post-deploy checks in §6.

## 8. Test evidence (final runs on the branch)

| Gate | Result |
|---|---|
| Backend `npm test` (with a local Valkey; Mongo integration tests skip without `TEST_MONGO_URI`) | 914 tests: **874 pass, 0 fail, 40 skipped** (baseline on `a008fb5`: 887 tests, 847 pass, 0 fail, 40 skipped) |
| Frontend `ng test` (full suite, ChromeHeadless) | **439 / 439** |
| Analytics-focused frontend specs | 48 / 48 (+1 ESLint-only follow-up) |
| `npm run test:ops` | **40 / 40** (includes `geoip-update.test.mjs`) |
| `npm run lint` | 0 errors; warnings are pre-existing except one fixed in the collector |
| Production SSR build | passes (`ng build --configuration production --ssr`) |
| Browser E2E `e2e-consent.mjs` (production build, real Chromium, Android fixture) | **19 / 19** (`artifacts/analytics/e2e-consent-result.json`) |
| CI (GitHub Actions on the PR) | see the PR checks |

## 9. Commits

See the PR description for the commit list (one per milestone).
