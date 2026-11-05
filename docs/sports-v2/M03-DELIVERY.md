# M03 Delivery: Real data, live football, search, personalisation and TV integration

Branch: `feat/sports-v2-m02-football-experience` (M03 work is uncommitted on top of M02). Preview: `/laboratorio/futbol/**` (noindex). Production `/deportes/futbol/**` is untouched (verified 200, indexed, unchanged). M04 not started.

## Verdict: PASS for the core flows on real data, with the limits below stated, not hidden

The preview now runs on the existing football BFF (`/v2/sports/football/*`), not on demo data. Home, live, fixtures, competition, team, standings, Match Center, news/article, search and follows were rendered by the production SSR build against the **real production API** (read-only). Nothing fictional can reach production: the demo adapter is only provided by tests.

Two things stop this from being "ready to cut over", both outside what M03 may do:

1. **The backend change must deploy first.** The new 9-day fixtures window needs `dateFrom`/`dateTo` on `GET /sports/football/matches` (one small controller change, validated, tested). Production does not have it yet: today the same request returns only *today's* fixtures (3 matches at probe time). The frontend degrades to that gracefully, so nothing breaks, but the preview shows only today until the backend ships. The 9-day range itself has **not** been exercised against the real provider (see Not verified).
2. **football-data.org free tier cannot supply** live minute, events, statistics, lineups, venues. The UI is functional without them and says so.

## Provider capability matrix (measured 2026-11-05, `evidence/m03/provider-probe.json`)

| Data | Source | Available? | What the UI does |
|---|---|---|---|
| Fixtures, kickoff (UTC instant) | football-data.org via BFF | Yes, any day (`?date=`, now also `dateFrom/dateTo`) | Window -4..+5 days preloaded; other days fetched on demand |
| Status (scheduled/live/finished/postponed) | football-data.org | Yes. `halftime` shown as live; `suspended`/`cancelled` shown as "Aplazado" (no v2 state yet) | Mapped, unknown values never become "live" |
| Score | football-data.org | Yes for live/finished; null otherwise | Never rendered as 0-0 when null |
| **Live minute** | football-data.org | **No** (0 of matches carry one) | Label "En vivo", no clock |
| Freshness | BFF cache: live 8 s fresh/45 s stale; today 45 s; fixtures 10 min | Polled, **not real time** | "Última actualización: HH:MM" and a "puede ir con retraso" note |
| Competitions | football-data.org (13 on this plan) | Yes | List, kind mapped (league/cup/international) |
| Standings | football-data.org | Yes for 4 of 13 (Brasileirão, Championship, Premier League, LaLiga); empty for the rest | Per-competition lazy fetch; "no tiene clasificación" otherwise |
| Standing zones (promotion/relegation) | none | **No** | Table without zones (never guessed) |
| Teams | derived from fixtures and tables | Name, slug, crest URL. No venue/city/founded | Monogram badge (crest licensing unresolved) |
| **Events, statistics, lineups** | none on this plan | **No** (0 of matches) | Empty states per tab, explicit text |
| Venue | none | No | Not shown |
| Broadcasts | EPG read model reconciled by `BroadcastReconciliationService` | Partial: 1 of 3 matches at probe time, provenance `reconciliation/high` | See "Where to watch" |
| Editorial news | CMS `BlogPost` (published only), via `/news` | 3 guides; **0 carry `sportsRelations`**, 1 has a cover | Listed; team/competition links only from structured tags |
| Team endpoint `/teams/:slug` | provider-derived, cache-dependent | **Unreliable**: 404 for a real team at probe time | Team resolved from fixtures/tables first; never a hard 404 (see SEO) |
| Backend `/search` | provider-derived | Weak (teams only from fixture pool) | Not used; search is client-side over loaded real data + `/news?q=` |

## What was built

**Data (`sports-v2/data/`)** (new code, no legacy frontend imports; isolation check passes, 72 files)
- `http-football-data.ts`: HTTP adapter behind the existing `FootballData` port. `load()` = 3 parallel calls (fixtures window, competitions, news). Fixtures failure = error state; news or competitions failure degrades. If the provider rejects the range it falls back to today's fixtures. Identical concurrent requests share one round trip.
- `football-mapper.ts`: pure mapping with one rule: a field the provider does not supply stays absent. Tested for null scores, missing minute, unknown status, no invented events/stats/lineups, broadcast verification, news relations, HTML to paragraphs, snapshot merging.
- Port gained optional enrichment (`liveUpdates`, `day`, `competition`, `team`, `match`, `searchNews`, `article`); the demo adapter and tests are unaffected.

