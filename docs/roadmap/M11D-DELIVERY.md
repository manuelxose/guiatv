# M11-D delivery: controlled production activation

Date: 2026-10-27. Scope: M11-D only.

## 1. Outcome
| State | Result |
|---|---|
| ENGINEERING PASS | **PASS**. Released as `20261027160344` @ `c06a09b`. The three activation blockers are closed, the real CLI was exercised, and an independent review found nothing left at HIGH or above |
| LIVE CANARY PASS | **PASS (execution)**. Two signed jobs ran (second one signed with the production key and reported to the production Admin) with real Claude through the owner's subscription gateway. The pipeline worked end to end and the gates **held the article** (critic `revise` after 3 drafts each). $0.80 + $0.67 at list price (§5) |
| PUBLICATION PASS | **BLOCKED**. No canary draft passed the critic, so none could be saved for review. Nothing was published. Owner decision needed (§8.3) |
| AUTOMATION READY | **NO**. A canary article that passes the gates, a supervised publication, the policy-page update and a server `EDITORIAL_POLICY_KEY` are still missing |
| AUTOMATION ENABLED | **NO**. `EDITORIAL_POLICY_PUBLISHING` was not changed |

## 2. Changes (PR #97)
- **Human approval isolation.**
  - New `EDITORIAL_POLICY_KEY` (header `x-editorial-policy-key`). It is the runner's only approval right (`approve-by-policy`).
  - The policy key is refused by `approve`, `rollback` and `policy/resume`.
  - Policy approval is closed when its key equals a review key or `ANALYTICS_ADMIN_KEY`, and the human key is refused when it equals the admin key.
  - The runner refuses to start when `EDITORIAL_REVIEW_KEY` or `AUCTORIO_EDITORIAL_REVIEW_KEY` is set.
  - `approve-by-policy` re-reads the emergency stop just before it saves.
- **Durable cost accounting.**
  - Failed calls carry their billed usage (`ModelCallFailed`). A failure whose billing is unknown marks the job `unresolved`, and it counts its whole allowance.
  - A call starts only if the article budget can absorb its full output cap (×4 for research, which can pause and resume).
  - `runEditorialBatch` journals `reserve` before a job may spend and `settle` when it ends. The CLI appends both rows to `spend.jsonl` synchronously, persists each run as it settles, and reports the settled amount to the Admin.
  - One journal and one `run.lock` per machine (`EDITORIAL_SPEND_DIR`, default `artifacts/m11b/runs`), whatever `--out` says. A crash leaves the lock and its reservation counted. Duplicate slugs are refused.
- **Unpublished media privacy.**
  - `editorialMediaGate` sees every `/storage` path, decoded once and normalised as the static server resolves it. It serves an editorial cover only when a `publish`+`approved` post uses it; otherwise it returns 404 with `no-store`.
  - The Admin detail view gets `coverPreview` (a data URL) through its authenticated API.

## 3. Skills and agents used
- Orchestrator (this session, Opus 5.5): implementation, tests, release.
- One independent security reviewer subagent (read-only, general-purpose): reviewed the diff, then re-reviewed the fixes.
- No other agents: the backend work was small and in one place, so splitting it would have added overlap.
- No new dependencies.
- Playwright Admin E2E was **not run**: no Admin editorial spec exists, the suite boots a backend against the shared database, and there is no live result to render. Admin Karma specs were run instead.

