# M11-B: AI editorial system

Implemented **2026-10-26** (Europe/Madrid) on `main@2032cdc`, with live release `20261026213853`. Production was read through public GETs only.

Out of scope, on purpose: production database writes, publication, unpublication, redirects, and changes to flags, indexation, canonicals or robots.

## What exists now

```
topic ─► research ─► evidence ─► editorial ◄─► critic ─► publisher gates ─► CMS draft + provenance
            │            │           │            │              │
       web search   fetch each   [[cN]] on    independent    M11-A gate + evidence gate
       + fetch      cited page   every fact   context        → blocked | verified | approved-by-policy
                    once, verify                                       (policy publishing default-off)
```

### Code

| Piece | Where | Decides |
|---|---|---|
| Evidence contract | `apps/backend/src/application/services/EditorialEvidence.ts` | what may be stated (deterministic) |
| Agent workflow | `EditorialAgentPipeline.ts` | role order, bounded loops, limits, final state |
| Claude adapter | `infrastructure/external/AnthropicEditorialModel.ts` | the API calls, with web tools for research only |
| CMS integration | `BlogPost.editorial`, `BlogPost.revisions`, `BlogController` | storage, approval, rollback |
| CLI | `scripts/editorial-agents.mjs` | `run` (live or replay), `verify`, `maintain`, `save-draft`, `publish` |

### Roles and models

Every role is a prompt on one injectable `EditorialModel`. The orchestration and every gate are plain code.

| Role | Model | Can |
|---|---|---|
| research | Opus 5.5, high effort, web search/fetch | propose sources, verbatim quotes, atomic claims |
| evidence | code, then Opus 5.5 | fetch every cited page once (2 MB cap, no crawling) and verify quotes. The model can only **demote** claims (conflicts) |
| editorial | Opus 5.5, medium | write only from supported claims; every factual sentence carries `[[cN]]` |
| SEO | code, then Haiku 5.5, low | metadata limits, slug, duplication, internal link status; the model only fixes metadata lengths |
| critic | Opus 5.5, high, separate context | judge the draft against the bundle only. It can **hold** a draft; it can never approve one alone |
| publisher | code | M11-A `evaluateEditorialQuality` + `evaluateEvidence` + metadata + internal link status |
| maintenance | code | due dates by volatility; re-fetch and re-verify; list the stated claims that lost support |

### Independence

Agents are not treated as independent evidence. Corroboration counts **registrable domains**, not agents or pages: two pages of one site count as one press source. Source trust is derived from the URL, not from the agent's label.

## Evidence rules

1. A claim is `supported` only if a quote of 12 or more characters, copied verbatim, is found in the text our code fetched (ignoring whitespace, case and markup).
2. The source must be official, internal or a dataset, or there must be two press domains.
3. Every number in the claim must appear in one of its verified quotes.

Everything else is `unverified` (dropped before drafting) or `conflicting`. Fewer than three usable claims holds the job without writing anything.

### Publication blocks (`evaluateEvidence`)

**Claims and sources**
- An uncited figure, date or time.
- An unsupported, conflicting or unknown claim marker.
- An external link that is not in the bundle.
- A source with no retrieval record.

**Integrity**
- Bundle or draft hash mismatch.
- HTML that is not the reviewed draft (visible-text fingerprint).
- A leaked marker.

**Freshness**
- A stated claim older than its cadence: TV schedule 1 day, prices, availability and rankings 30, sports rights 120, stable facts 365.

**Authorship and honesty**
- First-hand experience or interview language ("lo hemos probado", "en mi experiencia", "entrevistamos").
- Placeholders.
- A person-like byline (AI posts are signed "Redacción IA de Guía TV", rendered as an Organization in the Article schema).
- A missing AI disclosure.

**Value and review**
- `no-distinct-value`: no claim from GuíaTV's own data, and no table synthesizing two or more publishers.
- The critic missing, stale (another draft or bundle hash) or not `pass`.

The M11-A CMS gate still runs unchanged on top: 250-word floor, raw markdown, FAQ validity, broken or retired links, near-identical (block) and near-duplicate (needs a person). Two of these existing gates refused early test fixtures during development, as they should.

## CMS: states, provenance, versions, rollback

