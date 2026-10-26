# M11-A — Editorial quality review of the live guides

Date: 2026-10-26. Scope: the 10 approved posts served at `/guias/<slug>` on https://guiaprogramaciontv.com, their sources in `docs/seo/editorial-drafts/`, the retired 2026 corpus, and three trust pages. Method: public GETs only (≤ 3 req/s), live API content (`/v2/blog?slug=`) and rendered HTML compared word-for-word with the drafts, then spot checks against the official pages each post cites. Nothing here is a rewrite, and the review was done without visiting any service as a subscriber.

Every recommendation carries a tag:
- **(a)** engineering defect (code or data pipeline)
- **(b)** factual correction backed by a cited source
- **(c)** editorial or legal judgment for a human

## 1. Summary

- The live text matches the drafts exactly. The only difference is the AI-disclosure line that the publish script appends. No "Notas para el revisor" text leaked into any post.
- 4 posts are solid: the two price/plan guides and the two football-rights guides. 1 post (Movistar Plus+ vs DAZN) is useful but incomplete. The 5 platform rankings are templated near-duplicates: about 71% of their prose is identical once the platform name is swapped.
- 12 claims were spot-checked: **10 verified, 0 contradicted, 2 press-only (could not verify officially)**. 2 posts leave out what the official Movistar Plus+ page says the 9,99 € plan includes, and 1 post leaves out part of what the official DAZN page says.
- One compliance gap: the ranking posts use TMDB watch-provider data, which TMDB requires to be credited to **JustWatch**. None of the posts carries that credit.
- Retired corpus: of 51 old slugs, **37 redirect with 301 to a relevant page and 14 return 404**. 9 of those 404s had a merge or redirect proposed in the consolidation map. No retired slug appears in `sitemap-blog.xml`.
- The `/avisolegal` note about the AdSense review (03-ADSENSE-READINESS T11) is **gone**. A named editor, an AI-disclosure policy and a contact address for corrections now exist. Weaker points remain: no visible corrections log, out-of-date and unsupported claims on `/sobre-nosotros`, and an incomplete postal address.

## 2. Per-post classification

| # | Post (`/guias/…`) | Label | Evidence |
|---|---|---|---|
| 01 | `donde-ver-champions-league-2026-27-espana` | **Useful but incomplete** | Rights claims are sourced and verified (UEFA lists only Telefónica; the 2027 final is on Sat 5 Jun 2027 at the Metropolitano; RTVE holds the finals). It does not say what the cheapest Movistar Plus+ plan gives a Champions fan. "El precio … está en nuestra guía de precios; consulta el vigente" points elsewhere, yet movistarplus.es/planes says the 9,99 € plan includes "el mejor partido de cada jornada de Champions". The honest section "Lo que no podemos confirmar" is a strength. |
| 02 | `donde-ver-laliga-2026-27-espana` | **Useful but incomplete** | The rights split is sourced to LaLiga and DAZN. "Teledeporte emite un partido semanal en abierto" rests on press only (Qué!) and is marked as such. The 9,99 € plan description leaves out Champions and Premier League (see §3). The DAZN price is honestly marked as unverified. |
| 03 | `precios-plataformas-streaming-espana` | **Strong original (time-bound)** | A dated price table taken from official pages; checked Netflix and HBO Max figures match. One internal inconsistency: "Con anuncios: HBO Max … y Disney+ … son los más baratos", but Prime (4,99 €) also carries ads according to the post's own next bullet. |
| 04 | `netflix-hbo-max-disney-prime-video-que-plan-elegir` | **Strong original** | The only post with its own analysis: a 12-month cost vs annual-plan table (all 9 rows recomputed, arithmetic correct) and "qué elegir según tu caso". It overlaps post 03's price table (same figures), but it answers a different question. |
| 05 | `movistar-plus-vs-dazn` | **Useful but incomplete** | The DAZN price is missing, deliberately and with a stated reason. The Movistar column "Otras ligas: Tenis, Euroliga, pádel…" leaves out the Champions and Premier League match per round. The DAZN column leaves out "Un partido en abierto en todas las jornadas" from DAZN's own page. About 60% of its rights content repeats post 02. |
| 06 | `mejores-series-y-peliculas-netflix-espana` | **Templated / near-duplicate** | See §4. The tables are real data (TMDB, ≥3,000 votes), but there is no editorial commentary on any title. The live byline label "Ranking editorial" oversells a list sorted by TMDB score. |
| 07 | `mejores-series-y-peliculas-prime-video-espana` | **Templated / near-duplicate** | Same template. It includes *Proyecto Salvación* (2026, 8,6), a new release whose TMDB score will move. That score could not be verified. |
| 08 | `mejores-series-y-peliculas-disney-plus-espana` | **Templated / near-duplicate** | Same template. Catalogue presence (e.g. the *El señor de los anillos* trilogy, *El club de la lucha*) comes from TMDB/JustWatch and is unverifiable here. |
| 09 | `mejores-series-y-peliculas-hbo-max-espana` | **Templated / near-duplicate** | Same template. The live CTA box says "Ir a **Max** de **Max**" while the post says the service is now "HBO Max". |
| 10 | `mejores-series-y-peliculas-movistar-plus-espana` | **Templated / near-duplicate** | Same template. Its overlap with HBO Max is the highest (Jaccard 0.48): it shares Chernobyl, Los Soprano, Rick y Morty, Hora de aventuras and From with post 09. |