## 4. Tests
| Check | Result |
|---|---|
| `npm run lint -w apps/backend` | clean |
| Backend `npm test`, Windows, `TEST_MONGO_URI` (includes the editorial Mongo E2E) | 729 total: 727 pass, 1 fail, 1 skipped |
| Linux CI (PR #97, `e6dab8b`) | backend 728/729, 0 fail, 1 skipped (Redis); ops 30/30; SEO regression pass |
| `node scripts/m11d-cli-check.mjs` (real CLI, local fake API) | 7/7 |
| Signed replay through the real CLI | signature valid with the key, invalid with another; backend `replay` (never policy-publishable) |
| Admin Karma specs | 4/4 |

- The Windows fail is `content-certify` owner flow (POSIX file mode). The skip is the Redis presence test (`TEST_REDIS_URL` is not set).
- **The 723/725 discrepancy is the same two cases.** The 4 extra tests are new.
- The CLI checks cover:
  - reviewer keys refused
  - duplicate slugs refused
  - a malformed cap
  - HTTP 529: blocked, settled at 0, reported
  - a cut stream: settled at the full $3 allowance
  - an exhausted budget: zero provider calls
  - SIGKILL mid-job: the reservation stays counted, the lock refuses a duplicate run (exit 3), and a second `--out` shares the journal

## 5. Live AI execution
- The owner authorised one job on this session's token with a $3 ceiling.
- Validation before spending: `ANTHROPIC_BASE_URL` points to a local multi-provider gateway (`127.0.0.1`, `auto/*` aliases). `models.retrieve` returns **404** there for `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5`.
- Running through it would mean:
  - a silent provider switch
  - prices the ledger does not know
  - provenance falsely saying `anthropic`
- **First attempt: not run.** $0 spent, no model used.
- **Second attempt.** The owner clarified that Claude is used through the subscription, via that gateway. A probe confirmed the gateway serves real Claude under `cc/`:
  - `cc/claude-opus-5-5` answers as `claude-opus-5-5`; the same holds for sonnet and haiku.
  - The `web_search` server tool is accepted.
- **Adapter change (PR #99).** `ANTHROPIC_MODEL_PREFIX=cc/` is applied on the wire only, so prices and provenance keep the canonical id. A response from any other model is refused.
- **Canary.** One signed job on 2026-10-27, run with:
  - topic `cine-en-abierto-tdt-27-28-octubre-2026`
  - caps of $3 per article, $3 per day and 1 article per day
  - a local signing key
  - no `--report`
  - no production write
- **Result: `blocked`.** The reason is "agotados los ciclos de revisión" (review loops exhausted).
  - The critic (Opus) asked for `revise` 3 times. The last time it raised 6 issues, for example a phrase about "Sam" that c16 does not support.
  - One internal source returned 404: `program:20261027_paramount_network_20261027220000`.
- **Evidence.**
  - Claims: 20 in total; 8 supported, 12 unverified.
  - Quotes: all 34 match the retrieved text verbatim.
  - Sources: 6 internal GuíaTV sources, 5 retrieved.
  - Research did not run a web search; it used only the internal sources.
- **Draft.**
  - Title: "Cuatro películas en la TDT: qué plantea cada una y cómo elegir".
  - About 567 words.
  - Metadata within limits.
  - No cover.
- **Findings:**
  - block `source-not-retrieved`
  - block `critic-rejected`
  - human `unverified-claims`
- **Provenance.** Backend `anthropic`. The signature verifies with the run key and fails with another key.
- **Cost:** $0.802 at list price (actual billing is the subscription). 76,420 input and 26,015 output tokens.

  | Role | Model | Calls | USD |
  |---|---|---|---|
  | research | opus | 1 | 0.457 |
  | evidence | opus | 1 | 0.008 |
  | editorial | opus | 3 | 0.194 |
  | seo | haiku | 2 | 0.001 |
  | critic | opus | 3 | 0.143 |

- **Spend journal:** `reserve` $3, then `settle` $0.802401. The lock was released.
- The run file is in `artifacts/m11d/runs/` (untracked).

### Server keys and second canary (2026-10-27, owner-authorised)
**Server keys.**
- Production `/etc/guiatv/api.env` had `ANALYTICS_ADMIN_KEY` and `EDITORIAL_REVIEW_KEY`, but no signing key or policy key.
- I backed it up to `api.env.bak-m11d-<ts>`, then appended two new random keys, sent over stdin and never printed:
  - `EDITORIAL_PIPELINE_SIGNING_KEY`
  - `EDITORIAL_POLICY_KEY`
- I restarted `guiatv-api`: active, `NRestarts=0`, health 200.
- Runner copies are in `~/.guiatv/runner.env`, outside Git.
- `release.json` read over SSH: `20261027160344` / `c06a09b`.

**Checks after the restart.**
- The Admin shows `signingKeyConfigured true`.
- `approve-by-policy` with the policy key returns **403** "Policy publishing is disabled".
- `policy/resume` with the policy key returns **403**.

**Second canary.**
- Topic `cine-en-abierto-tdt-miercoles-28-octubre-2026`, with 3 live internal sources: *Ocean's 13*, *La trampa*, *La protectora*.
- Run with `--report` to production.
- First run, daily cap $3: $0.80 had already been spent, so the job was **held before any call** ("sin margen…", settled $0). The fail-closed headroom worked as designed.
- Rerun, daily cap $4, still $3 per job: **blocked** after 3 drafts. The critic asked for `revise` (7 medium/low issues on nuances, e.g. "heredera consentida" states as fact what the synopsis only implies).
  - All 3 sources were retrieved.
  - Claims: 14 in total, 7 supported.
  - Findings: block `critic-rejected`, human `unverified-claims`.
  - Draft: "Robos o guardaespaldas: tres películas y cómo elegir entre ellas", about 435 words.
  - Signature valid with the **server** key.
  - $0.673; 60,343 input and 21,852 output tokens.
- The production Admin shows both jobs with their costs, today's spend of $0.6732, 0 AI posts, and policy off.

## 6. Article, review and publication
Neither canary article passed the independent critic within `maxReviewLoops` (2, so 3 drafts). `save-draft` refuses blocked runs, so nothing reached the CMS, nothing was reviewed, and nothing was published. Production content is unchanged.

**Finding.** The pipeline works, but with this critic ("pass only if you would publish it as is") it does not converge within 2 revision loops. Whether to change that is an owner decision; the options are in §8.

## 7. Security findings
| Sev | Finding | Status |
|---|---|---|
| HIGH | Draft covers reachable via `/storage/%65ditorial`, `//`, `./`, `../`, `%2F` | Fixed (b061933), with a test for each spelling |
| MED | Headroom ignored paused research turns | Fixed (×4). Input tokens are still unbounded (`shortcut:` comment) |
| MED | Journal and lock were per `--out` | Fixed |
| LOW | Pause read before the awaits in `approve-by-policy` | Fixed |
| LOW | Runner could hold the Auctorio review key; human key could equal the admin key | Fixed |
| LOW | Repeated slugs shared a job id | Fixed (refused) |
| LOW (re-review) | The default spend dir depended on the cwd | Fixed (e6dab8b) |
| LOW | The admin key (runner-held) can still unpublish or delete posts | Accepted: takedown only, never publication |
| LOW | Title and meta are not in the signed attestation | Accepted: the runner holds the signing key anyway; the content is bound to `draftHash` |

## 8. Owner actions
1. Done: runner credentials (subscription gateway with `cc/`, plus the server's signing key and admin key in `~/.guiatv/runner.env`).
2. Done: `EDITORIAL_POLICY_KEY` is on the server and in the runner. `EDITORIAL_REVIEW_KEY` stays on the server and with the human reviewer only.
3. **Decide how a critic-rejected draft can reach a person.** Pick one:
   - (a) Raise `maxReviewLoops` (more cost per article).
   - (b) Let `save-draft` store a run blocked only by `critic-rejected` as a draft for human review. Policy publication would stay impossible, because the critic finding blocks it.
   - (c) Keep the current gates and accept a low yield.
4. When a run passes, or after (b), run `save-draft`. A named reviewer then reads the Admin detail view and approves with `approve` (the human key). The cover stays mock or none: `LIVE_IMAGE_PROVIDERS` is empty, so the article is published without a cover or held.

## 9. Release
- PR **#97**, branch `m11d-activation`, head `e6dab8b`. Commits:
  - `40023e8`: policy key
  - `571154a`: spend journal
  - `3711006`: private covers
  - `b061933`: review fixes
  - `e6dab8b`: spend dir anchor
- Linux CI on `e6dab8b`: green.
  - "Build, test, and performance budgets" run 40518466486: backend **729 tests: 728 pass, 0 fail, 1 skipped** (Redis); ops 30/30.
  - "SEO regression" run 40518466513: pass.
  - `live-crawl` was skipped (as on every PR).
- **Merged:** squash `c06a09b` on main (`--match-head-commit e6dab8b…`). Main CI on `c06a09b` is green: Build/test run 40521748014 and SEO regression run 40521748239.
- **Deployed:** `deploy-artifact.yml` run 40526995217 succeeded. Live release **`20261027160344`**; the deploy log checks out and installs `c06a09b6be3d…`.
- `release.json` was **not read over SSH**: the read-only `ssh contabo` check was refused by this session's permission system. The SHA comes from the deploy run log.
- **Production smoke tests (2026-10-27, after the deploy):**

  | Check | Result |
  |---|---|
  | `/` | 200 |
  | `/guias` | 200 |
  | `/sitemap.xml` | 200 |
  | `/politica-editorial` | 200; canonical unchanged; still says automatic publication is off |
  | `/v2/admin/editorial/overview` without credentials | 401 |
  | `/storage/editorial/<hex>-1600.webp` | 404 with `no-store` (new gate) |
  | `/storage/%65ditorial/…` | 404 with `no-store` (new gate) |
  | `/v2/blog` | 10 public posts, unchanged |
  | `/guias/mejores-series-y-peliculas-movistar-plus-espana` | 200, same canonical |

- No content, env, credentials or policy changed.
- Rollback target: `20261027134338` (`dad7c7c`).

## 10. Activation and rollback (not executed)
**Activation**, only with explicit owner authorisation:
1. Complete the owner actions in §8 and pass a supervised publication.
2. Update `/politica-editorial` (the "Está desactivada" paragraph) in the same release.
3. Set `EDITORIAL_POLICY_PUBLISHING=enabled` and `EDITORIAL_POLICY_DAILY_LIMIT=1`, then restart the API.
4. Publish at most 1 article per day with `publish` (policy key).

**Rollback**:
- At once: Admin "Detener" (any admin). The stop is re-checked just before save.
- Then set `EDITORIAL_POLICY_PUBLISHING=disabled` and restart.
- Code: redeploy release `20261027134338` (`dad7c7c`).

## 11. Next milestone
First, close M11-D's open gates: the owner actions in §8, then the live canary and the supervised publication (no new code expected). After that comes **M12: Controlled programmatic SEO**, which depends on M09, M10 and M11-B and is still NO-GO in `GUIATV-MILESTONES.md`. M12 has not started.
