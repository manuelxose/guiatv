# M12 entry gate: programmatic SEO readiness and editorial safeguards

Date: 2026-10-27. Baseline `main@81e0e15`, production `20261027175818` @ `e4f212a`. Scope: decide whether M12 may start, close the M11-D review gaps that affect it. No pages created, no AI run, nothing published.

## 1. Decision
**M12: NO-GO.** Its canonical dependencies are not met (§2). Engineering in this gate closed two HIGH safeguard defects and restored Admin E2E coverage; that does not change the dependency status.

## 2. Canonical entry criteria (GUIATV-MILESTONES.md) vs now
M12 row: *Controlled programmatic SEO · Depends M09, M10, M11-B · Acceptance: small batch, quality gate, kill switch · Blocker: scaled-content risk; not before M11-B · NO-GO*.

| Criterion | Required | Now (evidence) | Met |
|---|---|---|---|
| M09 | canonicals, indexation policy, no thin page indexable | Engineering released `20261026145804`; programme ↔ `/peliculas`/`/series` twin owner and airing-dependent movie `noindex` still owner decisions (CURRENT-STATE M09) | partial |
| M10 | no orphaned indexable detail pages | **PARTIAL**: 664 sitemap programme URLs beyond depth 3 (CURRENT-STATE M10) | no |
| M11-B | each guide passes the #86 gate, no unacknowledged `human` finding, a named reviewer publishes | 0 AI articles published. Both canaries held by the critic; draft `6ae0d88e…` awaits a named reviewer. Roadmap row still says NO-GO (author) and lists M04-B (not started) as a dependency | no |
| Small batch | a cap per batch | Only the entity canary has one (`CANARY_HARD_CAP` 25, `contentCertification.ts:17`); it governs serving, not indexing | no |
| Quality gate | per-URL gate before indexing | Editorial gate exists for guides only; nothing for generated page families | no |
| Kill switch | stop a batch being indexed without a redeploy | Entity kill env/file stops serving; pages there are always `noindex`. No index/sitemap kill for indexable pages | no |
| Search evidence | (needed to measure "scaled-content risk") | No Search Console export in the repo; `scripts/gsc-compare.mjs` unused | external |

## 3. M11-D blockers reviewed (independent reviewer subagent, read-only)
| Item | Result |
|---|---|
| Daily limit: authorization, validation, audit, concurrency | **Safe.** Human key only (policy key and key-equal-to-admin refused), integer 1–10, audited; ledger insert-then-count can only under-publish |
| Critic `revise` / `block` | **Safe on the stored verdict**: anything not `revise` is `block`; policy refuses both; human approve needs each `human` code acknowledged. **But** the verdict was trusted unsigned on the human path → HIGH-1 |
| Unverified claims, automated paths | Policy key refuses `critic-rejected`; cited non-supported claims block; uncited facts rely on the `FACTUAL` regex (MEDIUM, by design; see §6) |
| Unpublished media | **Safe**: gate before the only `/storage` static mount, decoded/normalised path, `coverPreview` admin-only. Hypothesis: S3 adapter uploads covers `public:true` (S3 not used in production) |
| Publication idempotency | Policy ledger `_id` per post+draft → 409 on repeat. **But** approvals were read-then-save → HIGH-2 |
| Held draft `6ae0d88e…` | Unpublished (`/guias/<slug>` 404, `/v2/blog/<slug>` 404, absent from `/v2/blog` and blog sitemap). Findings not acknowledged by anyone. Programmes air 2026-10-28: if no named reviewer acts before then, it expires unpublished |

### Fixed (PR in §5)
- **HIGH-1: provenance laundering.** The admin key (held by the runner) could `PUT` `origin:'human'` / `editorial:null`, or a forged verdict, turning a critic `block` into something a reviewer could approve. Now a post with M11-B provenance keeps its origin and provenance, and both approval paths add `provenanceSignatureFindings`: with the server key set, a missing or invalid signature is a `block`; without a key (development) it is a `human` finding.
- **HIGH-2: approval race.** Approvals read, gate, then `save()` with no precondition, so an edit landing in between went public under the old review. `BlogPost` now uses `optimisticConcurrency`; the controller's four saves return 409 on a concurrent write.
- **LOW-1:** a failed policy save no longer leaves a ledger row that burns a slot and locks the draft.

### Accepted / open (not fixed here)
| Sev | Finding | Why open |
|---|---|---|
| MEDIUM | The runner's admin key can create a new `origin:'human'` post (no provenance) and delete the AI draft | Needs a CMS key separate from the runner key: owner decision |
| MEDIUM | Runner daily cap is client-side (local run files, UTC day); server uses rolling 24 h; `createPost`/`recordJob` uncapped | Publication is still capped server-side; runs are not. Next editorial engineering item |
| MEDIUM | Policy path ignores `unverified-claims`; uncited facts rely on a regex | Owner must restate the rule; policy publishing stays off |
| LOW | Rollback republishes a policy revision without a ledger row; acknowledged codes not audited; per-code acknowledgement; emergency-stop race window of one save | Policy publishing off |
| LOW | Signing-key rotation makes stored signed drafts unapprovable (`provenance-signature-invalid`) | Re-run drafts after a rotation |
| LOW | `critic.issues` text not covered by the signature | Verdict and hashes are |

