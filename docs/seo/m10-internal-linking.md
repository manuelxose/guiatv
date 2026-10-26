# M10 — Internal linking and crawl architecture

Written for: the owner and whoever runs M11. M09's canonical ownership ([m09-canonical-ownership.md](m09-canonical-ownership.md)) and indexation rules are **unchanged**: no canonical, robots, sitemap, flag, or redirect policy was touched. Measurements are bounded samples of production taken with public GETs only.

## 1. Measurement method

`scripts/seo-link-graph.mjs` crawls breadth-first from `/` over raw SSR HTML (no JavaScript), so the recorded depth is the true minimum click depth.
- It fetched 1,200 pages, which includes **every page at depth 0–2** (1 + 81 + 936) and 182 pages at depth 3.
- It discovered 8,402 URLs in total.
- `--sitemap-check` compares the crawl with the 782 sitemap URLs.

"Not reached" means *no link from any page at depth ≤ 2*. It does not mean "linked from nowhere on the site".

```
node scripts/seo-link-graph.mjs https://guiaprogramaciontv.com --max 1200 --out before.json
node scripts/seo-link-graph.mjs https://guiaprogramaciontv.com --sitemap-check before.json
node scripts/seo-link-graph.mjs --compare before.json after.json
```

## 2. Link graph before M10 (2026-10-26, release `20261026145804`)

| Metric | Value |
|---|---|
| URLs discovered (depth ≤ 3) | 8,402 |
| … of which `/contenido/program:*` (`noindex`, keyed by airing ID, gone after one day) | **7,648 (91 %)** |
| Sitemap URLs reached within depth 3 | 89 of 782 |
| `/programas/` sitemap URLs reached | **0 of 664** |
| Canonical channel URLs not reached (linked only under an alias) | 29 |
| Links to non-canonical channel aliases | 16 targets (`/canales/dmax` → canonical `/canales/discovery`, `movistar-*` → `m-*`) |
| Programme → work links / work → programme links | 0 / 0 |
| Broken targets | 3: `/series/sin-titulo`, `/series/2020-britains-…`, Cloudflare `/cdn-cgi/l/email-protection` |
| Redirecting link targets | 4: `/guias/categoria/rankings`, `/deportes`, `/deportes/futbol/en-directo`, `/v2/docs` |
| Redirect chains | 1: **`/v2/docs` ↔ `/v2/docs/` loops forever** (nginx strips the slash, serve-static adds it back) |
| Empty or generic anchors | 0 / 0 |
| Parameterised link targets | 507 (platform filters, `/v2/affiliate/go/*`) |

Raw data: `artifacts/m10/link-graph-before.json`.

## 3. Linking policy (relationship hierarchy)

The rule: a link is rendered only when the destination is proven to resolve to the **same entity**. Otherwise the existing, safe target stays. A link never depends on title similarity.

| From | To | Condition | Anchor |
|---|---|---|---|
| Guide or channel card (Cine/Series airing) | `/peliculas|/series/:slug` | `program.workPath` (§4) | the card title |
| Guide or channel card (anything else) | the airing's `/contenido/program:<id>` (`noindex, follow`) | always (unchanged) | the card title |
| Programme page `/programas/:slug` | its work page | `workPath` | "Ficha completa de la película / de la serie" |
| Work page | its broadcast page `/programas/:slug` | `programmePath`: the page's own lookup resolves to a visible airing with the same TMDB id **and kind** | "Horarios de {título} en televisión" |
| Any channel mention | `/canales/{normalizedName}` | always | channel name |
| Editorial and hub lists | the final URL, never a known 301 | — | — |

**The 563 programme ↔ work twins (M09):** each is linked once in each direction, with intent-specific anchors. The programme page answers *when is it on TV*; the work page answers *what is it*. Both keep their self-canonical and robots. No twin is redirected or consolidated: that remains the M09 owner decision.

**Not linked, deliberately: programme-only airings → `/programas/:slug`.** Those pages are always-indexable but mostly absent from the sitemap. Linking every card to them would expose thousands of thin pages, which is in effect an indexation change. That decision belongs to M11-A/M11-B.

