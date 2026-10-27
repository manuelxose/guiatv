# M11-E: first human-approved AI publication

Date: 2026-10-27. Baseline `main@2f7d04f`, production `20261027190631` @ `267fb02`. Scope: one supervised AI-assisted publication through the existing human review workflow. No M12 work.

## 1. Executive summary
**Nothing was published.** The held draft is not publishable and is left to expire (owner decision). Two problems blocked the first publication; one is now fixed:
- **Fixed (PR #106).** The research agent could not read any primary source. The local Claude gateway does not run server tools (`web_fetch`/`web_search`).
- **Not fixed (no code defect).** The one authorised live run on a stable topic was **blocked** (`no-distinct-value`). The run used the Ley 13/2022 (BOE) and the CNMC as sources. The research agent added article numbers such as "(art. 98.1)" to its claims. The deterministic figure rule therefore demoted all 18 BOE claims, although their quotes were verified. The Admin daily limit (3) is now used up for 2026-10-27, so there was no second attempt.

| Gate | Status |
|---|---|
| ENGINEERING PASS | **PASS**: blocker fixed, tested, reviewed, merged (`1aaac84`) |
| EDITORIAL QUALITY PASS | **FAIL**: run blocked; held draft also fails (§3) |
| HUMAN REVIEW PASS | **NOT REACHED**: no reviewable draft. Not "waiting": nothing was saved to the CMS |
| PUBLICATION PASS | **NO** |
| M11-B | **PARTIAL** (unchanged) |
| M12 | **NO-GO** (unchanged) |

## 2. Initial state
- `main@2f7d04f`, clean apart from untracked artifacts.
- Live `20261027190631` @ `267fb02`. Rollback target `20261027175818`.
- 10 public posts. `EDITORIAL_POLICY_PUBLISHING` not enabled. Admin daily limit 3. Emergency stop not paused.

## 3. Held draft `6ae0d88eab70f0c81c342315` (`cine-en-abierto-tdt-miercoles-28-octubre-2026`)
Assessed from its run file and by re-reading its three sources. Nothing was acknowledged, edited or re-signed.
- **The source data is wrong.** The BE MAD 20:00 slot still says "Ocean's 13", with director Gary Ross, Debbie Ocean in the synopsis, 135 min. That is *Ocean's 8*. "La trampa" lists director "Sergi Nicolau" and investigator "Gim Baker". The EPG alone cannot support film facts.
- **It misses the search intent.** The article omits time and channel, which is what "qué echan el miércoles por la noche" asks for. It sends the reader to the GuíaTV records instead, and links them as `/v2/content/…` JSON API URLs, not public pages.
- **Critic verdict `revise`.** Two medium findings are inferences beyond the synopsis ("heredera consentida", "única con protagonismo coral"), plus "aporte práctico escaso". About 350 words.
- **Time-bound.** It covers programmes airing on 2026-10-28.
- **Decision (owner): let it expire.** It stays `draft`/`unreviewed`. Public `/guias/<slug>` returns 404 and it is absent from `/v2/blog`. Not deleted.

## 4. Topic selection
**Constraints found:**
- **The gateway cannot fetch the web.** In both M11-D runs `searches` was 0 and only GuíaTV sources were used. A direct probe asked for `web_fetch` and got back a failing `code_execution` block ("no more code_execution tool calls").
- **The EPG is short.** It ends on 2026-10-29 (`/v2/tv/read/schedule`: 30 Oct = 0 items), so Halloween schedules are impossible.
- **Some platform pages have no readable text.** The runner reads plain HTML: Atresplayer (SPA) returns 21–84 chars of text, and the Atresplayer and Mediaset help sites return 403/404. A "ver la TDT por internet" guide would therefore have no Atresmedia source.

**Chosen topic:** `horario-proteccion-menores-television-calificacion-por-edades`. It covers age ratings, time slots and the duties of free-to-air TV, pay TV and on-demand services under Ley 13/2022, arts. 98–100.
- **Stable.** It is law, not a schedule.
- **Primary sources.** BOE `BOE-A-2022-11311` (kind `official`) and the CNMC audiovisual sector page (kind `official`).
- **Clear informational intent.** Parents asking at what time adult content may air and what the age rating means.
- **Not a duplicate.** The 10 public guides cover streaming, prices and football.
- **Gap:** the topic has no GuíaTV data, so it has no internal links.
- **Gap:** it would create a new "Televisión" category.

Topic file: `artifacts/m11e/topics.json`.

## 5. Skills and agents actually used
- **Orchestrator (Opus 5.5).** Context recovery, held-draft assessment, gateway probe, source probes, fix, tests, PR, live run, diagnosis, production checks, this record.
- **Independent security/QA reviewer** (general-purpose subagent, read-only). Reviewed PR #106 and found no BLOCKER or HIGH. It raised two MEDIUM issues, both fixed before merge (§8).
- **Skill: ponytail** (smallest change).
- **WebSearch** was used once by the orchestrator, only to locate CNMC URLs. The runner fetched and verified its sources itself.
- **Not used:** Agent A/B as separate agents. The editorial and backend work was a few sequential steps that depended on each other, so it was not split.
- **Not used:** Playwright. No UI change and nothing to show in Admin.
- **Not used:** SEO tooling. No page was produced.

## 6. Live generation evidence
| Item | Value |
|---|---|
| Job ID | `2026-10-27T18:33:55.849Z-horario-proteccion-menores-television-calificacion-por-edades` |
| Command | `scripts/editorial-agents.mjs run artifacts/m11e/topics.json --out artifacts/m11d/runs --report https://guiaprogramaciontv.com --confirm-production-write`. `--out` is the M11-D dir so the 2 earlier runs of the day count against the limit |
| Daily limit | Read from Admin: 3. Runs today: 3 of 3 |
| Code | Local `dist` built from `a96fc16` (= merged `1aaac84`) |
| Backend / models | `anthropic` via the local gateway with `ANTHROPIC_MODEL_PREFIX=cc/` (the adapter refuses any other reported model). Research, evidence, editorial and critic: `claude-opus-5-5`. SEO: `claude-haiku-5-5` |
| Sources | s1 BOE 200 `official`; s2 CNMC 200 `official`; both retrieved and hashed |
| Claims | 22. **4 supported** (all CNMC). **18 BOE claims unverified**: their quotes are verified, but notes such as "cifras sin respaldo en las citas: 98.1" demote them, because the agent appended article numbers |
| Drafts / critic | 3 drafts. Critic `revise` ×3. Final issues: three high (text relies on discarded claims; "dónde reclamar" promised but not supported), four medium, two low |
| Findings | `block:no-distinct-value` (1 publisher verified), `human:critic-rejected`, `human:unverified-claims` |
| Result | `blocked` ("agotados los ciclos de revisión"). `save-draft` would refuse it, so nothing went to the CMS |
| Job report | Present in Admin: `state blocked`, `blockingCodes [no-distinct-value]`, `costUsd 0.606014` |
| Run file | `artifacts/m11d/runs/2026-10-27-horario-proteccion-menores-television-calificacion-por-edades.json` (untracked) |

**Diagnosis.** The pipeline worked as designed. The figure rule correctly rejects a number the quote does not contain. The fault is in the research output: article references were added to the claim text. The next attempt does not need a code change. Add one topic note: "no añadas números de artículo ni apartados a la afirmación salvo que estén dentro de la cita". It should run on a new day, after the owner authorises it.

## 7. Source and critic verification
- s1 retrieved: HTTP 200, 358,745 chars of text. Arts. 98–100 sit at offset ~180k. The `#:~:text=Artículo 98. Calificación` fragment started the prompt excerpt there; the quotes matched.
- s2 retrieved: HTTP 200.
- The critic's high findings were correct: the draft leaned on demoted claims. No critic `block`; verdict `revise`.

## 8. Engineering: PR #106 (`1aaac84`)
- **Blocker:** with server tools unavailable, the research agent could only quote GuíaTV EPG data.
- **Change** (runner path only, `EditorialAgentPipeline.ts`):
  - `seedUrls` are fetched before research, within the same `maxSourceFetches` budget.
  - Their text goes into the research prompt: 12k chars, starting at a `#:~:text=` fragment when one is given.
  - Seeds join the bundle as `s1…` with the host as publisher. Trust is still derived from the URL, and quotes are still verified against the whole page.
- **Review fixes:**
  - Unfetched seeds are left out of the bundle, so they cannot block approval later.
  - Research sources that relist a seed page are dropped, so they cannot inflate the publisher count.
- **Not changed:** evidence rules, signing, CMS, approval, keys, env and dependencies.
- **Not deployed.** The server does not call `runEditorialJob`, so production behaviour is unchanged. Live stays `20261027190631` @ `267fb02`, one commit behind `main` on the runner only.

## 9. Tests executed (this session)
| Check | Result |
|---|---|
| `npm run lint -w apps/backend` | clean |
| `EditorialAgentPipeline.test` + `EditorialEvidence.test` (Windows) | 35/35 |
| New test on the old code (fix stashed) | fails (1/12), as expected |
| PR CI `f3f597e` run 40560429018, `a96fc16` run 40561033815 | backend, frontend, verify green |
| Full backend suite, Mongo editorial tests, Admin Playwright | **not run**: no server, approval or UI path changed. Last results are inherited from M12-ENTRY-GATE §6 |
| Public SSR/SEO of a new article | not applicable (nothing published) |

## 10. Security and operational checks (read-only, after the run)
- Release `20261027190631`, `gitSha 267fb02`. `guiatv-api` active, `NRestarts=0`.
- `EDITORIAL_POLICY_PUBLISHING=enabled` is absent from `/etc/guiatv/api.env`.
- Admin daily limit 3; emergency stop not paused.
- `/`, `/guias`, `/politica-editorial`, `/sitemap.xml`, `/v2/health`: 200. `/v2/admin/editorial/overview` without key: 401.
- 10 public posts, same IDs as before. Held draft and new slug: 404.
- The runner never had the human review key; the run unset `EDITORIAL_REVIEW_KEY`.
- No approval, acknowledgement, provenance edit, key change or security setting change.
- No secrets printed.

## 11. Spending
- **Estimate:** this run cost $0.606 at list price. Today's three runs total about $2.08.
- **Actual billing: none.** The calls went through the owner's subscription gateway, so these USD figures are list-price estimates, not invoices.
- Gateway probe: 1 small Haiku call, not in the journal.

## 12. Remaining issues
- M12-ENTRY-GATE §3 MEDIUM items stay open:
  - The runner's admin key is not separate from the CMS key.
  - The daily cap is client-side and per output directory.
  - The policy path ignores `unverified-claims`.
- The gateway has no web tools. Research is limited to `seedUrls` the topic author picks, and to pages readable without JavaScript.
- The EPG is not authoritative for film metadata (wrong titles and directors in §3). Any schedule guide needs an external source per film.
- A new "Televisión" category would be created by the first article in it.
- No AI article has been published yet.

## 13. M11-B acceptance
The criterion "a named reviewer publishes an AI guide that passes the gate" is still unmet. The row stays **NO-GO (author)**, still with its M04-B dependency, unchanged without an owner decision. **M11-B: PARTIAL.**

## 14. M12
**NO-GO**, unchanged (M12-ENTRY-GATE §8).

## 15. Next single milestone
**M11-E (retry), on or after 2026-10-28.**
1. Owner authorises one run.
2. Same topic file plus the article-number note (§6).
3. If the run is not blocked: `save-draft`, independent certification, then the named reviewer approves with the human key in Admin → Operaciones IA.
4. Production SSR/SEO checks.

No code change expected.
