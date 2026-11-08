# M06 — Free football data research

Date: **2026-11-06**. Author: captain (the assigned research member was removed after its provider
route ran out of credit; its partial draft was discarded because it asserted coverage the probes
contradict).

Every claim below is tied to a probe recorded in `artifacts/m06/probes/`. Probes are anonymous
read-only GETs. Nothing here is inferred from "the endpoint returned HTTP 200".

---

## 1. Method

1. Enumerate candidate providers from their public documentation.
2. Probe endpoints without credentials where the documentation permits anonymous access.
3. For any provider that returns data, measure **content quality**, not just availability:
   finished matches, goals, goals whose scoring side cannot be resolved, and whether the last goal's
   running score agrees with the recorded final result.
4. Assign a rights verdict from documentation. **Availability is never evidence of permission.**

Two independent negative controls shaped the result:

- A 200 with an empty array (`[]`) proves the endpoint exists but has **no data**. It must never be
  read as coverage.
- A plausible-looking league code can resolve to an unrelated competition. `esp@2026` returns a
  league named **"ESP8266"** (a microcontroller), not Spain. Code names are not semantics.

---

## 2. Providers probed

### 2.1 OpenLigaDB — `api.openligadb.de`

| Property | Value |
|---|---|
| Authentication | none |
| Cost | none |
| Licence | **Open Database License (ODbL)** stated on the site with a link to `/lizenz` |
| Attribution | **required by ODbL** — exact wording **not yet captured** (see §4) |
| Rate limit | no documented limit; no `429` observed |

Season-2026 content measured (`artifacts/m06/probes/openligadb-quality-2026.json`):

| Code | Competition | Fixtures | Finished | Goals | Goals without resolvable side | Final score ≠ last goal | Venue present (finished) |
|---|---|---:|---:|---:|---:|---:|---:|
| `bl1` | 1. Bundesliga | 306 | 72 | 252 | 0 | 0 | 0 / 72 |
| `bl2` | 2. Bundesliga | 306 | 90 | 271 | 1 | 0 | 0 / 90 |
| `pl` | Premier League | 380 | 71 | 204 | 1 | 1 | 0 / 71 |
| `ucl` | Champions League | 144 | 72 | 291 | 0 | 0 | 0 / 72 |
| `uel2026` | Europa League | 144 | 72 | 214 | 0 | 2 | 8 / 72 |
| `uecl2026` | Conference League | 108 | 54 | 148 | 1 | 0 | 0 / 54 |
| `wm2026` | World Cup 2026 | 72 | 72 | 213 | 1 | 4 | 0 / 72 |
| `dfb` | DFB-Pokal | 56 | 48 | 241 | 0 | 5 | 0 / 48 |

Capabilities present: fixtures, kickoff (UTC + local + timezone id), status via `matchIsFinished`,
final and half-time results, goal timelines with scorer, minute, penalty and own-goal flags,
round/matchday (`group`), last update timestamp, team names and ids, sometimes venue.

Capabilities **absent**: referee, lineups, player/team statistics, standings, live minute.

**Verdict: `APPROVED_LIMITED_COVERAGE`** — approved (ODbL, no key, no cost) but limited: no live
minute, lineups, statistics, standings or referee, and no LaLiga.

### 2.2 OpenFootball — `raw.githubusercontent.com/openfootball/football.json`

Files exist for `2026-27/{es,en,de}.1.json` (HTTP 200, 40–55 KB).

Measured on the Spanish file (`artifacts/m06/probes/openfootball-es-sample.json`): 380 fixtures
listed, but **only 64 carry a score and the most recent is matchday 7 (2026-09-20)**. Scores contain
only `ht`/`ft`; there are **no goal events** (`withGoalsList: 0`).

**Verdict: `RESEARCH_ONLY`** — a month-stale snapshot with no events. Activating it would publish
September results as if current. It is not a live or current-day source.

### 2.3 football-data.org

`GET api.football-data.org/v4/competitions/PD/matches` without a key → **HTTP 403**,
`"apparently not within your permissions"`. No `FOOTBALL_DATA_API_KEY` exists in this environment,
and the commercial republication terms have been unresolved since M05.

**Verdict: `REQUIRES_CREDENTIALS`** — and even with a key, rights would need separate resolution
before publication.

### 2.4 TheSportsDB