**Timezone.** Instants stay ISO/UTC. `calendar.ts` formats in a display zone: Madrid on the server and in tests, the visitor's `Intl` zone after hydration (`store.startLive()`); the routed outlet is re-created once if the zone differs, so server and client markup never disagree on first paint. Zone is always stated ("hora de Madrid (CET)" / "tu hora local (Asia/Tokyo, GMT+9)"). Day grouping follows the display zone.

**Live updates: adaptive polling, not SSE/WebSocket.** Decision from measured constraints: the provider is pull-only, rate-limited (~10 req/min), and has no minute or events, so a push channel would add a server connection per tab with nothing new to push. Polling the BFF (which already dedupes and caches per 8 s) is the honest fit.
- `live-poller.ts` (pure cadence + one timer): 30 s while a match is live or within ±20 min of kickoff; 5 min if a match is due within 3 h; no polling otherwise. Exponential backoff to 5 min, stops after 5 consecutive failures (manual "Reintentar"). One in-flight request. Paused while the tab is hidden; one catch-up poll on return (coalesced within 5 s). Timer and listener released on destroy.
- Each poll: `/matches/live`, then settles matches that dropped out of the live list via `/matches/:slug` (max 3), merging in place by slug (no reorder, no reload). Broadcasts are kept when the live payload carries none.
- Stale handling: failed refresh shows "No se pudo actualizar; se muestran los datos de las HH:MM" and keeps last values.
- Server side: dedup/caching/rate-limit protection stays in the BFF (SWR cache, football-data throttle-header handling). Nothing duplicated.

**Favorites and personalisation.** Followed teams, favourite competitions and saved matches persist in `localStorage` (anonymous, SSR-safe, restored after hydration). Home personalises (My teams, upcoming, news). The Live Tracker now also **auto-tracks live matches of followed teams** (dismissable, capped at 3). *Authenticated persistence evaluated, not built:* the account surface in v2 does not exist yet and the brief says login must not be required; the `FollowStorage` port is the seam, an account adapter can sync on login without touching the store.

**Search.** Client-side over loaded real data (teams, competitions, fixtures, news) plus a debounced (300 ms, latest-wins) `/news?q=` for published articles beyond the loaded 30. Ranking: exact > prefix > word-prefix > contains; accent/case-insensitive; grouped; keyboard (arrows/Enter/Esc) from M02. No hit is ever fabricated.

**Header and site-wide search (M03 follow-up).** Sports keeps its full-screen layout and its own header style. The header now carries links to the other Guía TV sections (TV, Qué ver, Plataformas, Fútbol as current, Guías; collapsed into a "Secciones" menu below 1200 px), read from the app's own `portal-navigation.config` (the only legacy file v2 may import, allow-listed in the isolation check; pure data, so the links cannot drift). The search box now searches the whole app like the main one: football results from loaded data plus programmes, films and series from the same `/v2/discovery/search` endpoint (in-app detail paths only, up to 3 in the dropdown, also a section on the search page). Verified against the real API: "hormiguero" returns site results and Enter opens `/peliculas/la-hormiga-y-el-oso-hormiguero`. The legacy site footer is not shown inside the full-screen Sports layout; decide at cutover whether to add it.

**Editorial news.** Only `status: publish` content from the existing CMS endpoint; no second pipeline, publication policy untouched. Article bodies are fetched on demand. **Canonical of every article is the CMS page `/guias/:slug`** (verified 200 + self-canonical + indexable for all 3 current articles), so the v2 article view never competes with it. Dates are the CMS dates. Relations come only from `sportsRelations` (currently untagged, so no team/competition links appear; correct, not inferred from titles).

**Where to watch.** A broadcaster is shown only with evidence: EPG airing, editorial override, or high-confidence reconciliation. Medium/low guesses are dropped in the mapper (tested). Each entry says TV/streaming and its evidence, links only to Guía TV's own channel page (internal paths only; external URLs are rejected), and the kickoff shown is the provider's. When nothing is verified: "Emisión no confirmada ... No mostramos canales por suposición." A legal line states that Guía TV never links or embeds unauthorised streams. No affiliate or ad content is mixed into this block.

