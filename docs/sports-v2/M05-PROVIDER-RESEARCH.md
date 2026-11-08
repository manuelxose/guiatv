# M05-A — Free provider research and legal eligibility

Verification date: **2026-11-06**. Season observed: **2026/27**.
Two kinds of evidence are kept strictly apart:

- **Verified** = a real HTTP response was captured in this session and saved to
  `docs/sports-v2/m05-research/probe-2026-11-06.json`.
- **Documented** = stated by the provider's own documentation/terms page but *not*
  exercised with a real response in this session.

No provider gets a production PASS on documentation alone.

---

## 1. What was actually probed

Anonymous `curl`, user agent `guiatv-m05-research/1.0 (+https://guiaprogramaciontv.com)`, no credentials,
no accounts created, no paid plan touched.

| Endpoint | HTTP | Real content |
|---|---|---|
| `api.openligadb.de/getmatchdata/bl1/2026` | **200** | 345,960 bytes. Real 2026/27 Bundesliga. |
| `api.football-data.org/v4/competitions` | 200 | Catalogue page only (74 KB). |
| `api.football-data.org/v4/competitions/PD/standings` | **403** | `{"message":"... restricted ... Please check your subscription.","errorCode":403}` |
| `api.football-data.org/v4/competitions/PD/matches` | **403** | same |
| `api.football-data.org/v4/competitions/CL/standings` | **403** | same |
| `thesportsdb.com/api/v1/json/3/all_leagues.php` | 403 | Blocked at this network/agent identity. |

Rate-limit evidence from the football-data.org response headers:

```
X-Authenticated-Client: anonymous
X-Requests-Available: 47
X-RequestCounter-Reset: 86381     (seconds)
```

47 + 3 calls consumed = 50 ⇒ the anonymous window is **10 requests/minute**, modelled
in the registry as a rolling window.

### What OpenLigaDB really returns (Bundesliga 2026/27)

- 306 matches in the season payload; 72 finished; 66 finished matches carry a goal timeline.
- Goal events: `goalID`, `scoreTeam1`, `scoreTeam2`, `matchMinute`, `goalGetterName`,
  `scoringTeamId`, `isPenalty`, `isOwnGoal`, `isOvertime`.
- `matchResults`: `Halbzeit` and `Endergebnis` (half-time and full-time scores).
- Match: `matchDateTimeUTC`, `lastUpdateDateTime` (newest observed `2026-11-05T13:27:46Z`),
  `matchIsFinished`, `location`, `group.groupName`, `team1/team2 {teamId, teamName, shortName, teamIconUrl, wikidataId}`.
- **No live-minute field. No lineups. No team statistics. No standings table. No referee.**
- Unfinished matches carry **no** partial results (234 unfinished, 0 with results), so a live
  score cannot be read from this feed either.

---

## 2. Capability matrix

Legend: **V** = verified with a real response · **D** = documented only ·
**U** = unverified · **N** = unavailable from that provider · **X** = legally blocked.

