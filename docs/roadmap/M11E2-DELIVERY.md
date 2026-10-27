# M11-E2: autonomous editorial publishing engine

Date: 2026-10-27. Baseline `main@90c49b6`. Production after this milestone: `20261027211302` @ `6d4e40f`. Scope: autonomous revision and automatic certified publication on top of the existing M11-B…M11-E pipeline. No M12 work, no new provider integrations, no new dependencies.

## 0. Summary

| Gate | Status | Evidence |
|---|---|---|
| ENGINEERING PASS | **PASS** | PR #108 merged at `6d4e40f`, CI green. Two independent reviews: every BLOCKER and HIGH fixed and verified (§3) |
| AUTONOMOUS REVISION PASS | **PASS** | 12 new deterministic tests (§4). Live, three topics converged after 2 revisions each (§5) |
| LIVE PROVIDER PASS | **PASS** | Local run 6 went end to end with one `--autopublish` command (§5), and so did the production run (§15) |
| AUTOMATIC PUBLICATION READY | **PASS** | Deployed and verified in production (§10) |
| AUTOMATIC PUBLICATION ENABLED | **PASS** | Owner-authorised in session on 2026-10-27 and activated in production (§15) |
| PRODUCTION PUBLICATION PASS | **PASS** | 3 guides published autonomously in production; SSR and SEO verified (§15) |
| M11-B | **PARTIAL** in the canonical roadmap | The proposed alternative criterion (§12) is now met by evidence; adopting it is the owner's decision (§15) |
| M12 | **NO-GO**, unchanged | |

## 1. What was implemented

**Pipeline** (`EditorialAgentPipeline.ts`, `EditorialEvidence.ts`):

- **Revision loop.** The flow is RESEARCH → GENERATE → GATES → CRITIQUE → REVISE → REVALIDATE.
  - Every version is re-verified and re-criticised from scratch. The critic verdict and the HMAC signature bind the final draft hash, bundle hash and metadata hash, so no version inherits a PASS.
  - `run.revisions` records each version: verdict, blocking codes, gate fixes and the action taken.
- **Retry policy.** Bounded and configurable: `EDITORIAL_MAX_REVISIONS` (default 5), 3 research calls, `EDITORIAL_MAX_DAILY_ATTEMPTS` (default 30).
  - Missing evidence (unsupported claim, no distinct value, discarded claims the critic points at) → targeted re-research with the rejection reasons.
  - Writing defects → a minimal edit of the previous draft.
  - Mechanical gate defects → fixed *before* the critic, by the writer or the SEO agent, at most 3 per round.
  - An identical draft → the job is abandoned.
  - A critic `block` is final. The one exception: when every serious issue is missing evidence and research remains, a new candidate is built from new evidence and gets a new critic review. The blocked candidate is kept and signed into the provenance, and the next critic is told about it.
- **First-draft quality.** The writer and the critic share one rubric (`EDITORIAL_RUBRIC`), and the gate rules are given to the writer up front.
  - The critic has explicit severities. The verdict is the *stricter* of the model's own verdict and the severity rule, so a severity can only tighten it.
  - The critic reviews the excerpt and metadata as well; their hash is signed (`metadataHash`).
- **Validation false negatives fixed.** Each fix is targeted, with positive and negative tests:
  - **Legal references** ("art. 98.1", "Ley 13/2022"). Their numbers are exempt from the quoted-figure rule only when the verifier locates the quote inside that provision of that law's own page, or the verified quote itself names the same provision of the same law. A figure equal to the reference number still needs its quote.
  - **Spelled-out figures.** A law writes "ciento cuarenta y cuatro minutos". A claim may state 144 when its verified quote spells it. The grammar is strict: "dos y tres" is 2 and 3, never 5.
  - **Unreadable research pages** are dropped from the evidence and recorded, instead of blocking every draft.

**Budget and caps**:

- **Budget.** `EDITORIAL_BUDGET=unlimited` lifts both USD caps. Every call is still estimated, journaled (reserve 0, settle real) and reported, with model attribution.
- **Daily caps.** Attempts and publishable articles are capped separately. In-flight jobs are counted, so concurrency cannot exceed the quota. Attempts are counted from the machine-wide journal, reruns included; this closes the M12-ENTRY-GATE MEDIUM "cap per `--out` dir".