## 4. Identity rules for `workPath` (`VerifiedWorkLinks`, build time)

Every check must pass. Each failure is counted under its reason in the build log (`Verified work links`).

1. The editorial category is Cine (expects a `movie` row) or Series (expects a `tv` row). → otherwise `not_cine_or_series`
2. The airing carries a `mediaId`. A match from the M03 linker alone is never enough. → `no_media_id`
3. The M03 linker accepts that `mediaId` as `ALREADY_LINKED`: the row exists, is valid, has this TMDB id, and has the expected kind. → `media_id_rejected` (cross-type, conflicting)
4. The programme title key equals the row's title or original-title key. → `title_key_mismatch`
5. No other title in the build carries this TMDB id. → `tmdb_id_shared_by_other_titles`
6. The work slug, read through the detail page's own local lookup (same repository, same key, same validity filter), resolves to this TMDB id and to no other. → `slug_unresolved` / `slug_ambiguous`

Reads are batched and read-only, and the check fails closed. Shortcut: the proof holds for the catalogue as read at build time. A namesake row added later can change what the slug resolves to until the next 6-hourly rebuild.

## 5. Crawl fixes shipped

- Channel links use the canonical slug the page declares.
- The rankings category links `/guias/rankings` directly.
- The HTML sitemap page links `/deportes/futbol`.
- `/v2/docs` answers 200 without the trailing slash; a `<base>` tag keeps its assets resolving.
- A title with no slug characters renders a card with no link, instead of `/series/sin-titulo`.

Residual, not fixed:
- `/series/2020-britains-…`: the page's TMDB search fallback can't be predicted from the client.
- `/deportes/futbol/en-directo`: the link sits inside CMS editorial HTML (M11-A).
- `/cdn-cgi/l/email-protection`: Cloudflare email obfuscation.

## 6. Release and after-measurement (2026-10-26)

