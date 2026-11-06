# M05 — Competition and field coverage matrix

Verification date: **2026-11-06**, season **2026/27**.
Supersedes the earlier stub in this file, which predated the multi-provider work (it said
multiprovider was "not implemented in M05", which is no longer true).

"Runtime" means what a visitor can actually see **with today's credentials** (no provider key present).

Status legend: **LIVE** available now · **EPG** only TV schedule + broadcast association, no
sports feed data · **KEY** only once the owner supplies `FOOTBALL_DATA_API_KEY` and accepts the
rights position.

---

## 1. Per-competition runtime status

| Competition (catalog slug) | Provider | Fixtures | Result | Goal events | Live minute | Lineups | Statistics | Standings | Runtime status |
|---|---|---|---|---|---|---|---|---|---|
| Bundesliga (`bundesliga`) | OpenLigaDB (approved) | **yes** | **yes** | **yes** | no | no | no | no | **LIVE** (implemented, wired, verified payload) |
| LaLiga (`laliga`) | football-data.org (prototype) | documented | documented | no | no | no | no | documented | **EPG** — adapter not enabled |
| LaLiga Hypermotion (`laliga-hypermotion`) | football-data.org | documented | documented | no | no | no | no | documented | **EPG** |
| Copa del Rey (`copa-del-rey`) | football-data.org | documented | documented | no | no | no | no | n/a | **EPG** |
| Champions League (`champions-league`) | football-data.org | documented | documented | no | no | no | no | documented | **EPG** |
| Europa League (`europa-league`) | football-data.org | documented | documented | no | no | no | no | documented | **EPG** |
| Conference League (`conference-league`) | football-data.org | documented | documented | no | no | no | no | documented | **EPG** |
| Premier League (`premier-league`) | football-data.org; OpenLigaDB also lists it | documented | documented | no | no | no | no | documented | **EPG** |
| Serie A (`serie-a`) | football-data.org | documented | documented | no | no | no | no | documented | **EPG** |
| Ligue 1 (`ligue-1`) | football-data.org | documented | documented | no | no | no | no | documented | **EPG** |
| Primeira Liga (`primeira-liga`) | football-data.org | documented | documented | no | no | no | no | documented | **EPG** |
| Eredivisie (`eredivisie`) | football-data.org | documented | documented | no | no | no | no | documented | **EPG** |
| FIFA World Cup (`mundial`) | football-data.org | documented | documented | no | no | no | no | n/a | **EPG** |
| Eurocopa / Nations League / Selección (`eurocopa`, `nations-league`, `seleccion-espanola`) | football-data.org | documented | documented | no | no | no | no | n/a | **EPG** |

The catalog covers 16 slugs including all requested competitions. **"Documented" is not
"verified"**: those competitions were **not** exercised with a real response in this session
because no credential exists. They must not be reported as covered until an authenticated probe
runs.

The prior stub's Europa League sample fixtures were **not** verified and are not carried forward.

## 2. Per-field reality check

| Field | Free approved source? | What the UI does |
|---|---|---|
| Kickoff time | **yes** (OpenLigaDB `matchDateTimeUTC`) | shown |
| Final score | **yes** (OpenLigaDB `Endergebnis`) | shown |
| Half-time score | **yes** (OpenLigaDB `Halbzeit`) | shown |
| Goal timeline (minute, scorer, penalty, own goal) | **yes** (66 of 72 finished matches) | shown |
| Live minute | **no** | never shown, never derived from kickoff |
| Injury time | **no** | absent |
| Live score | **no** (no partial results in the feed) | absent until full-time |
| Lineups | **no** | "no disponible" state |
| Statistics / xG | **no** | "n/d", never 0 |
| Referee | **no** | absent (no backend field yet) |
| Stadium | **yes** (`location`) | shown when present |
| Standings | **no** free approved provider | explicit "competición no cubierta" path (built and tested, not yet reachable from the store) |
| TV broadcast | **yes** — GuíaTV's own EPG (unchanged) | shown independently of sports data |

## 3. Before/after

| Capability | Before M05 | After M05 |
|---|---|---|
| Event timelines in the UI | dropped by the mapper (`events: []`) | carried and rendered for Bundesliga |
| Statistics in the UI | dropped (`stats: []`) | carried when supplied; absent explicit, never 0 |
| Approved data providers | 1 (football-data.org, or EPG only) | 2 registered, 1 approved for real data |
| Provider failure handling | whole-provider fallback to EPG-only, losing scores | last-good snapshot preserved with per-field provenance |
| Identity across providers | none | canonical key + quarantine (men/women, reserve, reseason, two legs) |
| Quota protection | none | budget + reserve + throttle + emergency switch |
| Diagnostics | none | admin-only endpoint with redaction |

## 4. Honest headline

For a Bundesliga match the platform now shows **real fixtures, real results and a real goal
timeline**. For every other requested competition it shows the **TV schedule from our own EPG**
and nothing else from a sports feed. That is the ceiling reachable with zero spend and verified
rights today.