**Publication**:

- **CLI.** `run … --report <api> --autopublish` saves each passed run as a draft and publishes it through `approve-by-policy`.
  - The runner never holds the human key; it refuses to start with one.
  - Only this run's own unreviewed draft (same hash) is ever reused after a crash.
  - Mock images, replays and untrusted providers are refused before saving.
- **Server.** `approve-by-policy` needs all of: the env switch, a **one-time Admin activation** with the human review key (the switch alone publishes nothing), no emergency stop, signed live-provider provenance, every gate, metadata matching the reviewed hash, daily capacity, and the idempotency ledger. It publishes as `policy:m11b-evidence-gate`, so it cannot impersonate a reviewer. The manual human workflow is unchanged.
- **Admin (Operaciones IA).**
  - Activation form.
  - "Hoy" panel: generated, published, ready, held, rejected, revisions, rejection reasons, model usage and estimated spend.
  - Budget mode, and revisions and public link per job.
- **Public `/politica-editorial`.** Describes both publication paths truthfully. The old text promised that no article is published without a person.

## 2. Skills and agents actually used

- **Orchestrator (Opus 5.5).** Did the context recovery, design, implementation, tests, live runs, diagnosis, release and this record.
- **Agent D — independent security/QA reviewer** (general-purpose subagent, read-only, run three times):
  - Review 1: 2 HIGH, 4 MEDIUM, 3 LOW.
  - Review 2, on the convergence and evidence-rule commits: 3 HIGH, 2 MEDIUM.
  - Review 3: verified that every finding was closed, including probes and a 20,000-input fuzz.
- **Agents A, B and C (research, writer and SEO, critic)** are the pipeline's own live model roles. They are not session subagents. The live routes in all runs were `claude-opus-5-5` for research, evidence, editorial and critic, and `claude-haiku-5-5` for SEO, through the local subscription gateway (`ANTHROPIC_MODEL_PREFIX=cc/`).
- **Skill:** ponytail (smallest complete change).
- **Playwright:** Admin spec run locally in a real browser, 4/4.
- **Not used:** Impeccable / UI UX Pro Max (no redesign), WebSearch, new providers.

## 3. PRs and commits

PR #108 was squash-merged as `6d4e40f`. Its commits:

| Commit | What it contains |
|---|---|
| `cdbbda9` | Revision loop, legal references, unlimited budget, caps, `--autopublish`, activation, Admin, policy page. Includes review 1 fixes H1/H2/M1–M4/L1 |
| `544878a` | Shared rubric; gates run before the critic |
| `d8e7427` | CLI TDZ crash, found by live run 3 |
| `686b6e0` | Spelled-out figures, references named inside the quote, recoverable blocks |
| `a896dcf` | Review 2 fixes H-A/H-B/H-C/M-A/M-B |

Review residuals accepted as LOW:
- The daily "today" counts use the UTC day, while the cap uses a rolling 24 h.
- The identical-draft check compares only with the previous draft; it stays bounded by the revision limit.
- A serious critic issue that only *names* a discarded id counts as an evidence issue. Mitigated: the next critic is told about the block.
- A signed AI post's excerpt and metadata can only be changed by re-running the pipeline, as was already true of its body.
- `publish` run manually does not update the Admin job row (§9).

## 4. Test results

| Check | Result |
|---|---|
| Backend lint | clean |
| Editorial unit tests | 55/55, including 12 new M11-E2 tests in `EditorialAutonomy.test.ts` |
| Mongo controller tests (local docker Mongo) | 6/6 |
| Full backend suite (Windows) | 737/739. The one failure is the known Windows-only `content-certify` file-mode test; one test skipped |
| Frontend | lint 0 errors; unit tests 359/359 |
| Admin Playwright `admin-editorial.spec.ts` | 4/4, including the new activation and "Hoy" test |
| PR CI on every push | backend, frontend and verify green |

Required scenarios and the test that covers each:

