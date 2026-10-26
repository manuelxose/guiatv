# M11-A — content quality and AdSense remediation

Implementation and measurement: **2026-10-26** (Europe/Madrid). Baseline `main@6a441d2` = `origin/main`, clean checkout, live release `20261026202919` (M10). Production was read through public GETs only. No production database write, no bulk publication or unpublication, and no change to indexation, canonical or robots policy is part of M11-A.

## Reconciled state (differs from the historical baseline)

- **Public editorial corpus is 10 guides, not 50.** All are `ai-assisted`, published 2026-10-19/20 from `docs/seo/editorial-drafts` and approved by Arturo Baroja. The 2026-10-19 counts in `docs/seo/03-ADSENSE-READINESS.md` (50 posts, 33 blocking) describe the retired archive.
- **The two M10 "CMS links that redirect"** are 3 link instances in 2 rendered guides. In the raw API there are 18 instances in 9 guides; the frontend already rewrote `/editorial/`, which hid the rest.
- **Programme sitemap: 703 URLs**, not 664. All return 200, `index` and self-canonical. 664 of them were not reached in the bounded M10 crawl.

## Workstreams

| Agent | Scope | Output |
|---|---|---|
| A — editorial quality | 10 live guides, claims vs sources, ranking-cluster duplication, 51 retired slugs, trust pages | [m11a-editorial-review.md](../seo/m11a-editorial-review.md) |
| B — technical SEO | treatment of every sitemap programme URL | [m11a-programme-pages.md](../seo/m11a-programme-pages.md), `scripts/programme-page-quality.mjs`, `artifacts/m11a/programme-pages.json` |
| C/D — integrator | CMS gate, serve-time link canonicalization, EPG filler, `/guias` H1, CTA accessible name | PRs #86, #87, this PR |
| E — independent review | #86: 1 high, 2 medium, 7 low, all fixed, then re-reviewed (no critical/high). #87: every changed claim checked against its live source; 0 critical/high, 2 medium fixed | review notes in the PRs |

## Content quality (reproducible: `scripts/editorial-audit.mjs`, `scripts/programme-page-quality.mjs`)

**Editorial guides (10)**

| Class | Count | Evidence |
|---|---:|---|
| Strong original | 2 | 03 prices; 04 plan choice (its own annual-cost table, maths re-checked) |
| Useful but incomplete | 3 | 01 Champions, 02 LaLiga, 05 Movistar vs DAZN: omissions, no wrong claim |
| Templated / near-duplicate | 5 | 06–10 platform rankings: about 71 % of prose identical after swapping the platform name; 4-gram Jaccard 0.36–0.48 |
| Time-bound (needs scheduled review) | 9 | rankings and prices monthly; 01/02/05 expire with 2026-27 |
| Contradicted claims | 0 of 12 checked | 10 verified, 2 press-only (labelled as press in the text) |
| Broken or redirected internal links | 9 (API) / 2 (rendered) | fixed by #86 at serve time |
| Thin (< 250 words) | 0 | |

**Retired archive (51 slugs):** under `/guias/`, 37 → 301 (each to the new guide for its intent) and 14 → 404. Under `/editorial/`, all 51 → 301, so the 14 dead ones redirect into a 404. 9 of the 14 were proposed for merge or 301 in the 2026-10-19 consolidation map and are lost. None is in `sitemap-blog.xml`.

**Programme pages (703 sitemap URLs, 19:47 UTC snapshot)**

| Treatment | URLs | Meaning |
|---|---:|---|
| A keep as standalone | 50 | upcoming schedule + distinctive synopsis; 22 programme-only, 28 single-URL TMDB works |
| B keep for navigation, not an organic priority | 45 | no upcoming airing, placeholder/short or duplicated synopsis, recurring slot |
| C contextual link where it helps navigation | 157 | the work page links the programme (144) or the reverse (13); identity proven by the same TMDB id |
| D canonical/indexation policy review | 451 | same TMDB work also indexable at `/peliculas|/series` (282 linked both ways, 169 not linked) |
| E serving defect | 0 | |

- Duplicate risk: 608 of 703 have an indexable same-TMDB-id twin (72 of them at a different slug, which M09 could not see). 84 share an exact synopsis (23 groups). Near-duplicate synopses were not measured.
- Not done on purpose: no mass noindex, redirect or link block. C is not implemented here because the 144 missing `workPath` links are airings the M10 identity gate rejected. Loosening that gate to add links would be link inflation on unproven evidence.

**Category pages:** the 6 single-post categories are already `noindex, follow` and out of the sitemap; `streaming` and `futbol` (5 and 3 posts) are indexable.

## Fixes