No post was labelled low-value for being short, and none for being AI-assisted. Posts 03 and 04 are among the shortest and are the most useful. No post contains a claim that a source contradicts. The incomplete claims are omissions.

### Time-bound content ("octubre 2026" titles)

| Post | Really time-bound? | Stale when |
|---|---|---|
| 03 precios | Yes: monthly prices | Any price change. Re-check at least quarterly and on any provider announcement. Keep the month in the title only if the post is re-dated on each refresh. |
| 06–10 rankings | Yes: a catalogue snapshot from 2026-10-20 and moving TMDB votes | Monthly (catalogues rotate). Either refresh monthly or retitle without the month and show "datos del 20 oct 2026" in the body. **(c)** |
| 01 Champions | Season-bound, with no month in the title | After the final on 5 Jun 2027. The text "actualizada el 14 de octubre" for the UEFA page is already outdated (the page now shows 21 Oct 2026, with the same content). |
| 02 / 05 LaLiga | Season-bound | End of 2026-27. From 2027/28 the split changes to 5 + 5 per round. |

## 3. Claims spot-checked (2026-10-26)

| # | Claim (post) | Source checked | Result |
|---|---|---|---|
| 1 | Netflix 8,99 / 14,99 / 21,99 €; extra member 5,99 € with ads / 6,99 € without (03, 04) | https://help.netflix.com/es/node/24926 | **Verified** (the page localises by visitor; the euro figures matched) |
| 2 | HBO Max 6,99 / 10,99 / 15,99 / 44,99 €; annual 69,90 / 109,00 / 159,00 €; Premium 4 devices, 4K; Deportes add-on 5 €/month (03, 04) | https://www.hbomax.com/es/es | **Verified** |
| 3 | Movistar Plus+ Libre plans 4,99 € / 9,99 €, taxes included, no lock-in (02, 03, 05, 10) | https://www.movistarplus.es/planes | **Verified** |
| 4 | 9,99 € plan contents: "un partido de LaLiga … todos los de Hypermotion y deportes como tenis…" (02, 05) | same | **Incomplete**: the page also lists "el mejor partido de cada jornada de Champions y Premier League" |
| 5 | UEFA lists Telefónica as Spain's only broadcaster, with no free-to-air channel (01) | UEFA "Dónde ver la UEFA Champions League" (page updated 21 Oct 2026) | **Verified** ("España: Telefonica") |
| 6 | 2027 final on Saturday 5 June 2027 at the Estadio Metropolitano (01) | UEFA, 2027 final news | **Verified** |
| 7 | RTVE holds the 2025–2027 finals at 2,5 M€ per final (01) | FormulaTV, 15 Dec 2024 | **Verified** (press source: 7,5 M€ for three finals) |
| 8 | From 2027/28, Telefónica and DAZN each get 5 matches per round until 2032 (02, 05) | LaLiga press release, 28 Nov 2025 | **Verified** |
| 9 | Telefónica awarded the domestic lots to 2026/27 (19 Jan 2024) (02, 05) | LaLiga press release, 19 Jan 2024 | **Verified** for date and scope. The "5 per round + 3 full rounds" breakdown was not visible in the extract I read, so that part is unverifiable here. |
| 10 | DAZN Plan Fútbol: 5 matches in 35 of 38 rounds, all of Hypermotion, Premier/Bundesliga/Serie A (05) | DAZN Plan Fútbol news page | **Verified**. The same page also lists "Un partido en abierto en todas las jornadas de LALIGA EA SPORTS", which post 05 leaves out (the page is undated; a reviewer should confirm it applies to 2026-27). |
| 11 | Teledeporte shows one free LaLiga match a week (02) | Qué!, 21 Jul 2026 | **Press only, unverifiable officially**. Qué! does say it; not confirmed on RTVE. DAZN (#10) supports that a free match exists, but not which channel carries it. |
| 12 | Orange TV keeps the Champions and LaLiga (01, 02) | Qué!, 21 Jul 2026 | **Press only.** The post labels it correctly. |

Not verifiable with a plain fetch (JavaScript or cookie walls): Disney+ prices, Amazon Prime 4,99 € / 49,90 €, Apple TV 9,99 €. Each is cited to an official URL. A reviewer should open those pages in a browser.

**Claims without a specific source:**
- Rankings 06–10 cite only `https://www.themoviedb.org/` (the home page), so the list cannot be reproduced. They should state the query: provider, region ES, flatrate, vote_count ≥ 3000, date. **(c)**
- These posts do not credit JustWatch. TMDB's watch-provider documentation states: *"In order to use this data you must attribute the source of the data as JustWatch."* **(a)**, with the source at https://developer.themoviedb.org/reference/movie-watch-providers

## 4. Duplication in the 5-post platform cluster

All five posts follow the same skeleton: Respuesta corta → Cómo se ha hecho esta lista (4 bullets) → series table + "más reciente / más antigua" sentence → film table + the same sentence → Antes de suscribirte → Fuentes → TMDB notice.

| Post | Total words | Verbatim-shared words* | Share of total | Share of prose (excl. tables) |
|---|---:|---:|---:|---:|
| Netflix | 546 | 248 | 45% | 72% |
| Prime Video | 522 | 248 | 48% | 71% |
| Disney+ | 561 | 248 | 44% | 70% |
| HBO Max | 546 | 248 | 45% | 71% |
| Movistar Plus+ | 538 | 248 | 46% | 71% |

\*Identical lines in all five drafts after replacing the platform name with a placeholder.

- **Shared boilerplate (word for word):** the whole "Cómo se ha hecho esta lista" section, "Antes de suscribirte", the Fuentes block and the TMDB notice.
- **Slot-filled template:** the "Respuesta corta" paragraph (top title, score, most-voted title, starting price) and the two "La … más reciente es X; la más antigua, Y" sentences. I checked all ten of these sentences and they are correct.
- **Platform-specific:** only the two 10-row tables. Across the 100 table slots there are 65 distinct titles. *El caballero oscuro* appears in 4 lists. *Cadena perpetua*, *Interstellar*, *El retorno del rey*, *The Office*, *Los originales* and *Rick y Morty* each appear in 3.

Recommendation **(c)**: either merge the five into one page with a selector or one table per platform under a single shared method section, or give each post platform-specific value: originals, what is leaving or arriving, and a few lines of human commentary per pick. This needs a person who has actually watched the titles; do not invent viewing experience. Also drop the byline label "Ranking editorial" or justify it **(a/c)**.

## 5. Retired corpus (51 old slugs, checked 2026-10-26, without following redirects)

The source list is the 52 slugs in `artifacts/seo/editorial-audit-post-deploy.json`, which covers every slug named in `consolidation-map.md` and `03-ADSENSE-READINESS.md`. `movistar-plus-vs-dazn` is live (200) and was rewritten in place, so it is not counted below. Raw rows were kept outside the repo; the counts below are complete.

| Path | 200 | 301 | 404 | 410 |
|---|---:|---:|---:|---:|
| `/guias/<old-slug>` (51) | 0 | 37 | 14 | 0 |
| `/editorial/<old-slug>` (51) | 0 | 51 | 0 | 0 |

- Every old slug under `/editorial/` returns a 301. For the 14 dead ones the 301 goes to `/guias/<same-slug>`, which then returns 404: a redirect into a 404 **(a)**.
- No old slug appears in `sitemap-blog.xml`. That file has 13 entries: the 10 posts, `/guias/rankings` and two category pages.

**Do the new posts receive their intent cluster?** Yes, all of them:

| Intent | Redirects to |
|---|---|
| Champions (2 slugs) | 01 |
| LaLiga (3) | 02 |
| Prices (5) | 03 |
| "Which platform" and versus pages (7) | 04 |
| Platform rankings (11) | the matching 06–10 post |

"Hoy en TV" posts go to the live pages (`/programacion-tv/que-ver-hoy`, `/series`, `/peliculas`, `/deportes/futbol/partidos-hoy`), and the TDT posts go to `/canales`.

**URLs where the map proposed a merge or 301 but which now return 404 (lost assets): 9**

| Slugs | Map's proposal |
|---|---|
| `donde-ver-deporte-gratis-en-tv-en-espana-canales-en-abierto-y-opcion`, `deporte-en-abierto-programacion-de-esport3-y-la-otra-semana-del-25` | Merge, keeping the first as the canonical page; both are gone |
| `donde-ver-la-vuelta-2026-en-tv-y-streaming-canales-horarios-y-opcio`, `como-ver-la-vuelta-2026-en-tv-y-streaming-canales-y-horarios` | Archive or 301 to the `/deportes` hub |
| `mejores-series-de-estreno-en-septiembre-2026-no-te-las-pierdas`, `las-mejores-peliculas-que-llegan-a-las-plataformas-en-septiembre-de-2`, `estrenos-streaming-del-mes`, `estrenos-en-streaming-esta-semana`, `estrenos-de-cine-de-la-semana-que-ver-en-cines` | noindex archive or 301 to an "estrenos" hub, which does not exist |

The other 5 404s match the map's "likely retire": `anoche-conquiste-tebas`, `katy-perry-the-lifetimes-tour-live-from-paris`, `harry-potter-y-la-piedra-filosofal`, `donde-ver-series-espanolas` and `mejores-animes-crunchyroll`.

The map was also not followed in two places, though nothing was lost: the 3 versus pages ("keep") and `canales-de-cine-…` / `canales-infantiles-…` ("keep") now redirect with 301.

Recommendations:
- **(c)** Decide whether the free-sport and Vuelta URLs should redirect to a live sports page. Note that `/deportes` itself now redirects to `/deportes/futbol`.
- **(a)** Return 410 for slugs retired on purpose, and make `/editorial/<retired>` answer 404/410 directly instead of 301 → 404.

## 6. Trust pages (AdSense-relevant)

| Check | `/politica-editorial` | `/sobre-nosotros` | `/avisolegal` |
|---|---|---|---|
| Named accountable editor | ✅ "El editor responsable es Max Nova. Beatriz Olmedo y Arturo Baroja también colaboran…" | ✅ the same names | ➖ names the legal owner "Manuel Xosé Gonzalez Vietez", trade name "TecnoRia" |
| AI-assistance disclosure | ✅ "La inteligencia artificial puede ayudar a preparar borradores. Los textos asistidos deben incluir fuentes externas…" | ❌ none (only a link to the policy) | ➖ n/a |
| Corrections policy | ⚠️ contact only: "Para comunicar un error, envía la URL…". No promise to show a correction note or date on the article. | links to the policy | — |
| Drafting or internal notes | ⚠️ "El archivo está en revisión … Esta política no certifica que todos los artículos anteriores hayan completado esa revisión." This is a work-in-progress note, and outdated now that the archive is retired. | ⚠️ "Desarrollado con Angular 20, Server-Side Rendering para SEO óptimo, … microservicios" (engineering talk on a reader page) | ✅ **The AdSense-review note flagged in T11 is no longer present** (no "AdSense" anywhere in the page) |

Per-post disclosure: every post ends with "Elaborado con asistencia de IA … Revisión editorial: Arturo Baroja", and its byline reads "Revisado por Arturo Baroja".

Other findings:
- **(c)** `/sobre-nosotros` makes claims I could not substantiate:
  - "La guía de TV y streaming de referencia en España"
  - "actualizado al minuto"
  - "Explora el catálogo completo de Netflix…"
  - "Recomendaciones personalizadas … basado en tus gustos, historial y valoraciones"
  - "Artículos, reseñas, rankings y análisis sobre cine, series y anime"

  The site now has 10 guides, no reviews and no anime content. Remove or qualify these claims.
- **(c, legal)** `/avisolegal`:
  - "Domicilio: Travesía de Espiñeiro 1, 55, España" has no postal code or municipality.
  - TecnoRia is a "marca comercial" of an individual here, but `/sobre-nosotros` calls it an "empresa tecnológica española".
  - The jurisdiction clause names Madrid.

  Have someone with legal training review all three points.
- **(c)** The brand name varies across pages: "Guía TV", "Guía Programación TV", "GPTV".
- **(a)** The disclosure line is hard-coded in `scripts/editorial-publish.mjs` as "verificado el 19 de octubre de 2026" on all 10 posts. Six posts (05–10) say in their own body that the data was checked on 20 Oct, so the post contradicts itself. Take the date from each draft's `checked` field.
- **(c, process)** The drafts in the repo still read `status: draft-pending-human-review`, `reviewer: null`, and `editorial-drafts/README.md` still says "Prices are deliberately not stated" (the posts do state prices). The only record of human review is the API approval for "Arturo Baroja". Update the repo record so it matches what was published.

## 7. Corrections backed by a source (exact text)

| Post | Old → new | Tag and source |
|---|---|---|
| 02 | "…e incluye **un partido de LaLiga EA SPORTS por jornada**, todos los de LaLiga Hypermotion y deportes como tenis, Euroliga, pádel, golf, rugby y atletismo." → "…e incluye **el partido Movistar Plus de LaLiga EA SPORTS de cada jornada**, todos los de LaLiga Hypermotion, **el mejor partido de cada jornada de Champions y Premier League** y deportes como tenis, Euroliga, pádel, golf, rugby y atletismo." | (b) movistarplus.es/planes, read 26 Oct 2026 |
| 05 | Table row "Otras ligas", Movistar column: "Tenis, Euroliga, pádel, golf, rugby y atletismo" → "Mejor partido de cada jornada de Champions y Premier League; tenis, Euroliga, pádel, golf, rugby y atletismo" | (b) same |
| 01 | Add after "La final sí se ve en abierto en **RTVE**.": "El plan Libre Cine, Series y Deportes de Movistar Plus+ (9,99 €/mes) incluye el mejor partido de cada jornada de la Champions; el resto de partidos requiere un paquete superior." The second clause is an inference: confirm it on the operator's page before publishing. | (b) movistarplus.es/planes |
| 01 | "(actualizada el 14 de octubre de 2026)" → "(consultada el 26 de octubre de 2026)" | (b) the UEFA page now shows 21 Oct 2026 |
| 05 | Add to the DAZN column or text: "Un partido en abierto en todas las jornadas de LaLiga EA Sports" — only after confirming it applies to 2026-27 | (b) DAZN Plan Fútbol page (undated) |
| 03 | "**Con anuncios:** HBO Max Básico con anuncios (6,99 €) y Disney+ … son los más baratos" → "**Con anuncios, entre Netflix, HBO Max y Disney+:** HBO Max Básico con anuncios (6,99 €) y Disney+ Estándar con anuncios (6,99 €…) son los más baratos" | (b) the post's own table, plus the Prime Video help page (Prime includes ads) |
| 06–10 | Add next to the TMDB notice: "Datos de disponibilidad por plataforma: JustWatch (vía TMDB)." | (a)/(b) TMDB watch-provider documentation |
| 09 (UI) | CTA "Ir a Max de Max" → "Ir a HBO Max" | (a) hbomax.com/es/es brands the service "HBO Max" |
| all | Disclosure date "verificado el 19 de octubre de 2026" → the draft's `checked` date (20 Oct for 05–10) | (a) |

Not verified in this review, and still open: Disney+, Prime and Apple TV prices; Teledeporte as the free-to-air LaLiga channel; per-title catalogue presence in 06–10; TMDB scores. Each needs a person with browser access or a subscription.