| Scenario | Covered by |
|---|---|
| Successful autonomous flow | pipeline tests + live run 6 |
| Failed evidence retrieval | dropped sources |
| Unsupported claim correction | re-research test |
| Legal-reference validation | positive and negative tests, plus the real BOE probe |
| Critic rejection | block test and rubric test |
| Revision and revalidation | hash-binding asserts |
| Exhausted retries | bounded research, then rewrites, then held |
| Concurrency | 12 topics, 4 workers, limit 10 → exactly 10 |
| Daily limit 10 | Mongo test and the concurrency test |
| Unlimited budget | journal stays numeric; attempts still capped |
| Crash and restart recovery | journal and reuse of the same-hash draft only |
| Duplicate publication | ledger refusal, local live refusal |
| Emergency stop | existing Mongo test |
| Invalid provenance | signature, replay and metadata tamper tests |
| Unauthorized publishing | guard tests; activation without the human key → 403 (live) |
| No human key in automatic mode | runner refuses one; publication used the policy key only |

Mocks were used only for deterministic scenarios and are not counted as live validation.

## 5. Live generation results

All six runs used real models through the gateway, against real BOE and CNMC pages, publishing to an **isolated local API**:
- Test Mongo `guiatv_m11e2_live`.
- Throwaway keys in `artifacts/m11e2/local.env`, never the production secrets.
- `EDITORIAL_BUDGET=unlimited`, Admin limit 10, activated through the Admin route with the local human key.

| Run | Code | Topic | Versions | Result |
|---|---|---|---|---|
| 1 | first M11-E2 | Minors / time slots (Ley 13/2022, the M11-E topic, unchanged notes) | 6 | Held after 5 revisions. Evidence fixed (35/36 claims supported, vs 4/22 in M11-E). Final block: a figure in the excerpt |
| 2 | + review 1 fixes | same | 6 | Held: the critic never passed (repetition, filler); gate defects swung between rewrites |
| 3 | + rubric, gates before critic | same | 3 (2 revisions) | **PASS.** The CLI crashed at the final step (TDZ, fixed); the same signed draft was then published by policy through `publish` |
| 4 | same | Advertising limits (arts. 137–139) | 2 | Critic block: key claims discarded because the law spells figures out. The critic named them only in its message, so no re-research ran |
| 5 | + spelled figures, recoverable blocks | same | 3 (2 revisions) | **PASS.** The local API, still on the old build, refused it; that is the server re-checking as designed. After restarting on the new build, the same draft was published by policy |
| 6 | final (`a896dcf` code) | Accessibility: subtitles, audio description, sign language (arts. 101–106) | 3 (2 revisions) | **PASS and published with one `--autopublish` command, no person involved.** 31/32 claims supported, 2 tables |

The three published articles are 653, 491 and 649 words. Their HTML is in `artifacts/m11e2/published-*.html` and their run files in `artifacts/m11e2/runs/` (untracked).

## 6. Successful and failed revisions

- **Successful:** runs 3, 5 and 6 each took 2 revisions. In two of them the gate fixes before the critic removed a mechanical defect (an uncited legal reference, or a figure in the metadata) without spending a critic round. Run 5 re-researched once to recover evidence.
- **Failed, and why:**
  - Runs 1 and 2: the writer had not been given the critic's criteria, and gate defects were fixed only after the critic. This led to the shared rubric and the pre-critic gates.
  - Run 4: two validator false negatives (spelled-out figures; a reference named inside the quote) and a re-research trigger that missed critic messages. All three are fixed.
- No failing article was published. Every block was preserved with its provenance.

## 7. Editorial quality evidence

Assessed as the SEO/editorial agent:

- **Run 3, "Horario de emisión de contenidos para adultos…".**
  - The first sentence answers the intent: 22:00–6:00 for content rated not recommended under 18.
  - A table of time slots by content type, the pay-TV and on-demand obligations, and where to complain (CNMC).
  - Every fact names its article.
  - Weak points: no GuíaTV internal links (the topic has no own data); one loose paraphrase ("a cualquier hora" for "sin sujeción a la limitación horaria").
- **Run 5, "Límites de publicidad en TV…".**
  - The first sentence gives 144 and 72 minutes per slot and one break per 30 minutes.
  - It covers what does not count towards the limit, a table of breaks by content type, sport, on-demand services and the CNMC.
  - The statement "not per hour but per slot" is backed by the law's preamble.