- **Pipeline states**: `draft → researched → verified | approved-by-policy | blocked`. They are stored as `published` / `requires-update` in `BlogPost.editorial.state`.
- **Provenance**: `BlogPost.editorial` holds the bundle with its sources and retrieval times, the draft markdown, hashes, the critic review, the cost, `lastVerifiedAt`, `nextReviewAt` and the version.
- **Public reads**: these omit the bundle, the draft, the critic, the cost and the revisions. They return only `{state, lastVerifiedAt, nextReviewAt, version}`.
- **Human approval** (`POST /:id/approve`, unchanged contract): the evidence gate now also runs when a post has provenance, and acknowledgements cannot waive a block. Posts without provenance (the ten live guides) behave exactly as before.
- **Policy approval** (`POST /:id/approve-by-policy`, new). It requires all of the following:
  - `EDITORIAL_POLICY_PUBLISHING=enabled` (**unset in production = off**);
  - the admin key and the review key;
  - an `ai-assisted` post with provenance;
  - fewer than `EDITORIAL_POLICY_DAILY_LIMIT` (default 3) policy approvals in 24 h;
  - no block, and no human-judgement finding except `unverified-claims`, which the evidence gate settles claim by claim. `near-duplicate` and `links-unpublished-guide` still need a named reviewer.

  It records `reviewedBy = policy:m11b-evidence-gate`. The byline never shows it as a reviewer, so no person is impersonated.
- **Versioning**: every PUT keeps the previous title, text, SEO, review state and provenance as a revision (last 20).
- **Rollback** (`POST /:id/rollback {version}`, review key): the text comes back with the review it had. Approved text stays public, because it is exactly what was approved. AI text whose evidence is past its review date returns as a draft. The current version is kept as a revision.

## Cost control

- **Ledger, per article**: an entry per call (role, model, input and output tokens, searches, USD), plus totals, source fetches, draft attempts and review failures.
- **Prices** (USD per million tokens, input / output): Opus 5.5 at 4 / 20, Sonnet 5.5 at 2 / 10, Haiku 5.5 at 0.10 / 0.50. Web search is $0.01 per search. An unknown model is refused.
- **Default limits**:

  | Limit | Default |
  |---|---|
  | Per article | 3 USD |
  | Research calls | 2 |
  | Source fetches | 12 |
  | Retries per call | 1 |
  | Review loops | 2 |
  | Articles per day | 3 |
  | Concurrent jobs | 1 |

  The CLI env overrides are `EDITORIAL_MAX_ARTICLE_USD` and `EDITORIAL_MAX_DAILY`. The run that crosses the budget is recorded and the job is held.
- **Estimate**: one article is about four Opus calls. With research at roughly 30k tokens in / 6k out plus 5 searches, and the other three calls at roughly 15k / 3k each, that is about **0.66 USD per article** before retries (arithmetic from the price table, not a measured run).
- **Research loops**: there are no unrestricted ones. Maintenance re-fetches only the sources of due articles and uses no model.

## Tests

| Suite | Cases | Covers |
|---|---:|---|
| `EditorialEvidence.test.ts` | 15 | provenance, fabricated quotes and sources, invented figures, URL-derived trust, corroboration independence, contradictions, every gate, freshness, maintenance diff, cost ledger |
| `EditorialAgentPipeline.test.ts` | 10 | end-to-end with a scripted model and an offline web; missing evidence; conflicts; writer feedback; critic hold; bounded loops; cheap-model SEO fix; broken links; duplication; budget and fetch limits; idempotence; daily and concurrency caps |
| `AnthropicEditorialModel.test.ts` | 3 | structured outputs; web tools; `pause_turn`; refusal and truncation |
| `BlogController.editorial.mongo.test.ts` | 1 flow | on a throwaway database: persistence; policy switch off and on; byline; edit → revision → gate failure; human path also gated; rollback; critic rejection on both paths; near-identical; legacy posts refused; daily cap |

Local run: backend 705 pass / 1 fail / 1 skip. The failure is `content-certify.cli` "private key is owner-only", a POSIX file-mode assertion that cannot hold on Windows; that code is untouched. CI on Linux is the authority.

<!-- batch, review, CI and release sections are appended below -->