## 4. SEO readiness (independent SEO subagent, ~32 public GETs, read-only)
| Page type | Class | Reason |
|---|---|---|
| `/programas/:slug` | EXCLUDED | Already scaled-content risk: same-work twins, episode URLs with wrong synopsis, no cap/quality filter in its sitemap |
| `/peliculas/*`, `/series/*` | EXCLUDED until M09 §6 | Twin owner undecided; indexability flips with airings (`catalog-indexability.ts:12`) |
| `/canales/:slug` | CONDITIONAL | Closed set of 82; only with unique per-channel value; `LA-1` answers 200 (canonical lowercase) |
| `/guias/*` | EXCLUDED from programmatic | Editorial lane (M11-B gate); 5 rankings share ~71 % prose |
| `/deportes/futbol/*` | CONDITIONAL | Details need their own resolver and a word floor; `partidos-hoy` 122 words indexed |
| Hubs, `/tendencias`, `/contenido/*`, account | not programmatic / EXCLUDED | Fixed hubs; thin; `noindex` |

**Confirmed defects** (live + code): (1) indexable twins `/programas/black-rose` ↔ `/peliculas/black-rose` (M11-A: 608 of 703); (2) accent-dropping programme slugs still in the sitemap (`aqu-no-hay-quien-viva`; `SitemapController.ts:301`); (3) 99 of 726 programme sitemap URLs are episode slugs, e.g. `/programas/episodio-805` indexable with an unrelated synopsis; (4) airing-dependent `noindex` on works; (5) programme sitemap has no cap or quality filter (`SitemapController.ts:293-312`); (6) `sitemap-streaming.xml`/`sitemap-football.xml` not in the index; (7) the weekly live SEO crawl is disabled (`seo-regression.yml:18-20`); (8) no GSC data.
**Hypotheses**: programme `lastmod` is always today (precompute rewrites `updatedAt`); Google already folds many twins; robots.txt has two `User-agent: *` groups (Cloudflare + origin).

**Measurable entry conditions for any future batch**: M11-B done and M09 §6 recorded; defects 1–5 fixed or `noindex` (accent slugs with a 301 plan); 28-day GSC baseline through `gsc-compare.mjs`; an index gate like the entity canary but for indexing (env/file kill that drops the batch from sitemap and index within one cache TTL, allowlist with approver and date, ≤ 25 URLs); per-URL floor (≥ 300 unique main words, 0 duplicate synopses, < 30 % template share, source and date per fact, 200 + self-canonical + valid JSON-LD); kill trigger after 28 days (impressions per URL below site median, or > 20 % "crawled/discovered – not indexed"); weekly crawl on; every batch URL within 3 clicks of a hub.

## 5. Changes
- Backend: `EditorialEvidence.ts` (`provenanceSignatureFindings`), `BlogController.ts` (provenance lock in `normalizePayload`, `saveUnchanged`, ledger release), `BlogPost.model.ts` (`optimisticConcurrency`). Tests: `BlogController.editorial.mongo.test.ts` (laundering, forged/unsigned verdict, approval race), `EditorialOpsController.mongo.test.ts` (relabel now refused).
- E2E: new `e2e/specs/admin-editorial.spec.ts` (held draft shows `critic-rejected`/`unverified-claims` and only the private cover preview; emergency stop needs reason + confirmation; refused daily-limit change is shown, key sent only as a header, cleared, never stored). `admin-shell`: channel-icon preload mocked (fresh checkouts have no `storage/`), collapse check waits for the content transition.
- No frontend source, dependency, workflow, env or content change.

## 6. Tests (Windows, this session)
| Check | Result |
|---|---|
| `npm run lint -w apps/backend` | clean |
| Backend suite, `TEST_MONGO_URI` (test container) | 730: 728 pass, 1 fail (known `content-certify` POSIX mode on Windows), 1 skip (Redis) |
| New backend assertions on the old code | fail (relabel 200, race publishes); pass with the fix |
| Playwright `admin-editorial` + `admin-shell` (backend on test Mongo) | 7/7 |
| Playwright `admin-affiliate` | 1/3 pass. Desktop: channel-icon 404 console errors (same local-storage cause, own mock not changed). **Mobile: 18 px horizontal overflow** in Monetización (not editorial; recorded, not fixed) |
| Admin Playwright in CI | **none**: only `playwright.entity.config.ts` runs (seo-regression, after merge). These specs are local-only |

## 7. Skills and agents
- Orchestrator (Opus 5.5): context recovery, fixes, tests, E2E, docs, release.
- Independent security/concurrency reviewer (general-purpose, read-only): review, then re-review of the fixes (found the unsigned-provenance gap, fixed before merge).
- SEO readiness auditor (general-purpose, read-only, public GETs only).
- Skill: ponytail (smallest change). No new dependencies. No live AI call: a fresh run cannot satisfy an entry criterion (a passing article still needs a named reviewer), so Workstream D was not run ($0).

## 8. Remaining M12 blockers
1. M11-B: one AI article approved by a named reviewer (human key) and published; roadmap row and its M04-B dependency updated by the owner.
2. M10: decision on programme-only pages (664 beyond depth 3).
3. M09 §6: twin canonical owner; stable robots rule for works.
4. SEO defects 1–5 in §4.
5. An index-level kill switch, batch cap and per-URL quality gate.
6. GSC access and a 28-day baseline (external).
7. Owner: separate CMS key from the runner admin key (MEDIUM above).

## 9. Next single submilestone (not started)
**M11-E: supervised first publication.** Owner/reviewer decision on draft `6ae0d88e…` before 2026-10-28 (approve with the human key and explicit acknowledgements, or let it expire); if it expires, one signed pipeline run on a fresh topic, `save-draft`, named-reviewer approval; update `/politica-editorial` only if policy publishing is ever enabled; owner records whether M11-B still depends on M04-B. Exit: one AI article public via `approve`, production smoke, M11-B row updated. No programmatic pages.