- **Run 6, "Subtítulos, audiodescripción y lengua de signos…".**
  - The first sentence gives the subtitling percentages by service.
  - Two comparison tables.
- **Across all three:** no filler, no first person, no unsupported figure (gates on the runner and again on the server), the AI disclosure is present, and there is no near-duplicate of the 10 public guides.
- **Not guaranteed:** passing these gates does not guarantee rankings or AdSense approval.
- **Open SEO gaps:**
  - The three guides would open a new "Televisión" category.
  - There are no internal links for topics without GuíaTV data.
  - All three test topics cite the same law, which is a narrow corpus.

## 8. Daily publishing configuration

- **Mechanism:**
  - The Admin limit (1–10) is stored on the server (`editorial_settings`) and changes without a deploy.
  - The server enforces it at `approve-by-policy` with a ledger written first and counted over a rolling 24 h; concurrent approvals were tested.
  - The runner obeys `limit − publications in 24 h` and stops starting jobs once that many runs are publishable.
- **Testing profile:**
  - Limit 10: tested locally and in the Mongo test.
  - Unlimited budget; full telemetry.
  - Revisions ≤ 5, research ≤ 3, attempts ≤ 30 per day.
  - Critic, source and SEO gates are mandatory, and the emergency stop is available.
- **Production:** the limit is **still 3**. Raising it to 10 is an Admin action with the human key (§13).

## 9. Spending monitoring

- **Live runs this milestone: 7.411 USD estimated** at list price. Per run: 1.872, 2.034, 0.922, 0.645, 0.935 and 1.003.
  - These are subscription-gateway calls, so the figures are estimates, not invoices.
  - Every call is attributed to its model in the job report.
- **Admin:**
  - The "Hoy" panel shows model usage (calls, tokens, estimated USD) and rejection reasons.
  - In unlimited mode the caps read "presupuesto sin tope (modo de prueba)". Alerts are advisory only.
- **Known gap:** a manual `publish` does not update its job row. In the local test, "Publicados hoy" showed 1 while the cap ledger correctly counted 3. With `--autopublish` the job row is correct.

## 10. Production deployment status

- **Release:** `deploy-artifact.yml` run 40575740684 deployed `20261027211302` @ `6d4e40f` (`gitSha` verified on the host). `guiatv-api` is active with `NRestarts=0`.
- **Public pages:** `/v2/health`, `/`, `/guias`, `/politica-editorial` and `/sitemap.xml` return 200. The new policy text is live and the old promise is gone.
- **Editorial safety controls:**
  - `/v2/admin/editorial/overview` without a key returns 401.
  - `envEnabled false`, `activated false`, `active false`, not paused, signing key configured, daily limit 3.
  - 10 public posts, unchanged.
- **Rollback target:** `20261027190631`.

## 11. Automatic publication status

**Ready, not enabled.** Production has the full certified path. It publishes nothing until both steps in §13 are done. Once enabled, articles need no per-article approval. The emergency stop (Admin, any administrator) stops it at once.

## 12. Outstanding blockers and the proposed criterion change

- **No engineering blocker.**
- **Owner decision.** The `GUIATV-MILESTONES.md` row for M11-B still requires "a named reviewer publishes an AI guide that passes the gate". This record does **not** rewrite that row.
  - **Proposed change, for the owner to approve:** add an alternative criterion, "an AI guide is published in production by the certified automatic path (signed live provenance, independent critic PASS, every gate, Admin-activated policy)".
  - M11-B would turn PASS at the first production publication under this criterion.
- **Still open (M12-ENTRY-GATE, MEDIUM).** The runner's admin key is the same as the CMS key.
- **Coverage limits:**
  - Research only reads `seedUrls` the topic author provides; topics come from a curated file.
  - The EPG is still not authoritative for film metadata.
- **Image policy.** No live image provider exists. Text-only publication is allowed by the existing policy: no cover is required and `generatedImageFindings` only checks generated images.

## 13. Required owner activation action (one time)

1. **Approve production activation.** On the server, add `EDITORIAL_POLICY_PUBLISHING=enabled` to `/etc/guiatv/api.env`, back it up first, and restart `guiatv-api`. This is a production config change that needs your explicit approval; I have not done it.
2. **In Admin → Operaciones IA,** with the human review key:
   - "Activar publicación automática". This is an administrative switch for the mode, not an article approval.
   - Optionally set the daily limit to 10.