The documented public demo key (`123`) returns a **truncated** league list (750 bytes; the response
is visibly cut short). The demo key is rate-limited to a couple of requests and is explicitly not for
production.

**Verdict: `BLOCKED`** — demo credentials are not a production entitlement and do not carry
redistribution rights.

### 2.5 Providers rejected on rights without probing

These were not probed because their own terms settle the question:

| Provider | Reason |
|---|---|
| API-Football | free plan excludes commercial redistribution; requires paid subscription |
| Sportmonks | requires a commercial licence |
| StatsBomb open data | historical event data for analysis, not a live production feed |
| Google Sports | no licence to reuse; extraction would be scraping |
| ScrapingBee / SerpApi | extraction services; they do not convey rights to the underlying data |
| Flashscore | no licence; extraction prohibited by its terms |

**Verdict: `LEGAL_REVIEW_REQUIRED` for the extraction services, `BLOCKED` for the rest.**

---

## 3. LaLiga — the shortfall

LaLiga and the Spanish domestic competitions are **not available free in 2026/27**. Endpoints tried:

| Endpoint | Result |
|---|---|
| `getmatchdata/la1/2014` | `[]` |
| `getmatchdata/spa1/2026` | `[]` |
| `getmatchdata/pl1/2026` | `[]` |
| `getmatchdata/esp/2026` | an unrelated **"ESP8266"** league |
| OpenFootball `2026-27/es.1.json` | present but frozen at matchday 7 (2026-09-20), no goal events |
| football-data.org `/competitions/PD/matches` | HTTP 403 (no key) |

Same gap applies to: LaLiga Hypermotion, Copa del Rey, Serie A, Ligue 1, Primeira Liga.

This is a **blocker**, not a softening. Any M06 statement of coverage must exclude them.

---

## 4. What is still not evidenced

**The ODbL attribution wording has not been captured.** `https://www.openligadb.de/lizenz` renders
client-side (Blazor). The homepage states the data are under the ODbL and links to `/lizenz` and
`/nutzungsbedingungen`, but the licence page body was not retrievable in this environment without a
browser, and no browser tool is available to the agent that produced this document.

State: **`LEGAL_EVIDENCE_PARTIAL`**. The attribution text must be captured with a real browser and the
required credit placed on the public site before any production release. This is an open release
blocker, not a research nicety, because ODbL makes attribution obligatory.

---

## 5. Verdict table

| Provider | Free & keyless | 2026/27 data | Live minute | Events | Line-ups | Stats | Standings | Rights | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| OpenLigaDB | yes | **7 competitions** | no | goals | no | no | no | ODbL, attribution pending | `APPROVED_LIMITED_COVERAGE` |
| OpenFootball | yes | stale (MD7) | no | no | no | no | no | permissive | `RESEARCH_ONLY` |
| football-data.org | no key | unverified | — | — | — | — | — | unresolved | `REQUIRES_CREDENTIALS` |
| TheSportsDB | demo only | unverified | — | — | — | — | — | demo, non-prod | `BLOCKED` |
| API-Football | paid | unverified | — | — | — | — | — | prohibits redistribution | `BLOCKED` |
| Sportmonks | paid | unverified | — | — | — | — | — | commercial licence | `BLOCKED` |
| StatsBomb open | yes | historical | no | rich | yes | yes | no | analysis use | `RESEARCH_ONLY` |
| Google Sports | — | — | — | — | — | — | — | no licence | `BLOCKED` |
| ScrapingBee / SerpApi | — | — | — | — | — | — | — | convey no rights | `LEGAL_REVIEW_REQUIRED` |
| Flashscore | — | — | — | — | — | — | — | prohibited | `BLOCKED` |

---

## 6. Result against the M06 acquisition objective

The objective was at least one genuinely free current-season source **beyond** the existing
Bundesliga integration, prioritising Spain and UEFA.

- **UEFA: achieved.** Champions League (291 goals), Europa League (214), Conference League (148)
  are real 2026/27 data from an already-approved, keyless source.
- **England: achieved.** Premier League, 380 fixtures, 71 finished, 204 goals.
- **Germany: extended.** Bundesliga 2 and DFB-Pokal added alongside `bl1`.
- **Spain: not achieved.** LaLiga remains unavailable for free. Recorded as a blocker.

**Verdict: PARTIAL.** The UEFA and Premier League part of the objective succeeded on evidence; the
Spanish part did not, and no source was weakened or "tolerated" to manufacture it.
