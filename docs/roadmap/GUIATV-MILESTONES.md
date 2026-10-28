# GuíaTV — milestones

Written for: the owner and the agents/operators executing milestones. Facts and evidence: [CURRENT-STATE.md](CURRENT-STATE.md) (source of truth for "what is true now"). Rules for every milestone: one milestone per session; no deploy, flag change, restart, migration or credential change without the owner's explicit approval for that action; docs-only changes never deploy; do not deploy unrelated changes while a rollout is being watched (M04-B); report engineering / CI / merge / deploy / activation separately; never record a result that was not observed.

Status key: `Eng/CI/Merge/Deploy/Act` — ✔ done, ○ pending, – not applicable, ✖ blocked. GO = may start now; NO-GO = a dependency or approval is missing.

## Order of execution (adjusted from the provisional list)

```
M00 → M02-A (merge #51) → M01-A (VPS checks) → M01-B (deploy main) → M02-B (preflight) → M03-A → M03-B → M04-A → M04-B
```

Adjustments, each from evidence: (1) **M02-A now precedes M01-B** — #51 carries the `mediaId` fix and metrics block; deploying `ac58a24` alone wastes a sync cycle. (2) **M02-B narrowed** to the one unmeasured quantity (`catalogueRowShare`); EPG coverage, horizon (3 days) and identity checks are already measured. (3) **M03-A reuses** the preflight and `candidates.json` (candidates expire; re-select, don't rebuild). (4) **M03-B** is flag-off parity after deploy; the enriched-vs-before compare belongs to M04-B. (5) **M11 split** into M11-A (existing corpus defects) and M11-B (new original text). (6) Stream B code may start after M02-A but is not deployed during M04-B.

Dependency graph: M01-A←M00 · M02-A←M00 · M01-B←M01-A,M02-A · M02-B←M01-B · M03-A←M02-B · M03-B←M01-B · M04-A←M03-A,M03-B · M04-B←M04-A · M05←M02-A · M06←M05 · M07←M05 · M08←M05,M06,M07 · M09←M00 · M10←M09 · M11-A←M00 · M11-B←M11-A,M04-B · M12←M09,M10,M11-B · M13←M01-B · M14←M08,M09,M10,M11-A,M11-B,M13 · M15←M14

## Stream A — Production and enrichment

### M00 — Current-state reconciliation
- **Objective**: verified baseline, this roadmap, PR for review. **Non-goals**: any code, deploy, merge of #51, flag.
- **Status**: Eng ✔ · CI ○ (runs on the PR) · Merge ○ (owner) · Deploy – · Act –
- **Skills**: Graphify/Context Mode (targeted), code-review. **Acceptance**: both docs present; IDs unique; dependencies acyclic; every PR/commit cited exists. **Evidence**: CURRENT-STATE.md + the validation in the PR body. **Blockers**: none. **Rollback**: revert the docs commit. **GO** (complete on PR open).

### M02-A — Phase 3F PR validation and integration
- **Objective**: review PR #51 against its report, fix only real defects, merge with owner approval. **Scope**: add `scripts/legacy-rollout-snapshot.test.mjs` to `test:ops`; confirm the `mediaId` test and preflight test run in `verify`; confirm no workflow sets a legacy flag. **Non-goals**: deploy, re-measuring, new features.
- **Status**: DONE — #51 squash-merged 2026-10-22 as `221ca46` (head `0f85308`, checks green, no deploy triggered) · Merge ✔ · Deploy ○ (M01-B) · Act –
- **Depends**: M00. **Skills**: code-review, tdd, diagnosing-bugs (only if a check fails).
- **Acceptance**: green `verify` + `ssr-resilience` on the final head; review has no open correctness finding; merge approved by the owner; merge deploys nothing (`deploy.yml`/`deploy-artifact.yml` are dispatch-only).
- **Evidence**: PR checks, review notes. **Blockers**: owner merge approval. **Rollback**: `git revert` of the squash commit (flags off, nothing deployed). **GO** (merge itself: needs owner).

### M01-A — Artifact deployment safety verification
- **Objective**: prove the artifact path and rollback are ready before shipping code. **Scope** (read-only on the VPS, by an operator): live commit and release id, previous release id for rollback, `guiatv-ops.sh status`, disk/memory, unit health, `api.env` has no activation flags by name, deploy lock free. Optionally a rollback drill in a quiet window (owner decision; never run so far). **Non-goals**: deploy, edits to `/etc/guiatv/*`.
- **Status**: **DONE 2026-10-22 — CONDITIONAL GO for M01-B** (read-only SSH to `contabo` worked; evidence in CURRENT-STATE, "M01-A addendum"). Phase 3F merged as `221ca46`. Open conditions: no rollback drill ever run, `main` unprotected, outage cause unproven · Deploy: artifact path used once (`6907540`) · Act –
- **Depends**: M00. **Skills**: engineering:deploy-checklist, Context Mode. **Acceptance**: checklist from 3F §2 filled with observed values; rollback target named. **Evidence**: operator output pasted into CURRENT-STATE. **Blockers**: none for the checks (done); owner window and approval for M01-B. **Rollback**: none needed (read-only).