- **Release:** PRs #79/#80/#81 merged as `25853be`/`91feaa4`/`6288900`. CI on `main` was green, including `ssr-resilience` on push, which now runs there for the first time.
- **Deploy:** [artifact run 40372256365](https://github.com/manuelxose/guiatv/actions/runs/40372256365) → release **`20261026185109`**; `release.json` `gitSha` is `6288900`.
- **Services:** API and SSR active, 0 restarts.
- **Health:** healthy; 0 API server errors; legacy enrichment and the catalogue linker both `off`.
- **Rollback target:** `20261026145804`, kept and not needed.

**Parity** (`artifacts/m10/surface-{before,after}.tsv`, 17 URLs):
- Status, canonical, meta robots and `X-Robots-Tag` are identical except `/v2/docs`, which went 301 → **200** (the loop fix).
- `/peliculas/gladiator` is still `noindex, follow`; the airing-dependent rule is untouched.
- The programme sitemap went 664 → 700 URLs, which is evening-EPG growth (M09 guard unchanged).

**Link graph** (same bound: 1,200 pages, depth ≤ 2 complete; `artifacts/m10/link-graph-after.json`, taken about 15 minutes after the release):

| Metric | Before | After |
|---|---|---|
| Redirect chains | 1 (`/v2/docs` loop) | **0** |
| Redirecting link targets / link instances | 4 / 11 | **2 / 3** (both inside CMS editorial HTML) |
| Links to non-canonical URLs | 16 targets | **1** (`/canales/movistar-laliga`) |
| Broken targets / link instances | 3 / 11 | **2 / 8** (`/series/2020-britains-…`; Cloudflare `/cdn-cgi`) |
| `/programas/` pages reachable within depth 3 | **0** | **6** (via "Horarios de … en televisión") |
| Work → programme links | 0 | 6 |
| `noindex` targets linked | 776 | 740 |
| `/contenido/program:*` URLs discovered | 7,648 | 7,631 |

**Not yet measurable: the card switch to verified work pages.**
- `program.workPath` is computed when the read model is built. The last precompute before the release ran at 18:15 Madrid time, so cards still point at `/contenido` until the **00:15 Madrid rebuild**.
- Re-measure after that rebuild with `node scripts/seo-link-graph.mjs … --out link-graph-rebuilt.json` and `--compare`.
- The API build log line `Verified work links` gives the linked count and the count rejected per reason.

**Unsafe relationships rejected:** counted per build and logged under `Verified work links`. No production count exists yet, for the same reason (first rebuild at 00:15). The rules and their tests are in §4.

**Residuals:**
- **`/canales/movistar-laliga` vs canonical `/canales/m-laliga-uhd`.** The builder falls back to a source-derived `normalizedName` when a channel has no stored document (`TvReadModelBuilder`); this should be fixed in the builder.
- **Two editorial links that redirect.** These are in CMS editorial HTML (M11-A).
- **`/series/2020-britains-…`.** Slug fallback via TMDB search, which the client cannot predict.
- **Cloudflare `/cdn-cgi/l/email-protection`.**

**Acceptance against the roadmap ("no orphaned indexable detail pages"):** not met. 694 sitemap programme URLs are still outside depth 3. Twin programme pages become reachable only from their work pages, and programme-only pages are deliberately left unlinked pending an M11 decision.

## 7. Follow-up release, rebuild and final measurement (2026-10-26, owner-authorised)

**Football hotfix** ([#83](https://github.com/manuelxose/guiatv/pull/83), `8eaf099`):
- The `/canales/movistar-laliga` link came from the football "Dónde verlo" list, not from the TV builder. It now uses the airing's canonical `channel.normalizedName`.
- Deployed via [artifact run 40379443538](https://github.com/manuelxose/guiatv/actions/runs/40379443538) as release **`20261026194014`**. API and SSR active, 0 restarts, health healthy.

**Read-model rebuild:** one owner-authorised precompute run, using the same CLI as the schedule (`node dist/jobs/cli/precomputeSchedules.cli.js` with the API `EnvironmentFile`, `nice 10`). It rebuilt 4 dates in about 6 minutes, with 0 errors and a log at `/var/tmp/m10-precompute.log` on the host. `Verified work links` per date (25 / 26 / 27 / 28 Oct):

| Reason | Count |
|---|---|
| **linked** | 267 / 495 / 489 / 408 = **1,659** |
| `title_key_mismatch` (rejected) | 284 |
| `slug_ambiguous` (rejected; a homonym resolves the slug) | 46 |
| `tmdb_id_shared_by_other_titles` (rejected) | 16 |
| `slug_unresolved` (rejected) | 10 |
| `media_id_rejected` (cross-type or conflicting) | 0 |
| `no_media_id` (Cine/Series without a stored link; never derived) | 4,389 |
| `not_cine_or_series` | 33,773 |
| read errors | 0 |

So 82 % of Cine/Series airings with a stored identity (1,659 of 2,015) now link their work page, and 356 are rejected on identity evidence.

**Final crawl** (same bound; `artifacts/m10/link-graph-rebuilt.json`):

| Metric | Before | After release | After rebuild |
|---|---|---|---|
| Programme → work / work → programme links | 0 / 0 | 32 / 6 | **84 / 39** |
| `/programas/` pages reachable (depth ≤ 4) | 0 | 6 | **39** |
| `/peliculas` + `/series` pages discovered | 108 | 88 | **279** |
| `/contenido/program:*` discovered | 7,648 | 7,631 | **7,167** |
| `noindex` targets linked | 776 | 740 | **686** |
| Links to non-canonical channel URLs | 16 | 1 | **0** |
| Redirect chains / redirected link instances | 1 / 11 | 0 / 3 | **0 / 3** |
| Broken targets | 3 | 2 | 3 → fixed in [#84](https://github.com/manuelxose/guiatv/pull/84) (`/series/sin-titulo` via `catalog-card`) |

**Remaining residuals:**
- `/series/2020-britains-…`: TMDB-search slug, not predictable from the client.
- Cloudflare `/cdn-cgi/l/email-protection`.
- Two redirect links inside CMS editorial HTML (M11-A).
- One football link uses the pre-2026-10-20 UTC-dated match slug, which resolves and declares the current slug canonical. This is pre-existing and belongs to football slug hygiene.
- 664 sitemap programme URLs are still beyond depth 3. This is the deliberate M11 decision on programme-only pages.
