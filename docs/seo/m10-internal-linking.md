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

## 6. After the release

Filled in from the post-release crawl; see §7.