**SEO.** Per page: title, description, Open Graph, canonical (without query/tab/day, so views are not duplicate pages), JSON-LD (`SportsEvent` for fixtures without score/venue/broadcast claims, `NewsArticle`, `BreadcrumbList`; `<` escaped). The canonical derives from `SPORTS_V2_BASE`, so it becomes `/deportes/futbol/...` automatically at cutover. Unknown competition/article = real **404 + noindex** (authoritative sources); unknown match/team = 200 + noindex only, because the provider can fail to resolve a real fixture or team outside its window. Not-found pages declare no canonical. Preview stays `noindex, nofollow` and out of the sitemap (checked: `/sitemap.xml` has no `laboratorio` or football entries; non-sports routes untouched). No raw ids appear in any URL or text.

## Tests and measured evidence

- Frontend: full suite **625 passing** (549 at M02); sports-v2 alone **174** (98 at M02): mapper (18), HTTP adapter with mocked responses incl. empty/failed/degraded/range fallback/dedup (11), poller cadence and lifecycle (11), store live refresh/search ranking/site search/tracker/lazy loads (21), site nav (2), calendar zones and DST (4), SEO/404 (8), plus the 50 route-level flows (updated, still passing). ESLint on `sports-v2/**` clean; `npm run check:sports-v2` OK; `npm run build:ssr` passes.
- Backend: `FootballController.test.ts` (date range validation, 3 tests) and the existing `FootballQueryService` suite pass. `EditorialEvidence.ts` shows as modified in the working tree; it is **not** from this work (concurrent change by another process) and was left alone.
- Real-data SSR (production build, real API): 200 on home, fixtures, competitions, news, search, match, competition (table), team, standings, article; content present in server HTML (e.g. Brasileirão fixtures, Flamengo 76 pts, Palmeiras position); canonical correct; unknown competition/article/match/team behave as above. Home HTML 132 KB, warm render ~160 ms.
- Browser verification `scripts/sv2-m03-verify.mjs` (`evidence/m03/verify.json`, screenshots): 15/15 checks pass. Same real match 23:30Z shown as 23:30 for Madrid and 07:30 for Tokyo with the zone stated; with a controlled clock before kickoff: 1 poll in the first 31 s, the match moved to live 1-0 in place; **0 polls in 120 s while hidden**; a failure marks data stale and keeps the score; **4 extra calls in 30 min of continuous failure** (backoff, then stop); keyboard search navigates to `/equipos/se-palmeiras`; a followed team survives reload and personalises the home; no console errors and no hydration errors. One endpoint (`/matches/live`) was mocked in that run because real live matches cannot be summoned; everything else was real.
- Transfer cache: **0** client API calls after SSR on home and standings (data is reused, not refetched).

## Not verified / known limits

- **9-day fixtures range against the real provider.** Needs the backend deployed and (at most) a free-tier check; fallback to today exists. The existing per-day path (`?date=`) is production-proven.
- **No real live match was observed**, so live score updates are verified against a mocked `/matches/live` only; real minute/halftime behaviour is untested.
- Provider-capped data: no minute, events, stats, lineups, zones, venue; `suspended`/`cancelled` read as "Aplazado"; halftime reads "En vivo".
- Only 4 of 13 competitions have tables; only competitions with fixtures in the window show matches. Teams outside both cannot be resolved by direct link (provider limit, soft not-found).
- Broadcast coverage depends on the EPG: 1 of 3 probed matches. Spanish clubs/LaLiga had no fixtures in the probe window, so Spain-specific broadcast verification on real data is **not demonstrated**; mapping logic is unit-tested only.
- News: no tagged relations and no licensed images yet; article body flattens HTML to plain paragraphs (links/headings lost); the canonical article page is the real reading experience.
- Account-backed follows, crests, Playwright runs beyond Chromium, axe/screen-reader pass: not done.
- Cutover (`/deportes/futbol`, sitemap entries, redirects, index/follow) intentionally not performed; see `ROUTES.md`.

## Before M04 / release

1. Deploy the backend controller change; re-run `sv2-m03-verify.mjs` and the provider probe against it.
2. Have editorial tag football articles (`sportsRelations`) so team/competition links and personalised news populate.
3. Decide crest licensing, then replace monograms.
4. Run the cutover checklist in `ROUTES.md` in one release.
