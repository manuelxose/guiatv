# M11-A — Programme page quality (`/programas/:slug`)

Written for the owner. Everything below was measured on production on **2026-10-26 at 19:47 UTC**, using public GETs only. The run fetched sitemap-programs.xml, every page in it, and the public catalogue API. Treatments are **recommendations, not actions**. Nothing was changed in production.

- Script: `scripts/programme-page-quality.mjs` (`--self-check` passes)
- Output: `artifacts/m11a/programme-pages.json` (one row per URL, plus thresholds and the regex)

## 1. Method

For every `<loc>` in `sitemap-programs.xml` the script records:

| Signal | Source |
|---|---|
| status, meta robots + `X-Robots-Tag`, canonical | SSR HTML of `/programas/:slug` (`redirect: manual`) |
| ownership class | M09 `classify()`, loaded from `seo-ownership-audit.mjs` (the same code, not a copy). **Extended:** when the programme's verified `workPath` points at a *different* slug, that twin is fetched too. M09 could not see these twins. |
| upcoming airings / channels | `/v2/catalog/slug/program/:slug` → `airings[]` with `end` > run time (the API window is today + tomorrow) |
| description presence, words, duplication | API `synopsis`. A synopsis is a duplicate when its exact text (trimmed, case-folded) appears on another sitemap programme. |
| link state | programme → work: the API returns `workPath` and the twin has the same TMDB id. Work → programme: the twin's `programmePath` equals this URL. |
| crawl depth / inlinks | `artifacts/m10/link-graph-rebuilt.json` (crawl taken at 19:02 UTC, bounded to 1,200 pages) |

Requests are bounded to at most 5 GETs per URL. They are paced at 260 ms (about 230 per minute), 429 responses are retried after `Retry-After`, and a 5xx is retried twice.

**Treatment rules.** The first matching rule wins (`treat()`):

1. **E (engineering defect)**: the page is not a 200, serves `noindex`, or is not self-canonical.
2. Duplicate-indexable twin, linked in one direction only → **C**: add the missing reverse link. It is identity-proven and M10 §3 policy already intends it.
3. Duplicate-indexable twin, linked both ways or not linked at all → **D**: canonical/indexation policy review (M09 §6).
4. No upcoming airing → **B**.
5. Generic slot title (regex, only without a TMDB id) → **B**.
6. Recurring: no TMDB id and at least 4 airings in the window → **B**.
7. Description under 20 words → **B**.
8. Description identical to another programme's → **B**.
9. Otherwise → **A**.

## 2. Results (703 sitemap URLs)

| Treatment | URLs | Breakdown |
|---|---|---|
| **A** keep as standalone detail | **50** | 22 programme-only, 28 TMDB work with a single URL |
| **B** keep for navigation, not an organic priority | **45** | 35 no upcoming airing, 7 short or placeholder description, 2 recurring, 1 duplicated description |
| **C** contextual link where it improves navigation | **157** | 144: the work page links here, but this page does not link its work. 13: the reverse. |
| **D** canonical/indexation policy review | **451** | 282 linked both ways, 169 same TMDB id but not linked by the site |
| **E** engineering defect (status/robots/canonical) | **0** | every URL returned 200, `index`, and a self-canonical |

Signals:

| Signal | Count |
|---|---|
| Ownership: duplicate-indexable twin | 608 (72 found only through a `workPath` at a different slug) |
| Ownership: TMDB work with a single URL | 46 |
| Ownership: programme-only | 48 |
| Ownership: twin noindex | 1 |
| No upcoming airing at run time | 295 (42 %) |
| No description / under 20 words | 2 / 39 |
| Description identical to another programme | 84 URLs in 23 groups |
| Generic slot title | 2 |
| Programme links its work | 295 |
| Work links back | 426 |
| Crawl depth in the M10 graph: 2 / 3 / 4 / not reached | 3 / 27 / 9 / **664** |

The 664 URLs that were not reached split into 50 A, 45 B, 154 C and 415 D (the remaining 36 D and 3 C were reached).

## 3. Examples (10 per treatment; every ~n-th row in slug order)

Columns: upcoming/total airings · channel · description words · links (programme→work, work→programme) · depth.

**A**: `abuelo-made-in-spain` 1/1 Movistar Cine Español, 93 words · `cmicos-nuestros` 1/2 Somos, 75 · `desmontando-la-ciudad` 2/2 Odisea, 79 · `el-nuevo-barrio` 1/1 Aragón TV, 31 · `furia` 1/1 XTRM, 53 · `la-brecha` 1/1 XTRM, 79 · `la-revuelta` 1/1 TVE Internacional, 49 · `manolito-gafotas` 1/1 Movistar Cine Español, 32 · `pearl` 1/1 DARK, 32 · `soldado` 1/1 XTRM, 82. None has a twin, all have 0 inlinks, and none was reached.

**B**:
- `2-fast-2-furious-a-todo-gas-2`: synopsis identical to `fast-furious-5-a-todo-gas-5`
- `as-se-hizo-la-tierra`, `com-si-fos-ahir`, `dragon-ball-super`, `el-secreto`, `la-momia`, `los-misterios-de-laura`: 0 upcoming airings
- `deportes`: 10 words
- `killer`: 5 airings, no TMDB id
- `mujeres-al-borde-de-un-ataque-de-nervios`: synopsis is the literal "sin descripción."