- **#86 CMS safeguards.** `evaluateEditorialQuality` grades approval findings:
  - `block`: placeholder title, invalid FAQ (FAQPage), link to a nonexistent or retired guide, near-identical content (≥ 0.8).
  - `human`: unverified claims in assisted content, near-duplicate of a public post (≥ 0.35), link to a guide not yet public. The named reviewer must acknowledge each code.
  - `warn`: truncated metadata, month+year title, no internal links.

  Existing guards stay: duplicate slug (`assertUniqueSlug`), empty or thin body, author, SEO metadata, markdown, sources for non-human origin, entertainment relevance, accountable reviewer. Internal links that hit a 301 are rewritten to their destination when served and when saved. A drift test reads the Angular and SSR redirect tables. `editorial-publish.mjs` refuses to start without the acknowledgements, so a republish cannot leave a live guide as a draft, and takes the "verificado el" date per guide (`verifiedOn`). `editorial-audit.mjs` resolves every internal link (3xx/4xx = blocking).
- **#87 content.**
  - Drafts link canonical routes.
  - Source-backed corrections: Movistar Plus+ 9,99 € plan contents (02, 05, 01), the UEFA date, the "cheapest with ads" scope, JustWatch attribution as TMDB's terms require (06–10). Each is checked again by the reviewer against its live source.
  - Unconfirmed items were not added.
  - Accessibility: `/guias` H1 text "Guíasde" → "Guías de"; affiliate CTA accessible name "Ir a Max de Max" → "Ir a Max".
- **This PR.**
  - EPG filler synopses ("sin descripción.", "Programación Alacantí TV.") are hidden, and genre-list prefixes such as "(Documental,Otros) …" are stripped, when descriptions are displayed: programme detail read paths (at deploy) and read-model card fields (after the next precompute). Stored descriptions stay raw because category inference reads the prefix (PR #88 review). Measured on the live run: 6 placeholder and 42 prefixed programme pages.
  - Programme-page classifier; `classify()` moved to `scripts/seo-ownership-classify.mjs` so both audits share it.

## AdSense readiness (internal assessment; no application submitted, approval is never guaranteed)

| Type | Finding |
|---|---|
| Technical compliance, OK | sitemap URLs 200/index/self-canonical; named editor, AI disclosure and editorial policy public; the `/avisolegal` AdSense drafting note (T11) is gone. Ad placement gating was not re-audited (no ads are active, per 03-ADSENSE-READINESS) |
| Technical, fixed | redirected editorial links; EPG filler on indexable pages; H1/CTA text |
| Editorial quality | the 5 platform rankings are one template (about 71 % shared prose, 65 distinct titles in 100 slots); 10 guides is a small original corpus; 9 of 10 need dated maintenance |
| Content gaps | no first-hand reviews or commentary; programme pages are derived (EPG + TMDB) with 608 indexable twins |
| Unverified concerns | `/sobre-nosotros` claims ("de referencia en España", reviews, anime, personalised recommendations) not backed by the current site; `/avisolegal` address without a postal code, TecnoRia described two ways, jurisdiction clause (legal review); `/politica-editorial` "archivo en revisión" sentence is stale; Disney+/Prime/Apple TV prices not checkable without a browser |

**Verdict: NOT READY to request review** (unchanged from 03-ADSENSE-READINESS), now for editorial-depth reasons rather than technical ones.

## Remaining decisions (not engineering defects)

Owner / editor:
1. Republish the corrected drafts: `scripts/editorial-publish.mjs --reviewer "<name>" --acknowledge unverified-claims,near-duplicate`, after #86 is deployed. This is a production write.
2. Ranking cluster: merge into one page or give each platform specific, human-written value.
3. 9 lost retired URLs (free sport ×2, La Vuelta ×2, estrenos ×5): 301 to a live page, or 410.
4. Programme D group (451): `/programas/` ↔ `/peliculas|/series` canonical policy (M09 question, still open).
5. 127 programme slugs drop accented letters (`/programas/el-ltimo-sol`): needs a slug change with a 301 plan. 71 episode-level sitemap URLs (29 titled "Episodio N"): needs a sitemap policy decision.
6. Trust pages: `/sobre-nosotros` claims, `/avisolegal` legal points, the stale archive sentence in `/politica-editorial`, brand-name consistency.

Engineering follow-ups:
- `/editorial/<retired>` should answer 404/410 directly instead of 301 → 404.
- Stored `seo.canonicalUrl` values are `/editorial/<slug>` (the rendered canonical is correct: `/guias/<slug>`).
- Exact-duplicate synopses between different works (e.g. `scream-2`/`scream-3`) come from the EPG feed.