### M01-B1 — Release hardening (inserted before the deploy)
- **Status**: DONE 2026-10-22 (PR #54 squash-merged as `ba2a0a8`). PR #53 merged (`b8d697d`). Fixed: API graceful shutdown (websocket kept `server.close()` pending → 10 s, exit 1), post-boot journal classifier (user-manager shutdown target mis-read as clean), workflow guards, rollback simulation test. Proposed, not applied: `main` ruleset. Evidence: CURRENT-STATE "M01-B1 addendum". **Decision for M01-B: CONDITIONAL GO** (owner approval, merge this PR first).

### M01-B — Controlled Phase 3E production deployment
- **Objective**: ship `main` (3E + 3F) to production with every legacy flag unset. **Scope**: `gh workflow run deploy-artifact.yml --ref main`, post-deploy smoke: existing routes, `/sitemap.xml`, canonical/robots of a sample, `/v2/health/metrics` shows `legacyEnrichment` with epoch `off`, 0 new 5xx. **Non-goals**: any flag, switching `deploy.yml` to artifacts, post-boot unit.
- **Status**: Eng ✔ · CI ✔ · Merge ✔ (`ba2a0a8` incl. 3E, 3F, B1) · M01-B2 pre-flight CONDITIONAL GO (2026-10-22) · Deploy ✔ (**M01-B2-DEPLOY** PASS 2026-10-22: run 39769605049, `66be5ec`, release `20261022132028`; rollback `20261022010257` kept; next **M02-B**) · Act –
- **Depends**: M01-A, M02-A, M01-B1. **Skills**: engineering:deploy-checklist. **Acceptance**: production serves the new commit; payloads of sampled pages identical to flag-off baseline; metrics block present. **Evidence**: workflow run URL, smoke output. **Blockers**: owner approval of deploy and window; Contabo instability unresolved. **Rollback**: `sudo guiatv-ops.sh rollback <previous-release-id>` (id recorded in M01-A); triggers in `docs/release-workflow.md`. **NO-GO** until M01-A and M02-A.

### M02-B — Real catalogue and EPG measurement
- **Objective**: measure `catalogueRowShare` and verified broadcasts per candidate on production data. **Scope**: run the existing read-only preflight on the VPS (guard aborts on any write). **Non-goals**: new tooling; relaxing the evidence join; waiting is not a fix (the sync fix only affects programmes synced after M01-B, so run after at least one full EPG sync).
- **Status**: Eng ✔ · Measured ✔ (2026-10-22, read-only, 0 writes) · CI (see PR) · Merge ○ · Deploy ○ (not authorised in M02-B) · Act – · mediaId-fix effect **not yet measurable** (no sync since deploy; next scheduled sync re-measure: `scripts/m02b-measure.cjs`) · `catalogueRowShare` **26.3 %** · fixes merged `7b30fa6` and deployed (M02-C: run 39775322728, release `20261022140539`) · post-sync re-measure due after the 18:00 CEST sync
- **Depends**: M01-B. **Skills**: Context Mode, diagnosing-bugs if share is low. **Acceptance**: preflight JSON with per-date coverage and per-candidate outcome, zero writes. **Evidence**: `/tmp/preflight.json` committed under `docs/seo/phase-3f/`. **Blockers**: VPS access. **Rollback**: none (read-only). **NO-GO** until M01-B.
- **If the share is low**: next step is tying airings to rows at read-model build time (3F §10), as a new milestone — not a looser join. **Result: share is low (26.3 %); 2 196 of the 2 746 unlinked TMDB airings (59 % of all) have exactly one catalogue row for that TMDB id whose title key matches — see CURRENT-STATE M02-B addendum.**

### M02-C — Integrate, deploy, validate (2026-10-22)
- **Status**: PR #57 merged `7b30fa6` ✔ · deployed ✔ (run 39775322728, `20261022140539`, parity ✔, flags unchanged) · catalogue fix verified in prod (751 + 274 rows) ✔ · mediaId before/after ○ (needs the 18:00 CEST sync) · identity-linking design ✔ (`IDENTITY-LINKING-DESIGN.md`).
- **Next**: M03-L1 shadow-mode linker (see design) — done 2026-10-22 (below). M03-A stays blocked on the linker and on the owner decision about derived links.

### M03-L1 — Conservative EPG→catalogue linker, shadow mode (2026-10-22)
- **What**: pure `linkCatalogueRow` (`apps/backend/src/domain/services/catalogueLinker.ts`; LINKABLE / ALREADY_LINKED / REJECTED / AMBIGUOUS + reason code + evidence, rule `tmdb-type-titlekey-unique` v1) and `runCatalogueLinkShadow` called once per `TvReadModelBuilder.rebuildDate` behind `EPG_CATALOGUE_LINK_MODE` = `off` (default; unknown → off + one warning) | `shadow` (batched indexed reads ≤500 ids/query, ≤5 000 ids/run, counters + p50/p95 on `/v2/health/metrics` `catalogueLink`; nothing persisted, airings byte-identical, never fails the build).
- **Measured (prod, read-only, candidate dist, 12:30Z, before the 18:00 sync)**: shadow vs `m02b-measure` on the same window: linkable **2 150 = 2 150**, every rejection category identical (title key 290, wrong type 221, shared TMDB id 63, invalid rows 12, duplicates 6, no key 4); 977 already linked + 2 conflicting `mediaId` (= m02b `catalogue_tmdb_mismatch`). Overhead 54–87 ms per date vs 77–128 s per rebuild (≈0.1 %), 1 query per date. `artifacts/m03-l1/`.
- **Status**: Eng ✔ · Tests ✔ · Measured ✔ · Merged `bd98983` · Deployed release `20261022150159` · Act: flag **off** (shadow not enabled persistently). Post-resync: catalogueRowShare 34.6 % (196 type-crossed Series→movie links from the 3F copy path), linkable 2 171 (exact agreement). Persisting derived links and letting them satisfy `requireCatalogueRow` remain owner decisions.

### M03-L2 — Type-safe media identity propagation (2026-10-22)
- **Root cause (confirmed, prod read-only census)**: the sync's DB-enrichment cache (`SyncEPGData.loadExistingEnrichment`) was keyed by title alone and ignored kind. A `Serie` programme reused a same-titled film's `tmdbId` and, from 3F on, its movie row id. All 199 cross-type window airings came from this path (197 Series→movie, 2 Cine→tv; stored `tmdbSource: db_cache`, kind `series`; rows `metadataSource: epg`; 3 rows / 4 TMDB ids). The backfill script had a second, latent path: it linked by TMDB id only.
- **Fix**: linker `cross_type_media_id`; a kind-aware, row-verified sync cache (Cine/Serie hits need an explicit matching kind; ambiguity or an unreadable catalogue copies no id); an always-on build guard `guardExistingMediaIds` that strips unverified ids from built airings only; the backfill now filters by kind. 8 regression tests fail on the old code.
- **Status**: Eng ✔ · Tests ✔ (backend 640/1 skip, ops 29, CI green) · Merged `6efce56` (PR #61) · Deployed release `20261022161030` (rollback `20261022150159`) · Flags unchanged (all off). The post-sync rebuild is **pending** (next scheduled precompute). 201 stored programme docs remain; see `M03-L2-REMEDIATION-PROPOSAL.md`.

### M03 — Content enrichment & quality (2026-10-22) — identity stream CLOSED
- **Status**: Eng ✔ · CI ✔ · Merge ✔ (#62 `68b8523`, #63 `b0b0462`, #64 `ece2b03`) · Deploy ✔ (release `20261022182542`) · Act – (no flag changed). Evidence: CURRENT-STATE "M03 addendum", `artifacts/m03/`.
- **M03.0**: cross-type airings 199 → 0 after the 18:15 rebuild; TMDB pages no longer list opposite-kind airings (#64). **The identity-only stream is closed.** Historical residue (~201 stored programme docs) is tracked as technical debt below, not as a milestone.
- **M03.2/.4**: TMDB detail genres/runtime/original title (film genres and runtime 1/31 → 31/31), resolvable hub links (404s 3/95 → 1/79), Movie/TVSeries JSON-LD without third-party `aggregateRating` and invented `inLanguage`.
- **Technical debt — historical remediation (TD-1)**: stored `programs` with cross-type `mediaId`/`tmdbId` (`M03-L2-REMEDIATION-PROPOSAL.md`). Not user-visible after M03 (build guard + read-time kind filter). Do only with owner write approval; never a blocker.

### M03-A — Candidate enrichment verification
- **Objective**: final allowlist of 3–5 `/peliculas/` paths. **Scope**: pick candidates the preflight accepts with `verifiedBroadcasts > 0`; swap from the 25 reserves; re-take before-snapshots if > a few hours old. **Non-goals**: title-only matches, `scope=all`, series/programmes.
- **Status**: Eng ✔ · CI – · Merge – · Deploy – · Act –
- **Depends**: M02-B. **Skills**: Context Mode. **Acceptance**: allowlist + fresh `rollout-before-*.json`; each page `index, follow` at snapshot time. **Blockers**: candidates go `noindex` when the last airing passes — the list is valid for hours, not weeks. **Rollback**: none. **NO-GO** until M02-B.

### M03-B — SEO and performance regression validation
- **Objective**: show the deployed build with flags off changes nothing. **Scope**: `legacy-rollout-snapshot compare` of the M01-B build against the 3F before-snapshot (without `--expect-enriched`), `seo-regression` live crawl by manual dispatch, latency vs the 3F baseline. **Non-goals**: enrichment on.
- **Status**: Eng ✔ · CI ✔ · Merge – · Deploy – · Act –
- **Depends**: M01-B. **Skills**: seo, seo-technical, Playwright. **Acceptance**: compare exit 0; slug p95 ≤ 300 ms, `tv/read` p95 ≤ 1,230 ms, 0 new 5xx. **Rollback**: M01-B rollback. **NO-GO** until M01-B.

### M04-A — Controlled rollout preparation
- **Objective**: everything decided before the flag moves. **Scope**: owner confirms thresholds (3F §6, may tighten), rollback owner on call, kill file path agreed, nginx cache-purge command rehearsed on one path, exact `api.env` diff written out. **Non-goals**: setting the flag.
- **Status**: Eng ✔ · CI – · Merge – · Deploy – · Act ○
- **Depends**: M03-A, M03-B. **Skills**: engineering:deploy-checklist. **Acceptance**: a one-page go sheet signed off by the owner. **Blockers**: owner decisions. **Rollback**: n/a. **NO-GO** until dependencies.

### M04-B — Authorized rollout and monitoring
- **Objective**: enable `CONTENT_LEGACY_ENRICHMENT_ENABLED=true` with `SCOPE=<allowlist>` (never `all`), restart only `guiatv-api`, verify, watch ≥ 1 week. **Scope**: 3F §6 steps 2–5; `compare --expect-enriched`; metrics watch. **Non-goals**: more pages, other content types, unrelated deploys during the watch.
- **Status**: all ○ · **Depends**: M04-A. **Skills**: engineering:incident-response if a trigger fires. **Acceptance**: compare exit 0, counters healthy (`timeout` ≤ 1 %, `skipped:breaker_open` = 0), thresholds not breached for the watch period. **Blockers**: **explicit owner approval to activate**, quiet window. **Rollback**: kill file or unset flag + restart `guiatv-api` (nothing was written, nothing to undo); purge nginx cache of the paths. **NO-GO** until M04-A and approval.

## Stream B — Content and UX (provisional; detail when next)

| ID | Objective | Depends | Skills | Acceptance (summary) | Blockers | Go |
|---|---|---|---|---|---|---|
| M05 | Movie and series detail experience: separate work broadcasts from channel recommendations, safe known airing routes, responsive/a11y/SEO polish | M02-A ✔ | frontend-design, UI-UX-Pro-Max, angular-component | Backend/Angular/SSR CI green; deterministic Playwright + axe; production verification required before PASS | — | **DONE** (PR #71, release `20261023010043` @ `cb5a860`, verified) |
| M06 | Series and episodes pages (incl. frontend episode-titled links, EPG films classed as `Series`) | M05 | same | same; episode identity rules respected | 3 days of EPG only | NO-GO (verify whether M05 series detail already closed it) |
| M07 | Programme and channel pages (now/next; fix "7-day" assumptions) | M05 | same | no copy promises more than the 3-day guide | - | **DONE** (PR #72, release `20261023142416` @ `da9ec11`, verified — see [M07-DELIVERY.md](M07-DELIVERY.md)) |
| M08 | Global UX/UI consistency, navigation, football and search | M05, M07; M06 remainder tracked | Ponytail, Serena, design/review, Playwright, axe | Theme/mobile/SEO/budget checks and gated artifact release | Bounded debt recorded separately | DONE: #73/#74/#75, release20261026095229 @13aeaa8; production verified2026-10-26; see M08-DELIVERY.md |

## Stream C — SEO and editorial (provisional)

| ID | Objective | Depends | Skills | Acceptance (summary) | Known blockers | Go |
|---|---|---|---|---|---|---|
| M09 | Canonicals, indexation, technical SEO; decide sitemap policy for `/peliculas/` (822 `/programas/` URLs, no `/peliculas/` today) | M00 | seo-technical, seo-sitemap, seo-page | documented indexation policy; `seo-regression` green; no thin page indexable | `noindex`-by-airing rule makes indexability time-dependent | GO (read-only audit) |
| M10 | Internal linking and topical architecture | M09 | seo-cluster, mk-site-architecture | link graph reviewed; no orphaned indexable detail pages | — | **PARTIAL (2026-10-26)**: released `20261026185109` @ `6288900`; verified programme↔work links, canonical channel links, redirect/loop fixes, `ssr-resilience` on `main`. Not met: 694 sitemap programme URLs beyond depth 3 (programme-only linking is a policy decision, deferred to M11). [m10-internal-linking.md](../seo/m10-internal-linking.md) |
| M11-A | Existing-corpus quality: measure, fix safe defects, gate publication, classify programme pages | M00 | seo-content, code-review, Playwright | reproducible audits; confirmed defects fixed; gate blocks known defects; no unsupported facts published | republishing the corrected drafts is a reviewer action (production write) | **DONE 2026-10-26** (released `20261026213853` @ `d6f9eea`, verified): PRs #86 `329ac2f` (graded CMS gate, serve-time link canonicalization), #87 `d128bce` (source-backed draft corrections, H1/CTA a11y), #88 `d6f9eea` (EPG filler synopses, programme-page classifier). Corpus = 10 guides (not 50). Editorial audit blocking 9 → 0. Programme pages A 50 / B 45 / C 157 / D 451 / E 0. Release and remaining owner decisions: [M11A-DELIVERY.md](M11A-DELIVERY.md) |
| M11-B | Original editorial production: give the 5 platform rankings platform-specific human value or merge them; maintenance calendar for the 9 time-bound guides; first-hand commentary only from a named person; decide the 9 lost retired URLs | M11-A, M04-B | seo-content-brief, mk-copywriting | each new or rewritten guide passes the #86 gate with no unacknowledged `human` finding; sources and dates per claim; not template-shaped; a named reviewer publishes | needs a human author/reviewer and GSC traffic data | NO-GO (author) → **PARTIAL (2026-10-28)**. Owner's revised requirement (M11-F brief): a fully certified automatic publication (signed live provenance, independent critic PASS, every gate, Admin-activated policy) may satisfy the "a named reviewer publishes" criterion without a named reviewer. Met by evidence: 3 guides published that way on 2026-10-27/28 ([M11E2-DELIVERY.md](M11E2-DELIVERY.md) §15). Original criterion kept above for the record. Still PARTIAL because the M04-B dependency is unmet (M04-B all ○, NO-GO); the platform-ranking, maintenance-calendar and retired-URL items are not closed either |
| M11-F | Autonomous editorial operations: topic discovery and queue, unattended schedule, verified internal links, scheduled maintenance, GSC monitoring | M11-E2 | ponytail, Playwright, independent review | no hand-made topic files; explainable ranking; duplicate/low-value rejection; category and source diversity; scheduled runner within the Admin daily cap; certified revisions only; GSC observations or a precise blocker | runner needs the owner PC and its local model gateway | see [M11F-DELIVERY.md](M11F-DELIVERY.md) |
| M12 | Controlled programmatic SEO | M09, M10, M11-B | mk-programmatic-seo | small batch, quality gate, kill switch | scaled-content risk; not before M11-B | **NO-GO** (entry gate reviewed 2026-10-27: M10 partial, M11-B unmet, no index-level kill switch, batch cap or per-URL gate, no GSC baseline; [M12-ENTRY-GATE.md](M12-ENTRY-GATE.md)) |

## Stream D — Reliability and monetization (provisional)

| ID | Objective | Depends | Skills | Acceptance (summary) | Known blockers | Go |
|---|---|---|---|---|---|---|
| M13 | Performance and reliability: Mongo p99 tail (7.2 s), `tv/read` p95, cold-start slowness, Contabo outage follow-up | M01-B | diagnosing-bugs, sql-optimization | baselines improved or accepted by owner; uptime probe green | root cause of 2026-10-20/21 outage unknown (provider) | NO-GO |
| M14 | AdSense readiness review (internal verdict vs `03-ADSENSE-READINESS.md`) | M08, M09, M10, M11-A, M11-B, M13 | seo, seo-content, mk-analytics | every class in the remediation table closed or `noindex`; verdict written with evidence | Google publishes no pass threshold | NO-GO |
| M15 | Final remediation and submission readiness | M14 | engineering:deploy-checklist | owner submits; no open M14 finding | owner decision | NO-GO |