| Provider | Competition | Fixtures | Live | Minute | Events | Lineups | Statistics | Standings | Free quota | Rights | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **OpenLigaDB** | Bundesliga 2026/27 | **V** | N | N | **V** (goals: minute, scorer, penalty, own goal, HT/FT) | N | N | N | No documented limit; unauthenticated | ODbL — attribution + share-alike on derived databases | probe JSON; `api.openligadb.de/getmatchdata/bl1/2026` |
| OpenLigaDB | LaLiga, PL, UCL, UEL, UECL listed on site | D | N | N | D | N | N | N | as above | as above | homepage league list only; **not probed** |
| **football-data.org** | LaLiga, Segunda, Copa del Rey, UCL, UEL, UECL, PL, Bundesliga 1–3, Serie A, Ligue 1, Primeira Liga, WC, Euro, Nations League | D | D | D | U | D | D | D | Free plan 10 req/min; anonymous blocked from standings/matches (**V**) | Commercial republication clause **not found** | policies page + live 403 probe |
| API-Football (api-sports.io) | all target competitions | D | D | D | D | D | D | D | 100 requests/day, reset 00:00 UTC (recurring) | Terms grant **no licence to publish**; leagues may hold IP | docs + terms; **no key, never called** |
| TheSportsDB | multi-sport | U | U | U | U | U | U | U | shared key "123", 30 req/min | Free tier is for development; app-store publishing needs paid | probe returned **403**; terms page |
| Sportmonks | — | D | D | D | D | D | D | D | free plan exists; limits **not found** | Redistribution of raw data needs written approval | terms/integrity page |
| Highlightly | general | D | D | D | D | D | D | D | free limit **not found** officially | one-time plan purchase | docs; **no key** |
| SportScore | general | U | U | U | U | U | U | U | ~10,000 req/24h per IP | Commercial OK **with mandatory dofollow badge** | terms page; **not probed** |
| OpenFootball (football.json) | PL, Bundesliga 1–3, LaLiga+Segunda, Serie A/B, Ligue 1/2 | D | N | N | N | N | N | N | none needed | **Public domain** | README; **not probed** |
| StatsBomb Open Data | certain leagues (historic) | D | N | D | D | D | D | N | research only | **Research-only framing; not for commercial republication** | README |
| **Google** | — | X | X | X | X | X | X | X | — | **No official public football REST API exists** | developer product catalogue |
| **SerpApi (Google Sports)** | — | X | X | X | X | X | X | X | 250 searches/month recurring | Terms forbid reproducing/reselling the service; live litigation over SERP-derived data | terms + pricing |
| **Flashscore** | — | X | X | X | X | X | X | X | — | **No permission located**; its scrapers are MIT software, which licenses the code, **not the data** | repo licences vs. no data licence |

### Scoring of the three referenced extraction projects

| Project | Licence of the *code* | Licence of the *data* | Production decision |
|---|---|---|---|
| `ScrapingBee/google-sports-results-api` | not stated as a data licence | Google's own sport results | **Blocked** — no data rights |
| `serpapi/google-sports-api-world-cup` | hosted service terms | Google SERP content | **Blocked** — service resale forbidden |
| `omkarcloud/flashscore-scraper` | MIT (code) | Flashscore proprietary | **Blocked** — MIT covers software only; used as an *engineering reference* for normalisation shape, no runtime dependency |

---

## 3. Recommended combination (free-first, zero spend)

| Need | Provider | State |
|---|---|---|
| Real fixtures, results, goal timelines | **OpenLigaDB** (Bundesliga) | chosen, implemented, verified |
| Fixtures/results for Spanish + UEFA competitions | football-data.org with a **user-supplied** `FOOTBALL_DATA_API_KEY` | adapter exists; tier must be chosen by the owner |
| TV broadcasts | GuíaTV's own EPG + reconciliation | unchanged, already live |
| Live minute, lineups, statistics, referee, standings | **none available free** | BLOCKED |

OpenLigaDB is the only provider marked `approved`. football-data.org stays `prototype`
because its free-tier rights for commercial republication could not be evidenced.
Google, SerpApi and Flashscore are `blocked` with no adapter in the tree.

## 4. Unresolved restrictions (carried into delivery as BLOCKED/PARTIAL, never as PASS)

1. **Commercial republication clause for football-data.org** — terms page could not be read;
   its own materials say data is free "forever" for the listed competitions, but the terms
   are silent on republishing into a commercial site. Owner decision required.
2. **TheSportsDB free tier** forbids app-store publication but is silent on commercial websites;
   probe was 403 from this network.
3. **API-Football** explicitly grants no publication licence and warns of league IP rights.
4. **StatsBomb** is research-only; unusable for production republication.
5. **Sportmonks** forbids redistributing raw data without written approval.
6. **Card/crest images** — no provider's terms were verified to permit third-party crest
   republication. The frontend keeps user-safe URL validation and falls back to generated badges;
   no crests were newly imported.
7. No live-minute source exists among free providers, so the system must show *no* minute
   rather than a derived one.