**C**, all "programme does not link its twin" (L01): `57-segundos` (AMC), `blindspot` (Veo7, 6 airings), `de-que-te-quiero-te-quiero`, `el-silencio-de-los-corderos`, `fragments` (TV5MONDE), `la-huella-del-crimen`, `los-mosqueteros` (BBC Series), `muy-lejos` (M+ Drama), `school-for-scoundrels`, `star-trek-strange-new-worlds`. The work page links here via `programmePath`, but the programme API returns no `workPath`. The M10 per-airing gate (§4: title key, `mediaId`, homonym checks) rejected these airings, while the work-side lookup accepted the pair. The reverse link is identity-proven by the same TMDB id.

**D**:
- Linked both ways (L11): `2001-una-odisea-del-espacio`, `bright-minds` (depth 4), `depredador-alpha`, `elementary`, `fbi-internacional`, `la-guerra-de-los-mundos` (depth 4)
- Same TMDB id but no link either way (L00): `los-thunderman-infiltrados-t1`, `pampa-ilusin`, `scream-3`, `the-real-csi-miami`

## 4. Engineering defects found (data/slug, not indexation policy)

None of these is a status, robots, or canonical defect: every sitemap URL is a 200, indexable, self-canonical page. They are content and slug defects on indexable pages.

1. **Accented letters are dropped from programme slugs instead of transliterated.** 127 URLs are affected, for example `/programas/el-ltimo-sol` (title "El último sol"), whose work page is `/peliculas/el-ultimo-sol`. Other examples: `aqu-no-hay-quien-viva`, `ley-y-orden-unidad-de-vctimas-especiales`, `asalto-a-la-comisara-del-distrito-13`. The work slugs transliterate correctly. This is also why 72 twins sit at a *different* slug and M09 could not see them. A slug change means URL changes, so a fix needs a 301 plan and is not a quick patch.
2. **Placeholder text served as the synopsis and meta description of indexable pages.**
   - "sin descripción.": `creadoras`, `la-marrana`, `mujeres-al-borde-de-un-ataque-de-nervios`, `una-chica-para-dos` (confirmed in the `<meta name="description">` of `/programas/creadoras`)
   - "Programación Alacantí TV.": `el-escenario`, `mundo-natural`
3. **Episode-level programme URLs with the series synopsis.** 71 sitemap slugs carry `-tN-eN` / `episodio-N`, and 29 titles are just "Episodio N". For example, `/programas/episodio-800` … `episodio-814` (RTVE Promesa) are 15 indexable pages titled "Episodio 80x" with one identical synopsis about bear cubs. Further examples: `fallen-t01-e01` … (8 slugs, one synopsis, two slug spellings `t01-e07`/`t1-e7`) and `escuela-de-enfermera-t7-e1…e4`.
4. **Wrong synopsis on a different work:** `scream-2`/`scream-3` and `2-fast-2-furious-a-todo-gas-2`/`fast-furious-5-a-todo-gas-5` share one text each, so at least one of each pair is wrong.
5. **Genre prefix leaked into the synopsis**: "(Documental,Otros) …" on 43 URLs, e.g. `agujeros-negros-superpoderosos`.

## 5. Explicitly NOT recommended

- No mass `noindex`, no mass 301/canonical consolidation of the 608 twins, and no removal of B pages from the sitemap from this data alone. D is a review flag for the existing M09 §6 owner decision.
- No link blocks, footers, or "related programmes" lists added to reach a depth target. The 664 unreached URLs are a consequence of policy (M10 §3), not a defect.
- No channel → programme links for every airing (M10 §3 rejected this). The A list (50) is the only set where such a link would point at distinctive content. It is optional.
- No action keyed on "no upcoming airing" alone: 295 URLs had none at 19:47 UTC only because today's airing had ended. The sitemap window (today + tomorrow) makes this time-of-day dependent.

## 6. Owner/policy vs engineering

| Item | Kind |
|---|---|
| D: which URL owns a twin work (M09 §6), and whether work pages get a stable robots rule | owner/policy |
| B: whether programmes with no TMDB id / short description stay in the sitemap | owner/policy (needs Search Console data) |
| Whether episode-level programme URLs should exist or fold into the series programme | owner/policy, prompted by defect 3 |
| C: render the reverse twin link where the identity is proven | engineering, inside the existing M10 policy |
| Defects 1, 2, 4, 5 (slug transliteration, placeholder synopses, wrong synopses, genre prefix) | engineering/data |

## 7. Not measured

- Google's selected canonical, impressions and clicks (no Search Console).
- Twins with a different TMDB id or no `workPath`.
- Whether a channel page links a programme: by M10 policy it never does, so it was not re-crawled.
- Duplication by near-match (only exact text is compared).
- Results are a single snapshot: the sitemap changes each rebuild (722 URLs in M09, 703 now) and upcoming counts depend on the hour.
