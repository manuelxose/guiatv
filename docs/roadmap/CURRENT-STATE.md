# GuíaTV — current state (M00, verified 2026-10-22 ~09:15 UTC)

Written for: the owner and whoever executes the next milestone. Plan: [GUIATV-MILESTONES.md](GUIATV-MILESTONES.md). Update this file at the end of every milestone; it records only what was observed, with the source of each fact.

## Verified facts

| Fact | Evidence |
|---|---|
| `main` = `ac58a24` (Phase 3E, PR #50, merged 08:44Z) | `git rev-parse origin/main` after fetch |
| Open PRs: **#51 only** (Phase 3F, head `36b0e15`, not draft, `MERGEABLE`/`CLEAN`, no review). Checks: `verify` ✔, `ssr-resilience` ✔, `live-crawl` skipped by design; workflows *Build, test, and performance budgets* and *SEO regression* ✔ on `36b0e15` | `gh pr view 51`, `gh run list` |
| `main` has **no branch protection** (API 404): "required checks" are convention, not enforced | `gh api …/branches/main/protection` |
| Phase 3D = PR #48, `ed03242`. Phase 3C = PR #47, `6907540`. Squash-merged PRs #49 (stacked 3E, base = 3D branch) and #50 (3E re-landed on `main`) both exist; only #50 is on `main` | `gh pr list --state all` |
| CI on `main` push `ac58a24`: success. **No deploy run exists for `ac58a24`** | `gh run list` |
| Deploy history: `deploy-artifact.yml` ran **once** (dispatch, `6907540`, 2026-10-21 23:01Z, success). `deploy.yml` ran on push for `ed03242` (08:36Z, success) via the old compile-on-VPS path. Both are now `workflow_dispatch`-only | `gh run list --workflow …`, workflow files |
| **Production runs the Phase 3D build.** API uptime was 2,191 s at 09:15Z (restart ≈ 08:38Z, matches the `ed03242` deploy); `/v2/health/metrics` has no `legacyEnrichment` block and `/v2/health` has no `X-Legacy-Enrichment-Epoch`, i.e. the 3E code is not live | public GETs, this session |
| Activation flags: every `CONTENT_*`, public-read, canary, identity-write, `EPG_YEAR_PROVENANCE` and `CONTENT_LEGACY_ENRICHMENT_*` flag is **default-off in code** (`LegacyEnrichmentPolicy`: anything but `ENABLED=true` = off; `SCOPE` unset serves nothing; `KILL`/`KILL_FILE` instant off). Production `api.env` was **not read** (no SSH here); "unset" rests on the 3C/3F reports and the uptime probe's entity-reads-off invariant | source + docs |
| Rollback: `scripts/guiatv-ops.sh rollback [release-id]`; triggers in `docs/release-workflow.md`; legacy enrichment adds a kill file / flag unset. **No rollback drill has been run on the VPS** (3F §2) | `docs/ops/VPS-RELIABILITY-RUNBOOK.md`, 3F report |
| CI (`performance.yml` `verify`): lint, backend tests on MongoDB 8 (`*.mongo.test.ts` included), deploy-script sandbox, ops tests, Karma, production build with Angular budgets. `seo-regression.yml`: SSR/cache tests, Playwright entity specs, `seo:ssr-resilience`, live crawl of production (manual dispatch only) | workflow files |
| Roadmap/tracking docs before M00: none (`git ls-files` for roadmap/milestone) | repo |

## Phase status (engineering / CI / merge / deploy / activation)

| Phase | Eng | CI | Merge | Deploy | Activation |
|---|---|---|---|---|---|
| 3C (#47) | done | ✔ | `6907540` | artifact deploy ✔ | none (flags off) |
| 3D (#48) | done | ✔ | `ed03242` | **live** (old on-host build) | none; owner signature needed again (evidence changed, 3D §9) |
| 3E (#50) | done | ✔ | `ac58a24` | **not deployed** | none |
| 3F (#51) | done, see below | ✔ on `36b0e15` | **open** | not applicable until merged | none |

## Phase 3F reconciliation (PR #51: 23 files, +2,110/−12)

| Item | State |
|---|---|
| Read-only preflight `legacy-enrichment-preflight` (guarded, exit 97 on write) | **Implemented + Mongo-tested in CI.** Never run against production data (needs VPS) |
| `mediaId` propagation fix (`SyncEPGData` db-cache branches, repository projection) | **Implemented + tested.** Only affects programmes synced *after* a deploy; real `catalogueRowShare` unmeasured |
| Real EPG measurements (public GETs) | **Done**: horizon is **3 days, not 7**; 421 indexable films, 42 gain airings beyond the legacy window; `/peliculas/` pages are not in any sitemap |
| Candidate pages | 5 proposed + 25 reserves, **time-sensitive** (legacy page turns `noindex` when its last airing today/tomorrow passes; guide has 3 days) |
| SEO before-snapshots + `legacy-rollout-snapshot` compare tool | Before-snapshots taken 2026-10-22; tool implemented and unit-tested |
| Runtime metrics + latency baselines | `/v2/health/metrics.legacyEnrichment` counters; baselines recorded (slug p95 148 ms, `tv/read` p95 615 ms); rollback thresholds proposed (owner may tighten) |
| Kill switch / rollback | Kill env/file, scope list, breaker, 800 ms budget exist (3E); thresholds in 3F §6 |

## Genuine deficiencies and blockers

1. **`scripts/legacy-rollout-snapshot.test.mjs` is not run by CI** (`test:ops` lists three files; no workflow references it). Add it to `test:ops` in PR #51 (one line). → M02-A.
2. **3E report is stale on two points**: it says "not merged" and describes a 7-day window; the guide has 3 days (3F corrects the copy, not the 3E document). Treat 3F §3 as authoritative.
3. **Deploy ordering**: deploying `ac58a24` before #51 would ship 3E without the `mediaId` fix and metrics block, wasting a sync cycle. Roadmap orders merge of #51 before the deploy (M02-A → M01-B).
4. **Needs the owner/operator, not an agent**: VPS pre-checks and preflight run (no SSH from here), deploy approval and window, activation approval and final paths, merge approval for #51.
5. `main` unprotected; Contabo outage root cause still open (2026-10-20/21) — deploy only in a watched window.
6. Production flag state and the previous release id are unverified until M01-A.

## Safety statement for M00

Documentation only. No flag, deploy, restart, migration, credential or indexation rule was touched; production was read through public GETs only.

## Addendum — M02-A (2026-10-22)

- PR #52 squash-merged: `main` = `44b8391`. PR #51 rebased onto it; `scripts/legacy-rollout-snapshot.test.mjs` is now in `test:ops` (deficiency 1 resolved). Backend suite with MongoDB: 610 pass / 0 fail (incl. `mediaId` cache and preflight Mongo tests); `tsc` clean; `test:ops` 18 pass.
- Review of #51: `mediaId` is copied only from the same stored programme row that supplies `tmdbId` (first alias match, absent → omitted, never synthesised); preflight runs under the read-only guard (exit 97 on write); snapshot tool only issues GETs and writes `--out`; no flag defaults changed; no workflow runs on merge. No critical/high findings.
- Corrections: the 3E report's "not merged" is superseded (merged `ac58a24`, **not deployed**); EPG horizon is **3 days**, not 7. Historical reports are left unchanged.
- Remaining: owner merge approval for #51; VPS-only checks (M01-A), preflight against real data (M02-B); all activation stays owner-gated.

## M01-A addendum — production readiness (2026-10-22 ~10:05Z, read-only)

Method: SSH `contabo` (read-only commands only), public GETs. Nothing restarted, written, deployed or compiled.

**Phase 3F**: PR #51 head `0f85308` unchanged since review, `verify` ✔ `ssr-resilience` ✔ (`live-crawl` skipped by design), no review findings, no `.github/` change, both deploy workflows `workflow_dispatch`-only. Squash-merged → `main` = `221ca46`. The push ran only *Build, test, and performance budgets*; no deploy run. Flags unchanged (code default-off).

**Release baseline**: live = `releases/20261022103818`, `gitSha ed03242` (Phase 3D, old compile-on-VPS deploy, 08:38Z); checkout HEAD `ed03242`, clean (only untracked `.editorial-publish/`). `main` is 3 commits ahead (3E, M00, 3F), **not deployed**. `package-lock.json` unchanged `ed03242`→`main` and equals the server stamp, so the artifact path will not be refused for stale dependencies.

**Rollback**: releases on disk `20261021190805, …195307, …205747, 20261022010257 (6907540, Phase 3C), 20261022103818 (live)`. `guiatv-ops.sh rollback` (no id) picks `20261022010257`: atomic `ln -sfn` + `mv -Tf`, restarts API then SSR each health-verified, warms hubs, re-verifies; runs as root under the shared flock. `deploy-guiatv.sh` also auto-rolls back to the previous release if anything fails after publish starts. Data: 3E/3F add no migration/schema change (diff checked); `db:bootstrap` runs only with `BOOTSTRAP_DB=1`, which `deploy-artifact.yml` does not set; every flag off, so the old release reads the same data. **Never drilled on the VPS** (needs separate owner authorization).

**Deployment safety (code read, not executed)**: concurrency group `deploy-prod`, `cancel-in-progress: false`, build job 30 min, deploy job 20 min, ssh `command_timeout` 15 m, `script_stop`; server `flock /var/lock/guiatv-deploy.lock` (free; exit 75 if held); sha256 verified, `ARTIFACT_GIT_SHA` must equal checkout HEAD, lockfile-stamp guard, no `npm`/build on the host; post-publish smoke: 8 API, 8 SSR (incl. 301s) and Socket.IO checks; auth smokes skipped without `SMOKE_AUTH_TOKEN`. Caveat: the script `git reset --hard`s the live checkout it is running from (existing behaviour, worked on the 3C artifact deploy).

**Runtime (10:05Z)**: `guiatv-api`, `guiatv-ssr`, `nginx`, `mongod`, `valkey` active; 0 `NRestarts`; only failed unit `systemd-networkd-wait-online` (cosmetic, repeated). RAM 11.9 GB, 7.7 GB available, swap 4 GB file 0 B used, swappiness 10; `/` 145 GB, 42 % used, inodes 5 %. Kernel OOM/panic/hung-task/I-O-error lines: 0 in the last three boots. API `/v2/health` healthy. Correction (M01-B1): `guiatv-api` has `MemoryMax=2G` and a 1536 MB heap; only `guiatv-ssr` (heap 512 MB), mongod and valkey have no cgroup limit.

**Flags (effective)**: no `CONTENT_*`, `EPG_YEAR_PROVENANCE`, entity, canary, identity-write or legacy-enrichment variable exists in `api.env`, `ssr.env` or the running API/SSR process environments (checked by name only; no values read) → **all unset = off**. `post-boot.json` agrees (`activationFlagsPresent: []`, `entityReads: off`).

**Public baseline** (single GET each, curl, from WSL; all `index, follow` + matching canonical unless noted):

| URL | Status | Time | Bytes |
|---|---|---|---|
| `/` | 200 | 0.23–0.32 s | 1,124,713 |
| `/canales/la-1` | 200 | 0.81 s | 360,307 |
| `/canales/la-2` | 200 | 1.15 s | 503,863 |
| `/programas/chicago-pd` | 200 | 0.79 s | 232,575 |
| `/peliculas/gladiator` (legacy movie detail) | 200 | 0.64 s | 221,682 |
| `/peliculas/bikeriders-la-ley-del-asfalto` | 200 | 0.60 s | 218,895 |
| `/programacion-tv/en-directo` | 200 | 0.85 s | 450,402 |
| `/programacion-tv/peliculas` | 200 | 4.74 s (cold) | 372,228 |
| `/robots.txt`, `/sitemap.xml` (4 child sitemaps) | 200 | 0.26 s | 470 / 619 |
| `/v2/health` | 200 | 0.22 s | 526 |
| `/peliculas` (not a route) | 404 `noindex, nofollow` | 0.42 s | – |

`/api/v2/health` is 404 (health lives at `/v2/health`). `/peliculas/a|b` pages are not in any sitemap (3F finding).

**Outages (journal evidence)**:
- Verified: boot of 2026-10-20 17:24 ended with a **clean systemd poweroff** (23 min down, `last -x`): someone/something requested shutdown; not a crash. Boot of 21 Oct ends 20:58:47 CEST mid-service (valkey save line), no shutdown sequence, no kernel OOM/panic/hung/IO lines; node memory peak 2.7 GB of 11.9 GB, swap unused; VM is KVM. Reboot at 21:18 (owner).
- Verified: the ten "guiatv-api crashed" alerts on 21 Oct (and 10:38 on 22 Oct) are **restarts**: each shows `Stopping…` then exit status 1 ≈10 s later (stop timeout) and `OnFailure` firing. They are false-positive "crash" alerts and noise, not 10 crashes. The last one (20:57:51–20:58:01) precedes the journal cut by ~45 s: a restart was in progress shortly before the host vanished (correlation, not cause).
- `post-boot.json` says `endedWithoutShutdown: false` for the 21 Oct boot although the journal shows no shutdown: the detector under-reports; do not rely on it.
- Hypotheses (unproven): provider-side hard stop/migration (best fit for a silent cut, needs Contabo ticket); a memory/IO stall during on-host builds (no supporting counters). **No root cause.** Mitigations needing owner approval: file the Contabo ticket with the timestamps; artifact deploys only; `MemoryMax`/`OOMScoreAdjust` on units; fix the API's slow stop (10 s → exit 1) and the crash-alert wording; persistent journald is already on.

**Outstanding risks**: no rollback drill; `main` unprotected; outage cause open; 10 s API stop timeout makes every restart look like a failure; `deploy-guiatv.sh` self-replacement during run; auth smokes skipped without `SMOKE_AUTH_TOKEN`; `/programacion-tv/peliculas` cold render 4.7 s.

**M01-B prerequisites**: owner go + window, watched deploy (`gh workflow run deploy-artifact.yml --ref main`, then confirm the run built `221ca46`); pre-record `readlink current` (rollback id `20261022010257`); post-deploy compare this baseline (status, canonical, robots, payload size ±), `/v2/health/metrics` shows the `legacyEnrichment` block with flag off, flags still unset; abort and `guiatv-ops.sh rollback` on any smoke failure.

**Decision: CONDITIONAL GO for M01-B** (owner approval required; rollback drill recommended first or accept its absence explicitly).

## M01-B1 addendum — release hardening (2026-10-22 ~12:30Z; read-only on the VPS)

**GitHub**: PR #53 (head `88ff34c`, only the two roadmap files, `verify` ✔) squash-merged → `main` = `b8d697d`; Phase 3F `221ca46` is in it. The push ran only the build workflow, no deploy. Branch/PR for this milestone: `fix/m01b1-release-hardening` (not merged).

**Production re-read**: live `20261022103818` @ `ed03242`; rollback target `20261022010257` @ `6907540` present (`release.json` + `apps/`), 5 releases, 635 MB; deploy lock free; all five units active; 8.1 GB available, swap unused, `/` 42 %; 0 OOM/panic lines this boot; flags unset in env files and process environments (names only). `package-lock.json` is identical `6907540`→`main`, so the previous release runs on the shared `node_modules` and the artifact deploy will not be refused. Public SEO baseline of M01-A unchanged (not re-crawled).

**Deployment script self-reset**: `git reset --hard` replaces files with new inodes, so the running bash keeps reading the old, intact script (reproduced in a sandbox: `v1-start … v1-end`, file replaced underneath). Not a corruption risk. Consequence only: edits to `deploy-guiatv.sh` take effect one deploy late. No fix. Other failure modes reviewed and safe: build dirs are removed before `PUBLISH_STARTED=1`, but the live service runs from the immutable `releases/<id>` so nothing live is touched; a dirty checkout skips the sync and the artifact-commit check then refuses; failure after publish auto-reverts to the previous `current`; flock exit 75 changes nothing; artifact mode installs and compiles nothing (asserted in `test:deploy`).

**Rollback validation**: `scripts/test-deploy-script.sh` §7 simulates `guiatv-ops.sh rollback` in a sandbox with the production release ids: default target = newest release older than live (`20261022010257`), atomic switch leaves no `current.rollback`, rolling back to the live release fails. **A simulation, not a live rollback**; it does not exercise real systemd, nginx or Mongo. Data: 3E/3F add no migration; flags off. Residual risk: untested on the real host; needs root; rollback of an API that has already written new-shape documents is moot while flags are off.

**API shutdown (defect confirmed, fixed)**: journal 10:38:22 `SIGTERM received` → 10:38:32 `Forcefully exiting after timeout`, exit 1, no "HTTP server closed". Cause: `ChatSocketHub.close()` (which disconnects Socket.IO clients) ran *inside* the `server.close()` callback, but upgraded websockets keep `server.close()` pending forever, so it could never fire. Reproduced locally (`server.close` still pending after 2 s with one websocket client). Fix: `apps/backend/src/server/shutdown.ts` closes realtime first, then the HTTP server (idle keep-alives dropped, stragglers cut after 5 s), then the container, exit 0; the 10 s force remains. Tests: `shutdown.test.ts` (real socket.io client exits 0 in <1.5 s; stuck request cut after grace). Systemd was not the cause (`TimeoutStopUSec` 1 min 30 s). Takes effect only after deploy; unit files untouched. Mongo/Valkey shutdown is not implicated (never reached).

**Boot diagnostics (defect confirmed, fixed)**: `endedWithoutShutdown` matched `systemd[96133]: Reached target shutdown.target` — the per-user manager of uid 1000, whose session ended at 20:58:40 — and so reported "clean" for the abrupt end of 2026-10-21. `classifyPreviousBoot` now accepts only the system manager (`systemd[1]`), `systemd-shutdown` and journald "Journal stopped", reads the kernel journal for OOM/panic, and returns `clean-shutdown | abrupt-end | kernel-oom | kernel-panic | insufficient-evidence`; a service restart is not a shutdown. Tests in `post-boot-check.test.mjs`. The report still says "cause not established"; an abrupt end is not proof of a provider outage. Takes effect after deploy (the checker runs from the checkout).

**Resource safeguards (recommendations, measured, nothing applied)**: peaks since 10:38Z: API 1.5 GB (limit 2G, heap 1.5 GB — keep), SSR 0.44 GB (heap 512 MB → `MemoryMax=1G`), mongod 2.2 GB peak / 1.0 GB RSS (add `OOMScoreAdjust=-500` and consider `wiredTiger cacheSizeGB: 3`), valkey 0.18 GB. Restart policies already `Restart=always RestartSec=2`. Build on host remains the only large consumer; the artifact path removes it. Re-measure over a full day before choosing numbers.

**Branch protection**: `docs/ops/BRANCH-PROTECTION.md` + `docs/ops/main-ruleset.json` (no deletion, no force-push, PR required, `verify` required, Admin bypass in PR mode). `ssr-resilience` is path-filtered, so requiring it would block docs-only PRs; see the doc. **Not applied** (owner approval; account has `admin`). New tests in `workflows.test.mjs` fail CI if a deploy workflow gains an implicit trigger or another workflow uses the SSH secrets.

**Verification**: `npm run test:ops` 21/21 (+3 new), `test:deploy` ✔ (new §7), backend `npm test` 532 pass / 0 fail / 17 skipped, backend `tsc` clean, `bash -n` on both scripts, lint 0 errors. Frontend build/Karma not run (no frontend change); CI `verify` will.

**M01-B2 decision: CONDITIONAL GO.** Conditions: (1) owner approves the window and the deploy; (2) merge this PR first so the shutdown fix ships with the release (otherwise the first restart still takes 10 s and shows as "crashed"); (3) owner accepts that no live rollback drill was run, or authorises one; (4) optionally apply the branch ruleset. Deploy procedure unchanged from M01-A.

## M01-B2 addendum — release pre-flight (2026-10-22 ~11:05Z, read-only)

**Merge**: PR #54 (head `bed364e`, unchanged since review; `verify` + `ssr-resilience` green, `live-crawl` skipped by design; 11 files, no migration, no flag default changed, no workflow trigger changed) squash-merged as **`ba2a0a8`** with `--match-head-commit`. Content on `main`: 3E enrichment + metrics (`LegacyEnrichmentService`), 3F `mediaId` propagation, read-only preflight (`legacy-enrichment-preflight.ts`), `legacy-rollout-snapshot.mjs`, `shutdown.ts`, `classifyPreviousBoot`, workflow/deploy guards. `test:ops` 21/21 and `test-deploy-script.sh` pass on `ba2a0a8`. Only `deploy-artifact.yml`, `deploy.yml` and `uptime.yml` (probe) are non-PR triggers; both deploy workflows are `workflow_dispatch` only.

**Production re-read vs M01-A (unchanged)**: live `20261022103818` @ `ed03242`, checkout HEAD `ed03242`, tree clean; rollback target `20261022010257` @ `6907540` (127 MB, `release.json`, backend and SSR `dist` present); 5 releases; API and SSR `NRestarts=0`; five units active; 8.6 GB available, swap 0 B, `/` 42 %, inodes 5 %; 0 OOM/panic lines this boot; deploy lock free (non-blocking `flock` succeeded, no deploy process); `package-lock.json` sha equals the install stamp and `main`; `/v2/health` 200, metrics has no `legacyEnrichment` block (3E not live, expected). Single outlier: the first local `/v2/health` took 9.9 s, the next three 3–4 ms; not reproduced, same class as the cold-start tail in M13.

**Flags (names + effective boolean only)**: no `CONTENT_*`, `EPG_YEAR_PROVENANCE`, `*LEGACY_ENRICHMENT*` or `BOOTSTRAP_DB` in `api.env`, `ssr.env` or either process environment. Two older, non-experimental flags are `true` in `api.env`: `AI_CHATBOT_ENABLED` and `GSC_AUTO_SUBMIT_ENABLED`. They are not in the M01-A baseline text, were not changed by 3E/3F/B1, and the release does not touch them; recorded here so the post-deploy compare expects them.

**Workflow `deploy-artifact.yml`** (as on `ba2a0a8`): `workflow_dispatch` only; build job on GitHub (`npm ci`, `npm run build` with Angular budgets), tarball + `ARTIFACT_GIT_SHA` + sha256 job output; deploy job scp's it and runs `deploy-guiatv.sh main <tgz> <sha256>` over ssh (`script_stop: true`, so failure = nonzero); concurrency group `deploy-prod`, plus server `flock` (exit 75, nothing changed). The VPS runs no `npm` and no compile on this path. `deploy-guiatv.sh` verifies the checksum, then **refuses unless `ARTIFACT_GIT_SHA` equals the server's `git rev-parse HEAD`** after `git reset --hard origin/main`; publish is `ln -sfn` + `mv -Tf`, then API/SSR restart with 14 smoke checks (+ Socket.IO and auth smoke only if `SMOKE_AUTH_TOKEN` is set); any failure after publish starts rolls back to the previous release and exits nonzero.
**Commit pinning**: the build checks out `GITHUB_SHA`, i.e. `main` at dispatch time, fixed for the whole run. A push after dispatch cannot swap the artifact: the server's HEAD would differ from `ARTIFACT_GIT_SHA` and the deploy aborts **before** publishing. A push *before* dispatch is simply the new target, so confirm main's SHA right before dispatching. Docs-only pushes do not matter: the code at `main` is `ba2a0a8` plus documentation.
**Not verifiable here**: GitHub secrets (`DEPLOY_SSH_*`) existence; the artifact has a SHA file and checksum but no signed attestation (acceptable, same-run provenance); Socket.IO/auth smoke is skipped unless the token secret exists on the server.

**Expected invocation**: `gh workflow run deploy-artifact.yml --ref main`; then verify the run's `build` log shows the intended SHA, and afterwards `readlink current` = a new release whose `release.json.gitSha` equals it. Before: `readlink -f /var/www/guiatv/current` = `20261022103818`.

**Before-state snapshots** (public GETs, paced 1.5 s, current EPG, no crawl): `artifacts/m01-b2/before-detail.json` (`/peliculas/gladiator`, `/peliculas/bikeriders-la-ley-del-asfalto`, `/programas/chicago-pd`, 3/3 200; compare after deploy with `node scripts/legacy-rollout-snapshot.mjs compare before-detail.json after-detail.json`, without `--expect-enriched`) and `artifacts/m01-b2/before-surface.tsv` (status, latency, bytes, `X-Robots-Tag`, meta robots, canonical, JSON-LD block count for `/`, two channels, live, `/guias`, `/plataformas`, `/deportes/futbol`, robots, 5 sitemaps, health). Sitemap URL counts: static 23, channels 82, programs 822, blog 13. All pages `index, follow`, robots.txt unchanged.

**Rollback readiness**: target `20261022010257` present and complete; `guiatv-ops.sh rollback` (root, shared lock) is atomic and health-verified; simulated in `test-deploy-script.sh` §7. Data: no migration, flags off, old release reads the same data. **Not drilled live (accepted by owner; not evidence that rollback works).** Outage root cause of 2026-10-20/21 remains **unknown**.

**M01-B2 decision: CONDITIONAL GO.** Residual accepted risks: no live rollback drill; unknown Contabo outage cause; Socket.IO/auth smoke may be skipped; `main` ruleset not applied; two non-experimental flags already on. No unresolved critical/high defect. **Pending authorization (owner)**: run `gh workflow run deploy-artifact.yml --ref main` in an owner-chosen window with an agent watching, abort + `guiatv-ops.sh rollback 20261022010257` on any smoke failure. Next: **M01-B2-DEPLOY**.

## M01-B2-DEPLOY (2026-10-22): PASS

**Deploy**: owner-authorized; `gh workflow run deploy-artifact.yml --ref main` → [run 39769605049](https://github.com/manuelxose/guiatv-frontend/actions/runs/39769605049), head SHA = `main` = `66be5ec9b7b5819a92f0cbf1c54ac8bccbe810e5`, build + deploy ✔, 2 m 22 s. Artifact built in CI; no npm/compile on the VPS. Live release `20261022103818` (`ed03242`) → **`20261022132028` (`66be5ec`)**, verified from `release.json` over SSH. No auto-rollback ran. Rollback target `20261022010257` (`6907540`) still present and complete; not drilled live.

**Production after**: five units active, API/SSR `NRestarts=0`, 0 OOM lines, 8.6 GB available, swap 0 B. `/v2/health` 200, ~0.11 s (8 samples). `/v2/health/metrics.data.legacyEnrichment = {epoch: off, counters: {}}`; `X-Legacy-Enrichment-Epoch: off`. Flags: no `CONTENT_*`, `EPG_YEAR_PROVENANCE`, `*LEGACY_ENRICHMENT*` in `api.env`/`ssr.env`; `AI_CHATBOT_ENABLED` and `GSC_AUTO_SUBMIT_ENABLED` still `true` (unchanged).

**SEO (before-surface.tsv vs after)**: 15/15 paths same status (200); canonical, `X-Robots-Tag` and JSON-LD block count identical; robots.txt 470 B and 4 of 5 sitemaps byte-identical (`sitemap-programs.xml` 156713 → 158274 B, normal EPG growth). Detail pages (`legacy-rollout-snapshot compare`): 3/3 200, title, description, canonical, robots, JSON-LD, Movie entity, links unchanged; the tool reports `markup breakout` on all three, but the flag was already `true` in the before-snapshot (regex `</script><` matches adjacent script tags) → not a regression, tool heuristic to tighten. Latency: pages 0.19–1.09 s after vs 0.29–1.02 s before (cold first hit `/canales/la-1` 1.09 s vs 0.69 s; the rest faster); no material regression.

**Errors**: nginx 5xx: 3 at 13:20 CEST (the API/SSR restart), 0 afterwards. 50 earlier 503s on `/programas/*` at 13:10-13:12 CEST (≈10 min before dispatch) pre-date the release; cause not investigated. No `err`-level journal lines for API/SSR since deploy.

**Remaining risks**: no live rollback drill; `deploy-artifact.yml` passes `script_stop` which `appleboy/ssh-action@v1.2.2` does not accept (warning), so a failing remote script may not fail the workflow: verify on-host after each deploy; pre-release `/programas/*` 503 burst unexplained; Socket.IO/auth smoke skipped without `SMOKE_AUTH_TOKEN`; `main` ruleset not applied; Contabo outage cause unknown. Enrichment remains OFF; activation needs separate owner approval. **Next: M02-B** (not started).

## M02-B addendum — real catalogue validation and deployment reliability (2026-10-22, read-only on the VPS)

Evidence: `artifacts/m02-b/` (`measure-20261022.json`, `candidates-20261022.json`, `candidate-public-check-20261022.json`), produced by `scripts/m02b-measure.cjs` (read-only guard, pool 2, niced, 31 commands: find/aggregate only, guard exit 97 never hit). Volatile numbers: they describe 2026-10-22 ~11:49Z only.

**Reconciled**: PR #56 (head `847f4b1`, `verify` green, docs + one snapshot, no secrets) squash-merged as `85e9670`. No redeploy. Live release still `20261022132028` / `66be5ec`; flags unset (off).

**Deploy failure propagation (fixed in the M02-B PR, not deployed)**: root cause — `appleboy/ssh-action@v1.2.2` has no `script_stop` input (ignored, warning) and the remote script ended with `rm -rf`, so a failed `deploy-guiatv.sh` could still end with status 0. `deploy-artifact.yml` now runs `scripts/deploy-ssh.sh` (plain `ssh`, `set -euo pipefail`, cleanup in an EXIT trap, `timeout`): the step exit status is the deploy script's (75 lock/memory, 255 no connection, 124 timeout). scp step, concurrency group, sha256 + `ARTIFACT_GIT_SHA` verification, on-host flock and automatic rollback are untouched; trigger still `workflow_dispatch`; no build on the host. Tests: `scripts/deploy-ssh.test.mjs` (success, nonzero, lock 75, ssh failure 255, hang 124, malformed args, no key echo) and `test-deploy-script.sh` §8 (real `deploy-guiatv.sh` in the sandbox through the wrapper: lock contention → 75 and nothing changed; smoke failure → rollback + nonzero; healthy → 0). Host-key caveat unchanged: `StrictHostKeyChecking=accept-new` on an ephemeral runner is as unverified as ssh-action was; pinning a `known_hosts` secret is a follow-up.

**Defect found by the real run**: the shipped preflight reported **0 catalogue rows for all 1 009 TMDB ids** although `media_catalog` holds 17 322. Cause: `MongoMediaCatalogRepository.findManyByTmdbIds` (and `findByNormalizedTitles`, `find…` list reads) mapped every row through `MediaCatalogEntry`, which throws on an empty `normalizedTitle`; the catch returned `[]` for the whole batch. 55 rows (27 movie + 28 tv) have empty titles. Fixed once in the repository (`toEntities` skips and counts invalid rows); regression test `MongoMediaCatalogRepository.mongo.test.ts` fails without the fix. Production still runs the old code until the next deploy; `MediaCatalogService` title matching uses the same list read, so an invalid row could also have hidden title matches.

**Catalogue (whole collection)**: movies 13 369 (genres 97.1 %, runtime 71.2 %, original title 39.9 %, enriched 73.6 %, fully enriched 39.7 %); series 3 955 (genres 95.4 %, runtime 43.1 %, original title 30.3 %, enriched 76.5 %, fully enriched 18.3 %); every row has a TMDB id. In the EPG window: 753 movie + 278 tv rows for 1 009 TMDB ids, none without a row; movies fully enriched 421/753 (55.9 %), series 63/278 (22.7 %).

**EPG**: horizon today + 2 days (+ yesterday): 21–24 Oct = 9 539 / 12 318 / 10 563 / 7 586 airings (day 3 partial); 40 006 airings, 3 725 with TMDB id (9.3 %; Cine 55.5 %, Series 52.6 %, other categories < 12 %); **with catalogue row id: 979 → `catalogueRowShare` 26.3 %** (25.6–27.4 % per day).

**Identity outcomes (3 725 airings with a TMDB id, strict order of the joiner)**: verified 736 (461 upcoming + 275 already ended; 30 of them sit on a TMDB id shared by another title); missing mediaId 2 746 (2 513 have one catalogue row for that TMDB id — 2 196 with a matching title key, 317 not; 233 have several rows); title-key mismatch 238; wrong content type 3; catalogue/TMDB mismatch 2; dangling row 0. Verified upcoming: 94 movies / 122 broadcasts (1.3 each), 51 series / 339 broadcasts (6.6 each). Of the 238 title-key rejections, 214 have no part of the programme title equal to a row key — sampled (25 distinct ids) mostly genuinely different works (Atómica→Combustión espontánea, C.S.I.→S.C.I.谜案集, Corto→Corto Maltés, Negocios turbios→Mono malo), with 4–5 of 25 plausible false rejections (row title carries the alias in brackets, a one-letter typo, a Catalan title); 24 are `Title (Alias)` / `Title : Episode` forms where one part equals a row key (≈ Blue Bloods, Silent Witness, Jane Eyre). So the rule is conservative, not loose; the legitimate-rejection loss is on the order of 3–4 % of linked airings. 19 TMDB ids appear under more than one title key (the F&F 6/7 class). Title similarity is not used as proof anywhere.

**mediaId fix (Phase 3F)**: not evaluable on new data yet — the last EPG sync wrote its airings at 10:21Z, before the 11:20Z deploy (0 airings created/updated after it). The sync runs on a 6-hourly cron; the next run is the first with the fix. Baseline: stored programmes with a TMDB id carry a mediaId in 3 761 of 16 835 (22.3 %). Projection from stored rows: at most **417 of the 2 746** unlinked airings can gain a mediaId (all 417 point at a row with the same TMDB id), so the fix alone lifts the share from 26.3 % towards ≈ 37.5 %, not towards 100 %; the missing link is that most stored programmes never receive a mediaId. Re-measure after the next sync: `scripts/m02b-measure.cjs` (comparison key `mediaIdFix.airingsByLastWrite`).

**Rollout candidates**: five selected (all resolve through the public API to the same TMDB id and currently airing → `index`): `/peliculas/3-dias-para-matar` (4 verified airings), `/peliculas/los-otros` (2, 2 channels, one beyond the legacy window), `/peliculas/la-pianista` (2, one beyond), `/peliculas/poltergeist-fenomenos-extranos` (2), `/peliculas/jungla-de-cristal-la-venganza` (2); 25 ranked reserves in `candidates-20261022.json` (all publicly checked). Time-sensitive (hours). Each has a complete catalogue row; expected visible gain = verified schedule beyond today/tomorrow only for Los Otros/La pianista; the others gain verified metadata gaps only. 94 movies currently have verified upcoming broadcasts; 90 after dropping shared-TMDB-id cases. Enrichment not activated.

**503 investigation (nginx 5xx, journals; read-only)**: 503s exist only from 19 Oct 20:47 (0 on 15–18 Oct); 1 246 on 20 Oct, 428 on 21 Oct, 42 on 22 Oct. The "≈ 50 `/programas/*`" burst is **22 Oct 13:10–13:12 CEST**: 28 requests, all with bot user agents (≈ 80 % of that minute’s traffic was bots), in a minute with 179 requests (≈ 2× the preceding minutes); nginx error log = `upstream timed out (110) while reading response header` (SSR), SSR journal = `[ApiClient] /v2/tv/read` and `/v2/tv/read/channels` `TimeoutError`, API TMDB discover calls timing out at 8 000 ms in the same minutes, no restart, no kernel event, load ≈ 1.3 on 6 CPUs. Today 29 of 682 `/v2/tv/read` responses exceeded 3 s (max 7.3 s). The 21 Oct 11:03–11:04 burst (65 503s, mostly bot hits on `/deportes/futbol`) has the same upstream-timeout signature; the 22 Oct 10:38 burst (6) is the API restart (connection refused ≈ 4 s) and is expected. **Cause class: slow API reads under a crawler burst (upstream timeout), not unavailability. Why `/v2/tv/read` goes slow is unproven**; no small safe defect found, so no code change: follow-up (API tail latency of `/v2/tv/read` under crawler load; whether 503 is the right status for a render timeout; bot rate limits).

**Remaining risks**: production runs the old repository code until a deploy; mediaId effect unmeasured; host-key pinning; `/v2/tv/read` tail latency; no rollback drill; `main` ruleset unapplied.

**Decision**: M02-B engineering-complete except the mediaId before/after (needs the next scheduled sync). **M03-A readiness**: candidates ready but time-sensitive; refresh `measure` within hours of any approval; real lever for coverage is linking at sync/read-model build (tmdbId + same-type unique row + title key + provenance), a separate milestone with its own design review — not a looser join.

## M02-C addendum — integrate, deploy, re-measure (2026-10-22 ~12:10Z)

**Merge**: PR #57 (head `41a8d0e`, verify + ssr-resilience green, 14 files, no secrets, only the intended paths) squash-merged as **`7b30fa6`**. Tracking PR carries this addendum and `docs/roadmap/IDENTITY-LINKING-DESIGN.md`.

**Deploy**: one `deploy-artifact.yml` dispatch, run **39775322728**, built `7b30fa6` (SHA verified), build + deploy jobs success in the first attempt, no retry. Release `20261022132028` → **`20261022140539`** (`gitSha 7b30fa6`); rollback target `20261022132028` (and `…103818`) on disk. Pre-checks: services active, flock free, 6.9 GB RAM available, 84 GB disk free, no competing deploy, flags unchanged (`AI_CHATBOT_ENABLED=true`, `GSC_AUTO_SUBMIT_ENABLED=true` preserved; no `CONTENT_*`/`EPG_YEAR_PROVENANCE`). The ssh-action `script_stop` warning is gone; the new step ran `scripts/deploy-ssh.sh` and exited 0. **The failure path was verified in the sandbox only** — no failure was provoked against production.

**Post-deploy**: all five services active, `NRestarts` 0/0, OOM 0, `legacyEnrichment.epoch` `off`, flags identical. nginx 5xx since the deploy: 2 × 502 at 14:05 CEST (the restart), none after. Public surface (9 URLs: status, canonical, robots, X-Robots-Tag, sitemap/robots bytes) identical before/after (`artifacts/m02-c/*-surface.txt`); latency equal or lower (home 0.41→0.38 s, `/canales/la-1` 1.00→0.28 s, `/v2/tv/read` 0.20→0.14 s; single samples, cold vs warm, not a benchmark). `legacy-rollout-snapshot compare` reports "markup breakout" on all 4 pages, **identically in the before snapshots and in the M01-B2 before/after artifacts**: the detector regex `/<\/script><(?!\/)/` matches adjacent `</script><script>` tags, i.e. a tool false positive, not a regression (follow-up: tighten the regex).

**Catalogue fix in production**: the preflight now returns **751 movie + 274 tv rows** for the 1 009 window TMDB ids (before the fix: 0 + 0). The 6 ids without a row are exactly the 6 invalid rows (2 movie + 4 tv) the measurement script counts, so valid rows come back and invalid ones are skipped individually. 5 candidates accepted, 9 verified broadcasts (duplicate-slot and already-ended airings rejected as designed), 16 Mongo commands, guard clean, 1.5 s wall, nothing written. Full catalogue totals unchanged: 13 369 movie / 3 955 tv rows, 55 invalid.

**Identity coverage re-measure**: **blocked by the schedule, not by tooling.** The EPG sync runs 00/06/12/18 Europe/Madrid; the last run finished 12:20 CEST (10:20Z), before the 14:05 CEST deploy, and no airing has been written since (`lastAiringUpdate 10:21Z`, 0 created after deploy). Re-measure result is therefore identical to the baseline: 3 725 airings with TMDB id, 979 with mediaId, **catalogueRowShare 26.3 %**; the 3F effect is not attributable yet. Next sync: **18:00 CEST (16:00Z)**; compare `mediaIdFix.airingsByLastWrite` (`updated_after_deploy` cohort vs the 26.3 % baseline) using `scripts/m02b-measure.cjs`; judge the fix on airings that were already in the baseline window, not on newly appeared programmes.

**Missing-link categories** (3 725 airings with TMDB id): 979 linked; 2 746 unlinked of which 2 150 strictly linkable (655 distinct programme identities), 290 title key differs, 221 no row of expected type, 63 TMDB id shared by other titles, 6 several rows, 12 only invalid rows, 4 no title key. Design and placement analysis (recommendation: B, resolver in the read-model builder, shadow first): `docs/roadmap/IDENTITY-LINKING-DESIGN.md`. Root cause of the gap: cached programmes (`db_cache` path) never receive a `mediaId` and cached hits skip TMDB.

**Outstanding risks**: mediaId fix unmeasured until the 18:00 sync; `/v2/tv/read` tail latency and bot-burst 503s (M02-B); no rollback drill; `main` ruleset unapplied; host key unpinned (`accept-new`); snapshot-tool false positive; owner decision pending on whether derived links may satisfy `requireCatalogueRow`.

## M03-L1 addendum — conservative linker, shadow mode (2026-10-22 ~12:30Z)

**Merge**: PR #58 (head `80c7948`, verify green) squash-merged as `1ccb350`.

**Re-measure after the 18:00 sync: blocked by the schedule.** At 12:30Z the last airing write was 10:21Z (12:20 CEST sync), so the post-sync cohort does not exist yet; numbers equal the M02-C baseline: 3 725 airings with TMDB id, 979 with mediaId, **catalogueRowShare 26.3 %**, 2 746 missing, 417 projected copies by the 3F fix. Re-run `scripts/m02b-measure.cjs` after 16:00Z.

**Linker** (rules exactly as `IDENTITY-LINKING-DESIGN.md`; fuzzy similarity is never evidence, an existing `mediaId` is never touched; a derived link is a weaker tier than a sync-time link). Production shadow check (`scripts/m03l1-shadow-validate.cjs`, candidate dist staged in `/var/tmp`, read-only guard: 18 commands, all finds): window cohort agrees with `m02b-measure` **exactly** (linkable 2 150, all categories equal); per-date (builder) cohorts 477 / 638 / 627 / 447 linkable for 21–24 Oct. Latency: 54–87 ms per date (read + evaluate, nice 19) vs 77–128 s per production rebuild → ≈0.1 % added; window run 392 ms, 3 queries, 1 031 projected rows, 120 MB RSS for the whole script.

**Remaining conflicts**: 290 title-key differences, 221 series whose TMDB id only has a movie row, 63 TMDB ids shared by other titles, 12 invalid-only, 6 duplicates, 4 keyless titles, 2 airings whose `mediaId` points at a row with another TMDB id.

**Activation**: `EPG_CATALOGUE_LINK_MODE` unset in production (= off).

### M03-L1 deploy and post-resync re-measure (2026-10-22 ~13:40Z)

**Merge/deploy**: PR #59 (head `a816e91`, verify + ssr-resilience green; independent review found 1 high — builder passed raw `Program` entities without `editorialCategory`, so the type rule never fired — fixed before merge with a regression test) squash-merged as **`bd98983`**. One `deploy-artifact.yml` dispatch, run **39783113649**, build + deploy success first attempt → release **`20261022150159`** (`gitSha bd98983`); rollback target `20261022140539`. Post-deploy: API/SSR active, `NRestarts` 0, health 200, `/v2/health/metrics` `catalogueLink.mode = off`, 0 runs; `EPG_CATALOGUE_LINK_MODE` absent from api.env; 9-URL surface (status, canonical, robots meta, X-Robots-Tag) identical before/after; robots.txt hash unchanged.

**Owner-authorised resync**: one manual `syncEPG` CLI run (13:03–13:29Z, exit 0) then `precomputeSchedules` (4 dates rebuilt, 92–121 s each, exit 0), same commands and env as the cron. 3 catalogue upserts refused (CJK-only titles → empty `normalizedTitle`, existing guard working; no invalid rows written).

**Coverage after resync** (`artifacts/m03-l1/measure-postsync.json`; same four dates as the baseline, so the change is the 3F copy path plus normal intra-day EPG revisions, not new days): airings with TMDB id 3 725 → 3 949; with `mediaId` 979 → **1 366**; **catalogueRowShare 26.3 % → 34.6 %** (per date 25.9→33.1, 27.4→35.3, 25.6→33.0, 26.0→37.1). Strictly *verified* airings (m02b: id + row + type + title key) 766 → 900 (20.6 % → 22.8 %).

**New conflict introduced by the 3F copy path**: `Series` airings linked to a **movie** row 3 → **196** (m02b `wrong_content_type` 3 → 198; linker's `wrong_content_type` among unlinked fell 221 → 26 because those airings are now "linked"). These are the series whose TMDB id only has a movie row: the stored programme's `mediaId` points at a movie with the same numeric TMDB id — almost certainly a different work. Not user-visible (the joiner refuses type mismatches), but the raw 34.6 % overstates verified coverage. Fix belongs to the sync copy path (copy only when the row type matches the programme's TMDB kind) — separate milestone.

**Shadow after resync** (`artifacts/m03-l1/shadow-postsync.json`): linkable **2 171 = m02b 2 171**, every category identical again (title key 298, shared id 66, wrong type 26, invalid rows 12, duplicates 6, no key 4, conflicting `mediaId` 4); per-date 460 / 606 / 684 / 464; 69–114 ms per date vs 92–121 s rebuilds (≈0.1 %).

**Activation**: flag off; shadow not enabled persistently; nothing persisted.

## M03-L2 addendum — type-safe mediaId propagation (2026-10-22 ~14:30Z)

**Git**: PR #60 (M03-L1 docs) squash-merged as `bdbd8fa`. PR #61 (head `ed3bb21`; verify and ssr-resilience green) squash-merged as **`6efce56`**. Independent review found no critical or high issues. Two mediums were addressed: Cine/Serie programmes no longer reuse untyped cache entries, and phase-2 hits prefer tagged entries. Phase 2 and other categories still have no kind check; there is no type evidence to check against (see risks).

**Deploy**: one `deploy-artifact` run (39793188001) built `6efce56`. Release **20261022161030** is active; rollback target is 20261022150159. Health is `healthy`. Page heads, robots.txt and sitemap.xml are byte-identical to the pre-deploy baseline. Flags: none of `EPG_CATALOGUE_LINK_MODE` / `CONTENT_*` are set, so everything stays off. No sync was forced and nothing was written.

**Root cause (read-only census `scripts/m03l2-cross-type.cjs`, `artifacts/m03-l2/cross-type-before.json`)**:
- The title-keyed, kind-blind DB-enrichment cache in `SyncEPGData` caused the problem.
- All 199 cross-type airings in the window are built from stored programmes with `tmdbSource: db_cache` and kind `series` that point at a movie row of the same title (`metadataSource: epg`).
- `tmdbIdAlsoHasRowOfExpectedType` = no for 198 of them.
- They are present **both** in stored `programs` (201 documents, all `db_cache`) and in the derived `tv_read_airings`.

**Corrected paths**:
- `catalogueLinker` existing-id branch (type check).
- `SyncEPGData` cache load and selection.
- `TvReadModelBuilder.rebuildDate`: the guard runs after the merge, before insert.
- `backfill-media-catalog`: kind filter.

`MongoProgramRepository.findEnrichedByTitles` now also returns `tmdbKind`.

**Metrics** (`artifacts/m03-l2/measure-{before,after}.json`, same window; no rebuild has happened since the deploy yet):

| | before | after deploy (read model not rebuilt) | projected next build (guard run in-memory on the live airings) |
|---|---|---|---|
| airings with TMDB id | 3 949 | 3 949 | 3 949 |
| raw `mediaId` | 1 366 (34.6 %) | 1 366 | **1 164 (29.5 %)** |
| verified (upcoming + ended + shared-id) | 900 (22.8 %) | 900 | 900 (guard drops none) |
| cross-type (Series→movie / Cine→tv) | 196 / 2 | 196 / 2 | **0** |
| row of another TMDB id | 4 | 4 | 0 |
| title-key mismatch | 301 | 301 | unchanged (the read-time joiner still refuses these) |

The guard projection drops `cross_type_media_id` 198 and `conflicting_media_id` 4. Raw `mediaId` share is not verified coverage. The headline remains **22.8 % verified**.

**Pending evidence**: the first post-deploy scheduled sync and precompute (18:00 / 18:15 Madrid) will show three things:
- (a) newly synced programmes get no cross-type id;
- (b) rebuilt airings drop the 202 ids;
- (c) the stored residue keeps 201 documents until they expire or are re-enriched.

To check, re-run `scripts/m03l2-cross-type.cjs`. `crossType.airings` should be 0 and `guardProjection.airingsBuiltAfterDeploy` should be > 0. `/v2/health/metrics` `catalogueLink.mediaIdGuard` stays 0 in the API process, because precompute runs in a child job process.

**Historical records**: 201 stored programme documents still carry a cross-type `mediaId` and a film `tmdbId`. They are excluded from every new read model and refused by the cache. Correcting them needs a production write, which is out of scope; see `M03-L2-REMEDIATION-PROPOSAL.md`.

**Outstanding risks**:
- Kind is enforced only for Cine/Series. Phase-2 cache hits and other categories (Documental, Infantil…) accept a single-kind entry's verified row, because they carry no type evidence.
- The guard fails open on a catalogue read error. It is counted, and the read-time joiner still refuses type mismatches.
- 127 `db_cache` documents carry a `mediaId` without a recorded kind. Their rows are verified, but their kind is not.


## M03 addendum — content enrichment, identity stream closed (2026-10-22 ~16:30Z)

**Git**: #62 (M03-L2 record) merged `68b8523`. **#63** merged `b0b0462` (detail facts, hub links, schema). **#64** merged `ece2b03` (opposite-kind airing guard). CI `verify` + `ssr-resilience` green on each head. An independent review of #63 found 1 high (the TV-read slug fallback did not accept the new airing slugs), fixed before merge, plus 1 medium and 1 low, both addressed.

**Deploys** (`deploy-artifact`, flags untouched):
- run 39809158261 → release `20261022175606` (#63);
- run 39813703223 → release **`20261022182542`** (#64), live. Rollback target `20261022175606` (then `20261022161030`).
- `/v2/health` epoch `off`; `catalogueLink.mode` `off`.

**M03.0 — identity closed** (read-only census `scripts/m03l2-cross-type.cjs` after the 18:15 Madrid precompute, `artifacts/m03/cross-type-post-rebuild.json`):
- Cross-type airings in the window: **199 → 0**.
- Raw `mediaId` 1 162 (projection 1 164). All 3 952 TMDB airings were rebuilt on the guarded code; the guard ran with 0 errors.
- A second public path was found and fixed in #64. TMDB detail pages listed airings by `program.tmdbId` without checking kind, and today's window still had 55 `Series` airings whose id has only a film row (stored residue and namespace collisions). Those airings are now excluded.
- **Technical debt (separate, not an M03 prerequisite)**: about 201 stored `programs` documents keep a cross-type `mediaId` and film `tmdbId` (`M03-L2-REMEDIATION-PROPOSAL.md`, needs owner approval for a write). They no longer reach built airings, `mediaId` joins or TMDB detail broadcasts.

**M03.1/M03.2 — detail pages** (live sample: 64 `/peliculas` + `/series` pages linked from the hubs; `artifacts/m03/detail-sample-{before,after}.json`):

| field | before (`20261022161030`) | after (`20261022182542`) |
|---|---|---|
| film genres | 1/31 | **31/31** |
| film runtime | 1/31 | **31/31** |
| series genres | 2/33 | **32/33** |
| original title (when it differs) | 0 (enrichment-only) | **31/64** |
| `/v2/catalog/slug` p50 / p90 | 69 / 99 ms | 70 / 99 ms |

- **Cause**: `mapTmdbToCatalogItem` hardcoded `genres: []` and dropped `runtime` even though the cached TMDB detail held both. The values come from the same TMDB id the page already shows: no new identity, no new reads. A series' runtime is per episode, so it is not shown.
- **Hub links** (`artifacts/m03/hub-links-*.txt`): 3/95 returned 404 before, 1/79 after. Film and series airing links now use the accent-folded slug, and a high-confidence `T<n> E<n>` title links to the work. Programme slugs are unchanged. The remaining 404 is `/series/camino-a-la-perdicion`, a film the EPG categorises as `Series` (classification, follow-up).

**M03.4 — SEO** (`artifacts/m03/seo-{before,after}.json`):
- Canonical is self-referencing and the robots meta matches `X-Robots-Tag` on every page sampled (92 before, 77 after).
- Index/noindex is unchanged on the 57 pages common to both crawls.
- Movie/TVSeries JSON-LD no longer emits `aggregateRating`: it was a TMDB vote with no `ratingCount`, not collected on the site (before: 60/64). The hardcoded `inLanguage: 'es'` is also gone.
- Movie now carries `genre`, `duration` and `alternateName` from verified TMDB fields.
- No indexation rule was changed and no page was made indexable.

**Activation state**: unchanged. Legacy enrichment off, catalogue linker off, no `CONTENT_*` flag set. The M03 improvements are live **without** activation: they come from data the default path already loaded.

**Open follow-ups**:
- (a) The frontend `tv-normalizers` still builds episode-titled series links (`/series/x-t1-e3-…`). They resolve through the widened TV-read fallback while the airing is in today's or tomorrow's guide, otherwise 404.
- (b) EPG `Series` category on films.
- (c) `source=program` detail pages list the channel's adjacent programmes among airings, which the page should label as "en el canal" (UX, M05).

## M05 addendum — released and verified (2026-10-23)

M05 is live after PR #66 (backend/navigation), PR #69 (detail UX, accessibility and QA) and PR #70 (the confirmed film/series classification redirect). The final production artifact is release 20261023010043, git SHA cb5a860d953d353b86ebc3966b004e67e6cde772; guiatv-api and guiatv-ssr are active with zero restarts. Public verification returned /series/camino-a-la-perdicion → 301 /peliculas/camino-a-la-perdicion, the target page 200, and /v2/health 200. CI erify and ssr-resilience are green. Full evidence and acceptance details are in docs/roadmap/M05-DELIVERY.md and rtifacts/m05/QA.md.

## M08 addendum - candidate verified, release pending (2026-10-23)

Canonical repo manuelxose/guiatv; baseline main 2aa7389 and production release 20261023142416 on da9ec11. Shared navigation PR #73 merged as 5662db0; football PR #74 merged as ee4dd9e after independent reviews and green verify/SSR CI. Search/final accessibility PR #75 remains gated; no M08 deploy yet.

Candidate: 104 settled viewport/theme cells and 12 football-child combinations pass axe/overflow/runtime checks. Actual mobile search focus trapping, classification SSR hydration and time-only Madrid scoreboard rendering are verified. Real-data football/search 17 passed; public/admin shell 4/4 each, mocked auth/profile 2, navigation recovery 5. Raw SSR canonical/robots/header parity holds for 13 routes. Initial referenced assets +19,515 bytes (+2.71%); production build budgets pass.

M06 still lacks season/episode routes, DTOs and UI; work-level series/broadcast detail already exists. Historical EPG classification/identity debt is not rewritten. Five existing channel-icon URLs return 503 with fallback before M08. Final CI, artifact release, exact live commit/health/flag inventories/rollback and post-release browser matrix remain mandatory. Full evidence and next M09 action: docs/roadmap/M08-DELIVERY.md.