3. **Authorise the runner schedule** (owner machine): `node scripts/editorial-agents.mjs run <topics.json> --report https://guiaprogramaciontv.com --autopublish --confirm-production-write`, with `EDITORIAL_BUDGET=unlimited` and the runner environment from `~/.guiatv/runner.env`. It needs a topic queue.

After that, no per-article approval is requested.

## 15. Production activation and first autonomous publications (2026-10-27/28)

The owner authorised §13 in session ("te doy permiso para hacerlo y cerrar todo"). §11 and §13 record the state before activation.

**Activation:**

| Step | Result |
|---|---|
| `/etc/guiatv/api.env` | Backed up as `api.env.bak-m11e2-20261027T202033Z`, then `EDITORIAL_POLICY_PUBLISHING=enabled` appended. `guiatv-api` restarted: health 200, `NRestarts=0` |
| Admin activation | Done on the host against the local API, with keys read from the env file and never printed. Without the human key: **403**. With it: **200**. Recorded as `Propietario (autorizacion en sesion, M11-E2)`, deliberately not one of the named reviewers. Daily limit set to **10** (200) |
| State after activation | `envEnabled`, `activated` and `active` all true; not paused; limit 10 |

**Production run:**
- Command: `artifacts/m11e2/prod-run.mjs` → `editorial-agents.mjs run prod-queue.json --report https://guiaprogramaciontv.com --autopublish --confirm-production-write`.
- Environment: runner keys only (no human key), `EDITORIAL_BUDGET=unlimited`, the gateway with the `cc/` prefix.
- Queue: the three topics validated locally.

| Guide | Revisions | Claims used | Estimated USD | Result |
|---|---|---|---|---|
| `/guias/horario-proteccion-menores-television-calificacion-por-edades` | 1 | 22 | 0.639 | published |
| `/guias/limite-anuncios-television-minutos-por-hora-ley` | 1 | 21 | 0.620 | published |
| `/guias/subtitulos-audiodescripcion-lengua-de-signos-television-obligaciones` | 5 (passed on the last allowed version) | 32 | 1.942 | published |

No person approved any of the three articles. Each was published by `policy:m11b-evidence-gate` after the server re-ran every gate, the signature, the metadata hash, the cap and the stop check.

**Production checks** (read-only, after publication). The same results held for all three guides:
- **SSR:** status 200 and a self canonical.
- **Robots:** `index, follow`.
- **Schema:** `Article`, with author `Organization` "Redacción IA de Guía TV" pointing to `/politica-editorial`, plus `BreadcrumbList`.
- **Page:** the AI disclosure is present, and the guide is in the sitemap.
- **Public API:** `/v2/blog` shows `publish`, editorial state `published`, and no reviewer byline.
- **Listings:**
  - `/v2/blog` now lists 13 posts.
  - `/guias/categoria/television` returns 200 and lists the three guides.
  - `/guias` links them after one SSR stale-while-revalidate refresh. The first read served the cached hub, a known gotcha.
- **Admin:**
  - `approvalsLast24h` = 3 of 10.
  - "Hoy": 3 published, the jobs with their public URLs, budget `unlimited`.
- **Service:** `guiatv-api` active, `NRestarts=0`, release unchanged at `20261027211302`.

**Still for the owner:**
- Confirm, or reject, the M11-B acceptance-criterion change in §12. Its evidence now exists; `GUIATV-MILESTONES.md` was not rewritten.
- The three guides open a new "Televisión" category. All of them cite the same law.
- A recurring runner schedule needs a curated topic queue. Topics are not chosen automatically yet.

## 14. Next single milestone

This section was superseded on 2026-10-28: the first production autonomous publication took place (§15).

**Next: M11-F, autonomous topic queue and unattended schedule.**
- Topics: chosen from GuíaTV data and verifiable sources, with internal links and different laws or sources.
- Schedule: a recurring runner within the limit of 10.
- Monitoring: the published guides are indexed in GSC and re-verified at their review date (`maintain`).
- Decision: the M11-B criterion from §12.

No M12 work before that.
